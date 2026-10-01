const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const WS_URL = API.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
const runId = `${Date.now()}_${process.pid}`;
const marker = `__PFFV5_P6_${runId}__`;
const shortRun = runId.replace(/\D/g, '').slice(-10);
const db = new PrismaClient();
const passed = [];
const failures = [];
const artifacts = {
  runId,
  marker,
  startedAt: new Date().toISOString(),
  okkRecordIds: [],
  returnRecordIds: [],
  partialOperationIds: [],
  auditActions: [],
  cleanup: null,
};
let factoryId = null;
let okkSocket = null;

function record(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function redact(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /passwordHash|storagePath|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)
      ? '[hidden]'
      : inner
  )));
}

function hasSensitivePublicData(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|operationId|secret/i
    .test(JSON.stringify(value ?? null));
}

async function request(method, pathname, { userId, selectedFactoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (selectedFactoryId) headers['x-factory-id'] = selectedFactoryId;
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

async function expectStatus(name, expected, promise) {
  const response = await promise;
  const accepted = Array.isArray(expected) ? expected : [expected];
  record(name, accepted.includes(response.status), {
    expected: accepted,
    actual: response.status,
    ...(accepted.includes(response.status) ? {} : { response: redact(response.data) }),
  });
  return response;
}

function operationId(suffix) {
  return `${marker}:${suffix}`;
}

function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function waitFor(messages, predicate, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(found ?? null);
      }
    }, 75);
  });
}

function connect(userId, selectedFactoryId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?userId=${encodeURIComponent(userId)}&factoryId=${encodeURIComponent(selectedFactoryId)}`);
    const messages = [];
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      resolve({ ws, messages, connected });
    };
    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw));
        messages.push(event);
        if (event.type === 'connected') finish(true);
      } catch {
        // Malformed data is ignored; the regression only evaluates valid events.
      }
    });
    ws.on('error', () => finish(false));
    ws.on('close', () => finish(false));
    setTimeout(() => finish(false), 3000);
  });
}

async function createOkk(lineId, masterUserId, suffix) {
  const response = await expectStatus(`OKK create ${suffix}`, 201, request('POST', '/okk', {
    userId: 'test-okk',
    selectedFactoryId: factoryId,
    body: {
      lineId,
      masterUserId,
      defectDate: localDate(),
      shiftLabel: 'День',
      article: `Q-${shortRun}-${suffix}`,
      productName: `Контрольная партия ${shortRun} ${suffix}`,
      mismatchReason: 'Проверка последовательной частичной выдачи',
      defectQuantity: '52 гофры',
      decision: 'Передать продукцию на разбор по частям',
      operationId: operationId(`create-okk-${suffix}`),
    },
  }));
  if (response.data?.id) artifacts.okkRecordIds.push(response.data.id);
  return response.data;
}

async function createReturn(suffix) {
  const response = await expectStatus(`Return create ${suffix}`, 201, request('POST', '/returns', {
    userId: 'test-store',
    selectedFactoryId: factoryId,
    body: {
      title: `Возврат партии ${shortRun} ${suffix}`,
      reason: 'Проверка последовательной частичной выдачи',
      article: `R-${shortRun}-${suffix}`,
      quantity: 52,
      unit: 'гофры',
      photoUrl: 'attachment-pending',
      operationId: operationId(`create-return-${suffix}`),
    },
  }));
  if (response.data?.id) artifacts.returnRecordIds.push(response.data.id);
  return response.data;
}

async function okkRecord(id) {
  const list = await request('GET', '/okk?includeArchive=true', { userId: 'test-okk', selectedFactoryId: factoryId });
  return { response: list, record: Array.isArray(list.data) ? list.data.find((item) => item.id === id) : null };
}

async function returnRecord(id) {
  const list = await request('GET', '/returns?includeArchive=true', { userId: 'test-store', selectedFactoryId: factoryId });
  return { response: list, record: Array.isArray(list.data) ? list.data.find((item) => item.id === id) : null };
}

async function moduleCounts() {
  const response = await request('GET', '/ops/module-summary', { userId: 'test-management', selectedFactoryId: factoryId });
  const values = new Map(Array.isArray(response.data) ? response.data.map((item) => [item.module, item.count]) : []);
  return { response, okk: values.get('OKK'), returns: values.get('Returns') };
}

function archiveFingerprint(excludedOkk = [], excludedReturns = []) {
  return Promise.all([
    db.okkRecord.findMany({
      where: { archivedAt: { not: null }, ...(excludedOkk.length ? { id: { notIn: excludedOkk } } : {}) },
      select: { id: true, status: true, defectQuantity: true, archivedAt: true, deletedAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.returnRecord.findMany({
      where: { archivedAt: { not: null }, ...(excludedReturns.length ? { id: { notIn: excludedReturns } } : {}) },
      select: { id: true, status: true, quantity: true, unit: true, archivedAt: true, deletedAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]).then(([okk, returns]) => crypto.createHash('sha256').update(JSON.stringify({ okk, returns })).digest('hex'));
}

async function main() {
  const health = await request('GET', '/health');
  if (health.status !== 200) throw new Error(`Fresh backend is required at ${API}`);
  record('fresh backend health', health.status === 200 && health.data?.status === 'ok', { status: health.status });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  factoryId = factory.id;
  const line = await db.line.findFirst({
    where: { factoryId, deletedAt: null, deactivatedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const master = await db.userFactoryAccess.findFirst({
    where: { factoryId, role: 'MASTER', isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!line || !master) throw new Error('Factory 4 requires an active line and master for the regression');

  const permissionRows = await db.rolePermission.findMany({
    where: {
      OR: [
        { role: 'OKK', permissionCode: 'okk.manage' },
        { role: 'STORE', permissionCode: 'returns.manage' },
      ],
    },
    select: { role: true, permissionCode: true },
  });
  record('existing role permissions are reused', permissionRows.length === 2, permissionRows);

  const legacyBefore = await archiveFingerprint();
  const okkMain = await createOkk(line.id, master.userId, 'main');
  const okkConcurrent = await createOkk(line.id, master.userId, 'concurrent');
  const returnMain = await createReturn('main');
  if (!okkMain?.id || !okkConcurrent?.id || !returnMain?.id) throw new Error('Target records were not created');

  const okkInitial = await okkRecord(okkMain.id);
  record('OKK initial summary is 52 / 0 / 52', okkInitial.record?.quantitySummary?.original === '52'
    && okkInitial.record?.quantitySummary?.released === '0'
    && okkInitial.record?.quantitySummary?.remaining === '52'
    && okkInitial.record?.quantitySummary?.unit === 'гофры'
    && okkInitial.record?.availableActions?.includes('partial-release'), redact(okkInitial.record?.quantitySummary));
  const returnInitial = await returnRecord(returnMain.id);
  record('Return initial summary is 52 / 0 / 52', returnInitial.record?.quantitySummary?.original === '52'
    && returnInitial.record?.quantitySummary?.released === '0'
    && returnInitial.record?.quantitySummary?.remaining === '52'
    && returnInitial.record?.quantitySummary?.unit === 'гофры'
    && returnInitial.record?.availableActions?.includes('partial-release'), redact(returnInitial.record?.quantitySummary));

  await expectStatus('OKK over-release denied', 409, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 53, comment: 'Количество превышает остаток', operationId: operationId('okk-over') },
  }));
  await expectStatus('OKK zero release denied', 409, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 0, comment: 'Нулевое количество', operationId: operationId('okk-zero') },
  }));
  await expectStatus('OKK negative release denied', 409, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: -1, comment: 'Отрицательное количество', operationId: operationId('okk-negative') },
  }));
  await expectStatus('OKK empty comment denied', 409, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 1, comment: '   ', operationId: operationId('okk-empty-comment') },
  }));
  await expectStatus('unit spoof is denied', 409, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 1, unit: 'штуки', comment: 'Попытка сменить единицу', operationId: operationId('okk-unit-spoof') },
  }));
  await expectStatus('WORKER direct mutation denied', 403, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'worker-1', selectedFactoryId: factoryId,
    body: { quantity: 1, comment: 'Недоступная операция', operationId: operationId('worker-deny') },
  }));
  const blockedAccess = await db.userFactoryAccess.findFirst({
    where: { factoryId, isActive: true, isGuest: false, user: { blockedAt: { not: null } } },
    select: { userId: true },
  });
  if (!blockedAccess) throw new Error('No pre-existing blocked user is available for the security assertion');
  await expectStatus('blocked user direct mutation denied', 403, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: blockedAccess.userId, selectedFactoryId: factoryId,
    body: { quantity: 1, comment: 'Недоступная операция', operationId: operationId('blocked-deny') },
  }));
  const foreignAccess = await db.userFactoryAccess.findFirst({
    where: { userId: 'test-admin', isActive: true, factoryId: { not: factoryId } },
    select: { factoryId: true },
  });
  if (!foreignAccess) throw new Error('test-admin has no second factory access for cross-factory assertion');
  await expectStatus('cross-factory source mutation denied', [403, 409], request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-admin', selectedFactoryId: foreignAccess.factoryId,
    body: { quantity: 1, comment: 'Чужой завод', operationId: operationId('cross-factory-deny') },
  }));

  const realtime = await connect('test-okk', factoryId);
  okkSocket = realtime.ws;
  record('realtime client connected', realtime.connected, { connected: realtime.connected });
  const countsBeforeRelease = await moduleCounts();
  record('module summary available before release', countsBeforeRelease.response.status === 200, { status: countsBeforeRelease.response.status });

  const releaseStartedAt = Date.now();
  const okkRelease30 = await expectStatus('OKK release 30', 201, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: {
      quantity: 30,
      comment: '  Передано на переборку  ',
      operationId: operationId('okk-main-30'),
      actorId: 'worker-1',
      createdAt: '2000-01-01T00:00:00.000Z',
      remaining: 999,
      factoryId: foreignAccess.factoryId,
    },
  }));
  const firstOkkOperationId = okkRelease30.data?.operation?.id;
  const firstOkkOperation = firstOkkOperationId
    ? await db.quantityReleaseOperation.findUnique({ where: { id: firstOkkOperationId } })
    : null;
  record('OKK 52 -> 30 -> 22 is server-derived', okkRelease30.data?.operation?.quantityBefore === '52'
    && okkRelease30.data?.operation?.quantity === '30'
    && okkRelease30.data?.operation?.quantityAfter === '22'
    && firstOkkOperation?.actorId === 'test-okk'
    && firstOkkOperation?.factoryId === factoryId
    && firstOkkOperation.createdAt.getTime() >= releaseStartedAt - 1000
    && firstOkkOperation.comment === 'Передано на переборку', redact(okkRelease30.data));
  const okkDbAfter30 = await db.okkRecord.findUnique({ where: { id: okkMain.id }, select: { defectQuantity: true } });
  record('OKK original quantity stays immutable', okkDbAfter30?.defectQuantity === '52 гофры', okkDbAfter30);

  const realtimeEvent = await waitFor(realtime.messages, (event) => (
    event.type === 'quantity_release_updated' && event.payload?.id === firstOkkOperationId
  ));
  const committedWhenEmitted = realtimeEvent && firstOkkOperationId
    ? await db.quantityReleaseOperation.findUnique({ where: { id: firstOkkOperationId } })
    : null;
  record('realtime is emitted after committed operation exists', Boolean(realtimeEvent && committedWhenEmitted), redact(realtimeEvent));

  const countsAfterRelease = await moduleCounts();
  record('partial operation is not double-counted as a new case', countsAfterRelease.okk === countsBeforeRelease.okk
    && countsAfterRelease.returns === countsBeforeRelease.returns, {
    before: { okk: countsBeforeRelease.okk, returns: countsBeforeRelease.returns },
    after: { okk: countsAfterRelease.okk, returns: countsAfterRelease.returns },
  });

  const okkAfter30 = await okkRecord(okkMain.id);
  record('OKK public read model shows 52 / 30 / 22 and immutable history', okkAfter30.record?.quantitySummary?.original === '52'
    && okkAfter30.record?.quantitySummary?.released === '30'
    && okkAfter30.record?.quantitySummary?.remaining === '22'
    && okkAfter30.record?.releaseHistory?.length === 1
    && okkAfter30.record?.releaseHistory?.[0]?.comment === 'Передано на переборку'
    && !hasSensitivePublicData(okkAfter30.record), redact({ summary: okkAfter30.record?.quantitySummary, history: okkAfter30.record?.releaseHistory }));

  const okkRetry = await expectStatus('OKK duplicate operationId is idempotent', 201, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 30, comment: 'Передано на переборку', operationId: operationId('okk-main-30') },
  }));
  const okkCountAfterRetry = await db.quantityReleaseOperation.count({ where: { sourceType: 'OKK', sourceId: okkMain.id } });
  record('OKK retry creates no second operation', okkRetry.data?.idempotent === true && okkCountAfterRetry === 1, { idempotent: okkRetry.data?.idempotent, count: okkCountAfterRetry });
  await expectStatus('OKK original edit after release denied', 409, request('PATCH', `/okk/${okkMain.id}`, {
    userId: 'test-okk', selectedFactoryId: factoryId, body: { defectQuantity: '99 гофры' },
  }));

  const okkArchiveOp = await request('GET', `/archive/items?section=okk&status=PARTIAL_RELEASE&pageSize=100&search=${encodeURIComponent(`Контрольная партия ${shortRun} main`)}`, {
    userId: 'test-management', selectedFactoryId: factoryId,
  });
  record('OKK partial operation is visible in archive without parent duplication', okkArchiveOp.status === 200
    && okkArchiveOp.data?.items?.length === 1
    && okkArchiveOp.data.items[0]?.sourceType === 'QUANTITY_RELEASE_OPERATION'
    && okkArchiveOp.data.items[0]?.status === 'PARTIAL_RELEASE', redact(okkArchiveOp.data));

  await expectStatus('OKK release 10', 201, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 10, comment: 'Дополнительная переборка', operationId: operationId('okk-main-10') },
  }));
  const okkAfter10 = await okkRecord(okkMain.id);
  record('OKK sequential release leaves 12', okkAfter10.record?.quantitySummary?.remaining === '12'
    && okkAfter10.record?.quantitySummary?.released === '40'
    && okkAfter10.record?.releaseHistory?.length === 2, redact(okkAfter10.record?.quantitySummary));
  await expectStatus('OKK release full remainder 12', 201, request('POST', `/okk/${okkMain.id}/partial-release`, {
    userId: 'test-okk', selectedFactoryId: factoryId,
    body: { quantity: 12, comment: 'Выдан остаток', operationId: operationId('okk-main-12') },
  }));
  const okkClosed = await okkRecord(okkMain.id);
  record('OKK full release archives parent and preserves full history', okkClosed.record?.status === 'ARCHIVED'
    && Boolean(okkClosed.record?.archivedAt)
    && Boolean(okkClosed.record?.deletedAt)
    && okkClosed.record?.quantitySummary?.original === '52'
    && okkClosed.record?.quantitySummary?.released === '52'
    && okkClosed.record?.quantitySummary?.remaining === '0'
    && okkClosed.record?.releaseHistory?.length === 3, redact({ status: okkClosed.record?.status, summary: okkClosed.record?.quantitySummary }));
  const okkActiveAfterFull = await request('GET', '/okk', { userId: 'test-okk', selectedFactoryId: factoryId });
  record('fully released OKK parent is absent from active list', okkActiveAfterFull.status === 200
    && !okkActiveAfterFull.data?.some?.((item) => item.id === okkMain.id));

  const concurrentResults = await Promise.all([
    request('POST', `/okk/${okkConcurrent.id}/partial-release`, {
      userId: 'test-okk', selectedFactoryId: factoryId,
      body: { quantity: 30, comment: 'Параллельная выдача А', operationId: operationId('okk-concurrent-a') },
    }),
    request('POST', `/okk/${okkConcurrent.id}/partial-release`, {
      userId: 'test-okk', selectedFactoryId: factoryId,
      body: { quantity: 30, comment: 'Параллельная выдача Б', operationId: operationId('okk-concurrent-b') },
    }),
  ]);
  const concurrentStatuses = concurrentResults.map((item) => item.status).sort((a, b) => a - b);
  const concurrentRecord = await okkRecord(okkConcurrent.id);
  const concurrentOperationCount = await db.quantityReleaseOperation.count({ where: { sourceType: 'OKK', sourceId: okkConcurrent.id } });
  record('concurrent 30 + 30 is atomic with one conflict', concurrentStatuses.join(',') === '201,409'
    && concurrentOperationCount === 1
    && concurrentRecord.record?.quantitySummary?.remaining === '22'
    && Number(concurrentRecord.record?.quantitySummary?.remaining) >= 0, {
    statuses: concurrentStatuses,
    operationCount: concurrentOperationCount,
    remaining: concurrentRecord.record?.quantitySummary?.remaining,
  });

  await expectStatus('Return over-release denied', 409, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: 'test-store', selectedFactoryId: factoryId,
    body: { quantity: 53, comment: 'Количество превышает остаток', operationId: operationId('return-over') },
  }));
  await expectStatus('Return comment required', 409, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: 'test-store', selectedFactoryId: factoryId,
    body: { quantity: 1, comment: '', operationId: operationId('return-empty-comment') },
  }));
  const returnRelease30 = await expectStatus('Return release 30', 201, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: 'test-store', selectedFactoryId: factoryId,
    body: { quantity: 30, comment: 'Выдано производству', operationId: operationId('return-main-30') },
  }));
  const returnDbAfter30 = await db.returnRecord.findUnique({ where: { id: returnMain.id }, select: { quantity: true, unit: true } });
  const returnAfter30 = await returnRecord(returnMain.id);
  record('Return 52 -> 30 -> 22 preserves original and history', returnDbAfter30?.quantity === 52
    && returnDbAfter30?.unit === 'гофры'
    && returnAfter30.record?.quantitySummary?.original === '52'
    && returnAfter30.record?.quantitySummary?.released === '30'
    && returnAfter30.record?.quantitySummary?.remaining === '22'
    && returnAfter30.record?.releaseHistory?.length === 1
    && returnAfter30.record?.releaseHistory?.[0]?.comment === 'Выдано производству'
    && !hasSensitivePublicData(returnAfter30.record), redact({ summary: returnAfter30.record?.quantitySummary, history: returnAfter30.record?.releaseHistory }));
  const returnRetry = await expectStatus('Return duplicate operationId is idempotent', 201, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: 'test-store', selectedFactoryId: factoryId,
    body: { quantity: 30, comment: 'Выдано производству', operationId: operationId('return-main-30') },
  }));
  const returnCountAfterRetry = await db.quantityReleaseOperation.count({ where: { sourceType: 'RETURN', sourceId: returnMain.id } });
  record('Return retry creates no second operation', returnRetry.data?.idempotent === true && returnCountAfterRetry === 1, { idempotent: returnRetry.data?.idempotent, count: returnCountAfterRetry });
  await expectStatus('Return original edit after release denied', 409, request('PATCH', `/returns/${returnMain.id}`, {
    userId: 'test-store', selectedFactoryId: factoryId, body: { quantity: 99 },
  }));
  const returnArchiveOp = await request('GET', `/archive/items?section=returns&status=PARTIAL_RELEASE&pageSize=100&search=${encodeURIComponent(`Возврат партии ${shortRun} main`)}`, {
    userId: 'test-management', selectedFactoryId: factoryId,
  });
  record('Return partial operation is visible in archive without parent duplication', returnArchiveOp.status === 200
    && returnArchiveOp.data?.items?.length === 1
    && returnArchiveOp.data.items[0]?.sourceType === 'QUANTITY_RELEASE_OPERATION'
    && returnArchiveOp.data.items[0]?.status === 'PARTIAL_RELEASE', redact(returnArchiveOp.data));
  await expectStatus('Return full remainder 22', 201, request('POST', `/returns/${returnMain.id}/partial-release`, {
    userId: 'test-store', selectedFactoryId: factoryId,
    body: { quantity: 22, comment: 'Выдан остаток возврата', operationId: operationId('return-main-22') },
  }));
  const returnClosed = await returnRecord(returnMain.id);
  record('Return full release archives parent and preserves history', returnClosed.record?.status === 'ARCHIVED'
    && Boolean(returnClosed.record?.archivedAt)
    && Boolean(returnClosed.record?.deletedAt)
    && returnClosed.record?.quantitySummary?.original === '52'
    && returnClosed.record?.quantitySummary?.released === '52'
    && returnClosed.record?.quantitySummary?.remaining === '0'
    && returnClosed.record?.releaseHistory?.length === 2, redact({ status: returnClosed.record?.status, summary: returnClosed.record?.quantitySummary }));
  const returnActiveAfterFull = await request('GET', '/returns', { userId: 'test-store', selectedFactoryId: factoryId });
  record('fully released Return parent is absent from active list', returnActiveAfterFull.status === 200
    && !returnActiveAfterFull.data?.some?.((item) => item.id === returnMain.id));

  const operations = await db.quantityReleaseOperation.findMany({
    where: { operationId: { startsWith: marker } },
    select: { id: true, sourceType: true, sourceId: true, quantity: true, quantityBefore: true, quantityAfter: true, comment: true, actorId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  artifacts.partialOperationIds = operations.map((item) => item.id);
  record('all successful releases are immutable ledger operations', operations.length === 6, { count: operations.length });
  const audits = await db.auditLog.findMany({
    where: {
      entityId: { in: [...artifacts.okkRecordIds, ...artifacts.returnRecordIds] },
      action: { in: ['OKK_QUANTITY_PARTIALLY_RELEASED', 'RETURN_QUANTITY_PARTIALLY_RELEASED'] },
    },
    select: { action: true, entityId: true, details: true, createdAt: true },
  });
  artifacts.auditActions = [...new Set(audits.map((item) => item.action))];
  record('audit records before/released/after/comment for each successful operation', audits.length === operations.length
    && audits.every((item) => {
      const details = item.details ?? {};
      return details.actionLabel === 'Выдана часть продукции'
        && details.quantityBefore !== undefined
        && details.releasedQuantity !== undefined
        && details.quantityAfter !== undefined
        && String(details.comment ?? '').trim();
    }), { auditCount: audits.length, operationCount: operations.length, actions: artifacts.auditActions });

  const legacyAfter = await archiveFingerprint(artifacts.okkRecordIds, artifacts.returnRecordIds);
  record('pre-existing archived OKK and Return records are unchanged', legacyAfter === legacyBefore, {
    fingerprintStable: legacyAfter === legacyBefore,
  });
}

async function cleanup() {
  for (const id of artifacts.okkRecordIds) {
    const current = await db.okkRecord.findUnique({ where: { id }, select: { archivedAt: true, deletedAt: true } });
    if (current && !current.archivedAt && !current.deletedAt) {
      await request('POST', `/okk/${id}/archive`, { userId: 'test-okk', selectedFactoryId: factoryId, body: {} });
    }
  }
  for (const id of artifacts.returnRecordIds) {
    const current = await db.returnRecord.findUnique({ where: { id }, select: { archivedAt: true, deletedAt: true } });
    if (current && !current.archivedAt && !current.deletedAt) {
      await request('POST', `/returns/${id}/archive`, { userId: 'test-store', selectedFactoryId: factoryId, body: {} });
    }
  }

  const [activeOkk, activeReturns, operationRows] = await Promise.all([
    artifacts.okkRecordIds.length ? db.okkRecord.count({
      where: { id: { in: artifacts.okkRecordIds }, deletedAt: null, archivedAt: null },
    }) : 0,
    artifacts.returnRecordIds.length ? db.returnRecord.count({
      where: { id: { in: artifacts.returnRecordIds }, deletedAt: null, archivedAt: null },
    }) : 0,
    db.quantityReleaseOperation.findMany({
      where: { operationId: { startsWith: marker } },
      include: {
        okkRecord: { select: { archivedAt: true, deletedAt: true } },
        returnRecord: { select: { archivedAt: true, deletedAt: true } },
      },
    }),
  ]);
  const activeOperations = operationRows.filter((operation) => {
    const parent = operation.okkRecord ?? operation.returnRecord;
    return parent && !parent.archivedAt && !parent.deletedAt;
  }).length;
  artifacts.partialOperationIds = operationRows.map((item) => item.id);
  artifacts.cleanup = {
    activeTestOkkRecords: activeOkk,
    activeTestReturnRecords: activeReturns,
    activeTestPartialOperations: activeOperations,
    preexistingEntitiesDeleted: 0,
    strategy: 'existing archive endpoints; immutable ledger and audit retained',
  };
  record('cleanup leaves no active OKK test records', activeOkk === 0, artifacts.cleanup);
  record('cleanup leaves no active Return test records', activeReturns === 0, artifacts.cleanup);
  record('cleanup leaves no partial operation attached to an active test parent', activeOperations === 0, artifacts.cleanup);
  record('cleanup physically deletes no pre-existing entity', artifacts.cleanup.preexistingEntitiesDeleted === 0, artifacts.cleanup);
}

async function writeEvidence() {
  const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast6');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    runId: artifacts.runId,
    marker: artifacts.marker,
    status: failures.length ? 'FAIL' : 'PASS',
    testRecords: {
      okk: artifacts.okkRecordIds.map((id) => ({ id, finalState: 'ARCHIVED' })),
      returns: artifacts.returnRecordIds.map((id) => ({ id, finalState: 'ARCHIVED' })),
    },
    partialOperationIds: artifacts.partialOperationIds,
    auditActions: artifacts.auditActions,
    cleanup: artifacts.cleanup,
    checks: {
      passed: passed.map((item) => item.name),
      failed: failures.map((item) => item.name),
    },
  };
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

main()
  .catch((error) => failures.push({ name: 'runner error', detail: error instanceof Error ? error.stack : String(error) }))
  .finally(async () => {
    try { if (okkSocket) okkSocket.close(); } catch {}
    try { await cleanup(); } catch (error) { failures.push({ name: 'cleanup error', detail: error instanceof Error ? error.stack : String(error) }); }
    try { await writeEvidence(); } catch (error) { failures.push({ name: 'evidence write error', detail: error instanceof Error ? error.stack : String(error) }); }
    await db.$disconnect();
    console.log(JSON.stringify({ marker, passed, failures, artifacts }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  });
