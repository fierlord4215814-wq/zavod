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

async function upload(userId, factoryId, entityType, entityId) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `stage23-chat-attachment-${Date.now()}`);
  form.append('file', new Blob(['stage23 chat attachment'], { type: 'text/plain' }), 'stage23-chat.txt');
  return request('/attachments/upload', { userId, factoryId, method: 'POST', formData: form });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  const masterAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-master', factoryId } } });
  const okkAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-okk', factoryId } } });
  const managementAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-management', factoryId } } });
  const workerAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'worker-1', factoryId } } });
  if (!masterAccess?.departmentId || !okkAccess?.departmentId || !managementAccess?.departmentId || !workerAccess?.departmentId) throw new Error('seeded departments missing');

  const settings = await expectStatus('admin reads chat settings', 200, request('/admin/chat-settings', { userId: 'test-admin', factoryId }));
  if (settings.data?.chatEnabled === true) ok('chat settings exist');
  else fail('chat settings exist', settings.data);

  const adminChats = await expectStatus('admin reads chats', 200, request('/chats', { userId: 'test-admin', factoryId }));
  const factoryChat = adminChats.data.find((chat) => chat.type === 'FACTORY');
  const masterDepartmentChat = adminChats.data.find((chat) => chat.type === 'DEPARTMENT' && chat.departmentId === masterAccess.departmentId);
  const okkDepartmentChat = adminChats.data.find((chat) => chat.type === 'DEPARTMENT' && chat.departmentId === okkAccess.departmentId);
  const workerDepartmentChat = adminChats.data.find((chat) => chat.type === 'DEPARTMENT' && chat.departmentId === workerAccess.departmentId);
  const managementChat = adminChats.data.find((chat) => chat.type === 'MANAGEMENT');
  if (factoryChat && masterDepartmentChat && okkDepartmentChat && workerDepartmentChat && managementChat) ok('default chats exist');
  else fail('default chats exist', adminChats.data.map((chat) => ({ title: chat.title, type: chat.type, departmentId: chat.departmentId })));

  const masterChats = await expectStatus('master reads visible chats', 200, request('/chats', { userId: 'test-master', factoryId }));
  if (masterChats.data.some((chat) => chat.id === factoryChat.id) && masterChats.data.some((chat) => chat.id === masterDepartmentChat.id)) ok('master sees factory and own department chats');
  else fail('master sees factory and own department chats', masterChats.data.map((chat) => chat.title));
  if (!masterChats.data.some((chat) => chat.id === okkDepartmentChat.id) && !masterChats.data.some((chat) => chat.id === managementChat.id)) ok('master cannot see other department or management chat');
  else fail('master cannot see other department or management chat', masterChats.data.map((chat) => chat.title));

  await expectStatus('other department chat detail forbidden', 403, request(`/chats/${okkDepartmentChat.id}`, { userId: 'test-master', factoryId }));
  const workerChats = await expectStatus('worker reads visible chats by current permission policy', 200, request('/chats', { userId: 'worker-1', factoryId }));
  if (
    workerChats.data.some((chat) => chat.id === factoryChat.id)
    && workerChats.data.some((chat) => chat.id === workerDepartmentChat.id)
    && !workerChats.data.some((chat) => chat.id === masterDepartmentChat.id || chat.id === okkDepartmentChat.id || chat.id === managementChat.id)
  ) ok('worker sees only factory and own department chats');
  else fail('worker sees only factory and own department chats', workerChats.data.map((chat) => ({ id: chat.id, title: chat.title })));

  const createdMessage = await expectStatus('master creates chat message', 201, request(`/chats/${masterDepartmentChat.id}/messages`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { text: `Stage23 сообщение ${Date.now()}`, operationId: `stage23-sim-message-${Date.now()}` },
  }));
  const duplicate = await expectStatus('duplicate operationId is idempotent', 201, request(`/chats/${masterDepartmentChat.id}/messages`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { text: 'Stage23 duplicate', operationId: createdMessage.data.operationId },
  }));
  if (duplicate.data.id === createdMessage.data.id) ok('duplicate operationId returns same message');
  else fail('duplicate operationId returns same message', { first: createdMessage.data.id, duplicate: duplicate.data.id });

  const edited = await expectStatus('author edits chat message within window', 200, request(`/chats/${masterDepartmentChat.id}/messages/${createdMessage.data.id}`, {
    userId: 'test-master',
    factoryId,
    method: 'PATCH',
    body: { text: `Stage23 сообщение исправлено ${Date.now()}` },
  }));
  if (edited.data.editedAt) ok('message editedAt set');
  else fail('message editedAt set', edited.data);

  const attachment = await expectStatus('chat message attachment upload', 201, upload('test-master', factoryId, 'CHAT_MESSAGE', createdMessage.data.id));
  const metadata = await expectStatus('chat attachment metadata read', 200, request(`/attachments/${attachment.data.id}`, { userId: 'test-master', factoryId }));
  if (metadata.data.storagePath === undefined) ok('chat attachment metadata hides storagePath');
  else fail('chat attachment metadata hides storagePath', metadata.data);

  await expectStatus('chat read marker idempotent first', 201, request(`/chats/${masterDepartmentChat.id}/read`, { userId: 'test-master', factoryId, method: 'POST', body: {} }));
  await expectStatus('chat read marker idempotent second', 201, request(`/chats/${masterDepartmentChat.id}/read`, { userId: 'test-master', factoryId, method: 'POST', body: {} }));

  const deleted = await expectStatus('author soft deletes chat message', 200, request(`/chats/${masterDepartmentChat.id}/messages/${createdMessage.data.id}`, {
    userId: 'test-master',
    factoryId,
    method: 'DELETE',
  }));
  if (deleted.data.deletedAt && deleted.data.text === 'Сообщение удалено') ok('soft deleted message hidden');
  else fail('soft deleted message hidden', deleted.data);
  const deletedAttachmentRead = await request(`/attachments/${attachment.data.id}`, { userId: 'test-master', factoryId });
  if (deletedAttachmentRead.status !== 200) ok('deleted chat attachment inaccessible', { status: deletedAttachmentRead.status });
  else fail('deleted chat attachment inaccessible', deletedAttachmentRead.data);

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage23-chat-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage23-chat-other', name: 'Stage23 chat other' },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: otherFactory.id } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'test-admin', factoryId: otherFactory.id, role: 'ADMIN', isActive: true, isGuest: false },
  });
  const foreignChat = await db.chat.create({
    data: { factoryId: otherFactory.id, type: 'FACTORY', title: `Stage23 foreign ${Date.now()}`, createdById: 'test-admin' },
  });
  await expectStatus('cross-factory chat forbidden', 403, request(`/chats/${foreignChat.id}`, { userId: 'test-master', factoryId }));

  await db.user.upsert({
    where: { id: 'stage23-blocked-chat-user' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage23-blocked-chat-user', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage23-blocked-chat-user', factoryId } },
    update: { role: 'MASTER', departmentId: masterAccess.departmentId, isActive: true, isGuest: false },
    create: { userId: 'stage23-blocked-chat-user', factoryId, role: 'MASTER', departmentId: masterAccess.departmentId, isActive: true, isGuest: false },
  });
  await expectStatus('blocked chat user forbidden', 403, request('/chats', { userId: 'stage23-blocked-chat-user', factoryId }));
  await db.user.update({ where: { id: 'stage23-blocked-chat-user' }, data: { blockedAt: null } });

  const auditActions = await db.auditLog.findMany({
    where: { createdAt: { gte: since }, action: { in: ['CHAT_MESSAGE_CREATED', 'CHAT_MESSAGE_UPDATED', 'CHAT_MESSAGE_DELETED', 'CHAT_READ', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED'] } },
    select: { action: true },
  });
  for (const action of ['CHAT_MESSAGE_CREATED', 'CHAT_MESSAGE_UPDATED', 'CHAT_MESSAGE_DELETED', 'CHAT_READ', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    if (auditActions.some((item) => item.action === action)) ok(`audit ${action} written`);
    else fail(`audit ${action} written`, auditActions);
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
