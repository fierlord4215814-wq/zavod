const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const WS_URL = API.replace(/^http/, 'ws');
const db = new PrismaClient();
const state = { passed: [], failed: [], warnings: [] };

function record(name, passed, detail) {
  (passed ? state.passed : state.failed).push({ name, ...(detail ? { detail } : {}) });
}

async function request(path, { method = 'GET', token, factoryId, headers: extraHeaders, body } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function login(phone) {
  const response = await request('/auth/login', { method: 'POST', body: { phone, password: '1234' } });
  record(`bearer login ${phone.slice(-4)}`, response.status === 201 && Boolean(response.data?.token), { status: response.status });
  if (!response.data?.token) throw new Error(`Bearer login failed for ${phone.slice(-4)}`);
  return response.data;
}

function websocketResult(url, protocols) {
  return new Promise((resolve) => {
    let complete = false;
    const socket = new WebSocket(url, protocols);
    const finish = (result) => {
      if (complete) return;
      complete = true;
      try { socket.close(); } catch {}
      resolve(result);
    };
    socket.on('open', () => finish('OPEN'));
    socket.on('unexpected-response', (_request, response) => finish(`HTTP_${response.statusCode}`));
    socket.on('error', () => finish('ERROR'));
    setTimeout(() => finish('TIMEOUT'), 4000);
  });
}

function hasSensitivePayload(value) {
  return /passwordHash|storagePath|DATABASE_URL|JWT_SECRET|SESSION_SECRET|accessToken|refreshToken|authToken|Bearer\s+[A-Za-z0-9._~-]+/i
    .test(JSON.stringify(value ?? null));
}

async function main() {
  const health = await request('/health');
  record('fresh backend health', health.status === 200 && health.data?.status === 'ok', { status: health.status });

  const roleCases = [
    ['guest', '+79000009000', 'OTHER', true],
    ['worker', '+79000004701', 'WORKER', false],
    ['contractor', '+79000004711', 'CONTRACTOR', false],
    ['master', '+79000004720', 'MASTER', false],
    ['seniorMaster', '+79000009004', 'MASTER', false],
    ['kipia', '+79000004750', 'TECH_KIPIA', false],
    ['kipiaLead', '+79000009005', 'TECH_KIPIA', false],
    ['contractorLead', '+79000009101', 'CONTRACTOR_LEAD', false],
    ['technolog', '+79000009102', 'TECHNOLOG', false],
    ['other', '+79000009103', 'OTHER', false],
    ['mechanic', '+79000009104', 'TECH_MECHANIC', false],
    ['electric', '+79000009105', 'TECH_ELECTRIC', false],
    ['holod', '+79000009106', 'TECH_HOLOD', false],
    ['santechnik', '+79000009107', 'TECH_SANTECHNIK', false],
    ['okk', '+79000004730', 'OKK', false],
    ['store', '+79000004740', 'STORE', false],
    ['management', '+79000009008', 'MANAGEMENT', false],
    ['admin', '+79000009009', 'ADMIN', false],
  ];
  const actors = {};
  for (const [key, phone, expectedRole, expectedGuest] of roleCases) {
    const auth = await login(phone);
    const me = await request('/auth/me', {
      token: auth.token,
      factoryId: auth.recommendedFactoryId,
    });
    record(
      `role context ${expectedRole}${expectedGuest ? ' Guest' : ''}`,
      me.status === 200 && me.data?.role === expectedRole && Boolean(me.data?.isGuest) === expectedGuest && !hasSensitivePayload(me.data),
      { status: me.status, actualRole: me.data?.role, isGuest: me.data?.isGuest },
    );
    actors[key] = auth;
  }
  const { admin, master, worker, guest } = actors;
  const factoryId = admin.recommendedFactoryId;

  const headerProbe = await request('/auth/me', {
    factoryId,
    headers: { 'x-user-id': 'pilot-pack-admin' },
  });
  record(
    'x-user-id is ignored without explicit test mode',
    headerProbe.status === 200 && headerProbe.data?.isGuest === true && headerProbe.data?.userId !== 'pilot-pack-admin',
    { status: headerProbe.status, role: headerProbe.data?.role, isGuest: headerProbe.data?.isGuest },
  );

  const devLogin = await request('/auth/dev-login', { method: 'POST', body: { userId: 'pilot-pack-admin' } });
  record('dev-login is disabled in normal runtime', devLogin.status === 403, { status: devLogin.status });

  const unsignedWs = await websocketResult(`${WS_URL}/ws?userId=pilot-pack-admin&factoryId=${encodeURIComponent(factoryId)}`);
  const signedWs = await websocketResult(`${WS_URL}/ws?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${admin.token}`]);
  record('unsigned websocket identity is rejected', unsignedWs === 'HTTP_403', { result: unsignedWs });
  record('bearer websocket connects through subprotocol', signedWs === 'OPEN', { result: signedWs });

  const adminFactories = await request('/admin/factories', { token: admin.token, factoryId });
  const expectedFactoryIds = new Set((await db.userFactoryAccess.findMany({
    where: { userId: admin.userId, isActive: true, factory: { deletedAt: null } },
    select: { factoryId: true },
  })).map((item) => item.factoryId));
  const actualFactoryIds = new Set(Array.isArray(adminFactories.data) ? adminFactories.data.map((item) => item.id) : []);
  record(
    'admin factory list is limited to active UserFactoryAccess',
    adminFactories.status === 200
      && actualFactoryIds.size === expectedFactoryIds.size
      && [...actualFactoryIds].every((id) => expectedFactoryIds.has(id)),
    { status: adminFactories.status, expected: expectedFactoryIds.size, actual: actualFactoryIds.size },
  );

  const foreignFactory = await db.factory.findFirst({
    where: { id: { notIn: [...expectedFactoryIds] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (foreignFactory) {
    const foreignContext = await request(`/admin/factories/${foreignFactory.id}/context`, { token: admin.token, factoryId });
    record('admin cannot read a factory without access', [403, 409].includes(foreignContext.status), { status: foreignContext.status });
    const foreignDirectory = await request(`/directory/users?factoryId=${encodeURIComponent(foreignFactory.id)}`, { token: admin.token, factoryId });
    record('ADMIN cannot override directory factory scope by query', foreignDirectory.status === 403, { status: foreignDirectory.status });
  } else {
    state.warnings.push({ name: 'no foreign active factory available for direct context denial' });
  }

  const ownLine = await db.line.findFirst({ where: { factoryId, deletedAt: null }, select: { id: true } });
  const foreignLine = await db.line.findFirst({ where: { factoryId: { not: factoryId }, deletedAt: null }, select: { id: true } });
  if (ownLine) {
    const workers = await request(`/lines/${ownLine.id}/workers`, { token: admin.token, factoryId });
    record('line workers read-model is safe', workers.status === 200 && !hasSensitivePayload(workers.data), { status: workers.status });
  }
  if (foreignLine) {
    const workers = await request(`/lines/${foreignLine.id}/workers`, { token: admin.token, factoryId });
    record('foreign line workers are denied without disclosure', [403, 409].includes(workers.status) && !hasSensitivePayload(workers.data), { status: workers.status });
  }

  const foreignChat = await db.chat.findFirst({ where: { factoryId: { not: factoryId } }, select: { id: true } });
  if (foreignChat) {
    const chat = await request(`/chats/${foreignChat.id}`, { token: admin.token, factoryId });
    record('foreign chat is denied to selected-factory ADMIN', [403, 409].includes(chat.status) && !hasSensitivePayload(chat.data), { status: chat.status });
  }

  const taskArchive = await request('/archive/items?section=tasks&pageSize=100', { token: admin.token, factoryId });
  const archivedTaskIds = Array.isArray(taskArchive.data?.items)
    ? taskArchive.data.items.map((item) => item.sourceId).filter(Boolean)
    : [];
  const archivedTasks = archivedTaskIds.length
    ? await db.task.findMany({ where: { id: { in: archivedTaskIds } }, select: { id: true, factoryId: true } })
    : [];
  const archivedTaskById = new Map(archivedTasks.map((task) => [task.id, task]));
  record(
    'ADMIN archive task read-model stays inside selected factory',
    taskArchive.status === 200
      && archivedTaskIds.every((id) => archivedTaskById.get(id)?.factoryId === factoryId),
    { status: taskArchive.status, checked: archivedTaskIds.length },
  );

  const notifications = await request('/notifications', { token: admin.token, factoryId });
  const foreignPersonal = Array.isArray(notifications.data)
    ? notifications.data.filter((item) => item.userId && item.userId !== admin.userId)
    : [];
  record(
    'ADMIN notification list excludes other users personal notifications',
    notifications.status === 200 && foreignPersonal.length === 0,
    { status: notifications.status, foreignPersonal: foreignPersonal.length },
  );

  const guestAnnouncements = await request('/announcements/current', {
    token: guest.token,
    factoryId: guest.recommendedFactoryId,
  });
  const guestHasAnnouncement = Array.isArray(guestAnnouncements.data)
    ? guestAnnouncements.data.length > 0
    : Number(guestAnnouncements.data?.total ?? 0) > 0;
  record(
    'Guest receives no announcements through direct API',
    [200, 403].includes(guestAnnouncements.status) && !guestHasAnnouncement,
    { status: guestAnnouncements.status },
  );

  const workerAdmin = await request('/admin/roles', { token: worker.token, factoryId: worker.recommendedFactoryId });
  record('WORKER direct admin API is denied', workerAdmin.status === 403, { status: workerAdmin.status });

  const roleRouteCases = [
    ['CONTRACTOR_LEAD reads own company pool', actors.contractorLead, '/shift/contractor-lead/pool', 200],
    ['TECHNOLOG reads task board', actors.technolog, '/tasks', 200],
    ['OTHER worker-like role reads own shift', actors.other, '/shift/current', 200],
    ['TECH_MECHANIC reads task board', actors.mechanic, '/tasks', 200],
    ['TECH_ELECTRIC reads task board', actors.electric, '/tasks', 200],
    ['TECH_HOLOD reads defrost lines', actors.holod, '/defrost/lines', 200],
    ['TECH_SANTECHNIK reads task board', actors.santechnik, '/tasks', 200],
    ['OKK reads quality contour', actors.okk, '/okk', 200],
    ['STORE reads returns contour', actors.store, '/returns', 200],
    ['MANAGEMENT reads operations overview', actors.management, '/ops/overview', 200],
  ];
  for (const [name, actor, path, expectedStatus] of roleRouteCases) {
    const response = await request(path, { token: actor.token, factoryId: actor.recommendedFactoryId });
    record(name, response.status === expectedStatus && !hasSensitivePayload(response.data), { status: response.status });
  }

  const masterMe = await request('/auth/me', { token: master.token, factoryId: master.recommendedFactoryId });
  const samples = [headerProbe.data, adminFactories.data, notifications.data, masterMe.data];
  record('public samples contain no sensitive fields', !hasSensitivePayload(samples));

  console.log(JSON.stringify({
    passed: state.passed.length,
    failed: state.failed.length,
    warnings: state.warnings.length,
    results: state,
  }, null, 2));
  if (state.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
