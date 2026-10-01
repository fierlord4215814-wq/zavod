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

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');

  const health = await request('GET', '/health');
  record('/health returns no secrets', health.status === 200 && !JSON.stringify(health.data).match(/DATABASE_URL|password|secret|token/i), { status: health.status });

  const version = await request('GET', '/version');
  record('/version returns no secrets', version.status === 200 && !JSON.stringify(version.data).match(/DATABASE_URL|password|secret|token/i), { status: version.status });

  const login = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('worker login succeeds before reset', login.status === 201 && Boolean(login.data?.token), { status: login.status });
  const oldToken = login.data?.token;

  const meBefore = await request('GET', '/auth/me', { token: oldToken, factoryId: factory.id });
  record('old token works before auth update', meBefore.status === 200 && meBefore.data?.userId === 'worker-5' && meBefore.data?.isGuest === false, { status: meBefore.status });

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const reset = await request('POST', '/admin/users/worker-5/password-reset', {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { reason: 'stage20 auth invalidation regression' },
  });
  record('admin password reset updates auth state', reset.status === 201 && reset.data?.passwordResetRequired === true && !reset.data?.passwordHash, { status: reset.status });

  const oldTokenAfterReset = await request('GET', '/auth/me', { token: oldToken, factoryId: factory.id });
  record('old token invalidated after authUpdatedAt', oldTokenAfterReset.status === 200 && oldTokenAfterReset.data?.isGuest === true, { status: oldTokenAfterReset.status, isGuest: oldTokenAfterReset.data?.isGuest });

  const resetLogin = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('reset-required login returns setup token', resetLogin.status === 201 && resetLogin.data?.requiresPasswordChange === true && resetLogin.data?.setupToken, { status: resetLogin.status });

  const setPassword = await request('POST', '/auth/set-password', {
    body: { setupToken: resetLogin.data?.setupToken, newPassword: TEMP_PASSWORD, passwordRepeat: TEMP_PASSWORD },
  });
  record('set password after reset succeeds', setPassword.status === 201 && Boolean(setPassword.data?.token), { status: setPassword.status });

  const restored = await request('POST', '/auth/change-password', {
    token: setPassword.data?.token,
    factoryId: factory.id,
    body: { oldPassword: TEMP_PASSWORD, newPassword: DEV_PASSWORD },
  });
  record('password restored for dev fixtures', restored.status === 201 && restored.data?.ok === true, { status: restored.status });

  const blockedAt = new Date();
  await db.user.update({ where: { id: 'worker-5' }, data: { blockedAt } });
  const blockedLogin = await request('POST', '/auth/login', { body: { phone: WORKER_PHONE, password: DEV_PASSWORD } });
  record('blocked user cannot login', blockedLogin.status === 403, { status: blockedLogin.status });
  await db.user.update({ where: { id: 'worker-5' }, data: { blockedAt: null, passwordResetRequired: false } });

  const attachment = await db.attachment.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  if (attachment) {
    const metadata = await request('GET', `/attachments/${attachment.id}`, { userId: 'test-admin', factoryId: attachment.factoryId || factory.id });
    record('attachment metadata hides storagePath', metadata.status === 200 && !('storagePath' in (metadata.data ?? {})), { status: metadata.status });
  } else {
    record('attachment metadata hides storagePath', true, { skipped: 'no attachments found' });
  }

  const opsAudit = await request('GET', '/ops/audit?limit=10', { userId: 'test-admin', factoryId: factory.id });
  record('audit browser still masks sensitive fields', opsAudit.status === 200 && !JSON.stringify(opsAudit.data).match(/storagePath|DATABASE_URL|passwordHash|token/i), { status: opsAudit.status });

  const docs = [
    'docs/stage20-production-hardening.md',
    'docs/storage-policy.md',
    'docs/backup-restore.md',
    'docs/retention-policy.md',
    'docs/test-fixtures.md',
    'docs/browser-device-e2e-checklist.md',
  ];
  for (const doc of docs) {
    record(`${doc} exists`, fs.existsSync(path.resolve(__dirname, '..', '..', doc)));
  }

  await db.$disconnect();
  const result = { ok, failures };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  try {
    await db.user.update({ where: { id: 'worker-5' }, data: { blockedAt: null, passwordResetRequired: false } });
  } catch {}
  await db.$disconnect();
  console.error(error);
  process.exit(1);
});
