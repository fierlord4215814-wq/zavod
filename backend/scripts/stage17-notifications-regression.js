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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const managementAccess = await prisma.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId: 'test-management', factoryId } },
  });
  if (!managementAccess?.departmentId) throw new Error('test-management department missing');

  const direct = await prisma.notification.create({
    data: {
      factoryId,
      userId: 'worker-1',
      type: 'STAGE17_DIRECT_USER',
      title: 'Stage17 user notification',
      message: 'Direct user notification',
      severity: 'INFO',
    },
  });
  const departmentNotification = await prisma.notification.create({
    data: {
      factoryId,
      departmentId: managementAccess.departmentId,
      type: 'STAGE17_DEPARTMENT',
      title: 'Stage17 department notification',
      message: 'Department notification',
      severity: 'WARNING',
    },
  });

  const workerList = await expectStatus('worker reads notifications', 200, request('/notifications', { userId: 'worker-1', factoryId }));
  if (workerList.data.some((item) => item.id === direct.id) && !workerList.data.some((item) => item.id === departmentNotification.id)) {
    ok('worker sees own and factory notifications, not other departments');
  } else {
    fail('worker sees own and factory notifications, not other departments', workerList.data.map((item) => item.id));
  }

  const unread = await expectStatus('unread count works', 200, request('/notifications/unread-count', { userId: 'worker-1', factoryId }));
  if (unread.data.count >= 1) ok('unread count includes direct notification', unread.data);
  else fail('unread count includes direct notification', unread.data);

  await expectStatus('read notification idempotent first', 201, request(`/notifications/${direct.id}/read`, { userId: 'worker-1', factoryId, method: 'POST', body: {} }));
  await expectStatus('read notification idempotent second', 201, request(`/notifications/${direct.id}/read`, { userId: 'worker-1', factoryId, method: 'POST', body: {} }));
  await expectStatus('read-all works', 201, request('/notifications/read-all', { userId: 'worker-1', factoryId, method: 'POST', body: {} }));

  const managementList = await expectStatus('management reads scoped notifications', 200, request('/notifications', { userId: 'test-management', factoryId }));
  if (managementList.data.some((item) => item.id === departmentNotification.id)) ok('management sees own department notification');
  else fail('management sees own department notification', managementList.data.map((item) => item.id));

  const otherFactory = await prisma.factory.upsert({
    where: { code: 'stage17-notifications-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage17-notifications-other', name: 'Stage17 notifications other' },
  });
  const foreign = await prisma.notification.create({
    data: {
      factoryId: otherFactory.id,
      type: 'STAGE17_FOREIGN',
      title: 'Foreign notification',
      message: 'Foreign notification',
      severity: 'INFO',
    },
  });
  await expectStatus('cross-factory notification denied on read', 403, request(`/notifications/${foreign.id}/read`, { userId: 'worker-1', factoryId, method: 'POST', body: {} }));

  await prisma.user.upsert({
    where: { id: 'stage17-blocked-worker' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage17-blocked-worker', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage17-blocked-worker', factoryId } },
    update: { role: 'WORKER', isActive: true, isGuest: false },
    create: { userId: 'stage17-blocked-worker', factoryId, role: 'WORKER', isActive: true, isGuest: false },
  });
  await expectStatus('blocked user forbidden', 403, request('/notifications', { userId: 'stage17-blocked-worker', factoryId }));
  await prisma.user.update({ where: { id: 'stage17-blocked-worker' }, data: { blockedAt: null } });

  const taskCreate = await expectStatus('task event hook source created', 201, request('/tasks', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { description: `Stage17 task notification ${Date.now()}`, type: 'URGENT', assigneeUserIds: ['test-tech-kipia'] },
  }));
  const techNotifications = await expectStatus('assignee reads task notification', 200, request('/notifications', { userId: 'test-tech-kipia', factoryId }));
  if (techNotifications.data.some((item) => item.type === 'TASK_CREATED' && item.entityId === taskCreate.data.id)) ok('task created event creates notification');
  else fail('task created event creates notification', techNotifications.data.filter((item) => item.type === 'TASK_CREATED'));

  const orderItem = await expectStatus('order item for notification hook created', 201, request('/orders/items', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: {
      name: `Stage17 notif item ${Date.now()}`,
      minThreshold: 1,
      initialQuantity: 3,
      departmentId: managementAccess.departmentId,
    },
  }));
  const orderRequest = await expectStatus('order request hook source created', 201, request(`/orders/items/${orderItem.data.id}/order`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { requestedQuantity: 2, reasonComment: 'Stage17 notification hook' },
  }));
  const orderNotifications = await expectStatus('management reads order notification', 200, request('/notifications', { userId: 'test-management', factoryId }));
  if (orderNotifications.data.some((item) => item.type === 'ORDER_REQUEST_CREATED' && item.entityId === orderRequest.data.id)) ok('order request event creates notification');
  else fail('order request event creates notification', orderNotifications.data.filter((item) => item.type === 'ORDER_REQUEST_CREATED'));

  await expectStatus('admin reads selected factory notifications', 200, request('/notifications', { userId: 'test-admin', factoryId }));
  const workerAfter = await expectStatus('worker still cannot see unrelated notifications', 200, request('/notifications', { userId: 'worker-1', factoryId }));
  if (!workerAfter.data.some((item) => item.id === departmentNotification.id || item.id === foreign.id)) ok('worker unrelated department/factory notifications hidden');
  else fail('worker unrelated department/factory notifications hidden', workerAfter.data.map((item) => item.id));

  const accessDenied = await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', entityType: 'Notification', entityId: foreign.id } });
  if (accessDenied > 0) ok('ACCESS_DENIED audit for notification scope', { count: accessDenied });
  else fail('ACCESS_DENIED audit for notification scope', { count: accessDenied });

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
