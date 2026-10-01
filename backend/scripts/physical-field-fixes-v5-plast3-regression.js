const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { NestFactory } = require('@nestjs/core');
const { AssignmentKind, EmployeeState, LineStatus, PrismaClient, WashStatus } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { WashService } = require('../dist/modules/wash/wash.service');
const { hashPassword } = require('../dist/common/password');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const WS_API = API.replace(/^http/i, 'ws');
const db = new PrismaClient();
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const marker = `__PFFV5_P3_${runId}__`;
const passed = [];
const failed = [];
const ids = { factoryId: null, otherFactoryId: null, userIds: [], lineIds: [] };
const authTokens = new Map();

function record(name, condition, detail) {
  (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}: ${name}\n`);
}

function accepted(response, statuses = [200, 201]) {
  return statuses.includes(response?.status);
}

async function request(method, route, userId, factoryId, body) {
  const token = userId ? authTokens.get(userId) : null;
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Connection: 'close',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function createUser(factoryId, role, label, diagnostic = true) {
  const id = diagnostic ? `test-pffv5-p3-${label}-${runId}` : crypto.randomUUID();
  const password = crypto.randomBytes(18).toString('base64url');
  const phone = `+7999${String(Date.now() + ids.userIds.length).slice(-7)}`;
  await db.user.create({
    data: {
      id,
      factoryId,
      role,
      phone,
      normalizedPhone: phone,
      passwordHash: hashPassword(password),
      employeeState: EmployeeState.AVAILABLE,
    },
  });
  await db.userFactoryAccess.create({ data: { userId: id, factoryId, role, isGuest: false, isActive: true } });
  const login = await request('POST', '/auth/login', null, null, { phone, password });
  const token = login.data?.accessToken ?? login.data?.token;
  if (login.status !== 201 || !token) throw new Error(`Bearer login failed for ${label} (${login.status})`);
  authTokens.set(id, token);
  ids.userIds.push(id);
  return id;
}

async function createLine(factoryId, label, status = LineStatus.STOP) {
  const line = await db.line.create({ data: { factoryId, name: `${label} ${Date.now()} ${ids.lineIds.length + 1}`, status } });
  ids.lineIds.push(line.id);
  return line;
}

async function waitForCommittedEvent(userId, factoryId, type, action) {
  return new Promise((resolve, reject) => {
    const token = authTokens.get(userId);
    const socket = new WebSocket(`${WS_API}/ws?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    let actionPromise = null;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket ${type} timeout`));
    }, 12_000);
    socket.on('open', () => { actionPromise = Promise.resolve().then(action); });
    socket.on('message', async (raw) => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type !== type || event.payload?.factoryId !== factoryId) return;
        const actionResult = actionPromise ? await actionPromise : null;
        clearTimeout(timer);
        socket.close();
        resolve({ event, actionResult });
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

async function cleanup() {
  const now = new Date();
  for (const factoryId of [ids.factoryId, ids.otherFactoryId].filter(Boolean)) {
    await db.assignment.updateMany({ where: { factoryId, endedAt: null }, data: { endedAt: now, comment: `${marker} штатное завершение` } });
    await db.washSession.updateMany({ where: { factoryId, status: { not: WashStatus.DONE } }, data: { status: WashStatus.DONE, completedAt: now, version: { increment: 1 } } });
    await db.defrostEvent.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endAt: now, durationSeconds: 0 } });
    await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
    await db.userFactoryAccess.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
    await db.factory.updateMany({ where: { id: factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  }
  if (ids.userIds.length) {
    await db.user.updateMany({
      where: { id: { in: ids.userIds }, deletedAt: null },
      data: { blockedAt: now, deletedAt: now, employeeState: EmployeeState.OFF_SHIFT },
    });
  }
}

async function activeArtifacts() {
  if (!ids.factoryId) return { factories: 0, lines: 0, washes: 0, assignments: 0, defrosts: 0, accesses: 0 };
  const [factories, lines, washes, assignments, defrosts, accesses] = await Promise.all([
    db.factory.count({ where: { id: ids.factoryId, isActive: true } }),
    db.line.count({ where: { factoryId: ids.factoryId, deactivatedAt: null } }),
    db.washSession.count({ where: { factoryId: ids.factoryId, status: { not: WashStatus.DONE } } }),
    db.assignment.count({ where: { factoryId: ids.factoryId, endedAt: null } }),
    db.defrostEvent.count({ where: { factoryId: ids.factoryId, status: 'ACTIVE' } }),
    db.userFactoryAccess.count({ where: { factoryId: ids.factoryId, isActive: true } }),
  ]);
  return { factories, lines, washes, assignments, defrosts, accesses };
}

async function main() {
  const health = await fetch(`${API}/health`, { headers: { Connection: 'close' } }).then((response) => response.json()).catch(() => null);
  record('Свежий backend отвечает на /health', health?.status === 'ok');
  if (health?.status !== 'ok') throw new Error('Backend health недоступен');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const washService = app.get(WashService);
    const factory = await db.factory.create({ data: { code: `pffv5-p3-${runId}`, name: `${marker} Мойка и оттайка`, isActive: true } });
    const otherFactory = await db.factory.create({ data: { code: `pffv5-p3-other-${runId}`, name: `${marker} Чужой завод`, isActive: true } });
    ids.factoryId = factory.id;
    ids.otherFactoryId = otherFactory.id;
    const masterId = await createUser(factory.id, 'MASTER', 'master');
    const workerId = await createUser(factory.id, 'WORKER', 'worker');
    const coldId = await createUser(factory.id, 'TECH_HOLOD', 'cold');
    const ambiguousActorId = await createUser(factory.id, 'MASTER', 'neutral', false);

    const washLine = await createLine(factory.id, 'Санитарная линия');
    const oldLineAssignment = await db.assignment.create({
      data: { factoryId: factory.id, lineId: washLine.id, userId: workerId, kind: AssignmentKind.LINE, startedById: masterId },
    });
    await db.user.update({ where: { id: workerId }, data: { employeeState: EmployeeState.WORKING } });
    const startBefore = Date.now();
    const start = await request('POST', '/wash/start', masterId, factory.id, { lineId: washLine.id, operationId: `${marker}-wash-start` });
    const startAfter = Date.now();
    record('MASTER запускает мойку', accepted(start) && Boolean(start.data?.id), { status: start.status });
    const duplicate = await request('POST', '/wash/start', masterId, factory.id, { lineId: washLine.id, operationId: `${marker}-wash-duplicate` });
    record('Вторая active WashSession на линии запрещена', duplicate.status === 409, { status: duplicate.status });
    const assign = await request('POST', '/assignments/wash', masterId, factory.id, {
      targetUserId: workerId,
      washSessionId: start.data?.id,
      sourceAssignmentId: oldLineAssignment.id,
      operationId: `${marker}-wash-assign`,
    });
    record('Участник назначается через canonical Assignment WASH', accepted(assign) && assign.data?.kind === AssignmentKind.WASH, { status: assign.status });

    const [lineList, washList, detail] = await Promise.all([
      request('GET', '/lines', masterId, factory.id),
      request('GET', '/wash?includeCompleted=true&includeDiagnostics=true', masterId, factory.id),
      request('GET', `/wash/${start.data?.id}`, masterId, factory.id),
    ]);
    const lineRead = Array.isArray(lineList.data) ? lineList.data.find((item) => item.id === washLine.id) : null;
    const washRead = Array.isArray(washList.data) ? washList.data.find((item) => item.id === start.data?.id) : null;
    const startedAtMs = new Date(detail.data?.startedAt).getTime();
    record('LineService, WashService и detail видят одну active мойку', lineRead?.operationalState === 'WASH' && lineRead?.activeWash?.id === start.data?.id && washRead?.id === detail.data?.id && detail.data?.active === true);
    record('Wash duration использует server start и serverNow', detail.data?.startedAt === detail.data?.createdAt && Number.isFinite(startedAtMs) && startedAtMs >= startBefore - 2_000 && startedAtMs <= startAfter + 2_000 && new Date(detail.data?.serverNow).getTime() >= startedAtMs && detail.data?.durationSeconds >= 0);
    record('Участник виден в detail до завершения', detail.data?.participants?.some((item) => item.userId === workerId));

    const workerDenied = await request('POST', '/wash/start', workerId, factory.id, { lineId: washLine.id, operationId: `${marker}-worker-denied` });
    const otherLine = await createLine(otherFactory.id, 'Чужая санитарная линия');
    const crossFactory = await request('POST', '/wash/start', masterId, factory.id, { lineId: otherLine.id, operationId: `${marker}-cross-factory` });
    record('WORKER mutation запрещена backend', workerDenied.status === 403, { status: workerDenied.status });
    record('Cross-factory wash mutation запрещена', [403, 409].includes(crossFactory.status), { status: crossFactory.status });

    const completeEvent = await waitForCommittedEvent(masterId, factory.id, 'wash_updated', () => request('POST', `/wash/${start.data?.id}/complete`, masterId, factory.id, { operationId: `${marker}-wash-complete` }));
    const committedSession = await db.washSession.findUnique({ where: { id: start.data?.id } });
    record('WASH realtime публикуется после commit', accepted(completeEvent.actionResult) && committedSession?.status === WashStatus.DONE, { status: completeEvent.actionResult?.status });
    const repeatComplete = await request('POST', `/wash/${start.data?.id}/complete`, masterId, factory.id, { operationId: `${marker}-wash-complete-repeat` });
    const [assignmentRows, completedDetail, lineAfter] = await Promise.all([
      db.assignment.findMany({ where: { factoryId: factory.id, userId: workerId }, orderBy: { startedAt: 'asc' } }),
      request('GET', `/wash/${start.data?.id}`, masterId, factory.id),
      request('GET', '/lines', masterId, factory.id),
    ]);
    const activeWorkerAssignments = assignmentRows.filter((item) => !item.endedAt);
    const afterLineRead = Array.isArray(lineAfter.data) ? lineAfter.data.find((item) => item.id === washLine.id) : null;
    record('Completion закрывает active session и WASH assignments', committedSession?.status === WashStatus.DONE && assignmentRows.some((item) => item.kind === AssignmentKind.WASH && item.endedAt) && activeWorkerAssignments.length === 0);
    record('Participant history сохраняется, old LINE не resurrect', completedDetail.data?.participantsHistory?.some((item) => item.userId === workerId && item.endedAt) && Boolean(assignmentRows.find((item) => item.id === oldLineAssignment.id)?.endedAt) && activeWorkerAssignments.length === 0);
    record('Повторное завершение идемпотентно', accepted(repeatComplete) && completedDetail.data?.events?.filter((item) => item.type === 'COMPLETE').length === 1);
    record('После мойки линия не запускается автоматически', afterLineRead?.operationalState !== 'WASH' && afterLineRead?.status === LineStatus.STOP);

    const legacyLine = await createLine(factory.id, 'Линия безопасной сверки');
    const legacyOne = await db.washSession.create({ data: { factoryId: factory.id, lineId: legacyLine.id, startedById: masterId, status: WashStatus.REVIEW, createdAt: new Date(Date.now() - 72 * 3_600_000) } });
    const legacyTwo = await db.washSession.create({ data: { factoryId: factory.id, lineId: legacyLine.id, startedById: masterId, status: WashStatus.IN_PROGRESS, createdAt: new Date(Date.now() - 70 * 3_600_000) } });
    await db.washMessage.create({ data: { washSessionId: legacyOne.id, userId: masterId, message: `${marker} комментарий сохранения` } });
    await db.washIssue.create({ data: { factoryId: factory.id, washSessionId: legacyOne.id, createdById: masterId, message: `${marker} проблема`, title: `${marker} проблема` } });
    await db.washControlItem.create({ data: { factoryId: factory.id, washSessionId: legacyOne.id, lineId: legacyLine.id, createdById: masterId, title: `${marker} задание` } });
    await db.washEvent.create({ data: { factoryId: factory.id, washSessionId: legacyOne.id, actorId: masterId, type: 'START', text: `${marker} начало` } });
    const ambiguousLine = await createLine(factory.id, 'Нейтральная линия архива');
    const ambiguous = await db.washSession.create({ data: { factoryId: factory.id, lineId: ambiguousLine.id, startedById: ambiguousActorId, createdAt: new Date(Date.now() - 96 * 3_600_000) } });
    const childrenBefore = await Promise.all([
      db.washMessage.count({ where: { washSessionId: legacyOne.id } }),
      db.washIssue.count({ where: { washSessionId: legacyOne.id } }),
      db.washControlItem.count({ where: { washSessionId: legacyOne.id } }),
      db.washEvent.count({ where: { washSessionId: legacyOne.id } }),
    ]);
    const dryBeforeStatuses = await db.washSession.findMany({ where: { id: { in: [legacyOne.id, legacyTwo.id, ambiguous.id] } }, select: { id: true, status: true, version: true } });
    const dryRun = await washService.reconcileLegacyTestSessions(factory.id, { apply: false });
    const dryAfterStatuses = await db.washSession.findMany({ where: { id: { in: [legacyOne.id, legacyTwo.id, ambiguous.id] } }, select: { id: true, status: true, version: true } });
    record('Reconciliation dry-run ничего не меняет', JSON.stringify(dryBeforeStatuses) === JSON.stringify(dryAfterStatuses) && dryRun.mutations.sessionsClosed === 0 && dryRun.counts.provenTest === 2 && dryRun.counts.possibleRealUserData === 1);
    record('Duplicate legacy conflict классифицируется явно', dryRun.counts.dataConflictGroups === 1 && dryRun.counts.dataConflictSessions === 2);
    const apply = await washService.reconcileLegacyTestSessions(factory.id, { apply: true });
    const [legacyRows, childrenAfter, auditCount] = await Promise.all([
      db.washSession.findMany({ where: { id: { in: [legacyOne.id, legacyTwo.id, ambiguous.id] } }, select: { id: true, status: true, completedAt: true } }),
      Promise.all([
        db.washMessage.count({ where: { washSessionId: legacyOne.id } }),
        db.washIssue.count({ where: { washSessionId: legacyOne.id } }),
        db.washControlItem.count({ where: { washSessionId: legacyOne.id } }),
        db.washEvent.count({ where: { washSessionId: legacyOne.id, type: 'START' } }),
      ]),
      db.auditLog.count({ where: { factoryId: factory.id, action: 'PFFV5_P3_LEGACY_TEST_RECONCILIATION', entityId: { in: [legacyOne.id, legacyTwo.id] } } }),
    ]);
    record('PROVEN_TEST закрывается штатно с audit reason', apply.mutations.sessionsClosed === 2 && legacyRows.filter((item) => item.id !== ambiguous.id).every((item) => item.status === WashStatus.DONE && item.completedAt) && auditCount === 2);
    record('POSSIBLE_REAL_USER_DATA автоматически не меняется', legacyRows.find((item) => item.id === ambiguous.id)?.status !== WashStatus.DONE && apply.counts.possibleRealUserData === 1);
    record('Комментарии, проблемы, задания и исходная история сохранены', JSON.stringify(childrenBefore) === JSON.stringify(childrenAfter));
    record('Reconciliation не выполняет physical delete', apply.mutations.physicalDeletes === 0);
    const secondApply = await washService.reconcileLegacyTestSessions(factory.id, { apply: true });
    record('Повтор reconciliation идемпотентен', secondApply.mutations.sessionsClosed === 0 && secondApply.mutations.assignmentsClosed === 0);

    const runLine = await createLine(factory.id, 'Линия текущего запуска', LineStatus.WORK);
    const currentRunStartedAt = new Date(Date.now() - 35 * 60_000);
    await db.lineEvent.create({ data: { factoryId: factory.id, lineId: runLine.id, createdById: masterId, status: LineStatus.WORK, comment: `${marker} текущий запуск`, createdAt: currentRunStartedAt } });
    await db.defrostEvent.create({
      data: {
        factoryId: factory.id,
        lineId: runLine.id,
        startedById: coldId,
        endedById: coldId,
        startAt: new Date(Date.now() - 8 * 86_400_000),
        endAt: new Date(Date.now() - 8 * 86_400_000 + 40 * 60_000),
        durationSeconds: 2_400,
        status: 'COMPLETED',
      },
    });
    const defrostLines = await request('GET', '/defrost/lines?includeDiagnostics=true', coldId, factory.id);
    const runLineRead = Array.isArray(defrostLines.data) ? defrostLines.data.find((item) => item.id === runLine.id) : null;
    record('Defrost current run берётся из canonical LineService', accepted(defrostLines) && new Date(runLineRead?.currentRunStartedAt).getTime() === currentRunStartedAt.getTime() && runLineRead?.activeEvent === null);
    record('Завершённая старая оттайка не становится active duration', runLineRead?.activeEvent === null && runLineRead?.currentRunDataStatus === 'AVAILABLE');

    const defrostLine = await createLine(factory.id, 'Линия серверной оттайки');
    const defrostBefore = Date.now();
    const defrostStart = await request('POST', `/defrost/lines/${defrostLine.id}/start-today`, coldId, factory.id, { comment: marker, startAt: '2000-01-01T00:00:00.000Z', operationId: `${marker}-defrost-start` });
    const defrostAfter = Date.now();
    const defrostStartMs = new Date(defrostStart.data?.startAt).getTime();
    record('Defrost start использует server time', accepted(defrostStart) && defrostStartMs >= defrostBefore - 2_000 && defrostStartMs <= defrostAfter + 2_000);
    const defrostDuplicate = await request('POST', `/defrost/lines/${defrostLine.id}/start-today`, coldId, factory.id, { comment: marker, operationId: `${marker}-defrost-start` });
    record('Defrost start operationId идемпотентен', accepted(defrostDuplicate) && defrostDuplicate.data?.id === defrostStart.data?.id);
    const completeBefore = Date.now();
    const defrostComplete = await request('POST', `/defrost/lines/${defrostLine.id}/complete-today`, coldId, factory.id, { comment: marker, endAt: '2000-01-01T00:00:00.000Z', operationId: `${marker}-defrost-complete` });
    const completeAfter = Date.now();
    const completedAtMs = new Date(defrostComplete.data?.endAt).getTime();
    record('Defrost completion использует server time и duration одной сессии', accepted(defrostComplete) && completedAtMs >= completeBefore - 2_000 && completedAtMs <= completeAfter + 2_000 && defrostComplete.data?.durationSeconds >= 0);
    const completedLines = await request('GET', '/defrost/lines?includeDiagnostics=true', coldId, factory.id);
    const completedLineRead = Array.isArray(completedLines.data) ? completedLines.data.find((item) => item.id === defrostLine.id) : null;
    record('Завершённая оттайка отсутствует в activeEvent', completedLineRead?.activeEvent === null);
    const workerDefrostDenied = await request('POST', `/defrost/lines/${defrostLine.id}/start-today`, workerId, factory.id, { operationId: `${marker}-worker-defrost-denied` });
    const crossFactoryDefrost = await request('POST', `/defrost/lines/${otherLine.id}/start-today`, coldId, factory.id, { operationId: `${marker}-cross-defrost` });
    record('WORKER не может менять оттайку', workerDefrostDenied.status === 403, { status: workerDefrostDenied.status });
    record('Defrost cross-factory mutation запрещена', [403, 409].includes(crossFactoryDefrost.status), { status: crossFactoryDefrost.status });

    const safePayload = JSON.stringify({ lineRead, washRead, detail: detail.data, defrostLines: defrostLines.data });
    record('Публичные read-model не содержат storagePath/secrets', !/(storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+|secret\s*[:=])/i.test(safePayload));
  } finally {
    await app.close();
  }
}

main()
  .catch((error) => {
    failed.push({ name: 'Plast 3 regression crashed', detail: error instanceof Error ? error.stack : String(error) });
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  })
  .finally(async () => {
    await cleanup().catch((error) => failed.push({ name: 'Cleanup failed', detail: String(error) }));
    const remaining = await activeArtifacts().catch(() => ({ factories: -1, lines: -1, washes: -1, assignments: -1, defrosts: -1, accesses: -1 }));
    record('Test artifacts active remaining = 0', Object.values(remaining).every((value) => value === 0), remaining);
    await db.$disconnect();
    process.stdout.write(`${JSON.stringify({ runId, marker, passed: passed.length, failed: failed.length, remaining, results: { passed, failed } }, null, 2)}\n`);
    if (failed.length) process.exitCode = 1;
  });
