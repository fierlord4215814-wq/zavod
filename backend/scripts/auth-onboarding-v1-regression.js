const { randomBytes, scryptSync } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole } = require('@prisma/client');

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const password = '1234';
const ids = {
  guest: 'stage-auth-onboarding-guest',
  worker: 'stage-auth-onboarding-worker',
  noFactory: 'stage-auth-onboarding-no-factory',
  blocked: 'stage-auth-onboarding-blocked',
};

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function hashPassword(value) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(value, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /passwordHash|storagePath|DATABASE_URL|accessToken|refreshToken|authToken|token|secret/i.test(key) ? '[hidden]' : inner
  )));
}

function inspectPublicPayload(value) {
  const text = JSON.stringify(value ?? {});
  const findings = [];
  if (/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken|Bearer\s+/i.test(text)) {
    findings.push('secret-like field or value');
  }
  if (/factory context required|access denied|UserFactoryAccess|factoryId required/i.test(text)) {
    findings.push('technical access text');
  }
  return findings;
}

async function request(path, { method = 'GET', token, userId, factoryId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const command = process.platform === 'win32' ? 'npm.cmd run start:dev:win' : 'npm run start:dev:win';
  return spawn(command, [], {
    cwd: __dirname + '/..',
    shell: true,
    stdio: 'ignore',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForBackend() {
  for (let i = 0; i < 80; i += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function expectStatus(name, expected, promise, extraCheck) {
  const response = await promise;
  const findings = inspectPublicPayload(response.data);
  if (response.status !== expected) {
    fail(name, { expected, status: response.status, data: sanitize(response.data) });
  } else if (findings.length) {
    fail(`${name}: public payload is clean`, findings);
  } else if (extraCheck && !extraCheck(response)) {
    fail(name, { status: response.status, data: sanitize(response.data) });
  } else {
    ok(name, { status: response.status });
  }
  return response;
}

async function ensureUser({ id, phone, factoryId, role, isGuest = false, activeAccess = true, blockedAt = null }) {
  await db.user.upsert({
    where: { id },
    update: {
      factoryId,
      role,
      phone,
      normalizedPhone: normalizePhone(phone),
      passwordHash: hashPassword(password),
      passwordResetRequired: false,
      blockedAt,
      deletedAt: null,
    },
    create: {
      id,
      factoryId,
      role,
      phone,
      normalizedPhone: normalizePhone(phone),
      passwordHash: hashPassword(password),
      passwordResetRequired: false,
      blockedAt,
      deletedAt: null,
    },
  });
  if (activeAccess !== null) {
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: id, factoryId } },
      update: { role, isGuest, isActive: activeAccess, deactivatedAt: activeAccess ? null : new Date() },
      create: { userId: id, factoryId, role, isGuest, isActive: activeAccess, deactivatedAt: activeAccess ? null : new Date() },
    });
  }
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');

  await ensureUser({ id: ids.guest, phone: '+79009991001', factoryId: factory.id, role: UserRole.OTHER, isGuest: true });
  await ensureUser({ id: ids.worker, phone: '+79009991002', factoryId: factory.id, role: UserRole.WORKER, isGuest: false });
  await ensureUser({ id: ids.noFactory, phone: '+79009991003', factoryId: factory.id, role: UserRole.OTHER, activeAccess: null });
  await ensureUser({ id: ids.blocked, phone: '+79009991004', factoryId: factory.id, role: UserRole.WORKER, blockedAt: new Date() });

  try {
    await expectStatus('unknown phone uses generic Russian login error', 401,
      request('/auth/login', { method: 'POST', body: { phone: '+79009991999', password } }),
      (response) => response.data?.message === 'Неверный телефон или пароль.');

    const guestLogin = await expectStatus('guest login returns only assigned factory access', 201,
      request('/auth/login', { method: 'POST', body: { phone: '+79009991001', password } }),
      (response) => response.data?.token && response.data?.availableFactories?.length === 1 && response.data.availableFactories[0].isGuest === true);

    await expectStatus('guest /auth/me hides sensitive data', 200,
      request('/auth/me', { token: guestLogin.data.token, factoryId: factory.id }),
      (response) => response.data?.isGuest === true && !('passwordHash' in response.data));

    await expectStatus('guest direct API cannot open shift data', 403,
      request('/shift/current', { token: guestLogin.data.token, factoryId: factory.id }),
      (response) => response.data?.message === 'Раздел смены доступен после назначения роли.');

    await expectStatus('worker login returns non-guest factory access', 201,
      request('/auth/login', { method: 'POST', body: { phone: '+79009991002', password } }),
      (response) => response.data?.token && response.data?.availableFactories?.some((item) => item.id === factory.id && item.isGuest === false));

    await expectStatus('user without active factory access enters waiting assignment state', 201,
      request('/auth/login', { method: 'POST', body: { phone: '+79009991003', password } }),
      (response) => response.data?.token && Array.isArray(response.data.availableFactories) && response.data.availableFactories.length === 0);

    await expectStatus('blocked user receives clear Russian denial', 403,
      request('/auth/login', { method: 'POST', body: { phone: '+79009991004', password } }),
      (response) => response.data?.message === 'Доступ заблокирован. Обратитесь к администратору.');
  } finally {
    const createdUserIds = Object.values(ids);
    await db.user.updateMany({
      where: { id: { in: createdUserIds } },
      data: { blockedAt: null, passwordResetRequired: false },
    }).catch(() => undefined);
    await db.userFactoryAccess.updateMany({
      where: { userId: { in: createdUserIds } },
      data: { isActive: false, deactivatedAt: new Date() },
    }).catch(() => undefined);
    if (backend) stopBackend(backend);
    await db.$disconnect();
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
