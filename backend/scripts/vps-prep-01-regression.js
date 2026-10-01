'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.NODE_ENV = 'test';

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const catalog = require(path.join(backendRoot, 'prisma', 'system-foundation.cjs'));
const { AuthService } = require(path.join(backendRoot, 'dist', 'modules', 'auth', 'auth.service.js'));
const { AdminService } = require(path.join(backendRoot, 'dist', 'modules', 'admin', 'admin.service.js'));
const { applySystemFoundation } = require(path.join(backendRoot, 'dist', 'common', 'system-foundation.js'));
const { bootstrapFirstAdmin } = require(path.join(backendRoot, 'dist', 'common', 'first-admin-bootstrap.js'));
const {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} = require(path.join(backendRoot, 'dist', 'common', 'password.js'));
const {
  generateRecoveryCredential,
  hashRecoveryCredential,
  verifyRecoveryCredential,
} = require(path.join(backendRoot, 'dist', 'common', 'recovery-credential.js'));

const results = [];
function check(name, condition, details = undefined) {
  assert.ok(condition, name);
  results.push({ name, ok: true, ...(details ? { details } : {}) });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function catalogAndMigrationChecks() {
  const codes = catalog.permissions.map(([code]) => code);
  check('canonical permission codes are unique', new Set(codes).size === codes.length, { count: codes.length });
  const grants = Object.entries(catalog.rolePermissions).flatMap(([role, permissionCodes]) => (
    permissionCodes.map((permissionCode) => ({ role, permissionCode }))
  ));
  check('canonical role grants are unique', new Set(grants.map((item) => `${item.role}:${item.permissionCode}`)).size === grants.length, { count: grants.length });
  check('every canonical role grant references a canonical permission', grants.every((item) => codes.includes(item.permissionCode)));
  check('system catalog contains no demo identity or credential marker', !/test-admin|worker-1|contractor-1|factory-4|\+7900000|1234/i.test(JSON.stringify(catalog)));

  const earlyMigrationPath = path.join(backendRoot, 'prisma', 'migrations', '20260620122500_vps_prep_permission_catalog', 'migration.sql');
  const earlyMigration = fs.readFileSync(earlyMigrationPath, 'utf8');
  const snapshotCodes = [...earlyMigration.matchAll(/\(gen_random_uuid\(\), '([^']+)',/g)].map((match) => match[1]);
  // LOCAL-02 adds eligibility in migration 57; the original 119-code SQL stays immutable.
  check('immutable permission SQL snapshot plus additive chat eligibility matches canonical catalog', JSON.stringify([...snapshotCodes, 'chats.access'].sort()) === JSON.stringify([...codes].sort()), { count: snapshotCodes.length });
  check('permission SQL snapshot contains no role grants or demo rows', !/RolePermission|UserFactoryAccess|INSERT INTO "User"|INSERT INTO "Factory"|test-|pilot-|worker-/i.test(earlyMigration));

  const migrationRoot = path.join(backendRoot, 'prisma', 'migrations');
  const unknownGrantCodes = [];
  for (const directory of fs.readdirSync(migrationRoot).sort()) {
    const migrationPath = path.join(migrationRoot, directory, 'migration.sql');
    if (!fs.existsSync(migrationPath)) continue;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    if (!sql.includes('RolePermission')) continue;
    const literals = [...sql.matchAll(/'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'/g)].map((match) => match[1]);
    for (const code of new Set(literals)) {
      if (!codes.includes(code)) unknownGrantCodes.push({ directory, code });
    }
  }
  check('all historical role grants reference the canonical permission catalog', unknownGrantCodes.length === 0);

  const before = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'vps-preparation', 'vps-prep-01', 'before-hashes.json'), 'utf8'));
  const oldMigrationEntries = before.files.filter((item) => item.path.startsWith('backend/prisma/migrations/') && item.path.endsWith('/migration.sql'));
  const changedOldMigrations = oldMigrationEntries.filter((item) => sha256(path.join(repoRoot, item.path)) !== item.sha256);
  check('all pre-existing migration files retain their baseline checksum', changedOldMigrations.length === 0, { count: oldMigrationEntries.length });
  const prep01After = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'vps-preparation', 'vps-prep-01', 'after-hashes.json'), 'utf8'));
  const prep01MigrationEntries = prep01After.files.filter((item) => item.path.startsWith('backend/prisma/migrations/')
    && item.path.endsWith('/migration.sql') && !oldMigrationEntries.some((old) => old.path === item.path));
  const changedPrior55 = [...oldMigrationEntries, ...prep01MigrationEntries]
    .filter((item) => sha256(path.join(repoRoot, item.path)) !== item.sha256);
  check('all 55 migrations before LOCAL-01 reconciliation retain their recorded checksums',
    oldMigrationEntries.length === 53 && prep01MigrationEntries.length === 2 && changedPrior55.length === 0);

  const seed = fs.readFileSync(path.join(backendRoot, 'prisma', 'seed.js'), 'utf8');
  check('dev seed reuses canonical system catalog', seed.includes("require('./system-foundation.cjs')"));
  check('production commands do not invoke dev seed', !/vps-prep:(?:foundation|first-admin)[^\n]*seed/i.test(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8')));
  const postgresHarness = fs.readFileSync(path.join(backendRoot, 'scripts', 'vps-prep-01-postgres-integration.js'), 'utf8');
  check('PostgreSQL harness requires an explicit admin target and has no working DATABASE_URL or .env fallback',
    postgresHarness.includes('VPS_PREP_TEST_ADMIN_URL')
      && postgresHarness.includes('VPS_PREP_TEST_CONFIRM')
      && !/readFileSync\([^\n]*\.env|process\.env\.DATABASE_URL\s*\|\|/i.test(postgresHarness));
  check('Prisma migration commands run from the isolated temporary project',
    (postgresHarness.match(/cwd: path\.dirname\(path\.dirname\(schema\)\)/g) ?? []).length === 2);
}

function passwordPolicyChecks() {
  assert.throws(() => assertPasswordPolicy('short'));
  assert.throws(() => assertPasswordPolicy(' '.repeat(20)));
  assert.throws(() => assertPasswordPolicy('a'.repeat(129)));
  assert.doesNotThrow(() => assertPasswordPolicy('длинная парольная фраза'));
  const legacyHash = hashPassword('1234');
  check('legacy short password hashes remain verifiable for ordinary login', verifyPassword('1234', legacyHash));
  check('new password policy accepts password phrases and rejects weak new values', true);
}

function makeAuthHarness(epoch = new Date('2026-09-22T12:00:00.000Z')) {
  const recoveryCredential = generateRecoveryCredential();
  const initialEpoch = epoch;
  const state = {
    id: 'synthetic-reset-user',
    factoryId: 'synthetic-factory',
    role: 'WORKER',
    employeeState: 'AVAILABLE',
    normalizedPhone: '+79990000001',
    phone: '+79990000001',
    passwordHash: hashPassword('legacy-only'),
    passwordResetRequired: true,
    passwordRecoveryHash: hashRecoveryCredential(recoveryCredential),
    passwordRecoveryExpiresAt: new Date(Date.now() + 60_000),
    passwordRecoveryIssuedAt: new Date(),
    passwordRecoveryIssuedById: 'synthetic-admin',
    passwordRecoveryFactoryId: 'synthetic-factory',
    passwordRecoveryConsumedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    authUpdatedAt: initialEpoch,
    passwordChangedAt: null,
    blockedAt: null,
    deletedAt: null,
  };
  const accessState = { isActive: true, isGuest: false, factoryActive: true, factoryDeleted: false };
  const audits = [];
  const clone = () => ({ ...state });
  const db = {
    user: {
      findMany: async () => { await new Promise((resolve) => setImmediate(resolve)); return [clone()]; },
      findUnique: async () => clone(),
      update: async ({ data }) => { Object.assign(state, data); return clone(); },
      updateMany: async ({ where, data }) => {
        const matches = state.id === where.id
          && (where.passwordResetRequired === undefined || state.passwordResetRequired === where.passwordResetRequired)
          && (where.passwordRecoveryHash === undefined || state.passwordRecoveryHash === where.passwordRecoveryHash)
          && (where.authUpdatedAt === undefined || state.authUpdatedAt?.getTime() === where.authUpdatedAt?.getTime())
          && (!where.passwordRecoveryExpiresAt?.gt || state.passwordRecoveryExpiresAt?.getTime() > where.passwordRecoveryExpiresAt.gt.getTime())
          && (!where.factoryAccess?.some || (accessState.isActive && !accessState.isGuest && accessState.factoryActive && !accessState.factoryDeleted));
        if (!matches) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      },
    },
    userFactoryAccess: {
      findFirst: async () => (accessState.isActive && !accessState.isGuest && accessState.factoryActive && !accessState.factoryDeleted
        ? { id: 'synthetic-access' }
        : null),
      findMany: async () => [],
    },
  };
  const audit = { write: async (payload) => { audits.push(payload); } };
  const ws = { notifyAuthChanged: () => undefined };
  const service = new AuthService({ db }, {}, audit, ws);
  return { recoveryCredential, state, accessState, audits, service };
}

async function authChecks() {
  const sameTick = makeAuthHarness(new Date(Date.now() + 5000));
  const beforeSameTick = sameTick.state.authUpdatedAt.getTime();
  await sameTick.service.login({ phone: sameTick.state.phone, password: sameTick.recoveryCredential }, 'same-tick');
  check('recovery claim advances auth epoch even within the same clock tick', sameTick.state.authUpdatedAt.getTime() > beforeSameTick);

  const wrong = makeAuthHarness();
  const rejected = await Promise.allSettled([
    wrong.service.login({ phone: wrong.state.phone, password: 'definitely-wrong' }, 'wrong-secret'),
  ]);
  check('phone plus wrong recovery credential cannot obtain setup authority', rejected[0].status === 'rejected' && wrong.state.passwordRecoveryHash !== null);

  const foreign = makeAuthHarness();
  const other = makeAuthHarness();
  await assert.rejects(() => foreign.service.login({ phone: foreign.state.phone, password: other.recoveryCredential }, 'foreign-secret'));
  check('a recovery credential issued for another user cannot obtain setup authority', foreign.state.passwordRecoveryHash !== null);

  const expired = makeAuthHarness();
  expired.state.passwordRecoveryExpiresAt = new Date(Date.now() - 1);
  await assert.rejects(() => expired.service.login({ phone: expired.state.phone, password: expired.recoveryCredential }, 'expired-secret'));
  check('an expired recovery credential cannot obtain setup authority', expired.state.passwordRecoveryHash !== null);

  const revoked = makeAuthHarness();
  revoked.accessState.isActive = false;
  await assert.rejects(() => revoked.service.login({ phone: revoked.state.phone, password: revoked.recoveryCredential }, 'revoked-access'));
  check('revoked factory access cannot consume a recovery credential', revoked.state.passwordRecoveryHash !== null);

  const deleted = makeAuthHarness();
  deleted.state.deletedAt = new Date();
  await assert.rejects(() => deleted.service.login({ phone: deleted.state.phone, password: deleted.recoveryCredential }, 'deleted-user'));
  check('a soft-deleted identity cannot consume a recovery credential', deleted.state.passwordRecoveryHash !== null);

  const concurrent = makeAuthHarness();
  const attempts = await Promise.allSettled([
    concurrent.service.login({ phone: concurrent.state.phone, password: concurrent.recoveryCredential }, 'client-a'),
    concurrent.service.login({ phone: concurrent.state.phone, password: concurrent.recoveryCredential }, 'client-b'),
  ]);
  const setupResults = attempts.filter((item) => item.status === 'fulfilled' && item.value?.setupToken);
  check('one recovery credential is consumed successfully by only one concurrent client', setupResults.length === 1);
  check('consumed recovery credential hash is removed', concurrent.state.passwordRecoveryHash === null && concurrent.state.passwordRecoveryConsumedAt instanceof Date);

  const setupToken = setupResults[0].value.setupToken;
  const newPassword = 'новая надёжная парольная фраза';
  const setResult = await concurrent.service.setPassword({ setupToken, newPassword, passwordRepeat: newPassword });
  check('password setup returns no ordinary access token and requires a new login', setResult.ok === true && setResult.requiresLogin === true && !('token' in setResult));
  const replay = await Promise.allSettled([
    concurrent.service.setPassword({ setupToken, newPassword, passwordRepeat: newPassword }),
  ]);
  check('used setup token cannot be replayed', replay[0].status === 'rejected');
  const normalLogin = await concurrent.service.login({ phone: concurrent.state.phone, password: newPassword }, 'normal-login');
  check('ordinary login works with the newly installed password', Boolean(normalLogin.token) && normalLogin.requiresPasswordChange === false);

  const revokedAfterConsume = makeAuthHarness();
  const started = await revokedAfterConsume.service.login({ phone: revokedAfterConsume.state.phone, password: revokedAfterConsume.recoveryCredential }, 'setup-before-revoke');
  revokedAfterConsume.accessState.isActive = false;
  await assert.rejects(() => revokedAfterConsume.service.setPassword({
    setupToken: started.setupToken,
    newPassword,
    passwordRepeat: newPassword,
  }));
  check('revoked factory access prevents completion with an already issued setup token', revokedAfterConsume.state.passwordResetRequired === true);
}

function makeFoundationHarness(existingIdentity = false) {
  const state = {
    marker: null,
    factories: existingIdentity ? 1 : 0,
    users: existingIdentity ? 1 : 0,
    accesses: existingIdentity ? 1 : 0,
    permissions: new Map(),
    roleGrants: new Map(),
  };
  const tx = {
    $queryRaw: async () => [],
    systemFoundationState: {
      findUnique: async () => state.marker,
      create: async ({ data }) => { state.marker = { ...data }; return state.marker; },
    },
    factory: { count: async () => state.factories },
    user: { count: async () => state.users },
    userFactoryAccess: { count: async () => state.accesses },
    permission: {
      createMany: async ({ data }) => {
        let count = 0;
        for (const item of data) if (!state.permissions.has(item.code)) { state.permissions.set(item.code, item); count += 1; }
        return { count };
      },
    },
    rolePermission: {
      createMany: async ({ data }) => {
        let count = 0;
        for (const item of data) {
          const key = `${item.role}:${item.permissionCode}`;
          if (!state.roleGrants.has(key)) { state.roleGrants.set(key, { ...item }); count += 1; }
        }
        return { count };
      },
    },
  };
  return { state, prisma: { $transaction: async (fn) => fn(tx) } };
}

async function foundationChecks() {
  const clean = makeFoundationHarness(false);
  const first = await applySystemFoundation(clean.prisma);
  check('clean foundation installs system definitions and canonical role defaults once', first.state === 'INITIALIZED_CLEAN' && clean.state.permissions.size === catalog.permissions.length && clean.state.roleGrants.size > 0);
  const [grantKey, grant] = clean.state.roleGrants.entries().next().value;
  clean.state.roleGrants.set(grantKey, { ...grant, isActive: false });
  const second = await applySystemFoundation(clean.prisma);
  check('repeat foundation preserves an administrator-disabled role grant', second.state === 'ALREADY_APPLIED' && clean.state.roleGrants.get(grantKey).isActive === false);

  const existing = makeFoundationHarness(true);
  existing.state.roleGrants.set('WORKER:shift.self.read', { role: 'WORKER', permissionCode: 'shift.self.read', isActive: false });
  const adopted = await applySystemFoundation(existing.prisma);
  check('foundation adopts a populated identity database without rewriting role policy', adopted.state === 'ADOPTED_EXISTING' && existing.state.roleGrants.get('WORKER:shift.self.read').isActive === false);
}

function makeBootstrapHarness({ nonempty = false } = {}) {
  const state = {
    foundation: { id: 'permissions-role-defaults-v1', version: 1 },
    factories: nonempty ? [{ id: 'existing-factory', code: 'existing', name: 'Существующий завод' }] : [],
    users: [],
    accesses: [],
    audits: [],
  };
  const tx = {
    $queryRaw: async () => [],
    systemFoundationState: { findUnique: async () => state.foundation },
    factory: {
      count: async () => state.factories.length,
      findUnique: async ({ where }) => state.factories.find((item) => item.code === where.code) ?? null,
      create: async ({ data }) => {
        const row = { id: `factory-${state.factories.length + 1}`, deletedAt: null, ...data };
        state.factories.push(row);
        return row;
      },
    },
    user: {
      count: async () => state.users.length,
      findUnique: async ({ where }) => state.users.find((item) => item.normalizedPhone === where.normalizedPhone) ?? null,
      create: async ({ data }) => {
        const row = { id: `admin-${state.users.length + 1}`, deletedAt: null, blockedAt: null, ...data };
        state.users.push(row);
        return row;
      },
    },
    userFactoryAccess: {
      count: async () => state.accesses.length,
      findUnique: async ({ where }) => state.accesses.find((item) => (
        item.userId === where.userId_factoryId.userId && item.factoryId === where.userId_factoryId.factoryId
      )) ?? null,
      create: async ({ data }) => {
        const row = { id: `access-${state.accesses.length + 1}`, ...data };
        state.accesses.push(row);
        return row;
      },
    },
    auditLog: {
      findFirst: async () => state.audits[state.audits.length - 1] ?? null,
      create: async ({ data }) => {
        const row = { id: `audit-${state.audits.length + 1}`, createdAt: new Date(), ...data };
        state.audits.push(row);
        return row;
      },
    },
  };
  const prisma = {
    $transaction: async (fn) => {
      const snapshot = {
        factories: [...state.factories],
        users: [...state.users],
        accesses: [...state.accesses],
        audits: [...state.audits],
      };
      try {
        return await fn(tx);
      } catch (error) {
        state.factories = snapshot.factories;
        state.users = snapshot.users;
        state.accesses = snapshot.accesses;
        state.audits = snapshot.audits;
        throw error;
      }
    },
  };
  return { state, prisma };
}

async function bootstrapChecks() {
  const credential = generateRecoveryCredential();
  const input = {
    factoryName: 'Новый завод',
    factoryCode: 'new-factory',
    adminPhone: '+79990000010',
    adminLastName: 'Иванов',
    adminFirstName: 'Иван',
    recoveryCredential: credential,
  };
  const clean = makeBootstrapHarness();
  const created = await bootstrapFirstAdmin(clean.prisma, input);
  check('first-admin bootstrap creates exactly one factory, admin, access and audit',
    created.status === 'CREATED'
      && clean.state.factories.length === 1
      && clean.state.users.length === 1
      && clean.state.accesses.length === 1
      && clean.state.audits.length === 1);
  const repeated = await bootstrapFirstAdmin(clean.prisma, input);
  check('exact lost-response repeat is diagnostic and makes no changes',
    repeated.status === 'ALREADY_COMPLETED'
      && repeated.changed === false
      && clean.state.factories.length === 1
      && clean.state.users.length === 1
      && clean.state.accesses.length === 1);
  await assert.rejects(() => bootstrapFirstAdmin(clean.prisma, { ...input, recoveryCredential: generateRecoveryCredential() }));
  check('same metadata with a different bootstrap credential is refused', clean.state.users.length === 1);

  const nonempty = makeBootstrapHarness({ nonempty: true });
  await assert.rejects(() => bootstrapFirstAdmin(nonempty.prisma, input));
  check('bootstrap refuses a nonempty identity or factory state', nonempty.state.factories.length === 1 && nonempty.state.users.length === 0);

  const rollback = makeBootstrapHarness();
  await assert.rejects(() => bootstrapFirstAdmin(rollback.prisma, input, { failAfter: 'user' }));
  check('bootstrap transaction rolls back partial factory and user creation',
    rollback.state.factories.length === 0
      && rollback.state.users.length === 0
      && rollback.state.accesses.length === 0
      && rollback.state.audits.length === 0);
}

function makeAdminHarness() {
  const factoryId = 'synthetic-factory';
  const actor = {
    id: 'synthetic-admin', blockedAt: null, deletedAt: null, passwordResetRequired: false,
    permissionOverrides: [],
    factoryAccess: [{ factoryId, role: 'ADMIN', departmentId: null, companyId: null, jobTitleId: null, isGuest: false, isActive: true, jobTitle: null, factory: { isActive: true, deletedAt: null } }],
  };
  const target = {
    id: 'synthetic-worker', factoryId, blockedAt: null, deletedAt: null, passwordResetRequired: false,
    passwordRecoveryHash: null, passwordRecoveryExpiresAt: null, passwordRecoveryConsumedAt: null,
    factoryAccess: [{ factoryId, role: 'WORKER', departmentId: null, companyId: null, jobTitleId: null, isGuest: false, isActive: true, jobTitle: null }],
  };
  const audits = [];
  const db = {
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(db),
    user: {
      findUnique: async ({ where }) => where.id === actor.id ? actor : where.id === target.id ? target : null,
      update: async ({ where, data }) => { assert.equal(where.id, target.id); Object.assign(target, data); return target; },
    },
    rolePermission: { findMany: async () => [] },
    userPermissionOverride: { findMany: async () => [] },
    jobTitle: { findUnique: async () => null },
  };
  const audit = { writeTx: async (_tx, payload) => { audits.push(payload); } };
  const ws = { notifyAuthChanged: () => undefined };
  const service = new AdminService({ db }, audit, ws, {}, {});
  const context = { userId: actor.id, selectedFactoryId: factoryId, role: 'ADMIN', departmentId: null, companyId: null, permissions: ['admin.users.manage'], isAdmin: true, isGuest: false };
  return { actor, target, audits, service, context };
}

async function adminRecoveryChecks() {
  const harness = makeAdminHarness();
  harness.target.authUpdatedAt = new Date(Date.now() + 5000);
  const priorEpoch = harness.target.authUpdatedAt.getTime();
  const first = await harness.service.resetPassword(harness.context, harness.target.id, { reason: 'Синтетическая проверка' });
  const firstEpoch = harness.target.authUpdatedAt.getTime();
  check('administrator reset advances auth epoch beyond previous timestamp', firstEpoch > priorEpoch);
  check('authorized administrator receives exactly one functional recovery credential', first.passwordResetRequired && verifyRecoveryCredential(first.recoveryCredential, harness.target.passwordRecoveryHash));
  check('recovery credential is not persisted or written to audit in plaintext', !JSON.stringify(harness.target).includes(first.recoveryCredential) && !JSON.stringify(harness.audits).includes(first.recoveryCredential));
  const second = await harness.service.resetPassword(harness.context, harness.target.id, { reason: 'Повторная синтетическая проверка' });
  check('immediate recovery reissue advances auth epoch again', harness.target.authUpdatedAt.getTime() > firstEpoch);
  check('reissue explicitly revokes the previous credential and leaves one active credential', second.replacedExisting && first.recoveryCredential !== second.recoveryCredential && !verifyRecoveryCredential(first.recoveryCredential, harness.target.passwordRecoveryHash) && verifyRecoveryCredential(second.recoveryCredential, harness.target.passwordRecoveryHash));

  harness.actor.blockedAt = new Date();
  const denied = await Promise.allSettled([
    harness.service.resetPassword(harness.context, harness.target.id, { reason: 'Запрещённая проверка' }),
  ]);
  check('blocked assigning administrator cannot issue a recovery credential', denied[0].status === 'rejected');
}

async function main() {
  catalogAndMigrationChecks();
  passwordPolicyChecks();
  await foundationChecks();
  await bootstrapChecks();
  await authChecks();
  await adminRecoveryChecks();
  process.stdout.write(`${JSON.stringify({ status: 'PASS', checks: results.length, results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
