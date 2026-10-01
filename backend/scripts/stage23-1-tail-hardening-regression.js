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
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(pathname, { userId = 'test-admin', factoryId, method = 'GET', body, formData } = {}) {
  const headers = { 'x-user-id': userId };
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : formData,
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

async function upload(userId, factoryId, entityType, entityId, kind, blob, fileName) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', kind);
  form.append('operationId', `stage231-attachment-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  form.append('file', blob, fileName);
  return request('/attachments/upload', { userId, factoryId, method: 'POST', formData: form });
}

async function notificationCount(type, entityId, userId) {
  return db.notification.count({ where: { type, entityId, ...(userId ? { userId } : {}) } });
}

async function assertNotification(name, userId, factoryId, type, entityId) {
  const list = await expectStatus(`${name}: список уведомлений доступен`, 200, request('/notifications', { userId, factoryId }));
  if (list.data.some((item) => item.type === type && item.entityId === entityId)) ok(name);
  else fail(name, list.data.filter((item) => item.type === type).map((item) => ({ id: item.id, entityId: item.entityId })));
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  const stamp = Date.now();

  const managementAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-management', factoryId } } });
  if (!managementAccess?.departmentId) throw new Error('test-management department missing');
  const departmentId = managementAccess.departmentId;

  const chats = await expectStatus('мастер видит список чатов', 200, request('/chats', { userId: 'test-master', factoryId }));
  const chat = chats.data.find((item) => item.type === 'DEPARTMENT') || chats.data.find((item) => item.type === 'FACTORY');
  if (!chat) throw new Error('visible chat for test-master not found');
  const message = await expectStatus('сообщение чата создано', 201, request(`/chats/${chat.id}/messages`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { text: `Stage231 media ${stamp}`, operationId: `stage231-chat-${stamp}` },
  }));
  const photo = await expectStatus('фото в чат загружается', 201, upload('test-master', factoryId, 'CHAT_MESSAGE', message.data.id, 'PHOTO', new Blob(['stage231-photo'], { type: 'image/png' }), 'stage231.png'));
  const file = await expectStatus('файл в чат загружается', 201, upload('test-master', factoryId, 'CHAT_MESSAGE', message.data.id, 'FILE', new Blob(['stage231-file'], { type: 'text/plain' }), 'stage231.txt'));
  const video = await expectStatus('видео в чат загружается безопасно', 201, upload('test-master', factoryId, 'CHAT_MESSAGE', message.data.id, 'VIDEO', new Blob(['stage231-video'], { type: 'video/mp4' }), 'stage231.mp4'));
  for (const attachment of [photo.data, file.data, video.data]) {
    const meta = await expectStatus('metadata вложения не отдаёт storagePath', 200, request(`/attachments/${attachment.id}`, { userId: 'test-master', factoryId }));
    if (meta.data.storagePath === undefined) ok(`storagePath скрыт: ${attachment.kind}`);
    else fail(`storagePath скрыт: ${attachment.kind}`, meta.data);
  }
  await expectStatus('сообщение чата soft-delete', 200, request(`/chats/${chat.id}/messages/${message.data.id}`, { userId: 'test-master', factoryId, method: 'DELETE' }));
  await expectStatus('вложение удалённого сообщения недоступно', 403, request(`/attachments/${photo.data.id}/file`, { userId: 'test-master', factoryId }));

  const departments = await expectStatus('отделы для заявок доступны', 200, request('/tasks/recipient-departments', { userId: 'test-master', factoryId }));
  if (departments.data.some((item) => item.id === departmentId)) ok('список отделов содержит допустимый отдел');
  else fail('список отделов содержит допустимый отдел', departments.data);

  const assignees = await expectStatus('исполнители заявки доступны через поиск', 200, request('/tasks/assignee-candidates?query=test-tech-kipia', { userId: 'test-master', factoryId }));
  if (assignees.data.some((item) => item.userId === 'test-tech-kipia')) ok('поиск исполнителя включает пользователя вне текущей смены');
  else fail('поиск исполнителя включает пользователя вне текущей смены', assignees.data);

  const masters = await expectStatus('directory users role MASTER доступен для ОКК', 200, request('/directory/users?role=MASTER', { userId: 'test-okk', factoryId }));
  if (masters.data.length && masters.data.every((item) => item.role === 'MASTER')) ok('варианты мастера ОКК содержат только мастеров');
  else fail('варианты мастера ОКК содержат только мастеров', masters.data);

  const washUsers = await expectStatus('wash assignedTo options scoped', 200, request('/directory/users?q=test', { userId: 'test-master', factoryId }));
  if (washUsers.data.every((item) => item.factoryId === factoryId)) ok('directory users не протекают за пределы завода');
  else fail('directory users не протекают за пределы завода', washUsers.data);
  await expectStatus('blocked user denied on directory', 403, request('/directory/users', { userId: 'blocked-user', factoryId }));

  await db.shiftReturnRequest.updateMany({
    where: { factoryId, userId: 'worker-1', status: 'PENDING' },
    data: { status: 'CANCELLED', decisionComment: 'Stage231 regression closes stale pending request', decidedAt: new Date() },
  });
  await db.user.update({ where: { id: 'worker-1' }, data: { employeeState: 'OFF_SHIFT' } });
  const returnRequest = await expectStatus('SHIFT_RETURN_REQUESTED source created', 201, request('/shift/return-request', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { reason: `Stage231 return ${stamp}` },
  }));
  await assertNotification('SHIFT_RETURN_REQUESTED notification', 'test-master', factoryId, 'SHIFT_RETURN_REQUESTED', returnRequest.data.id);
  await db.shiftReturnRequest.update({
    where: { id: returnRequest.data.id },
    data: { status: 'CANCELLED', decisionComment: 'Stage231 regression closes its return request after notification check', decidedAt: new Date() },
  });

  const task = await expectStatus('task for redirect hook created', 201, request('/tasks', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: {
      description: `Stage231 redirect ${stamp}`,
      type: 'LONG',
      deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      departmentRecipientIds: [departmentId],
      operationId: `stage231-task-${stamp}`,
    },
  }));
  await expectStatus('TASK_REDIRECTED source updated', 201, request(`/tasks/${task.data.id}/redirect`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { newAssigneeUserIds: ['test-tech-kipia'], comment: 'Stage231 redirect to specialist' },
  }));
  await assertNotification('TASK_REDIRECTED notification', 'test-tech-kipia', factoryId, 'TASK_REDIRECTED', task.data.id);
  await expectStatus('TASK_DONE source completed', 201, request(`/tasks/${task.data.id}/complete`, {
    userId: 'test-tech-kipia',
    factoryId,
    method: 'POST',
    body: { comment: 'Stage231 done', operationId: `stage231-task-done-${stamp}` },
  }));
  await assertNotification('TASK_DONE notification', 'test-master', factoryId, 'TASK_DONE', task.data.id);

  const requestItem = await expectStatus('order request close hook source created', 201, request('/orders/requests', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { title: `Stage231 order ${stamp}`, requestedQuantity: 1, reasonComment: 'Stage231 manual order', departmentId },
  }));
  const beforeClose = await notificationCount('ORDER_REQUEST_CLOSED', requestItem.data.id, 'test-management');
  await expectStatus('ORDER_REQUEST_CLOSED source closed', 201, request(`/orders/requests/${requestItem.data.id}/close`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { closeStatus: 'ORDERED', comment: 'Stage231 ordered' },
  }));
  await assertNotification('ORDER_REQUEST_CLOSED notification', 'test-management', factoryId, 'ORDER_REQUEST_CLOSED', requestItem.data.id);
  const afterClose = await notificationCount('ORDER_REQUEST_CLOSED', requestItem.data.id, 'test-management');
  if (afterClose === beforeClose + 1) ok('ORDER_REQUEST_CLOSED notification not duplicated');
  else fail('ORDER_REQUEST_CLOSED notification not duplicated', { beforeClose, afterClose });

  const frontendRoot = path.resolve(__dirname, '../../frontend/src');
  const patterns = [/�/, /����/, /Ð/, /Рџ/, /Network unavailable/, /Access denied/, /No data/];
  const badFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (patterns.some((pattern) => pattern.test(text))) badFiles.push(path.relative(frontendRoot, full));
    }
  }
  walk(frontendRoot);
  if (badFiles.length === 0) ok('русский UI scan без mojibake/visible English хвостов');
  else fail('русский UI scan без mojibake/visible English хвостов', badFiles);

  if (state.failures.length) {
    console.error('STAGE23_1_TAIL_HARDENING_FAILED');
    console.error(JSON.stringify(state, null, 2));
    process.exit(1);
  }
  console.log('STAGE23_1_TAIL_HARDENING_PASSED');
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error('STAGE23_1_TAIL_HARDENING_ERROR');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
