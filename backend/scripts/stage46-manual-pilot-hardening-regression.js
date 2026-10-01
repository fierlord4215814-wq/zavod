const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };
const fixturePattern = /Stage\d+|stage\d+|regression|fixture|simulation|browser|demo|test line|Линия теста|тестовая линия/i;
const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|authToken|refreshToken/i;

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

async function request(pathname, { method = 'GET', userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null) headers['x-user-id'] = userId;
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

function hasFixture(value) {
  return fixturePattern.test(JSON.stringify(value ?? ''));
}

function hasSecret(value) {
  return secretPattern.test(JSON.stringify(value ?? ''));
}

async function main() {
  const login = await request('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');

  const current = await request('/shift/current', { userId: 'test-master', factoryId });
  const future = await request('/shift/future', { userId: 'test-master', factoryId });
  const past = await request('/shift/past', { userId: 'test-master', factoryId });
  if (current.status === 200 && future.status === 200 && past.status === 200) ok('current/future/past shift data is readable');
  else fail('current/future/past shift data is readable', { current: current.status, future: future.status, past: past.status });
  if (!JSON.stringify(future.data).includes('isActiveForShift') && !JSON.stringify(future.data).includes('Работает')) ok('future shift remains planning data');
  else fail('future shift remains planning data', future.data);
  if (Array.isArray(past.data?.sessions) && Array.isArray(past.data?.assignments)) ok('past shift is archive-like data');
  else fail('past shift is archive-like data', past.data);

  const people = await request('/people', { userId: 'test-master', factoryId });
  const peopleRows = Array.isArray(people.data) ? people.data : people.data?.people;
  if (people.status === 200 && Array.isArray(peopleRows) && !peopleRows.some((person) => person.blockedAt)) ok('people list excludes blocked users');
  else fail('people list excludes blocked users', { status: people.status, data: people.data });
  if (!hasFixture(peopleRows)) ok('people runtime list hides Stage/test fixtures');
  else fail('people runtime list hides Stage/test fixtures', people.data);

  const tasks = await request('/tasks/board', { userId: 'test-master', factoryId });
  if (tasks.status === 200 && !hasFixture(tasks.data)) ok('tasks runtime board hides Stage/test fixtures');
  else fail('tasks runtime board hides Stage/test fixtures', { status: tasks.status, data: tasks.data });

  const wash = await request('/wash', { userId: 'test-master', factoryId });
  if (wash.status === 200 && !hasFixture(wash.data)) ok('wash runtime list hides Stage/test fixtures');
  else fail('wash runtime list hides Stage/test fixtures', { status: wash.status, data: wash.data });

  const chats = await request('/chats', { userId: 'test-master', factoryId });
  if (chats.status === 200 && !hasFixture(chats.data)) ok('chat list hides Stage/test fixtures');
  else fail('chat list hides Stage/test fixtures', { status: chats.status, data: chats.data });
  const firstChat = Array.isArray(chats.data) ? chats.data[0] : null;
  if (firstChat?.id) {
    const detail = await request(`/chats/${firstChat.id}`, { userId: 'test-master', factoryId });
    if (detail.status === 200 && !hasFixture(detail.data?.messages ?? [])) ok('chat detail hides Stage/test messages');
    else fail('chat detail hides Stage/test messages', { status: detail.status, data: detail.data });
  }

  const notifications = await request('/notifications', { userId: 'test-master', factoryId });
  if (notifications.status === 200 && Array.isArray(notifications.data)) ok('notifications are readable for pilot user');
  else fail('notifications are readable for pilot user', { status: notifications.status, data: notifications.data });

  const workerShift = await request('/shift/current', { userId: 'worker-1', factoryId });
  if (workerShift.status === 200 && !JSON.stringify(workerShift.data).includes('Запустить / добавить')) ok('worker context does not expose master operational controls');
  else fail('worker context does not expose master operational controls', workerShift.data);

  const allPayloads = { current: current.data, future: future.data, past: past.data, people: people.data, tasks: tasks.data, wash: wash.data, chats: chats.data, notifications: notifications.data };
  if (!hasSecret(allPayloads)) ok('manual pilot payloads contain no secrets/storagePath');
  else fail('manual pilot payloads contain no secrets/storagePath', allPayloads);

  if (state.failures.length) {
    console.error('Stage 46 manual pilot hardening regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 46 manual pilot hardening regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
