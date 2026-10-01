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
const marker = `Медиа Рондо ${Date.now().toString(36)}`;
const operationMarker = `chat-media-${Date.now().toString(36)}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
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
  return { status: response.status, data, text };
}

async function download(pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  const response = await fetch(`${API}${pathname}`, { method: 'GET', headers });
  return { status: response.status, contentType: response.headers.get('content-type') || '' };
}

async function upload(userId, factoryId, entityId, file) {
  const form = new FormData();
  form.append('entityType', 'CHAT_MESSAGE');
  form.append('entityId', entityId);
  form.append('kind', file.kind);
  form.append('operationId', `${operationMarker}-${file.name}`);
  form.append('file', new Blob([file.bytes], { type: file.type }), file.name);
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
    record('direct chat available for media regression', direct.status === 201 && direct.data?.id, direct.data);

    const message = await request('POST', `/chats/${direct.data.id}/messages`, {
      userId: 'pilot-worker-1',
      factoryId,
      body: { text: `${marker}: фото и файл`, operationId: `${operationMarker}-message` },
    });
    record('message for visual media created', message.status === 201 && message.data?.id, message.data);

    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
    const photo = await upload('pilot-worker-1', factoryId, message.data.id, {
      name: 'chat-photo.png',
      type: 'image/png',
      kind: 'PHOTO',
      bytes: pngBytes,
    });
    const file = await upload('pilot-worker-1', factoryId, message.data.id, {
      name: 'chat-note.txt',
      type: 'text/plain',
      kind: 'FILE',
      bytes: Buffer.from('chat file attachment', 'utf8'),
    });
    record('image attachment upload works', photo.status === 201 && photo.data?.mimeType === 'image/png', photo.data);
    record('file attachment upload works', file.status === 201 && file.data?.mimeType === 'text/plain', file.data);

    const detail = await request('GET', `/chats/${direct.data.id}`, { userId: 'pilot-worker-2', factoryId });
    const detailText = JSON.stringify(detail.data);
    record('message detail includes safe attachment metadata', detail.status === 200 && detailText.includes(photo.data.id) && detailText.includes(file.data.id) && !hasSecret(detail.data), detail.data);

    const media = await request('GET', `/chats/${direct.data.id}/media`, { userId: 'pilot-worker-2', factoryId });
    record('media endpoint separates photos from files', media.status === 200
      && media.data?.media?.some((item) => item.id === photo.data.id)
      && media.data?.files?.some((item) => item.id === file.data.id)
      && !media.data?.files?.some((item) => item.id === photo.data.id), media.data);
    record('media endpoint hides storagePath/secrets', media.status === 200 && !hasSecret(media.data), media.data);

    const allowedDownload = await download(`/attachments/${photo.data.id}/file`, { userId: 'pilot-worker-2', factoryId });
    record('chat member can open guarded image preview', allowedDownload.status === 200 && /image\/png/.test(allowedDownload.contentType), allowedDownload);

    const deniedDownload = await download(`/attachments/${photo.data.id}/file`, { userId: 'pilot-worker-3', factoryId });
    record('non-member cannot open hidden direct chat attachment', deniedDownload.status === 403, deniedDownload);

    await db.chatMessage.create({
      data: {
        factoryId,
        chatId: direct.data.id,
        authorId: 'pilot-worker-2',
        kind: 'USER',
        text: `Stage56A.1 browser regression noise ${Date.now()}`,
      },
    });
    const cleanDetail = await request('GET', `/chats/${direct.data.id}`, { userId: 'pilot-worker-1', factoryId });
    record('Stage/test messages hidden in pilot runtime detail', cleanDetail.status === 200 && !JSON.stringify(cleanDetail.data.messages).includes('Stage56A.1 browser regression noise'), cleanDetail.data?.messages);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage56a-1-other-factory' },
      update: { isActive: true, deletedAt: null },
      create: { code: 'stage56a-1-other-factory', name: 'Stage56A.1 other factory' },
    });
    const foreignChat = await db.chat.create({ data: { factoryId: otherFactory.id, type: 'CUSTOM', title: 'Посторонний чат Stage56A.1', isHidden: true, createdById: 'test-admin' } });
    const crossFactory = await request('GET', `/chats/${foreignChat.id}`, { userId: 'pilot-worker-1', factoryId });
    record('cross-factory chat denied', crossFactory.status === 403, crossFactory.data);

    const audit = await db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ['CHAT_MESSAGE_SENT', 'CHAT_DIRECT_OPENED', 'CHAT_DIRECT_CREATED', 'ACCESS_DENIED'] },
      },
      select: { action: true, details: true },
    });
    record('chat visual hardening keeps audit actions', audit.some((item) => ['CHAT_MESSAGE_SENT', 'CHAT_DIRECT_OPENED', 'CHAT_DIRECT_CREATED'].includes(item.action)), audit);
    record('audit details do not expose secrets', !hasSecret(audit), audit);
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  if (failures.length) {
    console.error('Stage56A.1 chat visual hardening regression failed');
    console.error(JSON.stringify({ ok, failures }, null, 2));
    process.exit(1);
  }
  console.log('Stage56A.1 chat visual hardening regression passed');
  console.log(JSON.stringify({ ok: ok.map((item) => item.name) }, null, 2));
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
