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
const marker = `Пилотный чат Рондо ${Date.now()}`;
const operationMarker = `chat-v1-${Date.now()}`;

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
  form.append('file', new Blob(['chat tiny image'], { type: 'image/png' }), 'pilot-chat.png');
  return fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
    body: form,
  }).then(async (response) => {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  });
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
    const managementAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-management', factoryId } }, include: { department: true } });
    const okkAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-okk', factoryId } }, include: { department: true } });
    if (!managementAccess?.departmentId || !okkAccess?.departmentId) throw new Error('seeded chat departments missing');

    const adminChats = await request('GET', '/chats', { userId: 'test-admin', factoryId });
    record('ADMIN sees factory chat', adminChats.status === 200 && adminChats.data.some((chat) => chat.type === 'FACTORY' && chat.displayTitle === 'Общий чат завода'), adminChats.data);
    record('chat list has no duplicate department labels', adminChats.status === 200 && !/ОККОКК|Общий чат заводаОбщий чат/i.test(JSON.stringify(adminChats.data)), adminChats.data);

    const okkChats = await request('GET', '/chats', { userId: 'test-okk', factoryId });
    const okkDepartmentChat = okkChats.data?.find((chat) => chat.type === 'DEPARTMENT' && chat.departmentId === okkAccess.departmentId);
    const managementChat = adminChats.data?.find((chat) => chat.type === 'MANAGEMENT');
    record('department chat visible only to department/scope', okkChats.status === 200 && Boolean(okkDepartmentChat), okkChats.data);
    const masterManagementDetail = managementChat ? await request('GET', `/chats/${managementChat.id}`, { userId: 'test-master', factoryId }) : { status: 404 };
    record('hidden management chat denied to ordinary master', masterManagementDetail.status === 403, masterManagementDetail.data);

    const created = await request('POST', '/chats', {
      userId: 'test-management',
      factoryId,
      body: {
        title: marker,
        type: 'CUSTOM',
        description: 'Закрытый рабочий чат запуска линии',
        isHidden: true,
        members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
      },
    });
    record('management creates hidden group chat', created.status === 201 && created.data?.isHidden === true, created.data);
    const chatId = created.data.id;

    const workerChats = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    record('explicit member sees hidden group chat even without generic chat permission', workerChats.status === 200 && workerChats.data.some((chat) => chat.id === chatId), workerChats.data);
    const nonMemberChats = await request('GET', '/chats', { userId: 'pilot-worker-2', factoryId });
    record('non-member does not see hidden group chat', nonMemberChats.status === 403 || !nonMemberChats.data?.some?.((chat) => chat.id === chatId), nonMemberChats.data);

    const addMember = await request('POST', `/chats/${chatId}/members`, {
      userId: 'test-management',
      factoryId,
      body: { userId: 'pilot-worker-2', canRead: true, canWrite: true },
    });
    record('manager adds member', addMember.status === 201 && addMember.data?.displayName, addMember.data);
    const removeMember = await request('DELETE', `/chats/${chatId}/members/pilot-worker-2`, { userId: 'test-management', factoryId });
    record('manager soft-removes member', removeMember.status === 200 && removeMember.data?.isActive === false, removeMember.data);

    const sent = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'test-management',
      factoryId,
      body: { text: `${marker}: проверьте упаковку`, operationId: `${operationMarker}-message-${Date.now()}` },
    });
    record('manager sends text message', sent.status === 201 && sent.data?.text?.includes('проверьте'), sent.data);
    const uploadResult = await upload('test-management', factoryId, sent.data.id);
    record('message attachment upload works', uploadResult.status === 201 && uploadResult.data?.id, uploadResult.data);

    const reply = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: `${marker}: ответ по упаковке`, replyToMessageId: sent.data.id, operationId: `${operationMarker}-reply-${Date.now()}` },
    });
    record('member replies to message', reply.status === 201 && reply.data?.replyToMessageId === sent.data.id, reply.data);
    const reactionAdd = await request('POST', `/chats/${chatId}/messages/${sent.data.id}/reactions`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { emoji: '👍' },
    });
    record('member adds reaction to another message', reactionAdd.status === 201 && reactionAdd.data?.active === true, reactionAdd.data);
    const reactionRemove = await request('POST', `/chats/${chatId}/messages/${sent.data.id}/reactions`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { emoji: '👍' },
    });
    record('member removes own reaction', reactionRemove.status === 201 && reactionRemove.data?.active === false, reactionRemove.data);
    await request('POST', `/chats/${chatId}/messages/${sent.data.id}/reactions`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { emoji: '✅' },
    });

    const editable = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: `${marker}: черновик`, operationId: `${operationMarker}-edit-${Date.now()}` },
    });
    const edited = await request('PATCH', `/chats/${chatId}/messages/${editable.data?.id}`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: `${marker}: исправленный текст` },
    });
    record('author edits own text message', edited.status === 200 && edited.data?.editedAt && /исправленный/.test(edited.data.text), edited.data);
    const foreignEdit = await request('PATCH', `/chats/${chatId}/messages/${sent.data.id}`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: 'попытка чужого редактирования' },
    });
    record('direct API cannot edit another user message', foreignEdit.status === 403, foreignEdit.data);
    const deletedOwn = await request('DELETE', `/chats/${chatId}/messages/${editable.data?.id}`, { userId: 'pilot-worker-1', factoryId });
    record('author soft-deletes own message', deletedOwn.status === 200 && deletedOwn.data?.deleted === true && deletedOwn.data?.text === 'Сообщение удалено', deletedOwn.data);

    const workerDetail = await request('GET', `/chats/${chatId}`, { userId: 'pilot-worker-1', factoryId });
    record('member reads chat detail with message bubbles payload', workerDetail.status === 200 && workerDetail.data?.messages?.some((message) => message.id === sent.data.id), workerDetail.data);
    record('author display is human-readable', workerDetail.data?.messages?.some((message) => message.authorName && message.authorContext), workerDetail.data?.messages);
    record('reply preview is returned in chat detail', workerDetail.data?.messages?.some((message) => message.id === reply.data.id && message.replyTo?.id === sent.data.id), workerDetail.data?.messages);
    record('reaction summary is returned with human names', workerDetail.data?.messages?.some((message) => message.id === sent.data.id && message.reactions?.some?.((reaction) => reaction.emoji === '✅' && reaction.count === 1 && reaction.users?.length)), workerDetail.data?.messages);
    record('attachment metadata hides storagePath', workerDetail.status === 200 && !hasSecret(workerDetail.data), workerDetail.data);

    await request('POST', `/chats/${chatId}/messages`, {
      userId: 'test-management',
      factoryId,
      body: { text: `${marker}: новое для счётчика`, operationId: `${operationMarker}-unread-${Date.now()}` },
    });
    const unreadBefore = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    const unreadChat = unreadBefore.data?.find?.((chat) => chat.id === chatId);
    record('unread count updates for member', unreadBefore.status === 200 && unreadChat?.unreadCount > 0, unreadChat);
    const markRead = await request('POST', `/chats/${chatId}/read`, { userId: 'pilot-worker-1', factoryId, body: {} });
    const unreadAfter = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    const readChat = unreadAfter.data?.find?.((chat) => chat.id === chatId);
    record('mark read clears unread count', markRead.status === 201 && readChat?.unreadCount === 0, readChat);

    const fixtureMessage = await db.chatMessage.create({
      data: {
        factoryId,
        chatId,
        authorId: 'test-management',
        kind: 'USER',
        text: `Stage51 browser regression noise ${Date.now()}`,
      },
    });
    const detailAfterFixture = await request('GET', `/chats/${chatId}`, { userId: 'pilot-worker-1', factoryId });
    record('Stage/test messages hidden in pilot runtime detail', detailAfterFixture.status === 200 && !detailAfterFixture.data.messages.some((message) => message.id === fixtureMessage.id || /Stage51/.test(message.text)), detailAfterFixture.data.messages);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage51-other-factory' },
      update: { isActive: true, deletedAt: null },
      create: { code: 'stage51-other-factory', name: 'Stage51 other factory' },
    });
    const foreignChat = await db.chat.create({ data: { factoryId: otherFactory.id, type: 'CUSTOM', title: 'Посторонний закрытый чат', isHidden: true, createdById: 'test-admin' } });
    const crossFactory = await request('GET', `/chats/${foreignChat.id}`, { userId: 'test-management', factoryId });
    record('cross-factory chat denied', crossFactory.status === 403, crossFactory.data);

    await db.user.upsert({
      where: { id: 'stage51-blocked-chat-user' },
      update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
      create: { id: 'stage51-blocked-chat-user', factoryId, role: 'MASTER', blockedAt: new Date() },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: 'stage51-blocked-chat-user', factoryId } },
      update: { role: 'MASTER', departmentId: managementAccess.departmentId, isActive: true, isGuest: false },
      create: { userId: 'stage51-blocked-chat-user', factoryId, role: 'MASTER', departmentId: managementAccess.departmentId, isActive: true, isGuest: false },
    });
    const blocked = await request('GET', '/chats', { userId: 'stage51-blocked-chat-user', factoryId });
    record('blocked user denied', blocked.status === 403, blocked.data);

    const audit = await db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ['CHAT_CREATED', 'CHAT_MEMBER_ADDED', 'CHAT_MEMBER_REMOVED', 'CHAT_MESSAGE_SENT', 'CHAT_MESSAGE_UPDATED', 'CHAT_MESSAGE_DELETED', 'CHAT_MESSAGE_REACTION_ADDED', 'CHAT_MESSAGE_REACTION_REMOVED', 'CHAT_READ', 'ACCESS_DENIED'] },
      },
      select: { action: true },
    });
    for (const action of ['CHAT_CREATED', 'CHAT_MEMBER_ADDED', 'CHAT_MEMBER_REMOVED', 'CHAT_MESSAGE_SENT', 'CHAT_MESSAGE_UPDATED', 'CHAT_MESSAGE_DELETED', 'CHAT_MESSAGE_REACTION_ADDED', 'CHAT_MESSAGE_REACTION_REMOVED', 'CHAT_READ', 'ACCESS_DENIED']) {
      record(`audit ${action} written`, audit.some((item) => item.action === action), audit);
    }

    const archiveCreatedChat = await request('PATCH', `/chats/${chatId}`, {
      userId: 'test-management',
      factoryId,
      body: { isActive: false, reason: 'Регрессионная проверка завершена' },
    });
    record('regression chat archived after verification', archiveCreatedChat.status === 200 && archiveCreatedChat.data?.isActive === false, archiveCreatedChat.data);

    record('no secrets in chat responses', !hasSecret({ adminChats: adminChats.data, workerDetail: workerDetail.data, unreadAfter: unreadAfter.data }), { checked: true });
  } finally {
    stopBackend(backend);
    console.log(JSON.stringify({ ok, failures }, null, 2));
    await db.$disconnect();
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
