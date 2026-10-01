import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { bearerToken, verifyAuthToken } from './auth-token';
import { resolveEffectivePermissions } from './effective-permissions';
import { UserContext } from './user-context.types';

const DEFAULT_DEV_USER_ID = 'mock-user-1';
const DEFAULT_DEV_FACTORY_ID = '';
const DEFAULT_GUEST_ROLE = 'OTHER';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);
  private readonly allowTestAuthHeaders = process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_TEST_AUTH_HEADERS === 'true';

  constructor(private readonly prisma: PrismaService) {}

  async resolveForFactory(userId: string, factoryId: string): Promise<UserContext> {
    if (process.env.DISABLE_DB === 'true' || process.env.DEV_MODE === 'true') {
      return this.devFallback(userId, factoryId);
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        factoryAccess: {
          where: { factoryId, isActive: true },
          include: {
            department: true,
            company: true,
            factory: { select: { isActive: true, deletedAt: true } },
          },
        },
        permissionOverrides: true,
      },
    });
    const access = user?.factoryAccess[0];
    if (
      !user
      || user.deletedAt
      || user.blockedAt
      || user.passwordResetRequired
      || !access
      || !access.factory.isActive
      || access.factory.deletedAt
    ) {
      return this.guestContext(userId, factoryId);
    }

    const rolePermissions = await this.prisma.db.rolePermission.findMany({
      where: { role: access.role, isActive: true },
      select: { permissionCode: true },
    });
    const permissions = resolveEffectivePermissions({
      role: access.role,
      isGuest: access.isGuest,
      rolePermissionCodes: rolePermissions.map((item) => item.permissionCode),
      overrides: user.permissionOverrides.filter(
        (override) => override.factoryId === null || override.factoryId === factoryId,
      ),
    });
    const isGlobalDepartment = access.department?.scope === 'GLOBAL';

    return {
      userId: user.id,
      selectedFactoryId: factoryId,
      role: access.role,
      departmentId: access.departmentId,
      companyId: access.companyId,
      permissions,
      isAdmin: access.role === 'ADMIN',
      isGuest: access.isGuest,
      scope: isGlobalDepartment
        ? { type: 'GLOBAL', factoryId, departmentId: access.departmentId }
        : { type: 'FACTORY', factoryId, departmentId: access.departmentId },
      id: user.id,
      factoryId,
    };
  }

  async resolve(headers: Record<string, string | string[] | undefined>): Promise<UserContext> {
    const tokenPayload = verifyAuthToken(bearerToken(headers.authorization), 'auth');
    const requestedUserId = tokenPayload?.userId
      ?? (this.allowTestAuthHeaders ? headerValue(headers['x-user-id']) : undefined);
    const isBearerAuth = Boolean(tokenPayload);
    const requestedFactoryId = headerValue(headers['x-factory-id']) ?? headerValue(headers['x-selected-factory-id']);

    if (process.env.DISABLE_DB === 'true' || process.env.DEV_MODE === 'true') {
      return this.devFallback(requestedUserId, requestedFactoryId);
    }

    if (!requestedUserId) {
      return this.guestContext('anonymous', requestedFactoryId ?? '');
    }

    try {
      const user = await this.prisma.db.user.findUnique({
        where: { id: requestedUserId },
        include: {
          factoryAccess: {
            where: { isActive: true },
            include: {
              department: true,
              company: true,
              factory: { select: { isActive: true, deletedAt: true } },
            },
          },
          permissionOverrides: true,
        },
      });

      if (!user) {
        return this.guestContext('anonymous', requestedFactoryId ?? '');
      }

      const tokenIssuedBeforeAuthUpdate = isBearerAuth && user.authUpdatedAt
        ? tokenPayload?.authEpoch !== undefined
          ? tokenPayload.authEpoch !== user.authUpdatedAt.getTime()
          : Math.floor(user.authUpdatedAt.getTime() / 1000) > (tokenPayload?.iat ?? 0)
        : Boolean(isBearerAuth && tokenPayload?.authEpoch);

      if (user.deletedAt || user.blockedAt || tokenIssuedBeforeAuthUpdate || (isBearerAuth && user.passwordResetRequired)) {
        return this.guestContext(requestedUserId, requestedFactoryId ?? '');
      }

      const selectedFactoryId = requestedFactoryId ?? user.factoryId;
      const access = user.factoryAccess.find((item) => item.factoryId === selectedFactoryId);

      if (!access || !access.factory.isActive || access.factory.deletedAt) {
        return this.guestContext(user.id, selectedFactoryId);
      }

      const rolePermissions = await this.prisma.db.rolePermission.findMany({
        where: { role: access.role, isActive: true },
        select: { permissionCode: true },
      });
      const relevantOverrides = user.permissionOverrides.filter(
        (override) => override.factoryId === null || override.factoryId === selectedFactoryId,
      );
      const permissions = resolveEffectivePermissions({
        role: access.role,
        isGuest: access.isGuest,
        rolePermissionCodes: rolePermissions.map((item) => item.permissionCode),
        overrides: relevantOverrides,
      });

      const isGlobalDepartment = access.department?.scope === 'GLOBAL';
      const isAdmin = access.role === 'ADMIN';

      return {
        userId: user.id,
        selectedFactoryId,
        role: access.role,
        departmentId: access.departmentId,
        companyId: access.companyId,
        permissions,
        isAdmin,
        isGuest: access.isGuest,
        scope: isGlobalDepartment
          ? { type: 'GLOBAL', factoryId: selectedFactoryId, departmentId: access.departmentId }
          : { type: 'FACTORY', factoryId: selectedFactoryId, departmentId: access.departmentId },
        id: user.id,
        factoryId: selectedFactoryId,
      };
    } catch (error) {
      this.logger.error('Failed to resolve user context', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  private guestContext(userId: string, selectedFactoryId: string): UserContext {
    return {
      userId,
      selectedFactoryId,
      role: DEFAULT_GUEST_ROLE,
      departmentId: null,
      companyId: null,
      permissions: [],
      isAdmin: false,
      isGuest: true,
      scope: { type: 'GUEST', factoryId: selectedFactoryId || null },
      id: userId,
      factoryId: selectedFactoryId,
    };
  }

  private devFallback(userId?: string, factoryId?: string, role?: string): UserContext {
    const resolvedUserId = userId ?? DEFAULT_DEV_USER_ID;
    const selectedFactoryId = factoryId ?? DEFAULT_DEV_FACTORY_ID;
    const resolvedRole = role ?? 'MASTER';

    return {
      userId: resolvedUserId,
      selectedFactoryId,
      role: resolvedRole,
      departmentId: null,
      companyId: null,
      permissions: ['*'],
      isAdmin: resolvedRole === 'ADMIN',
      isGuest: false,
      scope: { type: 'FACTORY', factoryId: selectedFactoryId, departmentId: null },
      id: resolvedUserId,
      factoryId: selectedFactoryId,
    };
  }
}
