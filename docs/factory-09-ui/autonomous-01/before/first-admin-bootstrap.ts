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
