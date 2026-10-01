const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, ChatMessageKind, ChatType, UserRole } = require('@prisma/client');

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
const marker = `Stage43 attachments ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : options.formData,
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

function hasSecret(value) {
  const text = JSON.stringify(value);
  return /storagePath|passwordHash|JWT_SECRET|DATABASE_URL|token/i.test(text);
}

async function upload({ userId, factoryId, entityType, entityId, name = 'stage43.txt', mimeType = 'text/plain', size = 128, kind }) {
  const form = new FormData();
  const content = Buffer.alloc(size, 'a');
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', kind ?? (mimeType.startsWith('image/') ? 'PHOTO' : mimeType.startsWith('video/') ? 'VIDEO' : 'FILE'));
  form.append('operationId', `stage43-${userId}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([content], { type: mimeType }), name);
  return request('POST', '/attachments/upload', { userId, factoryId, formData: form });
}

async function createTask(factoryId) {
  const departments = await request('GET', '/tasks/recipient-departments', { userId: 'test-master', factoryId });
  const department = departments.data?.[0];
  if (!department) throw new Error('recipient department not found');
  const task = await request('POST', '/tasks', {
    userId: 'test-master',
    factoryId,
    body: {
      type: 'URGENT',
      description: `${marker}: заявка для вложений`,
      departmentRecipientIds: [department.id],
      operationId: `stage43-task-${Date.now()}`,
    },
  });
  if (task.status !== 201) throw new Error(`task create failed: ${task.status}`);
  return task.data;
}

async function createPrivateChatMessage(factoryId) {
  const chat = await db.chat.create({
    data: {
      factoryId,
      type: ChatType.MANAGEMENT,
      title: `${marker}: закрытый чат`,
      description: 'Проверка доступа к вложениям чата',
      isHidden: true,
      createdById: 'test-admin',
      members: {
        create: [
          { userId: 'test-admin', canRead: true, canWrite: true, canManage: true },
          { roleCode: UserRole.MANAGEMENT, canRead: true, canWrite: true, canManage: true },
        ],
      },
    },
  });
  return db.chatMessage.create({
    data: {
      factoryId,
      chatId: chat.id,
      authorId: 'test-admin',
      kind: ChatMessageKind.USER,
      text: `${marker}: вложение закрытого чата`,
    },
  });
}

async function ensureForeignFactory() {
  const factory = await db.factory.upsert({
    where: { code: 'factory-stage43-attachments' },
    create: { code: 'factory-stage43-attachments', name: 'Stage43 attachment scope factory' },
    update: { isActive: true, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: factory.id } },
    create: { userId: 'test-admin', factoryId: factory.id, role: 'ADMIN', isActive: true },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
  });
  return factory;
}

async function ensureBlockedUser(factoryId) {
  const user = await db.user.upsert({
    where: { id: 'stage43-blocked-user' },
    create: { id: 'stage43-blocked-user', factoryId, role: UserRole.MASTER, blockedAt: new Date() },
    update: { factoryId, role: UserRole.MASTER, blockedAt: new Date(), deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: user.id, factoryId } },
    create: { userId: user.id, factoryId, role: UserRole.MASTER, isActive: true },
    update: { role: UserRole.MASTER, isActive: true, isGuest: false },
  });
  return user;
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');

  const task = await createTask(factory.id);
  const allowed = await upload({ userId: 'test-master', factoryId: factory.id, entityType: 'TASK', entityId: task.id, name: 'stage43.txt', mimeType: 'text/plain' });
  record('allowed task file upload', allowed.status === 201, { status: allowed.status, data: allowed.data });
  record('metadata hides storagePath', allowed.status === 201 && allowed.data?.storagePath === undefined && !hasSecret(allowed.data));

  const unsupported = await upload({ userId: 'test-master', factoryId: factory.id, entityType: 'TASK', entityId: task.id, name: 'stage43.exe', mimeType: 'application/x-msdownload', kind: 'FILE' });
  record('unsupported mime rejected', unsupported.status === 409 && /Поддерживаются/.test(JSON.stringify(unsupported.data)), { status: unsupported.status, data: unsupported.data });

  const tooLarge = await upload({ userId: 'test-master', factoryId: factory.id, entityType: 'TASK', entityId: task.id, name: 'stage43-big.txt', mimeType: 'text/plain', size: 16 * 1024 * 1024, kind: 'FILE' });
  record('too large file rejected', tooLarge.status === 409 && /15 МБ/.test(JSON.stringify(tooLarge.data)), { status: tooLarge.status });

  const download = await request('GET', `/attachments/${allowed.data?.id}/file`, { userId: 'test-master', factoryId: factory.id });
  record('download guarded allowed user', download.status === 200, { status: download.status });

  const archive = await request('GET', `/archive/attachments?search=${encodeURIComponent('stage43.txt')}`, { userId: 'test-admin', factoryId: factory.id });
  record('archive attachments includes allowed source', archive.status === 200 && archive.data?.items?.some((item) => item.id === allowed.data?.id), { status: archive.status });
  record('archive response hides secrets', archive.status === 200 && !hasSecret(archive.data));

  const chatMessage = await createPrivateChatMessage(factory.id);
  const chatUpload = await upload({ userId: 'test-admin', factoryId: factory.id, entityType: 'CHAT_MESSAGE', entityId: chatMessage.id, name: 'stage43-chat.txt', mimeType: 'text/plain' });
  record('chat attachment upload', chatUpload.status === 201, { status: chatUpload.status });
  const workerChatRead = await request('GET', `/attachments/${chatUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id });
  record('chat attachment denied to unrelated worker', workerChatRead.status === 403, { status: workerChatRead.status });
  const workerArchive = await request('GET', `/archive/attachments?search=${encodeURIComponent('stage43-chat.txt')}`, { userId: 'worker-1', factoryId: factory.id });
  record('archive filters chat attachment by chat visibility', workerArchive.status === 200 && !workerArchive.data?.items?.some((item) => item.id === chatUpload.data?.id), { status: workerArchive.status });

  const foreignFactory = await ensureForeignFactory();
  const foreignTask = await db.task.create({
    data: {
      factoryId: foreignFactory.id,
      createdById: 'test-admin',
      type: 'URGENT',
      status: 'NEW',
      description: `${marker}: foreign task`,
    },
  });
  const foreignUpload = await upload({ userId: 'test-admin', factoryId: foreignFactory.id, entityType: 'TASK', entityId: foreignTask.id, name: 'stage43-foreign.txt', mimeType: 'text/plain' });
  const cross = await request('GET', `/attachments/${foreignUpload.data?.id}`, { userId: 'test-master', factoryId: factory.id });
  record('cross-factory attachment denied', cross.status === 403, { status: cross.status });

  const blocked = await ensureBlockedUser(factory.id);
  const blockedRead = await request('GET', `/attachments/${allowed.data?.id}`, { userId: blocked.id, factoryId: factory.id });
  record('blocked user denied attachment read', blockedRead.status === 403, { status: blockedRead.status });
  await db.user.update({ where: { id: blocked.id }, data: { blockedAt: null } });

  const hidden = await db.attachment.findFirst({ where: { id: allowed.data?.id }, select: { storagePath: true } });
  record('storagePath exists only in DB', Boolean(hidden?.storagePath));

  console.log(JSON.stringify({ ok, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
