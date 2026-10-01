import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { AssignmentRequestStatus, DepartmentScope, Prisma, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { nextAuthEpoch, signAuthToken, verifyAuthToken } from '../../common/auth-token';
import { assertPasswordPolicy, hashPassword, maskPhone, normalizePhone, PasswordPolicyError, phoneLookupCandidates, verifyPassword } from '../../common/password';
import { verifyRecoveryCredential } from '../../common/recovery-credential';
import { PrismaService } from '../../prisma/prisma.service';
import { UserContextService } from '../../common/user-context.service';
import { UserContext } from '../../common/user-context.types';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { WsService } from '../../ws/ws.service';

export type AvailableFactoryDto = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  role: string;
  departmentName: string | null;
  companyName: string | null;
  isGuest: boolean;
};

const REQUESTABLE_START_ROLES = [UserRole.WORKER, UserRole.CONTRACTOR, UserRole.MASTER] as const;

type AssignmentOption = {
  id: string;
  requestedRole: typeof REQUESTABLE_START_ROLES[number];
  departmentId: string | null;
  companyId: string | null;
  label: string;
  description: string;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class AuthService {
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly allowTestAuth = process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_TEST_AUTH_HEADERS === 'true';

  constructor(
    private readonly prisma: PrismaService,
    private readonly userContextService: UserContextService,
    private readonly auditService: AuditService,
    private readonly wsService: WsService,
  ) {}

  async register(
    body: { phone?: string; password?: string; passwordRepeat?: string; operationId?: string },
    clientKey = 'unknown',
  ) {
    const normalizedPhone = normalizePhone(body.phone ?? '');
    this.consumeRateLimit('register', clientKey, normalizedPhone || 'invalid', 5, 15 * 60 * 1000);
    if (!normalizedPhone) {
      throw new ForbiddenException({ code: 'INVALID_PHONE', message: 'Укажите корректный номер телефона.' });
    }
    this.assertPassword(body.password ?? '');
    if (body.password !== body.passwordRepeat) {
      throw new ForbiddenException({ code: 'PASSWORD_MISMATCH', message: 'Пароли не совпадают.' });
    }
    const operationId = String(body.operationId ?? '').trim();
    if (operationId && (!/^[A-Za-z0-9:_-]+$/.test(operationId) || operationId.length > 120)) {
      throw new ForbiddenException({ code: 'INVALID_OPERATION', message: 'Обновите страницу и повторите регистрацию.' });
    }

    const factory = await this.registrationFactory();
    const now = new Date();
    try {
      const user = await this.prisma.db.$transaction(async (tx) => {
        const candidates = phoneLookupCandidates(normalizedPhone);
        const possibleMatches = await tx.user.findMany({
          where: {
            OR: [
              { normalizedPhone: { in: candidates } },
              { phone: { not: null } },
            ],
          },
          select: { phone: true, normalizedPhone: true },
        });
        if (possibleMatches.some((item) => (
          normalizePhone(item.normalizedPhone ?? '') === normalizedPhone
          || normalizePhone(item.phone ?? '') === normalizedPhone
        ))) {
          throw new ForbiddenException({
            code: 'PHONE_ALREADY_REGISTERED',
            message: 'Этот номер уже зарегистрирован. Войдите или обратитесь к руководителю.',
          });
        }
        const created = await tx.user.create({
          data: {
            factoryId: factory.id,
            role: UserRole.OTHER,
            phone: normalizedPhone,
            normalizedPhone,
            passwordHash: hashPassword(body.password ?? ''),
            passwordChangedAt: now,
            authUpdatedAt: now,
            factoryAccess: {
              create: {
                factoryId: factory.id,
                role: UserRole.OTHER,
                isGuest: true,
                isActive: true,
              },
            },
          },
        });
        await this.auditService.writeTx(tx, {
          userId: created.id,
          factoryId: factory.id,
          action: 'USER_SELF_REGISTERED',
          entityType: 'User',
          entityId: created.id,
          details: {
            phone: maskPhone(normalizedPhone),
            state: 'WAITING_ASSIGNMENT',
            ...(operationId ? { operationId } : {}),
          },
        });
        return created;
      });
      this.clearRateLimit('register', clientKey, normalizedPhone);
      return this.authResponse(user.id, user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ForbiddenException({
          code: 'PHONE_ALREADY_REGISTERED',
          message: 'Этот номер уже зарегистрирован. Войдите или обратитесь к руководителю.',
        });
      }
      throw error;
    }
  }

  async login(body: { phone?: string; password?: string }, clientKey = 'unknown') {
    const normalizedPhone = normalizePhone(body.phone ?? '');
    const maskedPhone = normalizedPhone ? maskPhone(normalizedPhone) : '****';
    this.consumeRateLimit('login', clientKey, normalizedPhone || 'invalid', 10, 5 * 60 * 1000);
    const lookup = phoneLookupCandidates(body.phone ?? '');
    const matches = lookup.length
      ? await this.prisma.db.user.findMany({ where: { normalizedPhone: { in: lookup } }, take: 3 })
      : [];
    // A blocked legacy duplicate must not lock out the one usable profile.
    const usableMatches = matches.filter((candidate) => !candidate.deletedAt && !candidate.blockedAt);
    const collision = usableMatches.length > 1 || (usableMatches.length === 0 && matches.length > 1);
    if (collision) {
      await this.writeLoginFailed(null, maskedPhone, 'PHONE_COLLISION');
      throw new ForbiddenException({ code: 'PHONE_COLLISION', message: 'Номер связан с несколькими профилями. Обратитесь к администратору.' });
    }
    const user = usableMatches[0] ?? matches[0] ?? null;

    if (!user || user.deletedAt) {
      await this.writeLoginFailed(null, maskedPhone, 'NO_MATCH');
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Неверный телефон или пароль.' });
    }

    if (user.blockedAt) {
      await this.writeLoginFailed(user.id, maskedPhone, 'BLOCKED');
      throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'Доступ заблокирован. Обратитесь к администратору.' });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException({
        code: 'LOGIN_TEMPORARILY_LOCKED',
        message: 'Слишком много попыток входа. Повторите через несколько минут.',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (user.passwordResetRequired) {
      const now = new Date();
      const recoveryFactoryId = user.passwordRecoveryFactoryId;
      const recoveryAccess = recoveryFactoryId
        ? await this.prisma.db.userFactoryAccess.findFirst({
            where: {
              userId: user.id,
              factoryId: recoveryFactoryId,
              isActive: true,
              isGuest: false,
              factory: { isActive: true, deletedAt: null },
            },
            select: { id: true },
          })
        : null;
      if (!recoveryFactoryId || !recoveryAccess) {
        await this.writeLoginFailed(user.id, maskedPhone, 'RECOVERY_ACCESS_REVOKED');
        throw new ForbiddenException({
          code: 'RECOVERY_ACCESS_REVOKED',
          message: 'Доступ к заводу отозван. Обратитесь к администратору.',
        });
      }
      const recoveryValid = Boolean(
        user.passwordRecoveryHash
        && user.passwordRecoveryExpiresAt
        && user.passwordRecoveryExpiresAt.getTime() > now.getTime()
        && verifyRecoveryCredential(body.password ?? '', user.passwordRecoveryHash),
      );
      if (!recoveryValid) {
        const failedLoginCount = user.failedLoginCount + 1;
        await this.prisma.db.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount,
            lockedUntil: failedLoginCount >= 10 ? new Date(now.getTime() + 5 * 60 * 1000) : null,
          },
        });
        await this.writeLoginFailed(user.id, maskedPhone, 'BAD_OR_EXPIRED_RECOVERY_CREDENTIAL');
        throw new UnauthorizedException({
          code: 'INVALID_RECOVERY_CREDENTIAL',
          message: 'Неверный или истёкший временный код. Обратитесь к администратору.',
        });
      }

      const nextAuthEpochValue = nextAuthEpoch(user.authUpdatedAt);
      const claimed = await this.prisma.db.user.updateMany({
        where: {
          id: user.id,
          blockedAt: null,
          deletedAt: null,
          passwordResetRequired: true,
          passwordRecoveryHash: user.passwordRecoveryHash,
          passwordRecoveryExpiresAt: { gt: now },
          passwordRecoveryFactoryId: recoveryFactoryId,
          authUpdatedAt: user.authUpdatedAt,
          factoryAccess: {
            some: {
              factoryId: recoveryFactoryId,
              isActive: true,
              isGuest: false,
              factory: { isActive: true, deletedAt: null },
            },
          },
        },
        data: {
          passwordRecoveryHash: null,
          passwordRecoveryExpiresAt: null,
          passwordRecoveryConsumedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          authUpdatedAt: nextAuthEpochValue,
        },
      });
      if (claimed.count !== 1) {
        await this.writeLoginFailed(user.id, maskedPhone, 'RECOVERY_CREDENTIAL_ALREADY_USED');
        throw new UnauthorizedException({
          code: 'RECOVERY_CREDENTIAL_ALREADY_USED',
          message: 'Временный код уже использован или заменён. Обратитесь к администратору.',
        });
      }
      await this.auditService.write({
        userId: user.id,
        factoryId: user.factoryId,
        action: 'PASSWORD_RESET_FLOW_STARTED',
        entityType: 'Auth',
        entityId: user.id,
        details: { phone: maskedPhone },
      });
      this.clearRateLimit('login', clientKey, normalizedPhone);
      return {
        requiresPasswordChange: true,
        setupToken: signAuthToken(user.id, 15 * 60, 'password-setup', this.authEpoch(nextAuthEpochValue)),
        userId: user.id,
        availableFactories: await this.getAvailableFactories(user.id),
      };
    }

    if (!verifyPassword(body.password ?? '', user.passwordHash)) {
      const failedLoginCount = user.failedLoginCount + 1;
      await this.prisma.db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= 10 ? new Date(Date.now() + 5 * 60 * 1000) : null,
        },
      });
      await this.writeLoginFailed(user.id, maskedPhone, 'BAD_PASSWORD');
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Неверный телефон или пароль.' });
    }

    const accepted = await this.prisma.db.user.updateMany({
      where: {
        id: user.id,
        passwordHash: user.passwordHash,
        authUpdatedAt: user.authUpdatedAt,
        passwordResetRequired: false,
        blockedAt: null,
        deletedAt: null,
        lockedUntil: user.lockedUntil ?? null,
      },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    if (accepted.count !== 1) {
      await this.writeLoginFailed(user.id, maskedPhone, 'CREDENTIAL_CHANGED_DURING_LOGIN');
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Данные для входа изменились. Войдите заново.' });
    }
    const response = await this.authResponse(user.id, user);
    this.clearRateLimit('login', clientKey, normalizedPhone);

    await this.auditService.write({
      userId: user.id,
      factoryId: user.factoryId,
      action: 'LOGIN_SUCCESS',
      entityType: 'Auth',
      entityId: user.id,
      details: { phone: maskedPhone },
    });

    return response;
  }

  async setPassword(body: { setupToken?: string; newPassword?: string; passwordRepeat?: string }) {
    const payload = verifyAuthToken(body.setupToken, 'password-setup');
    if (!payload) throw new ForbiddenException({ code: 'INVALID_PASSWORD_SETUP_TOKEN', message: 'Сессия установки пароля истекла. Обратитесь к администратору.' });
    this.assertPassword(body.newPassword ?? '');
    if (body.newPassword !== body.passwordRepeat) {
      throw new ForbiddenException({ code: 'PASSWORD_MISMATCH', message: 'Пароли не совпадают.' });
    }

    const user = await this.prisma.db.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.deletedAt || user.blockedAt) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя установить пароль для этого пользователя.' });
    }
    if (
      !user.passwordResetRequired
      || user.passwordRecoveryHash
      || !user.passwordRecoveryFactoryId
      || payload.authEpoch === undefined
      || payload.authEpoch !== this.authEpoch(user.authUpdatedAt)
    ) {
      throw new ForbiddenException({
        code: 'PASSWORD_SETUP_ALREADY_USED',
        message: 'Ссылка смены пароля уже использована. Войдите с новым паролем.',
      });
    }

    const nextAuthEpochValue = nextAuthEpoch(user.authUpdatedAt);
    const claimed = await this.prisma.db.user.updateMany({
      where: {
        id: user.id,
        blockedAt: null,
        deletedAt: null,
        passwordResetRequired: true,
        passwordRecoveryHash: null,
        passwordRecoveryFactoryId: user.passwordRecoveryFactoryId,
        authUpdatedAt: user.authUpdatedAt,
        factoryAccess: {
          some: {
            factoryId: user.passwordRecoveryFactoryId,
            isActive: true,
            isGuest: false,
            factory: { isActive: true, deletedAt: null },
          },
        },
      },
      data: {
        passwordHash: hashPassword(body.newPassword ?? ''),
        passwordResetRequired: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        authUpdatedAt: nextAuthEpochValue,
        passwordRecoveryHash: null,
        passwordRecoveryExpiresAt: null,
        passwordRecoveryIssuedAt: null,
        passwordRecoveryIssuedById: null,
        passwordRecoveryFactoryId: null,
        passwordRecoveryConsumedAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ForbiddenException({
        code: 'PASSWORD_SETUP_ALREADY_USED',
        message: 'Ссылка смены пароля уже использована. Войдите с новым паролем.',
      });
    }

    await this.auditService.write({
      userId: user.id,
      factoryId: user.factoryId,
      action: 'PASSWORD_SET_AFTER_RESET',
      entityType: 'User',
      entityId: user.id,
      details: {},
    });
    this.wsService.notifyAuthChanged(user.id);

    return { ok: true, requiresLogin: true };
  }

  async changePassword(context: UserContext, body: { oldPassword?: string; newPassword?: string }) {
    if (!context || context.isGuest) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Войдите, чтобы изменить пароль.' });
    this.assertPassword(body.newPassword ?? '');
    const user = await this.prisma.db.user.findUnique({ where: { id: context.userId } });
    if (!user || user.deletedAt || user.blockedAt || user.passwordResetRequired) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь недоступен.' });
    if (!verifyPassword(body.oldPassword ?? '', user.passwordHash)) {
      throw new UnauthorizedException({ code: 'INVALID_OLD_PASSWORD', message: 'Старый пароль неверен.' });
    }

    const changed = await this.prisma.db.user.updateMany({
      where: {
        id: user.id,
        passwordHash: user.passwordHash,
        authUpdatedAt: user.authUpdatedAt,
        passwordResetRequired: false,
        blockedAt: null,
        deletedAt: null,
        factoryAccess: {
          some: {
            factoryId: context.selectedFactoryId,
            isActive: true,
            isGuest: false,
            factory: { isActive: true, deletedAt: null },
          },
        },
      },
      data: {
        passwordHash: hashPassword(body.newPassword ?? ''),
        passwordResetRequired: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        authUpdatedAt: nextAuthEpoch(user.authUpdatedAt),
        passwordRecoveryHash: null,
        passwordRecoveryExpiresAt: null,
        passwordRecoveryIssuedAt: null,
        passwordRecoveryIssuedById: null,
        passwordRecoveryFactoryId: null,
        passwordRecoveryConsumedAt: null,
      },
    });
    if (changed.count !== 1) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_CONFLICT', message: 'Пароль или доступ изменились. Войдите заново.' });
    }
    await this.auditService.write({
      userId: user.id,
      factoryId: context.selectedFactoryId || user.factoryId,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      details: {},
    });
    this.wsService.notifyAuthChanged(user.id);
    return { ok: true };
  }

  async logout(context: UserContext) {
    if (context && !context.isGuest) {
      await this.auditService.write({
        userId: context.userId,
        factoryId: context.selectedFactoryId || null,
        action: 'LOGOUT',
        entityType: 'Auth',
        entityId: context.userId,
        details: {},
      });
    }
    return { ok: true };
  }

  async devLogin(userId: string) {
    if (!this.allowTestAuth) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Тестовый вход отключён.' });
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      return {
        userId: userId || 'anonymous',
        role: 'OTHER',
        employeeState: 'AVAILABLE',
        availableFactories: [],
        recommendedFactoryId: null,
      };
    }

    const availableFactories = await this.getAvailableFactories(userId);
    return {
      userId: user.id,
      role: user.role,
      employeeState: user.employeeState,
      availableFactories,
      recommendedFactoryId: availableFactories[0]?.id ?? null,
    };
  }

  async me(context: UserContext) {
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: context.userId, factoryId: context.selectedFactoryId } },
      include: { user: true, department: true, jobTitle: true, company: true },
    });
    return {
      userId: context.userId,
      selectedFactoryId: context.selectedFactoryId,
      role: context.role,
      departmentId: context.departmentId,
      companyId: context.companyId,
      permissions: context.permissions,
      isAdmin: context.isAdmin,
      isGuest: context.isGuest,
      displayName: access?.user ? pilotDisplayName(access.user) : pilotDisplayName(context.userId),
      departmentName: access?.department?.name ?? null,
      companyName: access?.company?.name ?? null,
      jobTitleName: access?.jobTitle?.name ?? null,
      scope: context.scope,
      availableFactories: await this.getAvailableFactories(context.userId),
    };
  }

  async getAvailableFactories(userId: string): Promise<AvailableFactoryDto[]> {
    if (!userId || userId === 'anonymous') return [];

    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { blockedAt: true, deletedAt: true },
    });
    if (!user || user.blockedAt || user.deletedAt) return [];

    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        userId,
        isActive: true,
        factory: { isActive: true, deletedAt: null },
      },
      include: {
        factory: true,
        department: true,
        company: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const includeDiagnosticFactories = process.env.ZAVOD_INCLUDE_DIAGNOSTIC_FACTORIES === 'true';
    return access.filter((item) => includeDiagnosticFactories || !hasPilotFixtureMarker(item.factory.id, item.factory.name, item.factory.code)).map((item) => ({
      id: item.factory.id,
      name: item.factory.name,
      code: item.factory.code,
      isActive: item.factory.isActive,
      role: item.role,
      departmentName: item.department?.name ?? null,
      companyName: item.company?.name ?? null,
      isGuest: item.isGuest,
    }));
  }

  async assignmentRequestContext(context: UserContext) {
    const access = await this.assertAssignmentRequestActor(context);
    const [request, departments, companies] = await Promise.all([
      this.prisma.db.assignmentRequest.findFirst({
        where: { requestedById: context.userId, factoryId: context.selectedFactoryId },
        include: { department: true, company: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.department.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [{ factoryId: context.selectedFactoryId }, { scope: DepartmentScope.GLOBAL }],
        },
        orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.db.externalCompany.findMany({
        where: { factoryId: context.selectedFactoryId, isActive: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const assignments = this.buildAssignmentOptions(
      departments.filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code)),
      companies.filter((company) => !hasPilotFixtureMarker(company.id, company.name)),
    );
    return {
      status: access.isGuest ? 'WAITING_ASSIGNMENT' : 'ASSIGNED',
      request: request ? this.serializeAssignmentRequest(request) : null,
      options: {
        assignments: assignments.map(({ id, label, description }) => ({ id, label, description })),
      },
    };
  }

  async createAssignmentRequest(context: UserContext, body: any) {
    await this.assertAssignmentRequestActor(context, true);
    if (body.requestedRole !== undefined || body.departmentId !== undefined || body.companyId !== undefined) {
      throw new ForbiddenException({ code: 'INVALID_ASSIGNMENT_OPTION', message: 'Выберите одно готовое назначение из списка.' });
    }
    const operationId = String(body.operationId ?? '').trim();
    if (!operationId || operationId.length > 120) {
      throw new ForbiddenException({ code: 'INVALID_OPERATION', message: 'Обновите страницу и повторите отправку заявки.' });
    }
    const existingOperation = await this.prisma.db.assignmentRequest.findUnique({
      where: { operationId },
      include: { department: true, company: true },
    });
    if (existingOperation) {
      if (existingOperation.requestedById !== context.userId || existingOperation.factoryId !== context.selectedFactoryId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Эта заявка относится к другому пользователю.' });
      }
      return this.serializeAssignmentRequest(existingOperation);
    }

    const [departments, companies] = await Promise.all([
      this.prisma.db.department.findMany({
        where: { isActive: true, deletedAt: null, OR: [{ factoryId: context.selectedFactoryId }, { scope: DepartmentScope.GLOBAL }] },
      }),
      this.prisma.db.externalCompany.findMany({ where: { factoryId: context.selectedFactoryId, isActive: true } }),
    ]);
    const optionId = String(body.assignmentOptionId ?? '').trim();
    const option = this.buildAssignmentOptions(
      departments.filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code)),
      companies.filter((company) => !hasPilotFixtureMarker(company.id, company.name)),
    ).find((item) => item.id === optionId);
    if (!option) {
      throw new ForbiddenException({ code: 'INVALID_ASSIGNMENT_OPTION', message: 'Выбранное назначение недоступно. Обновите список.' });
    }
    const { requestedRole, departmentId, companyId } = option;

    const active = await this.prisma.db.assignmentRequest.findFirst({
      where: { requestedById: context.userId, factoryId: context.selectedFactoryId, status: AssignmentRequestStatus.PENDING },
      include: { department: true, company: true },
    });
    if (active) return this.serializeAssignmentRequest(active);

    const comment = String(body.comment ?? '').trim().slice(0, 500) || null;
    const request = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.assignmentRequest.create({
        data: {
          factoryId: context.selectedFactoryId,
          requestedById: context.userId,
          requestedRole,
          departmentId,
          companyId,
          comment,
          operationId,
          activeKey: `${context.userId}:${context.selectedFactoryId}`,
        },
        include: { department: true, company: true },
      });
      await this.auditService.writeTx(tx, {
        userId: context.userId,
        factoryId: context.selectedFactoryId,
        action: 'ASSIGNMENT_REQUEST_CREATED',
        entityType: 'AssignmentRequest',
        entityId: created.id,
        details: { requestedRole, departmentId, companyId, hasComment: Boolean(comment) },
      });
      return created;
    });
    return this.serializeAssignmentRequest(request);
  }

  private async assertAssignmentRequestActor(context: UserContext, requireGuest = false) {
    if (!context?.userId || context.userId === 'anonymous' || !context.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Войдите и выберите завод.' });
    }
    const access = await this.prisma.db.userFactoryAccess.findFirst({
      where: {
        userId: context.userId,
        factoryId: context.selectedFactoryId,
        isActive: true,
        user: { blockedAt: null, deletedAt: null },
        factory: { isActive: true, deletedAt: null },
      },
    });
    if (!access || (requireGuest && !access.isGuest)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: requireGuest ? 'Заявку может отправить только гость.' : 'Доступ к заводу недоступен.' });
    }
    return access;
  }

  private serializeAssignmentRequest(request: any) {
    return {
      id: request.id,
      status: request.status,
      requestedRole: request.requestedRole,
      roleLabel: this.assignmentRoleLabel(request.requestedRole),
      departmentId: request.departmentId,
      departmentName: request.department?.name ?? null,
      companyId: request.companyId,
      companyName: request.company?.name ?? null,
      comment: request.comment,
      version: request.version,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      decisionReason: request.decisionReason,
    };
  }

  private assignmentRoleLabel(role: UserRole) {
    if (role === UserRole.CONTRACTOR) return 'Наёмный работник';
    if (role === UserRole.MASTER) return 'Мастер';
    return 'Работник';
  }

  private buildAssignmentOptions(departments: Array<{ id: string; name: string }>, companies: Array<{ id: string; name: string }>): AssignmentOption[] {
    const optionId = (role: UserRole, target: 'department' | 'company', id: string) => (
      `assignment-${createHash('sha256').update(`v1:${role}:${target}:${id}`).digest('base64url').slice(0, 24)}`
    );
    const departmentOptions = departments.flatMap((department) => [UserRole.WORKER, UserRole.MASTER].map((requestedRole) => ({
      id: optionId(requestedRole, 'department', department.id),
      requestedRole,
      departmentId: department.id,
      companyId: null,
      label: `${this.assignmentRoleLabel(requestedRole)} · ${department.name}`,
      description: `Должность: ${this.assignmentRoleLabel(requestedRole)}. Подразделение: ${department.name}.`,
    })));
    const companyOptions = companies.map((company) => ({
      id: optionId(UserRole.CONTRACTOR, 'company', company.id),
      requestedRole: UserRole.CONTRACTOR,
      departmentId: null,
      companyId: company.id,
      label: `${this.assignmentRoleLabel(UserRole.CONTRACTOR)} · ${company.name}`,
      description: `Должность: ${this.assignmentRoleLabel(UserRole.CONTRACTOR)}. Фирма: ${company.name}.`,
    }));
    return [...departmentOptions, ...companyOptions].sort((left, right) => left.label.localeCompare(right.label, 'ru'));
  }

  private async authResponse(userId: string, credentialSnapshot: { passwordHash: string | null; authUpdatedAt: Date | null }) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.blockedAt) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь недоступен.' });
    if (user.passwordResetRequired || user.passwordHash !== credentialSnapshot.passwordHash
      || this.authEpoch(user.authUpdatedAt) !== this.authEpoch(credentialSnapshot.authUpdatedAt)) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Данные для входа изменились. Войдите заново.' });
    }
    const availableFactories = await this.getAvailableFactories(userId);
    return {
      token: signAuthToken(userId, 24 * 60 * 60, 'auth', this.authEpoch(credentialSnapshot.authUpdatedAt)),
      userId,
      role: user.role,
      employeeState: user.employeeState,
      availableFactories,
      recommendedFactoryId: availableFactories[0]?.id ?? null,
      requiresPasswordChange: false,
    };
  }

  private assertPassword(password: string) {
    try {
      assertPasswordPolicy(password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw new ForbiddenException({ code: error.code, message: error.message });
      }
      throw new ForbiddenException({ code: 'INVALID_PASSWORD', message: 'Пароль не соответствует требованиям безопасности.' });
    }
  }

  private async registrationFactory() {
    const configuredCode = process.env.REGISTRATION_FACTORY_CODE?.trim() || 'factory-4';
    const factory = await this.prisma.db.factory.findFirst({
      where: { code: configuredCode, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!factory) {
      throw new ForbiddenException({
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Регистрация временно недоступна. Обратитесь к администратору.',
      });
    }
    return factory;
  }

  private authEpoch(value: Date | null | undefined) {
    return value?.getTime() ?? 0;
  }

  private rateKey(scope: string, clientKey: string, normalizedPhone: string) {
    return createHash('sha256').update(`${scope}:${clientKey}:${normalizedPhone}`).digest('hex');
  }

  private consumeRateLimit(
    scope: string,
    clientKey: string,
    normalizedPhone: string,
    limit: number,
    windowMs: number,
  ) {
    const now = Date.now();
    if (this.rateBuckets.size > 5000) {
      for (const [key, bucket] of this.rateBuckets) {
        if (bucket.resetAt <= now) this.rateBuckets.delete(key);
      }
    }
    const key = this.rateKey(scope, clientKey, normalizedPhone);
    const current = this.rateBuckets.get(key);
    const next = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
    this.rateBuckets.set(key, next);
    if (next.count > limit) {
      throw new HttpException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Слишком много попыток. Повторите через несколько минут.',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private clearRateLimit(scope: string, clientKey: string, normalizedPhone: string) {
    this.rateBuckets.delete(this.rateKey(scope, clientKey, normalizedPhone));
  }

  private async writeLoginFailed(userId: string | null, maskedPhone: string, reason: string) {
    await this.auditService.write({
      userId,
      factoryId: null,
      action: 'LOGIN_FAILED',
      entityType: 'Auth',
      entityId: userId,
      details: { phone: maskedPhone, reason },
    });
  }
}
