const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const state = { ok: [], failures: [] };
const fixturePattern = /Stage\d+|stage\d+|regression|fixture|simulation|browser|demo|test line|Линия теста|тестовая линия/i;
const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|authToken|refreshToken/i;

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

async function request(pathname, { method = 'GET', userId = 'test-admin', factoryId, body, expected } = {}) {
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
  if (expected && !expected.includes(response.status)) {
    throw new Error(`${method} ${pathname} returned ${response.status}: ${text}`);
  }
  return { status: response.status, data };
}

function containsFixture(value) {
  return fixturePattern.test(JSON.stringify(value ?? ''));
}

function containsSecret(value) {
  return secretPattern.test(JSON.stringify(value ?? ''));
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
  const rootDir = path.resolve(__dirname, '..', '..');
  return spawn('npm.cmd run start --workspace backend', [], {
    cwd: rootDir,
    shell: true,
    stdio: 'ignore',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

let ownedBackend = null;

async function main() {
  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) {
      throw new Error('backend did not start for Stage 46.1B regression');
    }
  }

  const login = await request('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' }, expected: [200, 201] });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');

  const marker = `Stage46.1B visual audit ${Date.now()}`;
  const created = await request('/returns', {
    method: 'POST',
    userId: 'test-store',
    factoryId,
    expected: [200, 201],
    body: {
      receivedAt: '2026-05-24',
      productionDate: '2026-05-24',
      article: `ST461B-${Date.now()}`,
      productName: marker,
      mismatchReason: 'Проверка скрытия тестовой записи',
      quantity: 1,
      decision: 'Скрыть из рабочего списка пилота',
      photoUrl: 'attachment-pending',
    },
  });
  const createdId = created.data?.id;
  if (createdId) ok('marked Stage46.1B return fixture created for visibility check', { id: createdId });
  else fail('marked Stage46.1B return fixture created for visibility check', created.data);

  const runtimeReturns = await request('/returns', { userId: 'test-store', factoryId });
  const runtimeIds = Array.isArray(runtimeReturns.data) ? runtimeReturns.data.map((item) => item.id) : [];
  if (runtimeReturns.status === 200 && createdId && !runtimeIds.includes(createdId) && !containsFixture(runtimeReturns.data)) {
    ok('returns runtime list hides Stage/test fixtures');
  } else {
    fail('returns runtime list hides Stage/test fixtures', { status: runtimeReturns.status, ids: runtimeIds, data: runtimeReturns.data });
  }

  const archiveReturns = await request('/returns?includeArchive=true', { userId: 'test-store', factoryId });
  const archiveIds = Array.isArray(archiveReturns.data) ? archiveReturns.data.map((item) => item.id) : [];
  if (archiveReturns.status === 200 && createdId && archiveIds.includes(createdId)) {
    ok('returns history can still see marked record when archive/history is requested');
  } else {
    fail('returns history can still see marked record when archive/history is requested', { status: archiveReturns.status, ids: archiveIds });
  }

  if (createdId) {
    const archived = await request(`/returns/${createdId}/archive`, { method: 'POST', userId: 'test-store', factoryId, expected: [200, 201] });
    if (archived.status === 200 || archived.status === 201) ok('marked Stage46.1B return fixture archived without physical delete');
    else fail('marked Stage46.1B return fixture archived without physical delete', archived);
  }

  const chats = await request('/chats', { userId: 'test-master', factoryId });
  if (chats.status === 200 && !containsFixture(chats.data)) ok('chat runtime list remains free of Stage/test fixtures');
  else fail('chat runtime list remains free of Stage/test fixtures', { status: chats.status, data: chats.data });

  const wash = await request('/wash', { userId: 'test-master', factoryId });
  if (wash.status === 200 && !containsFixture(wash.data)) ok('wash runtime list remains free of Stage/test fixtures');
  else fail('wash runtime list remains free of Stage/test fixtures', { status: wash.status, data: wash.data });

  const tasks = await request('/tasks/board', { userId: 'test-master', factoryId });
  if (tasks.status === 200 && !containsFixture(tasks.data)) ok('tasks runtime board remains free of Stage/test fixtures');
  else fail('tasks runtime board remains free of Stage/test fixtures', { status: tasks.status, data: tasks.data });

  const payloads = { runtimeReturns: runtimeReturns.data, archiveReturns: archiveReturns.data, chats: chats.data, wash: wash.data, tasks: tasks.data };
  if (!containsSecret(payloads)) ok('visual audit payloads contain no secrets/storagePath');
  else fail('visual audit payloads contain no secrets/storagePath', payloads);

  if (state.failures.length) {
    console.error('Stage 46.1B visual human audit regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 46.1B visual human audit regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  stopBackend(ownedBackend);
  process.exit(process.exitCode ?? 0);
});
