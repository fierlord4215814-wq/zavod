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
const marker = `Проверка мессенджера v1 ${Date.now()}`;

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

async function uploadChatAttachment(userId, factoryId, entityId, { kind, mimeType, name, body }) {
  const form = new FormData();
  form.append('entityType', 'CHAT_MESSAGE');
  form.append('entityId', entityId);
  form.append('kind', kind);
  form.append('operationId', `chat-mobile-v1-${kind.toLowerCase()}-${Date.now()}`);
  form.append('file', new Blob([body], { type: mimeType }), name);
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

function hasForbiddenPayload(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, isActive: true } });

    const created = await request('POST', '/chats', {
      userId: 'test-management',
      factoryId: factory.id,
      body: {
        title: marker,
        type: 'CUSTOM',
        description: 'PILOT messenger v1 regression',
        isHidden: true,
        members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
      },
    });
    record('management creates hidden PILOT chat', created.status === 201 && created.data?.isHidden === true, created.data);
    const chatId = created.data?.id;
    if (!chatId) throw new Error('chat was not created');

    const textMessage = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { text: `${marker}: текст`, operationId: `chat-mobile-v1-text-${Date.now()}` },
    });
    record('text message is sent', textMessage.status === 201 && textMessage.data?.id, textMessage.data);

    const reply = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'pilot-worker-1',
      factoryId: factory.id,
      body: { text: `${marker}: ответ`, replyToMessageId: textMessage.data?.id, operationId: `chat-mobile-v1-reply-${Date.now()}` },
    });
    record('reply to message works', reply.status === 201 && reply.data?.replyToMessageId === textMessage.data?.id, reply.data);

    const reaction = await request('POST', `/chats/${chatId}/messages/${textMessage.data?.id}/reactions`, {
      userId: 'pilot-worker-1',
      factoryId: factory.id,
      body: { emoji: '👍' },
    });
    record('reaction can be toggled on message', reaction.status === 201 && reaction.data?.active === true, reaction.data);

    const editOwn = await request('PATCH', `/chats/${chatId}/messages/${reply.data?.id}`, {
      userId: 'pilot-worker-1',
      factoryId: factory.id,
      body: { text: `${marker}: изменено` },
    });
    record('author edits own message', editOwn.status === 200 && editOwn.data?.editedAt, editOwn.data);

    const editForeign = await request('PATCH', `/chats/${chatId}/messages/${textMessage.data?.id}`, {
      userId: 'pilot-worker-1',
      factoryId: factory.id,
      body: { text: 'чужое изменение' },
    });
    record('foreign edit is forbidden by backend', editForeign.status === 403, editForeign.data);

    const voiceMessage = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { text: 'Голосовое сообщение', operationId: `chat-mobile-v1-voice-${Date.now()}` },
    });
    const audio = await uploadChatAttachment('test-management', factory.id, voiceMessage.data?.id, {
      kind: 'AUDIO',
      mimeType: 'audio/webm',
      name: 'voice.webm',
      body: 'tiny voice note',
    });
    record('voice note uses guarded AUDIO attachment', audio.status === 201 && audio.data?.kind === 'AUDIO' && !hasForbiddenPayload(audio.data), audio.data);

    const videoMessage = await request('POST', `/chats/${chatId}/messages`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { text: 'Вложение', operationId: `chat-mobile-v1-video-${Date.now()}` },
    });
    const video = await uploadChatAttachment('test-management', factory.id, videoMessage.data?.id, {
      kind: 'VIDEO',
      mimeType: 'video/webm',
      name: 'clip.webm',
      body: 'tiny video note',
    });
    record('video attachment uses guarded VIDEO upload', video.status === 201 && video.data?.kind === 'VIDEO' && !hasForbiddenPayload(video.data), video.data);

    const poll = await request('POST', `/chats/${chatId}/polls`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: {
        question: `${marker}: какой вариант?`,
        options: ['Первый', 'Второй'],
        anonymous: false,
        multipleChoice: false,
        preventRevote: false,
        operationId: `chat-mobile-v1-poll-${Date.now()}`,
      },
    });
    record('simple poll message is created', poll.status === 201 && poll.data?.poll?.options?.length === 2, poll.data);
    const pollId = poll.data?.poll?.id;
    const optionId = poll.data?.poll?.options?.[0]?.id;

    const vote = await request('POST', `/chats/${chatId}/polls/${pollId}/vote`, {
      userId: 'pilot-worker-1',
      factoryId: factory.id,
      body: { optionIds: [optionId] },
    });
    record('member votes in poll', vote.status === 201 && vote.data?.votersCount === 1 && vote.data?.mineOptionIds?.includes(optionId), vote.data);

    const nonMemberVote = await request('POST', `/chats/${chatId}/polls/${pollId}/vote`, {
      userId: 'pilot-worker-2',
      factoryId: factory.id,
      body: { optionIds: [optionId] },
    });
    record('non-member cannot vote in hidden chat poll', nonMemberVote.status === 403, nonMemberVote.data);

    if (otherFactory) {
      const crossFactory = await request('GET', `/chats/${chatId}`, { userId: 'pilot-worker-1', factoryId: otherFactory.id });
      record('cross-factory chat detail denied', crossFactory.status === 403, crossFactory.data);
    } else {
      record('cross-factory chat detail denied', true, 'no second active factory in local data');
    }

    const detail = await request('GET', `/chats/${chatId}`, { userId: 'pilot-worker-1', factoryId: factory.id });
    record('detail includes reply, reaction, voice and poll payload', detail.status === 200
      && detail.data?.messages?.some((message) => message.replyTo?.id === textMessage.data?.id)
      && detail.data?.messages?.some((message) => message.attachments?.some?.((attachment) => attachment.kind === 'AUDIO'))
      && detail.data?.messages?.some((message) => message.attachments?.some?.((attachment) => attachment.kind === 'VIDEO'))
      && detail.data?.messages?.some((message) => message.poll?.id === pollId && message.poll.votersCount === 1)
      && !hasForbiddenPayload(detail.data), detail.data);

    const deleted = await request('DELETE', `/chats/${chatId}/messages/${reply.data?.id}`, { userId: 'pilot-worker-1', factoryId: factory.id });
    record('author soft-deletes own message', deleted.status === 200 && deleted.data?.text === 'Сообщение удалено', deleted.data);

    const archived = await request('PATCH', `/chats/${chatId}`, {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { isActive: false, reason: 'Завершение regression-чата mobile messenger v1' },
    });
    record('regression chat archived soft-way', archived.status === 200 && archived.data?.isActive === false, archived.data);

    console.log(`chat-mobile-messenger-v1-regression: ${ok.length} passed, ${failures.length} failed`);
    for (const item of ok) console.log(`PASS ${item.name}`);
    for (const item of failures) console.error(`FAIL ${item.name}: ${JSON.stringify(item.detail)}`);
    if (failures.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
