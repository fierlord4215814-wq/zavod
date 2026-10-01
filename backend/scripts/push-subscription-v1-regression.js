const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(path, { userId = 'test-admin', factoryId, method = 'GET', body } = {}) {
  const headers = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const endpoint = `https://push.invalid/zavod-v1/${Date.now()}`;

  const status = await request('/notifications/push/status', { userId: 'worker-1', factoryId });
  if (status.status === 200 && typeof status.data.available === 'boolean' && !('privateKey' in status.data)) {
    ok('push status is scoped and public');
  } else {
    fail('push status is scoped and public', status);
  }

  const bad = await request('/notifications/push/subscribe', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { endpoint },
  });
  if (bad.status === 400) ok('subscribe rejects missing browser keys');
  else fail('subscribe rejects missing browser keys', bad);

  const subscribe = await request('/notifications/push/subscribe', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: {
      endpoint,
      keys: { p256dh: 'stage68-public-key-placeholder', auth: 'stage68-auth-placeholder' },
      deviceLabel: 'Regression browser',
      userAgent: 'stage-realtime-regression',
    },
  });
  if (subscribe.status === 201 && subscribe.data.activeSubscriptions >= 1) ok('worker subscribes current device');
  else fail('worker subscribes current device', subscribe);

  const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (row?.userId === 'worker-1' && row.factoryId === factoryId && row.isActive && !row.revokedAt) {
    ok('subscription stored with user and factory scope');
  } else {
    fail('subscription stored with user and factory scope', row);
  }

  const foreignUnsubscribe = await request('/notifications/push/unsubscribe', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { endpoint },
  });
  const stillActive = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (foreignUnsubscribe.status === 201 && stillActive?.isActive) ok('another user cannot revoke foreign subscription');
  else fail('another user cannot revoke foreign subscription', { foreignUnsubscribe, stillActive });

  const unsubscribe = await request('/notifications/push/unsubscribe', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { endpoint },
  });
  const revoked = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (unsubscribe.status === 201 && revoked && !revoked.isActive && revoked.revokedAt) ok('owner soft-revokes subscription');
  else fail('owner soft-revokes subscription', { unsubscribe, revoked });

  const blockedUserId = 'push-v1-blocked-user';
  await prisma.user.upsert({
    where: { id: blockedUserId },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: blockedUserId, factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: blockedUserId, factoryId } },
    update: { role: 'WORKER', isActive: true, isGuest: false },
    create: { userId: blockedUserId, factoryId, role: 'WORKER', isActive: true, isGuest: false },
  });
  const blocked = await request('/notifications/push/status', { userId: blockedUserId, factoryId });
  if (blocked.status === 403) ok('blocked user push denied');
  else fail('blocked user push denied', blocked);
  await prisma.user.update({ where: { id: blockedUserId }, data: { blockedAt: null } });

  const text = JSON.stringify({ status, subscribe, unsubscribe });
  if (/passwordHash|DATABASE_URL|storagePath|VAPID_PRIVATE_KEY|secret/i.test(text)) fail('push API response leaks secret-like value');
  else ok('push API response does not leak secret-like values');

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
