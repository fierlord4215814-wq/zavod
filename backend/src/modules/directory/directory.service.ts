import { ForbiddenException, Injectable } from '@nestjs/common';
import { DepartmentScope, Prisma, UserRole } from '@prisma/client';
import { hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotFixtureUser, isPilotVisibleLine, pilotDisplayName } from '../../common/pilot-visibility';
import { maskPhone, normalizePhoneSearchDigits } from '../../common/password';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async canonicalDepartments(factoryId: string, query = '') {
    const departments = await this.prisma.db.department.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { factoryId },
          { factoryId: null, scope: DepartmentScope.GLOBAL },
        ],
        ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });

    const canonical = new Map<string, typeof departments[number]>();
    for (const department of departments) {
      if (hasPilotFixtureMarker(department.id, department.name, department.code)) continue;
      const key = this.normalizeDepartmentName(department.normalizedName ?? department.name);
      if (!key) continue;
      const current = canonical.get(key);
      if (!current || (current.factoryId === null && department.factoryId === factoryId)) {
        canonical.set(key, department);
      }
    }

    return [...canonical.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
      .map((department) => ({
        id: department.id,
        name: department.name,
        code: department.code,
        scope: department.scope,
        factoryId: department.factoryId,
      }));
  }

  async users(user: UserContext, query: { q?: string; role?: UserRole; departmentId?: string; factoryId?: string; page?: string; limit?: string }) {
    const factoryId = this.resolveFactory(user, query.factoryId);
    const requestedPage = Number.parseInt(String(query.page ?? ''), 10);
    const requestedLimit = Number.parseInt(String(query.limit ?? ''), 10);
    const paginated = Number.isFinite(requestedPage) || Number.isFinite(requestedLimit);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100;
    const searchTerms = String(query.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    const searchWhere = searchTerms.length
      ? {
          AND: searchTerms.map((term) => {
            const digits = normalizePhoneSearchDigits(term);
            return {
              OR: [
                { id: { contains: term, mode: 'insensitive' as const } },
                { lastName: { contains: term, mode: 'insensitive' as const } },
                { firstName: { contains: term, mode: 'insensitive' as const } },
                { middleName: { contains: term, mode: 'insensitive' as const } },
                ...(digits.length >= 3
                  ? [
                      { normalizedPhone: { contains: digits, mode: 'insensitive' as const } },
                      { phone: { contains: digits, mode: 'insensitive' as const } },
                    ]
                  : []),
              ],
            };
          }),
        }
      : {};
    const where: Prisma.UserFactoryAccessWhereInput = {
      factoryId,
      isActive: true,
      isGuest: false,
      ...(query.role ? { role: query.role } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(user.role === UserRole.MANAGEMENT && !user.isAdmin
        ? { OR: [{ departmentId: user.departmentId }, { departmentId: null }] }
        : {}),
      user: {
        blockedAt: null,
        deletedAt: null,
        ...searchWhere,
      },
    };
    const [access, total] = await Promise.all([
      this.prisma.db.userFactoryAccess.findMany({
        where,
        include: { user: true, department: true },
        orderBy: [
          { user: { lastName: 'asc' } },
          { user: { firstName: 'asc' } },
          { role: 'asc' },
          { userId: 'asc' },
        ],
        skip: paginated ? (page - 1) * limit : 0,
        take: limit,
      }),
      this.prisma.db.userFactoryAccess.count({ where }),
    ]);
    const items = access
      .filter((item) => this.canSeeDepartmentOption(user, item.departmentId) && !isPilotFixtureUser(item.user))
      .map((item) => ({
        userId: item.userId,
        displayName: pilotDisplayName(item.user),
        role: item.role,
        departmentId: item.departmentId,
        departmentName: item.department?.name ?? null,
        phoneLabel: item.user.normalizedPhone || item.user.phone
          ? maskPhone(item.user.normalizedPhone ?? item.user.phone ?? '')
          : null,
        employeeState: item.user.employeeState,
        factoryId: item.factoryId,
      }));
    return paginated
      ? { items, total, page, limit, hasMore: page * limit < total }
      : items;
  }

  async departments(user: UserContext, query: { q?: string; factoryId?: string }) {
    const factoryId = this.resolveFactory(user, query.factoryId);
    const departments = await this.canonicalDepartments(factoryId, query.q);
    return departments
      .filter((department) => this.canSeeDepartmentOption(user, department.id));
  }

  async lines(user: UserContext, query: { q?: string; factoryId?: string; includeDiagnostics?: string }) {
    const factoryId = this.resolveFactory(user, query.factoryId);
    const includeDiagnostics = user.isAdmin
      && isDiagnosticFixtureActor(user.userId)
      && String(query.includeDiagnostics ?? '').toLowerCase() === 'true';
    const lines = await this.prisma.db.line.findMany({
      where: {
        factoryId,
        deletedAt: null,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return lines
      .filter((line) => includeDiagnostics || isPilotVisibleLine(line))
      .map((line) => ({ id: line.id, name: line.name, status: line.status, factoryId: line.factoryId }));
  }

  roles() {
    return Object.values(UserRole).map((role) => ({ code: role }));
  }

  private resolveFactory(user: UserContext, requestedFactoryId?: string) {
    const factoryId = requestedFactoryId || user.selectedFactoryId;
    if (!factoryId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Выберите завод.' });
    if (factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к справочнику другого завода.' });
    }
    return factoryId;
  }

  private canSeeDepartmentOption(user: UserContext, departmentId: string | null) {
    if (user.isAdmin) return true;
    if (user.role !== UserRole.MANAGEMENT) return true;
    return !departmentId || departmentId === user.departmentId;
  }

  private normalizeDepartmentName(value: string) {
    return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }
}
