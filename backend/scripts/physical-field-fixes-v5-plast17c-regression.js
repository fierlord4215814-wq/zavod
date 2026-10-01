const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const runtimeDir = path.join(rootDir, '.codex-runtime');
const fingerprintPath = path.join(runtimeDir, 'p17c-protected-fingerprint.json');
const backendResultPath = path.join(runtimeDir, 'p17c-backend-result.json');

for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const WS_URL = API.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
const TEST_PASSWORD = process.env.PILOT_TEST_PASSWORD || '1234';
const actorTokens = new Map();
const checks = { passed: [], failed: [] };

function expect(condition, name, evidence) {
  const target = condition ? checks.passed : checks.failed;
  target.push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function unwrap(value) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object'
    ? value.data
    : value;
}

async function login(userId, password = TEST_PASSWORD) {
  const cacheKey = `${userId}:${password}`;
  if (actorTokens.has(cacheKey)) return actorTokens.get(cacheKey);
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`У пользователя ${userId} нет телефона для целевого входа.`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201 || !payload?.token) {
    throw new Error(`Не выполнен целевой вход ${userId}: HTTP ${response.status}.`);
  }
  actorTokens.set(cacheKey, payload.token);
  return payload.token;
}

async function request(method, pathname, { userId, token, password, factoryId, body } = {}) {
  const headers = {};
  const authToken = token ?? (userId ? await login(userId, password) : null);
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
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
  return { status: response.status, data: unwrap(data) };
}

function connectSocket(token, factoryId) {
  return new Promise((resolve) => {
    const messages = [];
    const closes = [];
    const ws = new WebSocket(`${WS_URL}?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    const connection = { ws, messages, connected: false, closes };
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      connection.connected = connected;
      resolve(connection);
    };
    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw));
        messages.push(event);
        if (event.type === 'connected') finish(true);
      } catch {
        // Malformed frames are ignored here and caught by payload assertions later.
      }
    });
    ws.on('error', () => finish(false));
    ws.on('close', (code, reason) => {
      closes.push({ code, reason: String(reason) });
      finish(false);
    });
    setTimeout(() => finish(false), 3000);
  });
}

async function waitForClose(connection, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (connection.closes.length) return connection.closes.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function waitForEvent(messages, type, fromIndex = 0, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const event = messages.slice(fromIndex).find((item) => item.type === type);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function expectNoEvent(messages, type, fromIndex = 0, timeoutMs = 900) {
  return !(await waitForEvent(messages, type, fromIndex, timeoutMs));
}

function isOpaqueInvalidation(event) {
  if (!event || !event.payload || typeof event.payload !== 'object') return false;
  const keys = Object.keys(event.payload).sort();
  return keys.length === 1
    && keys[0] === 'changedAt'
    && !Number.isNaN(Date.parse(event.payload.changedAt));
}

function closeSocket(connection) {
  if (!connection?.ws) return;
  try { connection.ws.close(); } catch { /* best-effort test cleanup */ }
}

function operationId(marker, suffix) {
  return `${marker}:${suffix}`.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120);
}

function sensitivePayloadFound(messages) {
  return /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i
    .test(JSON.stringify(messages));
}

async function sourceContractChecks() {
  const source = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const wsService = source('backend/src/ws/ws.service.ts');
  const events = source('backend/src/ws/events.ts');
  const app = source('frontend/src/App.tsx');
  const client = source('frontend/src/ws/client.ts');
  const okk = source('frontend/src/screens/OkkScreen.tsx');
  const wash = source('frontend/src/screens/WashScreen.tsx');
  const defrost = source('frontend/src/screens/DefrostScreen.tsx');

  expect(wsService.includes('FACTORY_WS_EVENT_CAPABILITIES'), 'backend factory audience uses the canonical capability matrix');
  expect(wsService.includes("changedAt: new Date().toISOString()"), 'factory invalidation payload is opaque');
  expect(!wsService.includes('safePayloadSummary'), 'legacy entity payload summarizer is absent');
  expect(events.includes("OKK_UPDATED: 'okk_updated'") && events.includes("DEFROST_UPDATED: 'defrost_updated'"), 'OKK and defrost events are registered');
  expect(app.includes('if (currentUser.isGuest)') && app.includes('realtimeContextEpoch'), 'Guest suppresses operational websocket and capability refresh rebinds it');
  expect(client.includes('reconnectSuppressed') && client.includes("event.type === 'auth_context_changed'"), 'client stops stale reconnect after auth-context change');
  expect(okk.includes("'zavod:okk-updated'"), 'OKK screen consumes canonical invalidation');
  expect(wash.includes("'zavod:wash-updated'"), 'Wash screen consumes canonical invalidation');
  expect(defrost.includes("'zavod:defrost-updated'"), 'Defrost screen consumes canonical invalidation');
}

async function runTargetedRegression() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  await sourceContractChecks();

  const health = await request('GET', '/health');
  if (health.status !== 200) throw new Error('Свежий backend недоступен для Пласта 17C.');
  expect(health.status === 200, 'backend health is ready', { status: health.status });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден.');
  const factoryId = factory.id;
  const actors = {
    admin: 'pilot-pack-admin',
    management: 'pilot-pack-management',
    master: 'pilot-pack-senior-master',
    unauthorized: 'pilot-pack-kipia-lead',
    defrostReader: 'pilot-pack-worker-source',
    guest: 'pilot-pack-guest',
  };
  const marker = `__PFFV5_P17C_${Date.now()}__`;
  const connections = [];
  let okkRecordId = null;
  let washSessionId = null;
  let washIssueId = null;
  let washControlId = null;
  let defrostEventId = null;
  let tempUserId = null;
  let capturedError = null;
  const cleanup = {
    okkArchived: false,
    washCompleted: false,
    defrostCompleted: false,
    tempBlocked: false,
    tempAccessDeactivated: false,
    physicalDeletes: 0,
  };

  const connectActor = async (userId) => {
    const connection = await connectSocket(await login(userId), factoryId);
    connections.push(connection);
    return connection;
  };

  try {
    const [adminToken, unauthorizedToken] = await Promise.all([
      login(actors.admin),
      login(actors.unauthorized),
    ]);
    const management = await connectActor(actors.management);
    const master = await connectActor(actors.master);
    const unauthorized = await connectSocket(unauthorizedToken, factoryId);
    connections.push(unauthorized);
    const defrostReader = await connectActor(actors.defrostReader);
    expect(management.connected && master.connected && unauthorized.connected && defrostReader.connected, 'authorized operational actors connect to websocket');

    const guest = await connectSocket(await login(actors.guest), factoryId);
    connections.push(guest);
    expect(!guest.connected, 'Guest websocket connection is denied');
    const crossFactory = await connectSocket(adminToken, crypto.randomUUID());
    connections.push(crossFactory);
    expect(!crossFactory.connected, 'cross-factory websocket connection is denied');

    const unauthorizedOkk = await request('GET', '/okk', { token: unauthorizedToken, factoryId });
    const unauthorizedWash = await request('GET', '/wash', { token: unauthorizedToken, factoryId });
    const unauthorizedDefrost = await request('GET', '/defrost/lines', { token: unauthorizedToken, factoryId });
    expect(unauthorizedOkk.status === 403, 'direct OKK API is denied without okk.read', { status: unauthorizedOkk.status });
    expect(unauthorizedWash.status === 403, 'direct Wash API is denied without wash.read', { status: unauthorizedWash.status });
    expect(unauthorizedDefrost.status === 403, 'direct Defrost API is denied without defrost.read', { status: unauthorizedDefrost.status });

    const [line, masterAccess] = await Promise.all([
      db.line.findFirst({
        where: { factoryId, deletedAt: null, deactivatedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.userFactoryAccess.findFirst({
        where: { factoryId, role: 'MASTER', isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!line || !masterAccess) throw new Error('Нет безопасной линии или активного мастера для OKK regression.');

    const managementOkkIndex = management.messages.length;
    const unauthorizedOkkIndex = unauthorized.messages.length;
    const createdOkk = await request('POST', '/okk', {
      token: adminToken,
      factoryId,
      body: {
        lineId: line.id,
        assignedMasterId: masterAccess.userId,
        description: `Regression ${marker}`,
        operationId: operationId(marker, 'okk-create'),
      },
    });
    expect(createdOkk.status === 201 && createdOkk.data?.id, 'OKK mutation succeeds through guarded API', { status: createdOkk.status });
    if (!createdOkk.data?.id) throw new Error('OKK regression record was not created.');
    okkRecordId = createdOkk.data.id;
    const okkEvent = await waitForEvent(management.messages, 'okk_updated', managementOkkIndex);
    expect(isOpaqueInvalidation(okkEvent), 'OKK reader receives one opaque invalidation');
    expect(await expectNoEvent(unauthorized.messages, 'okk_updated', unauthorizedOkkIndex), 'actor without okk.read receives no OKK invalidation');

    const masterWashIndex = master.messages.length;
    const unauthorizedWashIndex = unauthorized.messages.length;
    const startedWash = await request('POST', '/wash/start', {
      token: adminToken,
      factoryId,
      body: {
        targetType: 'OTHER',
        objectName: `Regression ${marker}`,
        objectDescription: 'Targeted realtime evidence',
        operationId: operationId(marker, 'wash-start'),
      },
    });
    expect(startedWash.status === 201 && startedWash.data?.id, 'Wash mutation succeeds through guarded API', { status: startedWash.status });
    if (!startedWash.data?.id) throw new Error('Wash regression session was not started.');
    washSessionId = startedWash.data.id;
    const washStartEvent = await waitForEvent(master.messages, 'wash_updated', masterWashIndex);
    expect(isOpaqueInvalidation(washStartEvent), 'Wash reader receives opaque start invalidation');

    const addedMessage = await request('POST', `/wash/${washSessionId}/message`, {
      token: adminToken,
      factoryId,
      body: { message: `Regression ${marker}`, operationId: operationId(marker, 'wash-message') },
    });
    expect(addedMessage.status === 201, 'Wash message emits after committed mutation', { status: addedMessage.status });
    const addedIssue = await request('POST', `/wash/${washSessionId}/issues`, {
      token: adminToken,
      factoryId,
      body: { title: `Regression ${marker}`, description: 'Targeted issue', operationId: operationId(marker, 'wash-issue') },
    });
    expect(addedIssue.status === 201 && addedIssue.data?.id, 'Wash issue emits after committed mutation', { status: addedIssue.status });
    washIssueId = addedIssue.data?.id ?? null;
    const control = await request('POST', `/wash/${washSessionId}/control-items`, {
      token: adminToken,
      factoryId,
      body: { title: `Regression ${marker}`, description: 'Targeted control', type: 'CONTROL', requiresPhoto: false },
    });
    expect(control.status === 201 && control.data?.id, 'Wash control item emits after committed mutation', { status: control.status });
    washControlId = control.data?.id ?? null;
    if (washIssueId) {
      const resolved = await request('PATCH', `/wash/issues/${washIssueId}/status`, {
        token: adminToken,
        factoryId,
        body: { status: 'RESOLVED', comment: `Regression resolved ${marker}` },
      });
      expect(resolved.status === 200, 'Wash issue resolve emits after commit', { status: resolved.status });
    }
    if (washControlId) {
      const completedControl = await request('PATCH', `/wash/control-items/${washControlId}`, {
        token: adminToken,
        factoryId,
        body: { status: 'DONE', comment: `Regression completed ${marker}` },
      });
      expect(completedControl.status === 200, 'Wash control completion emits after commit', { status: completedControl.status });
    }
    const completedWash = await request('POST', `/wash/${washSessionId}/complete`, {
      token: adminToken,
      factoryId,
      body: { operationId: operationId(marker, 'wash-complete') },
    });
    expect(completedWash.status === 201 && completedWash.data?.status === 'DONE', 'Wash session completes through guarded API', { status: completedWash.status });
    cleanup.washCompleted = completedWash.status === 201 && completedWash.data?.status === 'DONE';
    const washEvents = master.messages.slice(masterWashIndex).filter((event) => event.type === 'wash_updated');
    expect(washEvents.length >= 6 && washEvents.every(isOpaqueInvalidation), 'Wash lifecycle produces only opaque invalidations', { count: washEvents.length });
    expect(await expectNoEvent(unauthorized.messages, 'wash_updated', unauthorizedWashIndex), 'actor without wash.read receives no Wash invalidation');
    const duplicateWashIndex = master.messages.length;
    const duplicateComplete = await request('POST', `/wash/${washSessionId}/complete`, {
      token: adminToken,
      factoryId,
      body: { operationId: operationId(marker, 'wash-complete') },
    });
    expect(duplicateComplete.status === 201, 'duplicate Wash completion is idempotent', { status: duplicateComplete.status });
    expect(await expectNoEvent(master.messages, 'wash_updated', duplicateWashIndex), 'idempotent Wash replay emits no duplicate invalidation');

    const defrostLineCandidates = await db.line.findMany({
      where: { factoryId, status: { not: 'WORK' }, deletedAt: null, deactivatedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let defrostLine = null;
    for (const candidate of defrostLineCandidates) {
      if (/pilot|stage|regression|test/i.test(`${candidate.id} ${candidate.name}`)) continue;
      const [activeDefrost, activeWash] = await Promise.all([
        db.defrostEvent.count({ where: { factoryId, lineId: candidate.id, eventType: 'DEFROST', status: 'ACTIVE' } }),
        db.washSession.count({ where: { factoryId, lineId: candidate.id, status: { not: 'DONE' }, deletedAt: null } }),
      ]);
      if (!activeDefrost && !activeWash) { defrostLine = candidate; break; }
    }
    const defrostIndex = defrostReader.messages.length;
    const unauthorizedDefrostIndex = unauthorized.messages.length;
    if (defrostLine) {
      const startedDefrost = await request('POST', `/defrost/lines/${defrostLine.id}/start-today`, {
        token: adminToken,
        factoryId,
        body: { comment: `Regression ${marker}`, operationId: operationId(marker, 'defrost-start') },
      });
      expect(startedDefrost.status === 201 && startedDefrost.data?.id, 'Defrost starts through guarded API', { status: startedDefrost.status });
      defrostEventId = startedDefrost.data?.id ?? null;
      const completedDefrost = await request('POST', `/defrost/lines/${defrostLine.id}/complete-today`, {
        token: adminToken,
        factoryId,
        body: { comment: `Regression completed ${marker}`, operationId: operationId(marker, 'defrost-complete') },
      });
      expect(completedDefrost.status === 201 && completedDefrost.data?.status === 'COMPLETED', 'Defrost completes through guarded API', { status: completedDefrost.status });
      cleanup.defrostCompleted = completedDefrost.status === 201 && completedDefrost.data?.status === 'COMPLETED';
    } else {
      const fallbackLine = await db.line.findFirst({ where: { factoryId, deletedAt: null, deactivatedAt: null }, select: { id: true } });
      if (!fallbackLine) throw new Error('Нет линии для defrost invalidation evidence.');
      const blown = await request('POST', `/defrost/lines/${fallbackLine.id}/shock-chamber-blown`, {
        token: adminToken,
        factoryId,
        body: { comment: `Regression ${marker}`, operationId: operationId(marker, 'defrost-blow') },
      });
      expect(blown.status === 201, 'Defrost fallback event succeeds through guarded API', { status: blown.status });
      cleanup.defrostCompleted = blown.status === 201;
    }
    const defrostEvent = await waitForEvent(defrostReader.messages, 'defrost_updated', defrostIndex);
    expect(isOpaqueInvalidation(defrostEvent), 'Defrost reader receives opaque invalidation');
    expect(await expectNoEvent(unauthorized.messages, 'defrost_updated', unauthorizedDefrostIndex), 'actor without defrost.read receives no Defrost invalidation');

    const tempPhone = `+7999${String(Date.now()).slice(-7)}`;
    const registration = await request('POST', '/auth/register', {
      body: { phone: tempPhone, password: TEST_PASSWORD, passwordRepeat: TEST_PASSWORD, operationId: operationId(marker, 'register') },
    });
    expect(registration.status === 201 && registration.data?.userId && registration.data?.token, 'temporary lifecycle actor registers through public flow', { status: registration.status });
    tempUserId = registration.data?.userId ?? null;
    if (!tempUserId || !registration.data?.token) throw new Error('Не создан временный lifecycle actor.');
    const grant = await request('POST', `/admin/users/${tempUserId}/factory-access`, {
      token: adminToken,
      factoryId,
      body: { factoryId, role: 'MANAGEMENT', departmentId: null, companyId: null, isGuest: false, reason: marker },
    });
    expect(grant.status === 201, 'admin grants scoped capability through guarded API', { status: grant.status });
    const lifecycle = await connectSocket(registration.data.token, factoryId);
    connections.push(lifecycle);
    expect(lifecycle.connected, 'newly authorized lifecycle actor connects');
    const lifecycleIndex = lifecycle.messages.length;
    const okkUpdateForLifecycle = await request('PATCH', `/okk/${okkRecordId}`, {
      token: adminToken,
      factoryId,
      body: { description: `Regression lifecycle ${marker}` },
    });
    expect(okkUpdateForLifecycle.status === 200, 'OKK mutation used for capability lifecycle proof succeeds', { status: okkUpdateForLifecycle.status });
    expect(isOpaqueInvalidation(await waitForEvent(lifecycle.messages, 'okk_updated', lifecycleIndex)), 'authorized lifecycle actor receives OKK invalidation');

    const authChangeIndex = lifecycle.messages.length;
    const downgrade = await request('PATCH', `/admin/users/${tempUserId}/factory-access`, {
      token: adminToken,
      factoryId,
      body: { factoryId, role: 'WORKER', departmentId: null, companyId: null, reason: marker },
    });
    expect(downgrade.status === 200, 'capability downgrade succeeds through guarded API', { status: downgrade.status });
    const authChanged = await waitForEvent(lifecycle.messages, 'auth_context_changed', authChangeIndex);
    const downgradeClose = await waitForClose(lifecycle);
    expect(Boolean(authChanged) && downgradeClose?.code === 4001, 'downgrade invalidates and closes stale socket', { closeCode: downgradeClose?.code ?? null });

    const workerLifecycle = await connectSocket(registration.data.token, factoryId);
    connections.push(workerLifecycle);
    expect(workerLifecycle.connected, 'downgraded actor reconnects with current effective context');
    const workerOkkIndex = workerLifecycle.messages.length;
    const secondOkkUpdate = await request('PATCH', `/okk/${okkRecordId}`, {
      token: adminToken,
      factoryId,
      body: { description: `Regression after downgrade ${marker}` },
    });
    expect(secondOkkUpdate.status === 200, 'post-downgrade mutation succeeds', { status: secondOkkUpdate.status });
    expect(await expectNoEvent(workerLifecycle.messages, 'okk_updated', workerOkkIndex), 'downgraded actor no longer receives OKK invalidation');

    const blockIndex = workerLifecycle.messages.length;
    const blocked = await request('PATCH', `/admin/users/${tempUserId}/block-status`, {
      token: adminToken,
      factoryId,
      body: { blocked: true, reason: marker },
    });
    cleanup.tempBlocked = blocked.status === 200;
    const blockAuthChanged = await waitForEvent(workerLifecycle.messages, 'auth_context_changed', blockIndex);
    const blockClose = await waitForClose(workerLifecycle);
    expect(cleanup.tempBlocked && Boolean(blockAuthChanged) && blockClose?.code === 4001, 'blocked actor is notified and disconnected', { status: blocked.status, closeCode: blockClose?.code ?? null });
    const deactivate = await request('PATCH', `/admin/users/${tempUserId}/factory-access`, {
      token: adminToken,
      factoryId,
      body: { factoryId, isActive: false, reason: marker },
    });
    cleanup.tempAccessDeactivated = deactivate.status === 200;
    expect(cleanup.tempAccessDeactivated, 'temporary factory access is soft-deactivated', { status: deactivate.status });
    const deniedAfterDeactivate = await connectSocket(registration.data.token, factoryId);
    connections.push(deniedAfterDeactivate);
    expect(!deniedAfterDeactivate.connected, 'blocked and deactivated actor cannot reconnect');

    const archivedOkk = await request('POST', `/okk/${okkRecordId}/archive`, { token: adminToken, factoryId });
    cleanup.okkArchived = archivedOkk.status === 201;
    expect(cleanup.okkArchived, 'OKK regression record is archived through product flow', { status: archivedOkk.status });
    okkRecordId = null;

    expect(!sensitivePayloadFound(connections.flatMap((item) => item.messages)), 'websocket frames contain no secret or storage fields');
  } catch (error) {
    capturedError = error;
  } finally {
    const adminToken = actorTokens.get(`${actors.admin}:${TEST_PASSWORD}`) ?? null;
    if (adminToken && okkRecordId) {
      const archived = await request('POST', `/okk/${okkRecordId}/archive`, { token: adminToken, factoryId }).catch(() => null);
      cleanup.okkArchived = archived?.status === 201 || cleanup.okkArchived;
    }
    if (adminToken && washSessionId && !cleanup.washCompleted) {
      if (washIssueId) await request('PATCH', `/wash/issues/${washIssueId}/status`, { token: adminToken, factoryId, body: { status: 'RESOLVED', comment: `Regression cleanup ${marker}` } }).catch(() => null);
      if (washControlId) await request('PATCH', `/wash/control-items/${washControlId}`, { token: adminToken, factoryId, body: { status: 'DONE', comment: `Regression cleanup ${marker}` } }).catch(() => null);
      const completed = await request('POST', `/wash/${washSessionId}/complete`, { token: adminToken, factoryId, body: { operationId: operationId(marker, 'wash-cleanup') } }).catch(() => null);
      cleanup.washCompleted = completed?.status === 201 && completed?.data?.status === 'DONE';
    }
    if (adminToken && defrostEventId && !cleanup.defrostCompleted) {
      const completed = await request('POST', `/defrost/${defrostEventId}/end`, { token: adminToken, factoryId, body: { comment: `Regression cleanup ${marker}`, operationId: operationId(marker, 'defrost-cleanup') } }).catch(() => null);
      cleanup.defrostCompleted = completed?.status === 201 && completed?.data?.status === 'COMPLETED';
    }
    if (adminToken && tempUserId) {
      if (!cleanup.tempBlocked) {
        const blocked = await request('PATCH', `/admin/users/${tempUserId}/block-status`, { token: adminToken, factoryId, body: { blocked: true, reason: marker } }).catch(() => null);
        cleanup.tempBlocked = blocked?.status === 200;
      }
      if (!cleanup.tempAccessDeactivated) {
        const deactivated = await request('PATCH', `/admin/users/${tempUserId}/factory-access`, { token: adminToken, factoryId, body: { factoryId, isActive: false, reason: marker } }).catch(() => null);
        cleanup.tempAccessDeactivated = deactivated?.status === 200;
      }
    }
    connections.forEach(closeSocket);
  }

  const [activeOkk, activeWash, activeDefrost, activeTempUsers, activeTempAccesses] = await Promise.all([
    db.okkRecord.count({ where: { factoryId, description: { contains: marker }, deletedAt: null, archivedAt: null } }),
    db.washSession.count({ where: { factoryId, objectName: { contains: marker }, status: { not: 'DONE' }, deletedAt: null } }),
    db.defrostEvent.count({ where: { factoryId, status: 'ACTIVE', OR: [{ comment: { contains: marker } }, { endComment: { contains: marker } }] } }),
    tempUserId ? db.user.count({ where: { id: tempUserId, blockedAt: null, deletedAt: null } }) : Promise.resolve(0),
    tempUserId ? db.userFactoryAccess.count({ where: { userId: tempUserId, factoryId, isActive: true } }) : Promise.resolve(0),
  ]);
  const markerStatus = { activeOkk, activeWash, activeDefrost, activeTempUsers, activeTempAccesses };
  expect(Object.values(markerStatus).every((value) => value === 0), 'no active P17C regression marker remains', markerStatus);
  expect(cleanup.physicalDeletes === 0, 'physical deletes are zero');

  const result = {
    createdAt: new Date().toISOString(),
    factory: { name: factory.name, code: 'factory-4' },
    marker,
    checks,
    cleanup,
    markerStatus,
    passed: !capturedError && checks.failed.length === 0,
    error: capturedError instanceof Error ? capturedError.message : capturedError ? String(capturedError) : null,
  };
  fs.writeFileSync(backendResultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    mode: 'targeted-regression',
    passed: result.passed,
    passedChecks: checks.passed.length,
    failedChecks: checks.failed.length,
    cleanup,
    markerStatus,
    resultPath: backendResultPath,
    error: result.error,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

async function protectedSnapshot(factoryId, idsByModel = null) {
  const ids = (model) => idsByModel?.[model]?.length ? { id: { in: idsByModel[model] } } : null;
  const scoped = (model, where) => ids(model) ? { AND: [where, ids(model)] } : where;
  const userWhere = ids('users') ?? { OR: [{ factoryId }, { factoryAccess: { some: { factoryId } } }] };

  const [
    users,
    accesses,
    lines,
    assignments,
    plannedLines,
    plannedShifts,
    tasks,
    checklistRuns,
    washes,
    defrosts,
    okkRecords,
  ] = await Promise.all([
    db.user.findMany({
      where: userWhere,
      select: { id: true, factoryId: true, role: true, employeeState: true, blockedAt: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.userFactoryAccess.findMany({
      where: scoped('accesses', { factoryId }),
      select: { id: true, userId: true, factoryId: true, role: true, departmentId: true, jobTitleId: true, companyId: true, isGuest: true, isActive: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.line.findMany({
      where: scoped('lines', { factoryId }),
      select: { id: true, factoryId: true, name: true, status: true, version: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.assignment.findMany({
      where: scoped('assignments', { factoryId }),
      select: { id: true, factoryId: true, userId: true, kind: true, lineId: true, washSessionId: true, workAreaId: true, workAreaPositionId: true, startedAt: true, endedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedLineAssignment.findMany({
      where: scoped('plannedLines', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, shiftDate: true, shiftType: true, userId: true, releasedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedShiftAssignment.findMany({
      where: scoped('plannedShifts', { factoryId }),
      select: { id: true, factoryId: true, shiftDate: true, shiftType: true, kind: true, userId: true, workAreaId: true, workAreaPositionId: true, releasedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.task.findMany({
      where: scoped('tasks', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, lineStatusEventId: true, createdById: true, assignedToId: true, takenById: true, doneById: true, type: true, status: true, archivedAt: true, deletedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.checklistRun.findMany({
      where: scoped('checklistRuns', { factoryId }),
      select: { id: true, factoryId: true, departmentId: true, templateId: true, userId: true, lineId: true, shiftDate: true, shiftType: true, status: true, closedAt: true, closeKind: true },
      orderBy: { id: 'asc' },
    }),
    db.washSession.findMany({
      where: scoped('washes', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, targetType: true, startedById: true, status: true, deletedAt: true, completedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.defrostEvent.findMany({
      where: scoped('defrosts', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, startedById: true, endedById: true, startAt: true, endAt: true, status: true, eventType: true },
      orderBy: { id: 'asc' },
    }),
    db.okkRecord.findMany({
      where: scoped('okkRecords', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, createdById: true, assignedMasterId: true, status: true, acknowledged: true, archivedAt: true, deletedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const collections = {
    users,
    accesses,
    lines,
    assignments,
    plannedLines,
    plannedShifts,
    tasks,
    checklistRuns,
    washes,
    defrosts,
    okkRecords,
  };
  return {
    hash: sha(collections),
    counts: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rows.length])),
    idsByModel: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rows.map((row) => row.id)])),
    collections,
  };
}

async function captureBefore() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const factory = await db.factory.findUnique({
    where: { code: 'factory-4' },
    select: { id: true, name: true },
  });
  if (!factory) throw new Error('Завод 4 не найден.');
  const snapshot = await protectedSnapshot(factory.id);
  const document = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    factory,
    businessRelationshipHash: snapshot.hash,
    counts: snapshot.counts,
    idsByModel: snapshot.idsByModel,
    collections: snapshot.collections,
  };
  fs.writeFileSync(fingerprintPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    mode: 'fingerprint-before',
    path: fingerprintPath,
    factory,
    businessRelationshipHash: snapshot.hash,
    counts: snapshot.counts,
  }, null, 2));
}

async function verifyAfter() {
  if (!fs.existsSync(fingerprintPath)) throw new Error('Исходный fingerprint Пласта 17C не найден.');
  const before = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
  const after = await protectedSnapshot(before.factory.id, before.idsByModel);
  const unchanged = before.businessRelationshipHash === after.hash;
  console.log(JSON.stringify({
    mode: 'fingerprint-after',
    unchanged,
    beforeHash: before.businessRelationshipHash,
    afterHash: after.hash,
    countsBefore: before.counts,
    countsAfter: after.counts,
  }, null, 2));
  if (!unchanged) process.exitCode = 1;
}

async function actorInventory() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден.');
  const candidateIds = [
    'pilot-pack-admin',
    'pilot-pack-management',
    'pilot-pack-senior-master',
    'pilot-pack-kipia-lead',
    'pilot-pack-okk',
    'pilot-pack-worker-source',
    'pilot-pack-guest',
    'mobile-technolog',
    'mobile-tech-holod',
  ];
  const accesses = await db.userFactoryAccess.findMany({
    where: { factoryId: factory.id, userId: { in: candidateIds } },
    select: { userId: true, role: true, isGuest: true, isActive: true },
    orderBy: { userId: 'asc' },
  });
  const roles = [...new Set(accesses.map((item) => item.role))];
  const permissions = await db.rolePermission.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { role: true, permissionCode: true },
    orderBy: [{ role: 'asc' }, { permissionCode: 'asc' }],
  });
  const washSettings = await db.washSettings.findUnique({
    where: { factoryId: factory.id },
    select: {
      washIssueResolveRequiresPhoto: true,
      washCompleteRequiresNoOpenIssues: true,
      washCompleteRequiresOkkReview: true,
      washMiniTasksEnabled: true,
      washControlEnabled: true,
      washOkkReviewEnabled: true,
    },
  });
  console.log(JSON.stringify({
    mode: 'actor-inventory',
    factory,
    washSettings,
    actors: accesses.map((access) => ({
      ...access,
      permissions: access.isGuest
        ? []
        : permissions.filter((item) => item.role === access.role).map((item) => item.permissionCode),
    })),
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--fingerprint-before')) return captureBefore();
  if (process.argv.includes('--fingerprint-after')) return verifyAfter();
  if (process.argv.includes('--actor-inventory')) return actorInventory();
  return runTargetedRegression();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
