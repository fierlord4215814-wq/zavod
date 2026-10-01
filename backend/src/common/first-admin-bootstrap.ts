import { PrismaClient, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { maskPhone, normalizePhone } from './password';
import {
  assertRecoveryCredentialPolicy,
  hashRecoveryCredential,
  recoveryCredentialExpiresAt,
  verifyRecoveryCredential,
} from './recovery-credential';
import { SYSTEM_FOUNDATION_ID } from './system-foundation';

export type FirstAdminBootstrapInput = {
  factoryName: string;
  factoryCode: string;
  adminPhone: string;
  adminLastName: string;
  adminFirstName: string;
  adminMiddleName?: string | null;
  recoveryCredential: string;
  credentialTtlMinutes?: number;
};

export type FirstAdminBootstrapResult = {
  status: 'CREATED' | 'ALREADY_COMPLETED';
  changed: boolean;
  factoryId: string;
  adminUserId: string;
  maskedPhone: string;
  credentialExpiresAt: Date;
};

export type FirstAdminBootstrapTestHooks = {
  failAfter?: 'factory' | 'user' | 'access';
};

export type FirstAdminRecoveryInput = {
  databaseName: string;
  serverAddress: string;
  serverPort: number;
  factoryCode: string;
  adminPhone: string;
  recoveryCredential: string;
  credentialTtlMinutes?: number;
};

export type FirstAdminRecoveryResult = {
  status: 'REISSUED' | 'ALREADY_REISSUED';
  changed: boolean;
  maskedPhone: string;
  credentialExpiresAt: Date;
};

export type FirstAdminRecoveryTestHooks = {
  failAfterUpdate?: boolean;
};

function cleanRequired(value: string, label: string, maxLength: number) {
  const result = String(value ?? '').trim();
  if (result.length < 2 || result.length > maxLength) {
    throw new Error(`${label}: требуется от 2 до ${maxLength} символов.`);
  }
  return result;
}

function normalizeFactoryCode(value: string) {
  const result = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(result)) {
    throw new Error('Код завода должен содержать 2–50 строчных латинских букв, цифр или дефисов.');
  }
  return result;
}

function inputFingerprint(input: {
  factoryName: string;
  factoryCode: string;
  adminPhone: string;
  adminLastName: string;
  adminFirstName: string;
  adminMiddleName: string | null;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function detailsFingerprint(details: unknown) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const value = (details as Record<string, unknown>).requestFingerprint;
  return typeof value === 'string' ? value : null;
}

export async function bootstrapFirstAdmin(
  prisma: PrismaClient,
  rawInput: FirstAdminBootstrapInput,
  testHooks: FirstAdminBootstrapTestHooks = {},
): Promise<FirstAdminBootstrapResult> {
  const normalizedPhone = normalizePhone(rawInput.adminPhone);
  if (!normalizedPhone) throw new Error('Укажите корректный телефон первого администратора.');
  assertRecoveryCredentialPolicy(rawInput.recoveryCredential);

  const normalized = {
    factoryName: cleanRequired(rawInput.factoryName, 'Название завода', 120),
    factoryCode: normalizeFactoryCode(rawInput.factoryCode),
    adminPhone: normalizedPhone,
    adminLastName: cleanRequired(rawInput.adminLastName, 'Фамилия администратора', 80),
    adminFirstName: cleanRequired(rawInput.adminFirstName, 'Имя администратора', 80),
    adminMiddleName: String(rawInput.adminMiddleName ?? '').trim().slice(0, 80) || null,
  };
  const requestFingerprint = inputFingerprint(normalized);
  const passwordRecoveryHash = hashRecoveryCredential(rawInput.recoveryCredential);
  const now = new Date();
  const credentialExpiresAt = recoveryCredentialExpiresAt(now, rawInput.credentialTtlMinutes);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(914221, 2)::text AS lock_result`;

    const foundation = await tx.systemFoundationState.findUnique({
      where: { id: SYSTEM_FOUNDATION_ID },
    });
    if (!foundation) {
      throw new Error('Системная основа не применена. Сначала выполните vps-prep:foundation.');
    }

    const [factoryCount, userCount, accessCount] = await Promise.all([
      tx.factory.count(),
      tx.user.count(),
      tx.userFactoryAccess.count(),
    ]);

    if (factoryCount || userCount || accessCount) {
      const [factory, user, audit] = await Promise.all([
        tx.factory.findUnique({ where: { code: normalized.factoryCode } }),
        tx.user.findUnique({ where: { normalizedPhone } }),
        tx.auditLog.findFirst({
          where: { action: 'FIRST_ADMIN_BOOTSTRAPPED', entityType: 'SystemBootstrap' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const access = factory && user
        ? await tx.userFactoryAccess.findUnique({
            where: { userId_factoryId: { userId: user.id, factoryId: factory.id } },
          })
        : null;
      const exactCompleted = factoryCount === 1
        && userCount === 1
        && accessCount === 1
        && factory?.name === normalized.factoryName
        && !factory.deletedAt
        && user?.lastName === normalized.adminLastName
        && user.firstName === normalized.adminFirstName
        && user.middleName === normalized.adminMiddleName
        && !user.deletedAt
        && !user.blockedAt
        && access?.role === UserRole.ADMIN
        && access.isActive
        && !access.isGuest
        && verifyRecoveryCredential(rawInput.recoveryCredential, user.passwordRecoveryHash)
        && detailsFingerprint(audit?.details) === requestFingerprint;
      if (exactCompleted && factory && user) {
        return {
          status: 'ALREADY_COMPLETED',
          changed: false,
          factoryId: factory.id,
          adminUserId: user.id,
          maskedPhone: maskPhone(normalizedPhone),
          credentialExpiresAt: user.passwordRecoveryExpiresAt ?? credentialExpiresAt,
        };
      }
      throw new Error('FIRST_ADMIN_BOOTSTRAP_REFUSED: identity/factory state is not empty. Existing and soft-deleted records are not changed.');
    }

    const factory = await tx.factory.create({
      data: { name: normalized.factoryName, code: normalized.factoryCode, isActive: true },
    });
    if (testHooks.failAfter === 'factory') throw new Error('TEST_FAIL_AFTER_FACTORY');

    const admin = await tx.user.create({
      data: {
        factoryId: factory.id,
        role: UserRole.ADMIN,
        phone: normalizedPhone,
        normalizedPhone,
        lastName: normalized.adminLastName,
        firstName: normalized.adminFirstName,
        middleName: normalized.adminMiddleName,
        passwordHash: null,
        passwordResetRequired: true,
        passwordRecoveryHash,
        passwordRecoveryExpiresAt: credentialExpiresAt,
        passwordRecoveryIssuedAt: now,
        passwordRecoveryIssuedById: null,
        passwordRecoveryFactoryId: factory.id,
        passwordRecoveryConsumedAt: null,
        authUpdatedAt: now,
      },
    });
    if (testHooks.failAfter === 'user') throw new Error('TEST_FAIL_AFTER_USER');

    await tx.userFactoryAccess.create({
      data: {
        userId: admin.id,
        factoryId: factory.id,
        role: UserRole.ADMIN,
        isGuest: false,
        isActive: true,
      },
    });
    if (testHooks.failAfter === 'access') throw new Error('TEST_FAIL_AFTER_ACCESS');

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        factoryId: factory.id,
        action: 'FIRST_ADMIN_BOOTSTRAPPED',
        entityType: 'SystemBootstrap',
        entityId: admin.id,
        details: {
          source: 'vps-prep-01-cli',
          requestFingerprint,
          credentialExpiresAt: credentialExpiresAt.toISOString(),
          passwordSetupRequired: true,
        },
      },
    });

    return {
      status: 'CREATED',
      changed: true,
      factoryId: factory.id,
      adminUserId: admin.id,
      maskedPhone: maskPhone(normalizedPhone),
      credentialExpiresAt,
    };
  });
}

/** Operator-only recovery for the one original bootstrap ADMIN, never a public auth path. */
export async function reissueFirstAdminRecovery(
  prisma: PrismaClient,
  rawInput: FirstAdminRecoveryInput,
  testHooks: FirstAdminRecoveryTestHooks = {},
): Promise<FirstAdminRecoveryResult> {
  const phone = normalizePhone(rawInput.adminPhone);
  if (!phone) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: invalid admin phone');
  const factoryCode = normalizeFactoryCode(rawInput.factoryCode);
  const databaseName = String(rawInput.databaseName ?? '').trim();
  const serverAddress = String(rawInput.serverAddress ?? '').trim();
  const serverPort = Number(rawInput.serverPort);
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(databaseName) || !serverAddress || !Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: explicit database identity is required');
  }
  assertRecoveryCredentialPolicy(rawInput.recoveryCredential);
  const nextHash = hashRecoveryCredential(rawInput.recoveryCredential);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(914221, 2)::text AS lock_result`;
    const [identity] = await tx.$queryRaw<Array<{ database_name: string; server_address: string | null; server_port: number | null }>>`
      SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port
    `;
    if (identity?.database_name !== databaseName || identity.server_address !== serverAddress || Number(identity.server_port) !== serverPort) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: database identity mismatch');
    }
    const foundation = await tx.systemFoundationState.findUnique({ where: { id: SYSTEM_FOUNDATION_ID } });
    if (!foundation) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: system foundation missing');

    const [factoryCount, userCount, accessCount, bootstrapAuditCount] = await Promise.all([
      tx.factory.count(), tx.user.count(), tx.userFactoryAccess.count(),
      tx.auditLog.count({ where: { action: 'FIRST_ADMIN_BOOTSTRAPPED', entityType: 'SystemBootstrap' } }),
    ]);
    if (factoryCount !== 1 || userCount !== 1 || accessCount !== 1 || bootstrapAuditCount !== 1) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: bootstrap identity cardinality mismatch');
    }
    const [factory, user, audit] = await Promise.all([
      tx.factory.findUnique({ where: { code: factoryCode } }),
      tx.user.findUnique({ where: { normalizedPhone: phone } }),
      tx.auditLog.findFirst({ where: { action: 'FIRST_ADMIN_BOOTSTRAPPED', entityType: 'SystemBootstrap' } }),
    ]);
    const access = factory && user ? await tx.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.id, factoryId: factory.id } },
    }) : null;
    const provenance = factory && user ? inputFingerprint({
      factoryName: factory.name, factoryCode: factory.code, adminPhone: phone,
      adminLastName: user.lastName ?? '', adminFirstName: user.firstName ?? '', adminMiddleName: user.middleName,
    }) : null;
    const auditDetails = audit?.details && typeof audit.details === 'object' && !Array.isArray(audit.details)
      ? audit.details as Record<string, unknown> : null;
    if (!factory || !factory.isActive || factory.deletedAt || !user || user.factoryId !== factory.id
      || user.role !== UserRole.ADMIN || user.deletedAt || user.blockedAt || user.passwordHash !== null
      || !user.passwordResetRequired || user.passwordChangedAt || !user.passwordRecoveryHash
      || !user.passwordRecoveryIssuedAt || !user.passwordRecoveryExpiresAt || user.passwordRecoveryConsumedAt
      || user.passwordRecoveryFactoryId !== factory.id || user.passwordRecoveryIssuedById !== null
      || !access || !access.isActive || access.deactivatedAt || access.isGuest || access.role !== UserRole.ADMIN
      || audit?.factoryId !== factory.id || audit?.entityId !== user.id || audit?.userId !== user.id
      || auditDetails?.source !== 'vps-prep-01-cli' || detailsFingerprint(audit?.details) !== provenance) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: bootstrap provenance or access mismatch');
    }

    const now = new Date();
    if (user.passwordRecoveryIssuedAt.getTime() > now.getTime()
      || user.passwordRecoveryExpiresAt.getTime() <= user.passwordRecoveryIssuedAt.getTime()) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: inconsistent credential timestamps');
    }
    if (user.passwordRecoveryExpiresAt.getTime() > now.getTime()) {
      const priorReissue = await tx.auditLog.findFirst({ where: {
        action: 'FIRST_ADMIN_RECOVERY_REISSUED', entityType: 'SystemBootstrap', entityId: user.id,
      }, orderBy: { createdAt: 'desc' } });
      if (priorReissue && verifyRecoveryCredential(rawInput.recoveryCredential, user.passwordRecoveryHash)) {
        return { status: 'ALREADY_REISSUED', changed: false, maskedPhone: maskPhone(phone), credentialExpiresAt: user.passwordRecoveryExpiresAt };
      }
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: current credential has not expired');
    }
    if (verifyRecoveryCredential(rawInput.recoveryCredential, user.passwordRecoveryHash)) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: expired credential cannot be reissued unchanged');
    }
    const nextExpiry = recoveryCredentialExpiresAt(now, rawInput.credentialTtlMinutes);
    const authEpoch = new Date(Math.max(now.getTime(), (user.authUpdatedAt?.getTime() ?? 0) + 1));
    const changed = await tx.user.updateMany({
      where: {
        id: user.id, passwordRecoveryHash: user.passwordRecoveryHash,
        passwordRecoveryExpiresAt: user.passwordRecoveryExpiresAt,
        passwordRecoveryConsumedAt: null, passwordResetRequired: true,
        authUpdatedAt: user.authUpdatedAt,
      },
      data: {
        passwordRecoveryHash: nextHash, passwordRecoveryExpiresAt: nextExpiry,
        passwordRecoveryIssuedAt: now, passwordRecoveryIssuedById: null,
        passwordRecoveryFactoryId: factory.id, passwordRecoveryConsumedAt: null,
        failedLoginCount: 0, failedLoginStage: 0, lockedUntil: null, authUpdatedAt: authEpoch,
      },
    });
    if (changed.count !== 1) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: compare-and-swap failed');
    if (testHooks.failAfterUpdate) throw new Error('TEST_FAIL_AFTER_RECOVERY_UPDATE');
    await tx.auditLog.create({ data: {
      userId: null, factoryId: factory.id, action: 'FIRST_ADMIN_RECOVERY_REISSUED',
      entityType: 'SystemBootstrap', entityId: user.id,
      details: { source: 'operator-cli', databaseName, passwordSetupRequired: true, credentialExpiresAt: nextExpiry.toISOString() },
    } });
    return { status: 'REISSUED', changed: true, maskedPhone: maskPhone(phone), credentialExpiresAt: nextExpiry };
  });
}
