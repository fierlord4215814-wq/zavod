const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];

const DEV_PASSWORD = '1234';
const TEMP_PASSWORD = '5678';
const WORKER_PHONE = '+79000000105';
const ADMIN_HEADERS = {};

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  ADMIN_HEADERS.userId = 'test-admin';
  ADMIN_HEADERS.factoryId = factory.id;

  const worker = await db.user.findUnique({ where: { id: 'worker-5' } });
  if (!worker?.normalizedPhone || !worker.passwordHash) throw new Error('worker-5 auth seed is missing');

  const success = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('phone/password login success', success.status === 201 && success.data?.token && !success.data?.passwordHash, { status: success.status });

  const wrong = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: 'bad-password' } });
  record('wrong password rejected', wrong.status === 401, { status: wrong.status });

  const me = await request('GET', '/auth/me', { token: success.data?.token, factoryId: factory.id });
  record('/auth/me bearer token works', me.status === 200 && me.data?.userId === 'worker-5' && !('passwordHash' in (me.data ?? {})), { status: me.status });

  const forbiddenReset = await request('POST', '/admin/users/worker-4/password-reset', {
    userId: 'worker-1',
    factoryId: factory.id,
    body: { reason: 'stage115 worker forbidden' },
  });
  record('WORKER cannot reset password', forbiddenReset.status === 403, { status: forbiddenReset.status });

  const reset = await request('POST', '/admin/users/worker-5/password-reset', {
    ...ADMIN_HEADERS,
    body: { reason: 'stage115 auth regression' },
  });
  record('ADMIN reset password flag', reset.status === 201 && reset.data?.passwordResetRequired === true && !reset.data?.passwordHash, { status: reset.status });

  const resetLogin = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('reset-required login returns setup token', resetLogin.status === 201 && resetLogin.data?.requiresPasswordChange === true && resetLogin.data?.setupToken, { status: resetLogin.status });

  const setPassword = await request('POST', '/auth/set-password', {
    body: { setupToken: resetLogin.data?.setupToken, newPassword: TEMP_PASSWORD, passwordRepeat: TEMP_PASSWORD },
  });
  record('set password after reset', setPassword.status === 201 && setPassword.data?.token, { status: setPassword.status });

  const oldPassword = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('old password fails after reset change', oldPassword.status === 401, { status: oldPassword.status });

  const newPassword = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: TEMP_PASSWORD } });
  record('new password login success', newPassword.status === 201 && newPassword.data?.token, { status: newPassword.status });

  const changeBack = await request('POST', '/auth/change-password', {
    token: newPassword.data?.token,
    factoryId: factory.id,
    body: { oldPassword: TEMP_PASSWORD, newPassword: DEV_PASSWORD },
  });
  record('change password restores dev password', changeBack.status === 201 && changeBack.data?.ok === true, { status: changeBack.status });

  const blockedAt = new Date(Date.now() + 60_000);
  await db.user.update({ where: { id: 'worker-5' }, data: { blockedAt } });
  const blockedLogin = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('blocked user login rejected', blockedLogin.status === 403, { status: blockedLogin.status });
  await db.user.update({ where: { id: 'worker-5' }, data: { blockedAt: null, passwordResetRequired: false } });

  const devLogin = await request('POST', '/auth/dev-login', { body: { userId: 'test-master' } });
  record('dev-login remains available for regression', devLogin.status === 201 && devLogin.data?.userId === 'test-master', { status: devLogin.status });

  for (const action of ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ADMIN_PASSWORD_RESET', 'PASSWORD_SET_AFTER_RESET', 'PASSWORD_CHANGED', 'ACCESS_DENIED']) {
    const count = await auditCount(action, since);
    record(`${action} audit written`, count >= 1, { count });
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  await db.$disconnect();
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
