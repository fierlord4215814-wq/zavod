const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const WS_URL = API.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
const TEST_PASSWORD = process.env.PILOT_TEST_PASSWORD || '1234';
const actors = {
  creator: 'pilot-pack-senior-master',
  assignee: 'pilot-pack-kipia-lead',
  unrelated: 'pilot-pack-worker-source',
};
const tokens = new Map();
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function login(userId) {
  if (tokens.has(userId)) return tokens.get(userId);
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`Realtime actor ${userId} has no login phone.`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201 || !payload?.token) throw new Error(`Realtime actor ${userId} login failed: HTTP ${response.status}.`);
  tokens.set(userId, payload.token);
  return payload.token;
}

async function request(pathname, { userId = null, factoryId, method = 'GET', body } = {}) {
  const headers = {};
  if (userId) headers.Authorization = `Bearer ${await login(userId)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function connect(userId, factoryId) {
  const token = await login(userId);
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    const messages = [];
    let connected = false;
    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw));
        messages.push(event);
        if (event.type === 'connected' && !connected) {
          connected = true;
          resolve({ ws, messages, connected: true });
        }
      } catch {
        // Ignore malformed payloads in regression collection.
      }
    });
    ws.on('error', () => resolve({ ws, messages, connected: false }));
    ws.on('close', () => {
      if (!connected) resolve({ ws, messages, connected: false });
    });
    setTimeout(() => {
      if (!connected) resolve({ ws, messages, connected: false });
    }, 2500);
  });
}

function waitFor(messages, predicate, ms = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > ms) {
        clearInterval(timer);
        resolve(null);
      }
    }, 100);
  });
}

async function main() {
  let factoryId = null;
  let tech = null;
  let worker = null;
  let createdTaskId = null;

  try {
    const health = await request('/health');
    if (health.status !== 200) throw new Error('backend /health is not available for realtime regression');
    const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    factoryId = factory.id;

    tech = await connect(actors.assignee, factoryId);
    if (tech.connected) ok('allowed user connects to websocket');
    else fail('allowed user connects to websocket');

    worker = await connect(actors.unrelated, factoryId);
    if (worker.connected) ok('second allowed user connects to websocket');
    else fail('second allowed user connects to websocket');

    const stamp = Date.now();
    const description = `Realtime v1 task ${stamp}`;
    const techEventIndex = tech.messages.length;
    const workerEventIndex = worker.messages.length;
    const created = await request('/tasks', {
      userId: actors.creator,
      factoryId,
      method: 'POST',
      body: {
        description,
        type: 'URGENT',
        assigneeUserIds: [actors.assignee],
        operationId: `realtime-v1-task-${stamp}`,
      },
    });
    createdTaskId = created.data?.id ?? null;
    if (created.status === 201 && createdTaskId) ok('task created for notification event');
    else fail('task created for notification event', created);

    const taskUpdated = await waitFor(
      tech.messages.slice(techEventIndex),
      (event) => event.type === 'task_updated',
    );
    const taskPayloadKeys = taskUpdated?.payload && typeof taskUpdated.payload === 'object'
      ? Object.keys(taskUpdated.payload).sort()
      : [];
    if (taskPayloadKeys.length === 1 && taskPayloadKeys[0] === 'changedAt') ok('task reader receives opaque task invalidation');
    else fail('task reader receives opaque task invalidation', taskUpdated);

    const unrelatedTaskUpdate = await waitFor(
      worker.messages.slice(workerEventIndex),
      (event) => event.type === 'task_updated',
      1200,
    );
    if (!unrelatedTaskUpdate) ok('actor without tasks.read receives no task invalidation');
    else fail('actor without tasks.read receives no task invalidation', unrelatedTaskUpdate);

    const techNotification = await waitFor(tech.messages, (event) =>
      event.type === 'notification_created'
      && event.payload?.type === 'TASK_CREATED'
      && event.payload?.entityId === createdTaskId,
    );
    if (techNotification) ok('assignee receives realtime notification');
    else fail('assignee receives realtime notification', tech.messages);

    const workerNotification = await waitFor(worker.messages, (event) =>
      event.type === 'notification_created'
      && event.payload?.entityId === createdTaskId,
      1200,
    );
    if (!workerNotification) ok('unrelated worker does not receive assignee notification');
    else fail('unrelated worker does not receive assignee notification', workerNotification);

    if (JSON.stringify(tech.messages).includes('passwordHash') || JSON.stringify(tech.messages).includes('storagePath')) {
      fail('websocket payload does not leak secrets');
    } else {
      ok('websocket payload does not leak secrets');
    }

    if (createdTaskId) {
      await request(`/tasks/${createdTaskId}/take`, {
        userId: actors.assignee,
        factoryId,
        method: 'POST',
        body: { operationId: `realtime-v1-task-take-${stamp}` },
      });
      const completed = await request(`/tasks/${createdTaskId}/complete`, {
        userId: actors.assignee,
        factoryId,
        method: 'POST',
        body: { operationId: `realtime-v1-task-complete-${stamp}`, comment: 'Штатное завершение realtime regression.' },
      });
      if (completed.status === 201 && completed.data?.status === 'DONE') ok('regression task completed through guarded API');
      else fail('regression task completed through guarded API', completed);
    }
  } finally {
    tech?.ws?.close();
    worker?.ws?.close();
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) throw new Error(`Realtime v1 regression failed: ${state.failures.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
