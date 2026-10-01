const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const marker = `Чат смены Рондо ${Date.now().toString(36).slice(-5)}`;
const operationMarker = `chat-ux-${Date.now().toString(36)}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function upload(userId, factoryId, entityId) {
  const form = new FormData();
  form.append('entityType', 'CHAT_MESSAGE');
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `${operationMarker}-photo-${Date.now()}`);
  form.append('file', new Blob(['chat tiny image'], { type: 'image/png' }), 'chat-photo.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
    body: form,
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

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotScenario() {
  const result = spawnSync(process.execPath, ['scripts/stage47-pilot-scenario.js'], { cwd: backendDir, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'stage47 pilot scenario failed');
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  const since = new Date();
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;

    const direct = await request('POST', '/chats/direct/pilot-worker-2', { userId: 'pilot-worker-1', factoryId, body: {} });
    record('worker creates direct chat without group-management rights', direct.status === 201 && direct.data?.type === 'DIRECT' && direct.data?.directUser?.displayName, direct.data);
    const directAgain = await request('POST', '/chats/direct/pilot-worker-2', { userId: 'pilot-worker-1', factoryId, body: {} });
    record('direct chat create is idempotent', directAgain.status === 201 && directAgain.data?.id === direct.data?.id, directAgain.data);

    const directMessage = await request('POST', `/chats/${direct.data.id}/messages`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: `${marker}: личная проверка`, operationId: `${operationMarker}-direct-${Date.now()}` },
    });
    record('direct member sends message', directMessage.status === 201 && /личная/.test(directMessage.data?.text ?? ''), directMessage.data);
    const attachment = await upload('pilot-worker-1', factoryId, directMessage.data.id);
    record('direct chat attachment upload works by membership', attachment.status === 201 && attachment.data?.id, attachment.data);

    const directDetail = await request('GET', `/chats/${direct.data.id}`, { userId: 'pilot-worker-2', factoryId });
    record('other direct member sees message', directDetail.status === 200 && directDetail.data?.messages?.some((message) => message.id === directMessage.data.id), directDetail.data);
    record('direct detail hides storagePath/secrets', directDetail.status === 200 && !hasSecret(directDetail.data), directDetail.data);
    const media = await request('GET', `/chats/${direct.data.id}/media`, { userId: 'pilot-worker-2', factoryId });
    record('media endpoint returns chat attachments safely', media.status === 200 && media.data?.media?.some((item) => item.id === attachment.data.id) && !hasSecret(media.data), media.data);

    const beforeRead = await request('GET', '/chats', { userId: 'pilot-worker-2', factoryId });
    const unread = beforeRead.data?.find?.((chat) => chat.id === direct.data.id);
    record('direct unread badge updates', beforeRead.status === 200 && unread?.unreadCount > 0, unread);
    const markRead = await request('POST', `/chats/${direct.data.id}/read`, { userId: 'pilot-worker-2', factoryId, body: {} });
    const afterRead = await request('GET', '/chats', { userId: 'pilot-worker-2', factoryId });
    const readChat = afterRead.data?.find?.((chat) => chat.id === direct.data.id);
    record('mark read clears direct unread', markRead.status === 201 && readChat?.unreadCount === 0, readChat);

    const hide = await request('POST', `/chats/${direct.data.id}/hide-for-me`, { userId: 'pilot-worker-1', factoryId, body: {} });
    const hiddenList = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    const otherList = await request('GET', '/chats', { userId: 'pilot-worker-2', factoryId });
    record('hide-for-me removes direct chat only for current user', hide.status === 201 && !hiddenList.data?.some?.((chat) => chat.id === direct.data.id) && otherList.data?.some?.((chat) => chat.id === direct.data.id), { hidden: hide.data, hiddenList: hiddenList.data, otherList: otherList.data });
    const reopened = await request('POST', '/chats/direct/pilot-worker-2', { userId: 'pilot-worker-1', factoryId, body: {} });
    record('opening direct chat again restores hidden chat', reopened.status === 201 && reopened.data?.id === direct.data.id, reopened.data);

    const workerGroupCreate = await request('POST', '/chats', {
      userId: 'pilot-worker-1',
      factoryId,
      body: { title: `${marker}: forbidden group`, type: 'CUSTOM' },
    });
    record('ordinary worker cannot create group chat', workerGroupCreate.status === 403, workerGroupCreate.data);

    const closedGroup = await request('POST', '/chats', {
      userId: 'test-management',
      factoryId,
      body: {
        title: `${marker}: закрытая группа`,
        type: 'CUSTOM',
        isHidden: true,
        members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
      },
    });
    record('management creates hidden group', closedGroup.status === 201 && closedGroup.data?.isHidden, closedGroup.data);
    const nonMemberDetail = await request('GET', `/chats/${closedGroup.data.id}`, { userId: 'pilot-worker-2', factoryId });
    record('non-member cannot open hidden group', nonMemberDetail.status === 403, nonMemberDetail.data);

    await db.chatMessage.create({
      data: {
        factoryId,
        chatId: direct.data.id,
        authorId: 'pilot-worker-2',
        kind: 'USER',
        text: `Stage56A browser regression noise ${Date.now()}`,
      },
    });
    const detailAfterNoise = await request('GET', `/chats/${direct.data.id}`, { userId: 'pilot-worker-1', factoryId });
    record('Stage/test messages hidden in pilot runtime', detailAfterNoise.status === 200 && !JSON.stringify(detailAfterNoise.data.messages).includes('Stage56A'), detailAfterNoise.data.messages);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage56a-other-factory' },
      update: { isActive: true, deletedAt: null },
      create: { code: 'stage56a-other-factory', name: 'Stage56A other factory' },
    });
    const foreignChat = await db.chat.create({ data: { factoryId: otherFactory.id, type: 'CUSTOM', title: 'Посторонний чат Stage56A', isHidden: true, createdById: 'test-admin' } });
    const crossFactory = await request('GET', `/chats/${foreignChat.id}`, { userId: 'pilot-worker-1', factoryId });
    record('cross-factory chat denied', crossFactory.status === 403, crossFactory.data);

    await db.user.upsert({
      where: { id: 'stage56a-blocked-chat-user' },
      update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
      create: { id: 'stage56a-blocked-chat-user', factoryId, role: 'WORKER', blockedAt: new Date() },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: 'stage56a-blocked-chat-user', factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: 'stage56a-blocked-chat-user', factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blocked = await request('GET', '/chats', { userId: 'stage56a-blocked-chat-user', factoryId });
    record('blocked user denied', blocked.status === 403, blocked.data);

    const audit = await db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ['CHAT_DIRECT_CREATED', 'CHAT_DIRECT_OPENED', 'CHAT_HIDDEN_FOR_USER', 'CHAT_MESSAGE_SENT', 'CHAT_READ', 'ACCESS_DENIED'] },
      },
      select: { action: true },
    });
    record('audit direct chat action written', audit.some((item) => item.action === 'CHAT_DIRECT_CREATED' || item.action === 'CHAT_DIRECT_OPENED'), audit);
    for (const action of ['CHAT_HIDDEN_FOR_USER', 'CHAT_MESSAGE_SENT', 'CHAT_READ', 'ACCESS_DENIED']) {
      record(`audit ${action} written`, audit.some((item) => item.action === action), audit);
    }
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  if (failures.length) {
    console.error('Stage56A internal messenger UX regression failed');
    console.error(JSON.stringify({ ok, failures }, null, 2));
    process.exit(1);
  }
  console.log('Stage56A internal messenger UX regression passed');
  console.log(JSON.stringify({ ok: ok.map((item) => item.name) }, null, 2));
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});

