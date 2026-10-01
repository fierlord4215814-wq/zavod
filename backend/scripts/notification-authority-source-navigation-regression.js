const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  PrismaClient,
  PermissionEffect,
  UserRole,
  NotificationSeverity,
} = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { passed: [], failed: [] };
const PASSWORD = 'NotificationProof-1234';
const now = () => new Date();
const future = () => new Date(Date.now() + 60 * 60_000);
const expired = () => new Date(Date.now() - 60_000);

const FIXTURE = {
  factoryA: 'f04-f06-notification-authority-factory-a',
  factoryB: 'f04-f06-notification-authority-factory-b',
  departmentA: 'f04-f06-notification-authority-department-a',
  departmentB: 'f04-f06-notification-authority-department-b',
  worker: 'f04-f06-notification-authority-worker',
  admin: 'f04-f06-notification-authority-admin',
  guest: 'f04-f06-notification-authority-guest',
};
const FACTORY_IDS = [FIXTURE.factoryA, FIXTURE.factoryB];
const USER_IDS = [FIXTURE.worker, FIXTURE.admin, FIXTURE.guest];
const PHONES = {
  [FIXTURE.worker]: '+79995550201',
  [FIXTURE.admin]: '+79995550202',
  [FIXTURE.guest]: '+79995550203',
};
const PERMISSIONS = ['notifications.read', 'tasks.read', 'orders.read', 'wash.read', 'announcements.read'];
const tokens = new Map();

function pass(name, detail) {
  state.passed.push({ name, ...(detail === undefined ? {} : { detail }) });
}

function fail(name, detail) {
  state.failed.push({ name, ...(detail === undefined ? {} : { detail }) });
}

function expect(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => (
    /password|token|secret|DATABASE_URL|storagePath/i.test(key) ? '[redacted]' : item
  )));
}

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(value, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function tokenFor(userId) {
  const cached = tokens.get(userId);
  if (cached) return cached;
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONES[userId], password: PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Не выполнен вход fixture ${userId}: HTTP ${response.status}`);
  tokens.set(userId, data.token);
  return data.token;
}

async function request(pathname, { userId = FIXTURE.worker, factoryId = FIXTURE.factoryA, method = 'GET' } = {}) {
  const token = await tokenFor(userId);
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-factory-id': factoryId,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : '{}',
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function setOverride(userId, factoryId, permissionCode, effect) {
  await db.userPermissionOverride.upsert({
    where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode } },
    update: { effect },
    create: { userId, factoryId, permissionCode, effect },
  });
}

async function setWorkerAccess(factoryId, active, isGuest = false) {
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId: FIXTURE.worker, factoryId } },
    data: {
      isActive: active,
      isGuest,
      deactivatedAt: active ? null : now(),
      deactivationReason: active ? null : 'Завершение изолированной проверки доступа к уведомлениям',
    },
  });
}

async function ensureFixtures() {
  tokens.clear();
  await db.factory.upsert({
    where: { id: FIXTURE.factoryA },
    update: { name: 'Контур уведомлений А', code: 'notification-authority-a', isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: FIXTURE.factoryA, name: 'Контур уведомлений А', code: 'notification-authority-a' },
  });
  await db.factory.upsert({
    where: { id: FIXTURE.factoryB },
    update: { name: 'Контур уведомлений Б', code: 'notification-authority-b', isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: FIXTURE.factoryB, name: 'Контур уведомлений Б', code: 'notification-authority-b' },
  });
  await db.department.upsert({
    where: { id: FIXTURE.departmentA },
    update: { factoryId: FIXTURE.factoryA, name: 'Служба уведомлений А', code: 'notification-authority-a', isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: FIXTURE.departmentA, factoryId: FIXTURE.factoryA, name: 'Служба уведомлений А', code: 'notification-authority-a' },
  });
  await db.department.upsert({
    where: { id: FIXTURE.departmentB },
    update: { factoryId: FIXTURE.factoryB, name: 'Служба уведомлений Б', code: 'notification-authority-b', isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: FIXTURE.departmentB, factoryId: FIXTURE.factoryB, name: 'Служба уведомлений Б', code: 'notification-authority-b' },
  });

  const passwordHash = hashPassword(PASSWORD);
  for (const [id, role, firstName] of [
    [FIXTURE.worker, UserRole.WORKER, 'Сотрудник'],
    [FIXTURE.admin, UserRole.ADMIN, 'Администратор'],
    [FIXTURE.guest, UserRole.OTHER, 'Гость'],
  ]) {
    await db.user.upsert({
      where: { id },
      update: {
        factoryId: FIXTURE.factoryA,
        firstName,
        lastName: 'Контур уведомлений',
        role,
        phone: PHONES[id],
        normalizedPhone: PHONES[id].replace(/\D/g, ''),
        passwordHash,
        passwordChangedAt: now(),
        authUpdatedAt: now(),
        blockedAt: null,
        deletedAt: null,
        passwordResetRequired: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        id,
        factoryId: FIXTURE.factoryA,
        firstName,
        lastName: 'Контур уведомлений',
        role,
        phone: PHONES[id],
        normalizedPhone: PHONES[id].replace(/\D/g, ''),
        passwordHash,
        passwordChangedAt: now(),
        authUpdatedAt: now(),
        passwordResetRequired: false,
      },
    });
  }

  for (const [userId, factoryId, role, departmentId, isGuest] of [
    [FIXTURE.worker, FIXTURE.factoryA, UserRole.WORKER, FIXTURE.departmentA, false],
    [FIXTURE.worker, FIXTURE.factoryB, UserRole.WORKER, FIXTURE.departmentB, false],
    [FIXTURE.admin, FIXTURE.factoryA, UserRole.ADMIN, null, false],
    [FIXTURE.guest, FIXTURE.factoryB, UserRole.OTHER, FIXTURE.departmentB, true],
  ]) {
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId, factoryId } },
      update: { role, departmentId, isGuest, isActive: true, deactivatedAt: null, deactivationReason: null },
      create: { userId, factoryId, role, departmentId, isGuest, isActive: true },
    });
  }

  for (const factoryId of FACTORY_IDS) {
    for (const permissionCode of PERMISSIONS) {
      await setOverride(FIXTURE.worker, factoryId, permissionCode, PermissionEffect.ALLOW);
    }
  }
  await db.notification.updateMany({
    where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }] },
    data: { expiresAt: expired() },
  });
}

async function cleanup() {
  const stamp = now();
  await db.notification.updateMany({
    where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }] },
    data: { expiresAt: expired() },
  });
  await db.pushSubscription.updateMany({
    where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }] },
    data: { isActive: false, revokedAt: stamp },
  });
  await db.userFactoryAccess.updateMany({
    where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }] },
    data: { isActive: false, deactivatedAt: stamp, deactivationReason: 'Изолированная проверка завершена' },
  });
  await db.department.updateMany({
    where: { id: { in: [FIXTURE.departmentA, FIXTURE.departmentB] } },
    data: { isActive: false, deactivatedAt: stamp },
  });
  await db.factory.updateMany({
    where: { id: { in: FACTORY_IDS } },
    data: { isActive: false, deactivatedAt: stamp },
  });
  await db.user.updateMany({
    where: { id: { in: USER_IDS } },
    data: { blockedAt: stamp, deletedAt: stamp },
  });
}

async function cleanupCounts() {
  const stamp = now();
  const [users, factories, access, notifications, pushes, departments] = await Promise.all([
    db.user.count({ where: { id: { in: USER_IDS }, blockedAt: null, deletedAt: null } }),
    db.factory.count({ where: { id: { in: FACTORY_IDS }, isActive: true, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }], isActive: true } }),
    db.notification.count({
      where: {
        AND: [
          { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: stamp } }] },
        ],
      },
    }),
    db.pushSubscription.count({ where: { OR: [{ factoryId: { in: FACTORY_IDS } }, { userId: { in: USER_IDS } }], isActive: true, revokedAt: null } }),
    db.department.count({ where: { id: { in: [FIXTURE.departmentA, FIXTURE.departmentB] }, isActive: true, deletedAt: null } }),
  ]);
  return {
    ACTIVE_MARKER_USERS: users,
    ACTIVE_MARKER_FACTORIES: factories,
    ACTIVE_MARKER_UFA: access,
    ACTIVE_MARKER_NOTIFICATIONS: notifications,
    ACTIVE_MARKER_PUSH_SUBSCRIPTIONS: pushes,
    OTHER_ACTIVE_MARKERS: departments,
    PHYSICAL_DELETES: 0,
    PREEXISTING_OPERATIONAL_CHANGED: 0,
  };
}

function createServiceHarness() {
  const { UserContextService } = require('../dist/common/user-context.service');
  const { NotificationsService } = require('../dist/modules/notifications/notifications.service');
  const { PushService } = require('../dist/push/push.service');
  const prisma = { db };
  const delivered = { ws: [], push: [] };
  const ws = {
    sendToUsers(userIds, event, payload) {
      delivered.ws.push({ userIds: [...userIds], event, payload });
    },
  };
  const push = {
    async sendNotificationToUsers(userIds, payload) {
      delivered.push.push({ userIds: [...userIds], payload });
      return { sent: userIds.length, skipped: 0 };
    },
  };
  const audit = { write: async () => undefined, writeTx: async () => undefined };
  const contexts = new UserContextService(prisma);
  const notifications = new NotificationsService(prisma, audit, ws, push, contexts);
  const pushService = new PushService(prisma);
  return { notifications, pushService, delivered };
}

function resetDelivery(delivered) {
  delivered.ws.length = 0;
  delivered.push.length = 0;
}

function deliveredTo(delivered, userId) {
  return delivered.push.some((item) => item.userIds.includes(userId))
    && delivered.ws.some((item) => item.userIds.includes(userId));
}

async function createNotification(service, input) {
  return service.create({
    type: `AUTHORITY_${crypto.randomUUID()}`,
    title: input.title,
    message: input.message || 'Проверка актуального доступа к источнику.',
    operationId: crypto.randomUUID(),
    severity: NotificationSeverity.WARNING,
    expiresAt: future(),
    ...input,
  });
}

async function runBackend() {
  await ensureFixtures();
  const { notifications, pushService, delivered } = createServiceHarness();

  const sameFactory = await createNotification(notifications, {
    factoryId: FIXTURE.factoryA,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка текущего завода',
  });
  expect('authorized TASK producer reaches current recipient', deliveredTo(delivered, FIXTURE.worker));

  resetDelivery(delivered);
  const remote = await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка доступного второго завода',
  });
  expect('canonical ALLOW override enables TASK delivery', deliveredTo(delivered, FIXTURE.worker));

  resetDelivery(delivered);
  const departmentWash = await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    departmentId: FIXTURE.departmentB,
    entityType: 'WASH_ISSUE',
    entityId: crypto.randomUUID(),
    title: 'Замечание мойки',
  });
  expect('department wash producer reaches matching authorized department', deliveredTo(delivered, FIXTURE.worker));

  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    entityType: 'ORDER_REQUEST',
    entityId: crypto.randomUUID(),
    title: 'Заказ требует внимания',
  });
  expect('factory order producer uses effective orders authority', deliveredTo(delivered, FIXTURE.worker));

  const listA = await request('/notifications');
  const listAIds = new Set(Array.isArray(listA.data) ? listA.data.map((item) => item.id) : []);
  expect('active current and legitimate remote personal notifications are visible', listA.status === 200 && listAIds.has(sameFactory.id) && listAIds.has(remote.id), safe(listA));
  expect('cross-factory department/factory feed is not broadened', !listAIds.has(departmentWash.id));

  const unreadList = await request('/notifications?unreadOnly=true');
  const unreadCount = await request('/notifications/unread-count');
  expect('list and unread count agree', unreadList.status === 200 && unreadCount.status === 200 && unreadList.data.length === unreadCount.data.count, { list: unreadList.data?.length, count: unreadCount.data?.count });
  const readSame = await request(`/notifications/${sameFactory.id}/read`, { method: 'POST' });
  const unreadAfterRead = await request('/notifications?unreadOnly=true');
  expect('direct read removes the same row from unread list', readSame.status === 201 && !unreadAfterRead.data.some((item) => item.id === sameFactory.id), safe(readSame));

  await setWorkerAccess(FIXTURE.factoryB, false);
  const revokedList = await request('/notifications');
  const revokedUnread = await request('/notifications/unread-count');
  const revokedRead = await request(`/notifications/${remote.id}/read`, { method: 'POST' });
  const rowAfterRevoke = await db.notification.findUnique({ where: { id: remote.id }, select: { id: true } });
  expect('UFA revoke preserves historical row', rowAfterRevoke?.id === remote.id);
  expect('UFA revoke removes remote personal row from list and unread', revokedList.status === 200 && !revokedList.data.some((item) => item.id === remote.id) && revokedUnread.status === 200 && revokedUnread.data.count === 0, safe({ revokedList: revokedList.data, revokedUnread }));
  expect('UFA revoke blocks direct read', revokedRead.status === 403, safe(revokedRead));
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка после отзыва доступа',
  });
  expect('UFA revoke blocks future WS and push delivery', !deliveredTo(delivered, FIXTURE.worker));

  await setWorkerAccess(FIXTURE.factoryB, true);
  const restoredAccess = await request('/notifications');
  expect('restored Factory plus active UFA restores canonical access', restoredAccess.status === 200 && restoredAccess.data.some((item) => item.id === remote.id));

  await db.factory.update({ where: { id: FIXTURE.factoryB }, data: { isActive: false, deactivatedAt: now() } });
  const deactivatedList = await request('/notifications');
  const deactivatedRead = await request(`/notifications/${remote.id}/read`, { method: 'POST' });
  expect('deactivated source Factory blocks list and direct read', deactivatedList.status === 200 && !deactivatedList.data.some((item) => item.id === remote.id) && deactivatedRead.status === 403, safe(deactivatedRead));
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка отключённого завода',
  });
  expect('deactivated Factory blocks future WS and push', !deliveredTo(delivered, FIXTURE.worker));

  await db.factory.update({ where: { id: FIXTURE.factoryB }, data: { isActive: true, deactivatedAt: null } });
  const restoredFactory = await request('/notifications');
  expect('Factory restore with active UFA follows F-01 semantics', restoredFactory.status === 200 && restoredFactory.data.some((item) => item.id === remote.id));
  await setWorkerAccess(FIXTURE.factoryB, false);
  const restoredRevoked = await request('/notifications');
  expect('Factory restore does not restore a revoked UFA', restoredRevoked.status === 200 && !restoredRevoked.data.some((item) => item.id === remote.id));
  await setWorkerAccess(FIXTURE.factoryB, true);

  await setOverride(FIXTURE.worker, FIXTURE.factoryB, 'wash.read', PermissionEffect.DENY);
  const washDeniedList = await request('/notifications', { factoryId: FIXTURE.factoryB });
  const washDeniedRead = await request(`/notifications/${departmentWash.id}/read`, { factoryId: FIXTURE.factoryB, method: 'POST' });
  expect('department match plus effective DENY is inaccessible', washDeniedList.status === 200 && !washDeniedList.data.some((item) => item.id === departmentWash.id) && washDeniedRead.status === 403, safe(washDeniedRead));
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    departmentId: FIXTURE.departmentB,
    entityType: 'WASH_ISSUE',
    entityId: crypto.randomUUID(),
    title: 'Замечание после запрета мойки',
  });
  expect('effective DENY blocks department WS and push', !deliveredTo(delivered, FIXTURE.worker));
  await setOverride(FIXTURE.worker, FIXTURE.factoryB, 'wash.read', PermissionEffect.ALLOW);

  await setOverride(FIXTURE.worker, FIXTURE.factoryB, 'tasks.read', PermissionEffect.DENY);
  const taskDeniedList = await request('/notifications');
  expect('effective source capability removal hides personal notification', taskDeniedList.status === 200 && !taskDeniedList.data.some((item) => item.id === remote.id));
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка после запрета источника',
  });
  expect('effective source capability removal blocks WS and push', !deliveredTo(delivered, FIXTURE.worker));
  await setOverride(FIXTURE.worker, FIXTURE.factoryB, 'tasks.read', PermissionEffect.ALLOW);

  const adminRemote = await db.notification.create({
    data: {
      factoryId: FIXTURE.factoryB,
      userId: FIXTURE.admin,
      type: `AUTHORITY_${crypto.randomUUID()}`,
      title: 'Административное уведомление второго завода',
      message: 'Проверка заводской области доступа администратора.',
      entityType: 'TASK',
      entityId: crypto.randomUUID(),
      severity: NotificationSeverity.INFO,
      expiresAt: future(),
    },
  });
  const adminWithoutB = await request('/notifications', { userId: FIXTURE.admin });
  expect('ADMIN has no arbitrary source-Factory bypass', adminWithoutB.status === 200 && !adminWithoutB.data.some((item) => item.id === adminRemote.id));
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: FIXTURE.admin, factoryId: FIXTURE.factoryB } },
    update: { role: UserRole.ADMIN, isGuest: false, isActive: true, deactivatedAt: null },
    create: { userId: FIXTURE.admin, factoryId: FIXTURE.factoryB, role: UserRole.ADMIN, isGuest: false, isActive: true },
  });
  const adminWithB = await request('/notifications', { userId: FIXTURE.admin });
  expect('ADMIN with active source UFA can use personal remote notification', adminWithB.status === 200 && adminWithB.data.some((item) => item.id === adminRemote.id));
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId: FIXTURE.admin, factoryId: FIXTURE.factoryB } },
    data: { isActive: false, deactivatedAt: now() },
  });

  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.guest,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Уведомление гостя',
  });
  const guestList = await request('/notifications', { userId: FIXTURE.guest, factoryId: FIXTURE.factoryB });
  expect('Guest receives neither operational API access nor delivery', guestList.status === 403 && !deliveredTo(delivered, FIXTURE.guest), safe(guestList));

  await db.user.update({ where: { id: FIXTURE.worker }, data: { blockedAt: now() } });
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка заблокированному сотруднику',
  });
  const blockedApi = await request('/notifications/unread-count', { factoryId: FIXTURE.factoryB });
  expect('blocked user receives no operational delivery or API access', !deliveredTo(delivered, FIXTURE.worker) && blockedApi.status === 403, safe(blockedApi));

  await db.user.update({ where: { id: FIXTURE.worker }, data: { blockedAt: null, deletedAt: now() } });
  resetDelivery(delivered);
  await createNotification(notifications, {
    factoryId: FIXTURE.factoryB,
    userId: FIXTURE.worker,
    entityType: 'TASK',
    entityId: crypto.randomUUID(),
    title: 'Заявка удалённому сотруднику',
  });
  expect('deleted user receives no operational WS or push', !deliveredTo(delivered, FIXTURE.worker));
  await db.user.update({ where: { id: FIXTURE.worker }, data: { blockedAt: null, deletedAt: null } });

  const payload = pushService.notificationPayload({
    id: remote.id,
    factoryId: FIXTURE.factoryB,
    type: remote.type,
    title: remote.title,
    message: remote.message,
    severity: remote.severity,
    sourceRoute: 'tasks',
    createdAt: remote.createdAt,
  });
  const payloadText = JSON.stringify(payload);
  expect('push payload keeps minimal safe source provenance', payload.factoryId === FIXTURE.factoryB && payload.sourceRoute === 'tasks');
  expect('push payload omits source internals and secrets', !/entityType|entityId|operationId|storagePath|passwordHash|token|secret|DATABASE_URL/i.test(payloadText), safe(payload));

  const publicText = JSON.stringify([listA.data, restoredFactory.data, payload]);
  expect('public notification samples do not expose sensitive fields', !/storagePath|passwordHash|DATABASE_URL|permissionCode|operationId|token|secret/i.test(publicText));
}

async function prepareBrowser() {
  await ensureFixtures();
  const records = {};
  for (const [key, factoryId, title] of [
    ['sameFactory', FIXTURE.factoryA, 'Открыть заявку текущего завода'],
    ['remoteAllowed', FIXTURE.factoryB, 'Открыть заявку второго завода'],
    ['remoteRevoked', FIXTURE.factoryB, 'Проверить отзыв доступа перед открытием'],
    ['remoteDeactivated', FIXTURE.factoryB, 'Проверить отключение завода перед открытием'],
    ['remoteDenied', FIXTURE.factoryB, 'Проверить запрет раздела перед открытием'],
    ['browserIntent', FIXTURE.factoryB, 'Открыть из уведомления браузера'],
    ['serviceWorkerIntent', FIXTURE.factoryB, 'Открыть из системного уведомления'],
    ['coldStartIntent', FIXTURE.factoryB, 'Открыть после холодного запуска'],
  ]) {
    records[key] = await db.notification.create({
      data: {
        factoryId,
        userId: FIXTURE.worker,
        type: `AUTHORITY_${crypto.randomUUID()}`,
        title,
        message: 'Безопасный переход к заявкам.',
        entityType: 'TASK',
        entityId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        severity: NotificationSeverity.WARNING,
        expiresAt: future(),
      },
      select: { id: true, factoryId: true, title: true, message: true, type: true, severity: true, createdAt: true },
    });
  }
  const fixture = {
    ...FIXTURE,
    factoryAName: 'Контур уведомлений А',
    factoryBName: 'Контур уведомлений Б',
    notifications: records,
  };
  const outputDir = path.join(rootDir, '.codex-runtime', 'notification-authority');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'fixture.json'), JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ prepared: true, fixturePath: path.join(outputDir, 'fixture.json') }, null, 2));
}

async function main() {
  const mode = process.argv[2] || '--backend';
  if (mode === '--cleanup') {
    await cleanup();
    console.log(JSON.stringify({ cleanup: await cleanupCounts() }, null, 2));
    return;
  }
  if (mode === '--prepare-browser') {
    await prepareBrowser();
    return;
  }

  try {
    await runBackend();
  } finally {
    await cleanup();
  }
  const counts = await cleanupCounts();
  for (const [name, count] of Object.entries(counts)) expect(`cleanup ${name} is zero`, count === 0, count);
  console.log(JSON.stringify({ ...state, cleanup: counts }, null, 2));
  if (state.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
