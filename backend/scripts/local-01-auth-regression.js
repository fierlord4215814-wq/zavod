'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');

const { AuthService } = require(path.join(__dirname, '..', 'dist', 'modules', 'auth', 'auth.service.js'));
const { UserContextService } = require(path.join(__dirname, '..', 'dist', 'common', 'user-context.service.js'));
const { nextAuthEpoch } = require(path.join(__dirname, '..', 'dist', 'common', 'auth-token.js'));
const { hashPassword } = require(path.join(__dirname, '..', 'dist', 'common', 'password.js'));

const oldPassword = 'старая надёжная парольная фраза';
const newPassword = 'новая надёжная парольная фраза';
const factoryId = 'local-neutral-factory';
const results = [];
function check(name, value) { assert.ok(value, name); results.push(name); }

function makeHarness(epoch = new Date(Date.now() + 5000)) {
  const state = {
    id: 'local-operator', factoryId, role: 'ADMIN', employeeState: 'AVAILABLE',
    phone: '+79990000081', normalizedPhone: '+79990000081',
    passwordHash: hashPassword(oldPassword), passwordResetRequired: false,
    authUpdatedAt: epoch, failedLoginCount: 0, lockedUntil: null,
    blockedAt: null, deletedAt: null, permissionOverrides: [],
  };
  const factory = { id: factoryId, name: 'Нейтральный локальный завод', code: 'local-neutral', isActive: true, deletedAt: null };
  const access = { id: 'local-access', userId: state.id, factoryId, role: 'ADMIN', isGuest: false, isActive: true,
    departmentId: null, companyId: null, department: null, company: null, factory };
  let beforePasswordMutation = null;
  const snapshot = (include = false) => ({ ...state, ...(include ? { factoryAccess: [access], permissionOverrides: [] } : {}) });
  const mutate = (where, data, compare) => {
    if (beforePasswordMutation) { const hook = beforePasswordMutation; beforePasswordMutation = null; hook(); }
    if (compare && (where.id !== state.id || where.passwordHash !== state.passwordHash
      || where.authUpdatedAt?.getTime() !== state.authUpdatedAt.getTime()
      || (where.passwordResetRequired !== undefined && where.passwordResetRequired !== state.passwordResetRequired)
      || (where.blockedAt === null && state.blockedAt !== null)
      || (where.deletedAt === null && state.deletedAt !== null))) return 0;
    Object.assign(state, data);
    return 1;
  };
  const db = {
    user: {
      findMany: async () => [snapshot()],
      findUnique: async ({ include }) => snapshot(Boolean(include)),
      update: async ({ where, data }) => { mutate(where, data, false); return snapshot(); },
      updateMany: async ({ where, data }) => ({ count: mutate(where, data, true) }),
    },
    userFactoryAccess: { findMany: async () => [access] },
    rolePermission: { findMany: async () => [{ permissionCode: 'admin.users.manage' }] },
  };
  let pauseLoginSuccess = null;
  const auditActions = [];
  const audit = { write: async ({ action }) => { auditActions.push(action); if (action === 'LOGIN_SUCCESS' && pauseLoginSuccess) await pauseLoginSuccess(); } };
  const ws = { notifyAuthChanged: () => undefined };
  const prisma = { db };
  const auth = new AuthService(prisma, {}, audit, ws);
  const consumer = new UserContextService(prisma);
  const context = { userId: state.id, selectedFactoryId: factoryId, role: 'ADMIN', isAdmin: true, isGuest: false };
  return {
    state, auth, consumer, context, auditActions,
    setLoginPause: (promise) => { pauseLoginSuccess = promise; },
    beforeMutation: (fn) => { beforePasswordMutation = fn; },
  };
}

async function main() {
  const late = makeHarness();
  let reachedAudit;
  const atAudit = new Promise((resolve) => { reachedAudit = resolve; });
  let releaseLogin;
  const holdLogin = new Promise((resolve) => { releaseLogin = resolve; });
  late.setLoginPause(async () => { reachedAudit(); await holdLogin; });
  const pendingLogin = late.auth.login({ phone: late.state.phone, password: oldPassword }, 'late-login');
  const firstStage = await Promise.race([
    atAudit.then(() => 'AUDIT'),
    pendingLogin.then((result) => `RETURNED_BEFORE_AUDIT:${result?.requiresPasswordChange}:${late.auditActions.join(',')}`, (error) => `REJECTED:${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 5000)),
  ]);
  assert.equal(firstStage, 'AUDIT', `login did not reach success audit: ${firstStage}`);
  await late.auth.changePassword(late.context, { oldPassword, newPassword });
  releaseLogin();
  let staleResult;
  try { staleResult = await pendingLogin; } catch { staleResult = null; }
  const staleContext = staleResult?.token
    ? await late.consumer.resolve({ authorization: `Bearer ${staleResult.token}`, 'x-factory-id': factoryId })
    : null;
  check('late login cannot receive usable new-epoch authority after verified old password',
    !staleResult?.token || staleContext?.isGuest === true);

  const staleChange = makeHarness();
  const issuedHash = hashPassword('временный одноразовый код для восстановления');
  staleChange.beforeMutation(() => {
    staleChange.state.passwordHash = issuedHash;
    staleChange.state.passwordResetRequired = true;
    staleChange.state.authUpdatedAt = nextAuthEpoch(staleChange.state.authUpdatedAt);
  });
  await assert.rejects(() => staleChange.auth.changePassword(staleChange.context, { oldPassword, newPassword }));
  check('stale changePassword cannot overwrite completed admin reset',
    staleChange.state.passwordHash === issuedHash && staleChange.state.passwordResetRequired === true);

  const concurrent = makeHarness();
  const attempts = await Promise.allSettled([
    concurrent.auth.changePassword(concurrent.context, { oldPassword, newPassword }),
    concurrent.auth.changePassword(concurrent.context, { oldPassword, newPassword }),
  ]);
  check('only one concurrent password change can commit from one credential snapshot',
    attempts.filter((item) => item.status === 'fulfilled').length === 1);
  check('same-millisecond password change advances the auth epoch',
    concurrent.state.authUpdatedAt.getTime() > Date.now() + 4000);

  process.stdout.write(JSON.stringify({ status: 'PASS', checks: results.length, results }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ status: 'FAIL', message: error.message }) + '\n');
  process.exitCode = 1;
});
