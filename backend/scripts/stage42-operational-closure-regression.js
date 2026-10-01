const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const stamp = Date.now();
const marker = `Operational closure evidence ${stamp}`;

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function expectForbidden(name, promise) {
  const response = await promise;
  if ([400, 403, 409].includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: [400, 403, 409], status: response.status, data: response.data });
  return response;
}

function hasNoSecrets(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|authToken|token/i.test(JSON.stringify(value));
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null, name: { not: { startsWith: 'Stage' } } }, orderBy: { createdAt: 'asc' } });
  if (!line) throw new Error('production line not found');
  const techAccess = await db.userFactoryAccess.findFirst({
    where: { factoryId, userId: 'test-tech-holod', isActive: true, isGuest: false },
  });
  const recipientDepartmentId = techAccess?.departmentId
    ?? (await db.department.findFirst({ where: { OR: [{ factoryId }, { scope: 'GLOBAL' }], isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } }))?.id;
  if (!recipientDepartmentId) throw new Error('recipient department not found');

  const start = await expectStatus('MASTER фиксирует простой с причиной и комментарием', 200, request('PATCH', `/lines/${line.id}/status`, {
    userId: 'test-master',
    factoryId,
    body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: техническая остановка` },
  }));
  const eventId = start.data?.id;
  if (eventId && start.data?.downtimeReason === 'TECHNICAL') ok('downtime reason stored explicitly', { eventId });
  else fail('downtime reason stored explicitly', start.data);

  await expectForbidden('correction requires comment', request('POST', `/archive/downtime/${eventId}/correction`, {
    userId: 'test-master',
    factoryId,
    body: {
      correctedStartAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      correctedEndAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      comment: '',
    },
  }));

  const correctedStartAt = new Date(Date.now() - 25 * 60_000).toISOString();
  const correctedEndAt = new Date(Date.now() - 2 * 60_000).toISOString();
  await expectStatus('MASTER уточняет время простоя', 201, request('POST', `/archive/downtime/${eventId}/correction`, {
    userId: 'test-master',
    factoryId,
    body: { correctedStartAt, correctedEndAt, comment: `${marker}: уточнение фактического запуска` },
  }));
  const correctionAudit = await db.auditLog.findFirst({ where: { action: 'LINE_DOWNTIME_CORRECTED', entityId: eventId }, orderBy: { createdAt: 'desc' } });
  if (correctionAudit && JSON.stringify(correctionAudit.details).includes('oldValue') && JSON.stringify(correctionAudit.details).includes('newValue')) ok('correction audit stores old/new values');
  else fail('correction audit stores old/new values', correctionAudit);

  const task = await expectStatus('MASTER creates task from downtime', 201, request('POST', '/tasks', {
    userId: 'test-master',
    factoryId,
    body: {
      lineId: line.id,
      lineStatusEventId: eventId,
      operationId: `stage42-task-${stamp}`,
      type: 'URGENT',
      description: `${marker}: заявка из простоя`,
      departmentRecipientIds: [recipientDepartmentId],
    },
  }));
  const taskId = task.data?.id;
  if (taskId && task.data?.lineId === line.id && task.data?.lineStatusEventId === eventId) ok('task keeps lineId and lineStatusEventId', { taskId });
  else fail('task keeps lineId and lineStatusEventId', task.data);

  const recipientTasks = await expectStatus('recipient department sees downtime task', 200, request('GET', `/tasks?search=${encodeURIComponent(marker)}&includeDone=true`, {
    userId: 'test-tech-holod',
    factoryId,
  }));
  if (JSON.stringify(recipientTasks.data).includes(taskId)) ok('recipient department can see task from downtime');
  else fail('recipient department can see task from downtime', recipientTasks.data);

  await expectForbidden('wrong role/department cannot take unrelated task', request('POST', `/tasks/${taskId}/take`, {
    userId: 'worker-1',
    factoryId,
    body: { operationId: `stage42-worker-take-${stamp}` },
  }));

  await expectStatus('MASTER completes downtime', 200, request('PATCH', `/lines/${line.id}/status`, {
    userId: 'test-master',
    factoryId,
    body: { status: 'WORK', comment: `${marker}: фактически запущена` },
  }));

  const summary = await expectStatus('analytics uses corrected downtime interval', 200, request('GET', `/archive/downtime/summary?dateFrom=${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}&dateTo=${new Date().toISOString().slice(0, 10)}&downtimeLinkedOnly=true`, {
    userId: 'test-admin',
    factoryId,
  }));
  if ((summary.data?.downtime?.totalMinutes ?? 0) >= 1) ok('corrected downtime contributes to archive analytics', summary.data.downtime);
  else fail('corrected downtime contributes to archive analytics', summary.data);

  const notifications = await expectStatus('notification related source route exists', 200, request('GET', '/notifications', {
    userId: 'test-tech-holod',
    factoryId,
  }));
  const relatedNotification = notifications.data?.find((item) => item.entityType === 'TASK' && item.entityId === taskId);
  if (relatedNotification?.sourceRoute === 'tasks') ok('task notification links to tasks screen');
  else fail('task notification links to tasks screen', relatedNotification ?? notifications.data);

  const archive = await expectStatus('archive task item has source route', 200, request('GET', `/archive/items?section=tasks&search=${encodeURIComponent(marker)}`, {
    userId: 'test-admin',
    factoryId,
  }));
  const archiveItem = archive.data?.items?.find((item) => item.sourceId === taskId);
  if (archiveItem?.sourceRoute === 'tasks') ok('archive source route is present for task');
  else fail('archive source route is present for task', archive.data);

  await expectForbidden('archive link does not bypass task visibility', request('GET', `/tasks/${taskId}`, {
    userId: 'worker-1',
    factoryId,
  }));

  const defrostSummary = await expectStatus('defrost 30-day summary is safe', 200, request('GET', `/defrost/lines/${line.id}/summary?days=30`, {
    userId: 'worker-1',
    factoryId,
  }));
  if (Object.prototype.hasOwnProperty.call(defrostSummary.data, 'defrostCount') && Object.prototype.hasOwnProperty.call(defrostSummary.data, 'hasEnoughData')) ok('defrost summary returns count or insufficient data safely');
  else fail('defrost summary returns count or insufficient data safely', defrostSummary.data);
  await expectStatus('defrost 60-day summary is safe', 200, request('GET', `/defrost/lines/${line.id}/summary?days=60`, {
    userId: 'test-tech-holod',
    factoryId,
  }));

  const orderArchive = await expectStatus('stock TAKE/RESTOCK archive metrics still work', 200, request('GET', '/archive/items?section=orders', {
    userId: 'test-store',
    factoryId,
  }));
  if (orderArchive.data?.metrics && Object.prototype.hasOwnProperty.call(orderArchive.data.metrics, 'takeQuantity') && Object.prototype.hasOwnProperty.call(orderArchive.data.metrics, 'restockQuantity')) ok('stock archive exposes TAKE/RESTOCK metrics', orderArchive.data.metrics);
  else fail('stock archive exposes TAKE/RESTOCK metrics', orderArchive.data);

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage42-other-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage42-other-factory', name: 'Stage42 другой завод', isActive: true },
  });
  await expectForbidden('cross-factory line denied', request('PATCH', `/lines/${line.id}/status`, {
    userId: 'test-admin',
    factoryId: otherFactory.id,
    body: { status: 'PAUSE', downtimeReason: 'OTHER', comment: marker },
  }));

  await db.user.upsert({
    where: { id: 'stage42-blocked-master' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage42-blocked-master', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage42-blocked-master', factoryId } },
    update: { role: 'MASTER', isActive: true, isGuest: false },
    create: { userId: 'stage42-blocked-master', factoryId, role: 'MASTER', isActive: true, isGuest: false },
  });
  await expectForbidden('blocked user denied', request('GET', '/archive/downtime/summary', {
    userId: 'stage42-blocked-master',
    factoryId,
  }));
  await db.user.update({ where: { id: 'stage42-blocked-master' }, data: { blockedAt: null } });

  if (hasNoSecrets(notifications.data) && hasNoSecrets(archive.data) && hasNoSecrets(defrostSummary.data)) ok('responses contain no secrets or storage paths');
  else fail('responses contain no secrets or storage paths', { notifications: notifications.data, archive: archive.data, defrostSummary: defrostSummary.data });

  const taskCleanup = await db.task.updateMany({
    where: { description: { contains: marker }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  ok('marked Stage42 tasks soft-cleaned', { count: taskCleanup.count });

  console.log(JSON.stringify({ api: API, factoryId, lineId: line.id, eventId, ok: state.ok, failures: state.failures }, null, 2));
  await db.$disconnect();
  if (state.failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
