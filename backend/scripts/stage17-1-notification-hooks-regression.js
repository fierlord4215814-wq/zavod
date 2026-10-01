const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });
const createdStockItemIds = [];

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

async function notificationCount(type, entityId, userId) {
  return prisma.notification.count({ where: { type, entityId, ...(userId ? { userId } : {}) } });
}

async function assertNotification(name, userId, factoryId, type, entityId) {
  const list = await expectStatus(`${name}: recipient can list notifications`, 200, request('/notifications', { userId, factoryId }));
  if (list.data.some((item) => item.type === type && item.entityId === entityId)) ok(name);
  else fail(name, list.data.filter((item) => item.type === type).map((item) => ({ id: item.id, entityId: item.entityId })));
}

async function activeWashSession(factoryId) {
  const existing = await prisma.washSession.findFirst({ where: { factoryId, status: { not: 'DONE' } }, orderBy: { createdAt: 'desc' } });
  if (existing) return existing;
  const line = await prisma.line.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!line) throw new Error('line not found for wash');
  const started = await expectStatus('wash session for notification hooks started', 201, request('/wash/start', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, operationId: `stage171-wash-${Date.now()}` },
  }));
  return started.data;
}

async function cleanup() {
  if (!createdStockItemIds.length) return;
  await prisma.minimumStockItem.updateMany({
    where: { id: { in: createdStockItemIds } },
    data: { isActive: false, archivedAt: new Date() },
  });
}

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const managementAccess = await prisma.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId: 'test-management', factoryId } },
  });
  if (!managementAccess?.departmentId) throw new Error('test-management department missing');
  const departmentId = managementAccess.departmentId;
  const stamp = Date.now();

  const item = await expectStatus('low-stock source item created', 201, request('/orders/items', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { name: `Проверка уведомления остатка ${stamp}`, minThreshold: 2, initialQuantity: 3, departmentId },
  }));
  if (item.data?.id) createdStockItemIds.push(item.data.id);
  await expectStatus('low-stock take crosses threshold', 201, request(`/orders/items/${item.data.id}/take`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { quantity: 2, comment: 'Проверка снижения ниже минимума' },
  }));
  await assertNotification('low stock creates notification', 'test-management', factoryId, 'ORDER_STOCK_BELOW_THRESHOLD', item.data.id);
  const lowStockCount = await notificationCount('ORDER_STOCK_BELOW_THRESHOLD', item.data.id, 'test-management');
  await expectStatus('low-stock duplicate event does not duplicate notification', 201, request(`/orders/items/${item.data.id}/take`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { quantity: 1, comment: 'Проверка повторного снижения ниже минимума' },
  }));
  const lowStockCountAfter = await notificationCount('ORDER_STOCK_BELOW_THRESHOLD', item.data.id, 'test-management');
  if (lowStockCountAfter === lowStockCount) ok('low stock notification idempotent by entity');
  else fail('low stock notification idempotent by entity', { before: lowStockCount, after: lowStockCountAfter });

  const task = await expectStatus('overdue LONG task created', 201, request('/tasks', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: {
      description: `Stage171 overdue LONG ${stamp}`,
      type: 'LONG',
      deadlineAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      departmentRecipientIds: [departmentId],
      assigneeUserIds: ['test-tech-kipia'],
      operationId: `stage171-long-${stamp}`,
    },
  }));
  await expectStatus('LONG escalation check runs', 201, request('/tasks/escalation/check', { userId: 'test-management', factoryId, method: 'POST', body: {} }));
  await assertNotification('LONG escalation creates assignee notification', 'test-tech-kipia', factoryId, 'TASK_LONG_ESCALATED', task.data.id);

  const important = await expectStatus('important shift log created', 201, request('/shift-log', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { departmentId, title: `Stage171 important ${stamp}`, text: 'Important handover notice', isImportant: true },
  }));
  await assertNotification('important shift log creates notification', 'test-management', factoryId, 'SHIFT_LOG_IMPORTANT_CREATED', important.data.id);

  const washSession = await activeWashSession(factoryId);
  const issue = await expectStatus('wash issue hook source created', 201, request(`/wash/${washSession.id}/issues`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { title: `Stage171 wash issue ${stamp}`, description: 'Needs attention' },
  }));
  await assertNotification('wash issue creates notification', 'test-master', factoryId, 'WASH_ISSUE_CREATED', issue.data.id);
  const review = await expectStatus('wash OKK review hook source created', 201, request(`/wash/${washSession.id}/okk-review`, {
    userId: 'test-okk',
    factoryId,
    method: 'POST',
    body: { status: 'NEEDS_REWORK', comment: 'Stage171 review needs rework' },
  }));
  await assertNotification('wash OKK review creates notification', 'test-master', factoryId, 'WASH_OKK_REVIEW_CREATED', review.data.id);

  const template = await expectStatus('checklist template for auto-close created', 201, request('/checklists/templates', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { name: `Stage171 checklist ${stamp}`, departmentId },
  }));
  await expectStatus('checklist row for auto-close created', 201, request(`/checklists/templates/${template.data.id}/rows`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { title: 'Stage171 row', sortOrder: 1 },
  }));
  const run = await expectStatus('checklist run for auto-close started', 201, request('/checklists/runs', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { templateId: template.data.id },
  }));
  await expectStatus('checklist auto-close hook source runs', 201, request('/checklists/runs/auto-close', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { force: true, departmentId, comment: 'Stage171 auto-close' },
  }));
  await assertNotification('checklist auto-close creates notification', 'test-management', factoryId, 'CHECKLIST_RUN_AUTO_CLOSED', run.data.id);

  const defrostLines = await expectStatus('defrost lines are available for notification hook', 200, request('/defrost/lines', {
    userId: 'test-tech-holod',
    factoryId,
  }));
  const availableDefrostLines = Array.isArray(defrostLines.data) ? defrostLines.data : [];
  const line = availableDefrostLines.find((item) => item.status === 'STOP' && /Проверочная линия оттайки/i.test(item.name ?? ''))
    ?? availableDefrostLines.find((item) => item.status === 'STOP');
  if (!line?.id) throw new Error('line not found for defrost');
  const activeDefrost = await prisma.defrostEvent.findFirst({ where: { factoryId, lineId: line.id, status: 'ACTIVE' } });
  if (activeDefrost) {
    await expectStatus('existing defrost ended before stage171 start', 201, request(`/defrost/${activeDefrost.id}/end`, {
      userId: 'test-tech-holod',
      factoryId,
      method: 'POST',
      body: { comment: 'Stage171 clean active defrost' },
    }));
  }
  const defrost = await expectStatus('defrost started for notification hook', 201, request('/defrost/start', {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, comment: 'Stage171 defrost start' },
  }));
  await assertNotification('defrost started creates notification', 'test-tech-holod', factoryId, 'DEFROST_STARTED', defrost.data.id);
  await expectStatus('defrost completed for notification hook', 201, request(`/defrost/${defrost.data.id}/end`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Stage171 defrost done' },
  }));
  await assertNotification('defrost completed creates notification', 'test-tech-holod', factoryId, 'DEFROST_COMPLETED', defrost.data.id);

  const foreignFactory = await prisma.factory.upsert({
    where: { code: 'stage171-notification-hooks-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage171-notification-hooks-other', name: 'Stage171 notification hooks other' },
  });
  const foreign = await prisma.notification.create({
    data: { factoryId: foreignFactory.id, type: 'STAGE171_FOREIGN', title: 'Foreign', message: 'Foreign', severity: 'INFO' },
  });
  await expectStatus('unrelated factory notification denied', 403, request(`/notifications/${foreign.id}/read`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: {},
  }));

  await prisma.user.update({ where: { id: 'worker-1' }, data: { blockedAt: new Date() } });
  await expectStatus('blocked user cannot read notifications', 403, request('/notifications', { userId: 'worker-1', factoryId }));
  await prisma.user.update({ where: { id: 'worker-1' }, data: { blockedAt: null } });

  const readable = await prisma.notification.create({
    data: { factoryId, userId: 'test-management', type: 'STAGE171_READABLE', title: 'Readable', message: 'Readable', severity: 'INFO' },
  });
  await expectStatus('read notification still works', 201, request(`/notifications/${readable.id}/read`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: {},
  }));
  await expectStatus('read-all still works', 201, request('/notifications/read-all', { userId: 'test-management', factoryId, method: 'POST', body: {} }));

  const deniedAudit = await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', entityType: 'Notification', entityId: foreign.id } });
  if (deniedAudit > 0) ok('ACCESS_DENIED audit remains for forbidden notification access', { count: deniedAudit });
  else fail('ACCESS_DENIED audit remains for forbidden notification access', { count: deniedAudit });

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
  });
