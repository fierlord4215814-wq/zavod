const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { PrismaClient, AssignmentKind, EmployeeState, LineStatus, ShiftType } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'node',
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
});

const {
  addFactoryShifts,
  factoryShiftDate,
  factoryShiftTarget,
  factoryShiftWindow,
} = require('../src/common/shift-time.ts');

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const WS_API = API.replace(/^http/i, 'ws');
const db = new PrismaClient();
const passed = [];
const failed = [];
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const marker = `__PFFV5_P1_${runId}__`;
const ids = {
  factoryId: null,
  otherFactoryId: null,
  departmentId: null,
  userIds: [],
  lineIds: [],
};

function record(name, condition, detail) {
  (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function safePayload(value) {
  return !/(storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+|secret\s*[:=])/i
    .test(JSON.stringify(value ?? {}));
}

async function request(method, route, userId, factoryId, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function createUser(factoryId, departmentId, role, suffix, employeeState = EmployeeState.AVAILABLE) {
  const id = `test-pffv5-p1-${suffix}-${runId}`;
  await db.user.create({ data: { id, factoryId, role, employeeState } });
  await db.userFactoryAccess.create({
    data: { userId: id, factoryId, departmentId, role, isGuest: false, isActive: true },
  });
  ids.userIds.push(id);
  return id;
}

async function createLine(factoryId, name, status = LineStatus.STOP, createdAt) {
  const line = await db.line.create({ data: { factoryId, name: `${marker} ${name}`, status, ...(createdAt ? { createdAt } : {}) } });
  ids.lineIds.push(line.id);
  return line;
}

async function createComposition(factoryId, lineId, actorId, requiredCount, target = factoryShiftTarget()) {
  const position = await db.linePosition.create({
    data: { factoryId, lineId, name: 'Оператор', displayName: 'Оператор', sortOrder: 1 },
  });
  const template = await db.lineStaffingTemplate.create({
    data: { factoryId, lineId, name: `${marker} Основной состав` },
  });
  await db.lineStaffingTemplateItem.create({
    data: {
      templateId: template.id,
      positionId: position.id,
      requiredCount,
      plannedCount: requiredCount,
      minRequired: requiredCount,
      maxRequired: requiredCount,
      sortOrder: 1,
    },
  });
  const plan = await db.lineShiftWorkPlan.create({
    data: {
      factoryId,
      lineId,
      staffingTemplateId: template.id,
      shiftDate: factoryShiftDate(target),
      shiftType: target.shiftType,
      createdById: actorId,
    },
  });
  return { position, template, plan };
}

function coreState(value) {
  const line = value?.line ?? value;
  return {
    lineId: line?.lineId ?? line?.id,
    factoryId: line?.factoryId,
    productionShiftId: line?.productionShiftId,
    operationalState: line?.operationalState,
    assignedCount: Number(line?.assignedCount ?? 0),
    requiredCount: Number(line?.requiredCount ?? 0),
    compositionId: line?.selectedComposition?.id ?? line?.activeTemplate?.id ?? null,
  };
}

async function waitForCommittedLineEvent(userId, factoryId, lineId, action) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_API}/ws?userId=${encodeURIComponent(userId)}&factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1']);
    let actionResult = null;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket line_updated timeout'));
    }, 12_000);
    socket.on('open', async () => {
      try {
        actionResult = await action();
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.on('message', async (raw) => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type !== 'line_updated') return;
        const dashboard = await request('GET', `/lines/${lineId}/dashboard`, userId, factoryId);
        clearTimeout(timer);
        socket.close();
        resolve({ event, dashboard, actionResult });
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
  if (ids.factoryId) {
    await db.assignment.updateMany({
      where: { factoryId: ids.factoryId, endedAt: null },
      data: { endedAt: now, comment: `${marker} штатное завершение проверки` },
    });
    await db.washSession.updateMany({
      where: { factoryId: ids.factoryId, status: { not: 'DONE' } },
      data: { status: 'DONE', completedAt: now },
    });
    await db.defrostEvent.updateMany({
      where: { factoryId: ids.factoryId, status: 'ACTIVE' },
      data: { status: 'COMPLETED', endAt: now, durationSeconds: 0 },
    });
    await db.lineEvent.updateMany({
      where: { factoryId: ids.factoryId, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null },
      data: { confirmedEndAt: now },
    });
    await db.line.updateMany({
      where: { factoryId: ids.factoryId, deactivatedAt: null },
      data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` },
    });
    await db.userFactoryAccess.updateMany({
      where: { factoryId: ids.factoryId, isActive: true },
      data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` },
    });
    await db.factory.updateMany({
      where: { id: ids.factoryId, isActive: true },
      data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` },
    });
  }
  if (ids.otherFactoryId) {
    await db.line.updateMany({
      where: { factoryId: ids.otherFactoryId, deactivatedAt: null },
      data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` },
    });
    await db.factory.updateMany({
      where: { id: ids.otherFactoryId, isActive: true },
      data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` },
    });
  }
  if (ids.userIds.length) {
    await db.user.updateMany({
      where: { id: { in: ids.userIds }, deletedAt: null },
      data: { deletedAt: now, blockedAt: now, employeeState: EmployeeState.OFF_SHIFT },
    });
  }
}

async function activeArtifactCounts() {
  const [factories, lines, washes, defrosts, assignments, accesses] = await Promise.all([
    db.factory.count({ where: { code: { contains: `pffv5-p1-${runId}` }, isActive: true } }),
    ids.factoryId ? db.line.count({ where: { factoryId: ids.factoryId, deactivatedAt: null } }) : 0,
    ids.factoryId ? db.washSession.count({ where: { factoryId: ids.factoryId, status: { not: 'DONE' } } }) : 0,
    ids.factoryId ? db.defrostEvent.count({ where: { factoryId: ids.factoryId, status: 'ACTIVE' } }) : 0,
    ids.factoryId ? db.assignment.count({ where: { factoryId: ids.factoryId, endedAt: null } }) : 0,
    ids.factoryId ? db.userFactoryAccess.count({ where: { factoryId: ids.factoryId, isActive: true } }) : 0,
  ]);
  return { factories, lines, washes, defrosts, assignments, accesses };
}

async function main() {
  const current = factoryShiftTarget();
  const future = addFactoryShifts(current, 1);
  const previous = addFactoryShifts(current, -1);
  const previousWindow = factoryShiftWindow(previous);

  const factory = await db.factory.create({
    data: { code: `pffv5-p1-${runId}`, name: `${marker} Каноническое состояние`, isActive: true },
  });
  ids.factoryId = factory.id;
  const otherFactory = await db.factory.create({
    data: { code: `pffv5-p1-other-${runId}`, name: `${marker} Другой завод`, isActive: true },
  });
  ids.otherFactoryId = otherFactory.id;
  const department = await db.department.create({
    data: { factoryId: factory.id, code: `masters-${runId}`, name: `${marker} Мастера` },
  });
  ids.departmentId = department.id;

  const masterId = await createUser(factory.id, department.id, 'MASTER', 'master');
  const managementId = await createUser(factory.id, department.id, 'MANAGEMENT', 'management');
  const adminId = await createUser(factory.id, department.id, 'ADMIN', 'admin');
  const worker1 = await createUser(factory.id, department.id, 'WORKER', 'worker1');
  const worker2 = await createUser(factory.id, department.id, 'WORKER', 'worker2');
  const stopWorker = await createUser(factory.id, department.id, 'WORKER', 'stop-worker', EmployeeState.ASSIGNED);
  const timeWorker = await createUser(factory.id, department.id, 'WORKER', 'time-worker', EmployeeState.TIME_ROLE);
  const archiveWorker = await createUser(factory.id, department.id, 'WORKER', 'archive-worker');
  const coldId = await createUser(factory.id, department.id, 'TECH_HOLOD', 'cold');

  const runningLine = await createLine(factory.id, 'Рабочая линия', LineStatus.WORK);
  const runningComposition = await createComposition(factory.id, runningLine.id, masterId, 2, current);
  await db.assignment.createMany({
    data: [worker1, worker2].map((userId, index) => ({
      factoryId: factory.id,
      lineId: runningLine.id,
      userId,
      kind: AssignmentKind.LINE,
      positionId: runningComposition.position.id,
      staffingTemplateId: runningComposition.template.id,
      slotIndex: index + 1,
      startedById: masterId,
    })),
  });
  await db.user.updateMany({ where: { id: { in: [worker1, worker2] } }, data: { employeeState: EmployeeState.ASSIGNED } });
  await db.assignment.create({
    data: { factoryId: factory.id, userId: timeWorker, kind: AssignmentKind.TIME, timeRoleName: 'Учётная работа', startedById: masterId },
  });

  const downtimeLine = await createLine(factory.id, 'Линия простоя', LineStatus.WORK);
  await createComposition(factory.id, downtimeLine.id, masterId, 1, current);
  const downtimeResponses = await Promise.all([
    request('PATCH', `/lines/${downtimeLine.id}/status`, masterId, factory.id, { status: 'PAUSE', comment: 'Проверка канонического простоя', downtimeReason: 'TECHNICAL' }),
    request('PATCH', `/lines/${downtimeLine.id}/status`, masterId, factory.id, { status: 'PAUSE', comment: 'Повтор канонического простоя', downtimeReason: 'TECHNICAL' }),
  ]);
  const openDowntimeCount = await db.lineEvent.count({
    where: { lineId: downtimeLine.id, status: 'PAUSE', confirmedEndAt: null },
  });
  record('DOWNTIME transition is concurrent-safe and single-active', downtimeResponses.every((item) => item.status === 200) && openDowntimeCount === 1, { statuses: downtimeResponses.map((item) => item.status), openDowntimeCount });

  const washLine = await createLine(factory.id, 'Линия мойки', LineStatus.STOP);
  const washStartedAt = Date.now();
  const washStart = await request('POST', '/wash/start', masterId, factory.id, {
    targetType: 'LINE',
    lineId: washLine.id,
    operationId: `${marker}-wash`,
    createdAt: '2000-01-01T00:00:00.000Z',
  });
  const washRecord = washStart.data?.id ? await db.washSession.findUnique({ where: { id: washStart.data.id } }) : null;
  record('wash uses server timestamp', washStart.status === 201 && washRecord && washRecord.createdAt.getTime() >= washStartedAt - 1_000, { status: washStart.status });
  const sameWash = await request('POST', '/wash/start', masterId, factory.id, {
    targetType: 'LINE', lineId: washLine.id, operationId: `${marker}-wash`,
  });
  const competingWash = await request('POST', '/wash/start', masterId, factory.id, {
    targetType: 'LINE', lineId: washLine.id, operationId: `${marker}-wash-competing`,
  });
  const activeWashCount = await db.washSession.count({ where: { factoryId: factory.id, lineId: washLine.id, status: { not: 'DONE' } } });
  record('wash is idempotent and single-active', sameWash.status === 201 && sameWash.data?.id === washStart.data?.id && competingWash.status === 409 && activeWashCount === 1, { same: sameWash.status, competing: competingWash.status, activeWashCount });

  const stopLine = await createLine(factory.id, 'Линия атомарной остановки', LineStatus.WORK);
  const stopComposition = await createComposition(factory.id, stopLine.id, masterId, 1, current);
  await db.lineShiftWorkPlan.create({
    data: {
      factoryId: factory.id,
      lineId: stopLine.id,
      staffingTemplateId: stopComposition.template.id,
      shiftDate: factoryShiftDate(future),
      shiftType: future.shiftType,
      createdById: masterId,
    },
  });
  const stopAssignment = await db.assignment.create({
    data: {
      factoryId: factory.id,
      lineId: stopLine.id,
      userId: stopWorker,
      kind: AssignmentKind.LINE,
      positionId: stopComposition.position.id,
      staffingTemplateId: stopComposition.template.id,
      slotIndex: 1,
      startedById: masterId,
    },
  });
  const stopResponse = await request('PATCH', `/lines/${stopLine.id}/status`, masterId, factory.id, {
    status: 'STOP', comment: 'Штатная остановка линии', downtimeReason: 'OTHER',
  });
  const stopRepeat = await request('PATCH', `/lines/${stopLine.id}/status`, masterId, factory.id, {
    status: 'STOP', comment: 'Повторная остановка линии', downtimeReason: 'OTHER',
  });
  const [closedAssignment, stopUser, stopTemplate, currentPlan, futurePlan, stopEvents] = await Promise.all([
    db.assignment.findUnique({ where: { id: stopAssignment.id } }),
    db.user.findUnique({ where: { id: stopWorker } }),
    db.lineStaffingTemplate.findUnique({ where: { id: stopComposition.template.id } }),
    db.lineShiftWorkPlan.findUnique({ where: { factoryId_lineId_shiftDate_shiftType: { factoryId: factory.id, lineId: stopLine.id, shiftDate: factoryShiftDate(current), shiftType: current.shiftType } } }),
    db.lineShiftWorkPlan.findUnique({ where: { factoryId_lineId_shiftDate_shiftType: { factoryId: factory.id, lineId: stopLine.id, shiftDate: factoryShiftDate(future), shiftType: future.shiftType } } }),
    db.lineEvent.findMany({ where: { lineId: stopLine.id, status: 'STOP' } }),
  ]);
  record('STOP releases people atomically', stopResponse.status === 200 && Boolean(closedAssignment?.endedAt) && stopUser?.employeeState === EmployeeState.AVAILABLE, { status: stopResponse.status });
  record('STOP preserves composition and current/future plans', Boolean(stopTemplate && currentPlan && futurePlan), { template: Boolean(stopTemplate), currentPlan: Boolean(currentPlan), futurePlan: Boolean(futurePlan) });
  record('repeated STOP is idempotent', stopRepeat.status === 200 && stopEvents.length === 1 && stopRepeat.data?.id === stopResponse.data?.id, { status: stopRepeat.status, eventCount: stopEvents.length });

  const stoppedPlannedLine = await createLine(factory.id, 'Плановая остановленная линия', LineStatus.STOP);
  await createComposition(factory.id, stoppedPlannedLine.id, masterId, 1, current);
  const defrostLine = await createLine(factory.id, 'Линия серверного времени оттайки', LineStatus.STOP);
  const defrostStartBefore = Date.now();
  const defrostStart = await request('POST', '/defrost/start', coldId, factory.id, {
    lineId: defrostLine.id,
    comment: 'Проверка серверного времени',
    startAt: '2000-01-01T00:00:00.000Z',
    operationId: `${marker}-defrost-start`,
  });
  const defrostEndBefore = Date.now();
  const defrostEnd = defrostStart.data?.id
    ? await request('POST', `/defrost/${defrostStart.data.id}/end`, coldId, factory.id, {
        comment: 'Проверка завершена',
        endAt: '2000-01-01T00:00:01.000Z',
        operationId: `${marker}-defrost-end`,
      })
    : { status: 0, data: null };
  const defrostRecord = defrostStart.data?.id ? await db.defrostEvent.findUnique({ where: { id: defrostStart.data.id } }) : null;
  record('defrost start/end use server timestamps and non-negative duration', defrostStart.status === 201 && defrostEnd.status === 201 && defrostRecord && defrostRecord.startAt.getTime() >= defrostStartBefore - 1_000 && defrostRecord.endAt && defrostRecord.endAt.getTime() >= defrostEndBefore - 1_000 && Number(defrostRecord.durationSeconds) >= 0, { start: defrostStart.status, end: defrostEnd.status, durationSeconds: defrostRecord?.durationSeconds });

  const list = await request('GET', '/lines', masterId, factory.id);
  const overview = await request('GET', '/lines/shift-overview', masterId, factory.id);
  const detail = await request('GET', `/lines/${runningLine.id}/current-shift-detail`, masterId, factory.id);
  const dashboard = await request('GET', `/lines/${runningLine.id}/dashboard`, masterId, factory.id);
  const listLine = list.data?.find((item) => item.id === runningLine.id);
  const overviewLine = overview.data?.find((item) => item.id === runningLine.id);
  const parity = [listLine, overviewLine, detail.data, dashboard.data].map(coreState);
  record('list/shift/detail/dashboard share one canonical state', list.status === 200 && overview.status === 200 && detail.status === 200 && dashboard.status === 200 && parity.every((item) => JSON.stringify(item) === JSON.stringify(parity[0])), parity);
  const stateById = new Map(list.data?.map((item) => [item.id, item]) ?? []);
  record('state priority WASH > DOWNTIME > RUNNING > STOPPED', stateById.get(washLine.id)?.operationalState === 'WASH' && stateById.get(downtimeLine.id)?.operationalState === 'DOWNTIME' && stateById.get(runningLine.id)?.operationalState === 'RUNNING' && stateById.get(stopLine.id)?.operationalState === 'STOPPED');
  const totals = (list.data ?? []).reduce((value, line) => ({
    assigned: value.assigned + Number(line.productionStaffAssignedCount ?? 0),
    required: value.required + Number(line.productionStaffRequiredCount ?? 0),
  }), { assigned: 0, required: 0 });
  record('production staffing total excludes TIME/WASH and keeps stopped active plan', totals.assigned === 2 && totals.required === 5, totals);
  record('canonical payloads are leak-free', safePayload({ list: list.data, overview: overview.data, detail: detail.data, dashboard: dashboard.data }));

  const workerRead = await request('GET', '/lines/shift-overview', worker1, factory.id);
  const workerWrite = await request('PATCH', `/lines/${runningLine.id}/status`, worker1, factory.id, { status: 'STOP', comment: 'Запрещённая остановка' });
  const managementRead = await request('GET', '/lines/shift-overview', managementId, factory.id);
  const adminRead = await request('GET', '/lines/shift-overview', adminId, factory.id);
  record('minimal role matrix keeps WORKER read-only and managers readable', workerRead.status === 200 && workerWrite.status === 403 && managementRead.status === 200 && adminRead.status === 200, { workerRead: workerRead.status, workerWrite: workerWrite.status, management: managementRead.status, admin: adminRead.status });

  const otherLine = await createLine(otherFactory.id, 'Линия другого завода', LineStatus.WORK);
  const crossFactory = await request('GET', `/lines/${otherLine.id}/dashboard`, masterId, factory.id);
  record('cross-factory line access denied', crossFactory.status === 409 || crossFactory.status === 403, { status: crossFactory.status });

  const archiveLine = await createLine(factory.id, 'Архивная линия', LineStatus.STOP, new Date(previousWindow.from.getTime() - 86_400_000));
  const archiveComposition = await createComposition(factory.id, archiveLine.id, masterId, 1, previous);
  const at = (hours) => new Date(previousWindow.from.getTime() + hours * 3_600_000);
  await db.lineEvent.createMany({
    data: [
      { factoryId: factory.id, lineId: archiveLine.id, createdById: masterId, status: 'WORK', comment: `${marker} работа`, createdAt: at(-1), confirmedEndAt: at(-1) },
      { factoryId: factory.id, lineId: archiveLine.id, createdById: masterId, status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker} простой`, createdAt: at(2), confirmedEndAt: at(3) },
      { factoryId: factory.id, lineId: archiveLine.id, createdById: masterId, status: 'WORK', comment: `${marker} возобновление`, createdAt: at(3), confirmedEndAt: at(3) },
      { factoryId: factory.id, lineId: archiveLine.id, createdById: masterId, status: 'STOP', comment: `${marker} завершение`, createdAt: at(7) },
    ],
  });
  await db.assignment.create({
    data: {
      factoryId: factory.id,
      lineId: archiveLine.id,
      userId: archiveWorker,
      kind: AssignmentKind.LINE,
      positionId: archiveComposition.position.id,
      staffingTemplateId: archiveComposition.template.id,
      slotIndex: 1,
      startedById: masterId,
      endedById: masterId,
      startedAt: at(1),
      endedAt: at(6),
    },
  });
  await db.lineShiftWorkPlanRow.create({
    data: { workPlanId: archiveComposition.plan.id, sortOrder: 1, article: 'PFFV5', productName: 'Архивный продукт', plannedGofrCount: 10 },
  });
  await db.line.update({
    where: { id: archiveLine.id },
    data: { deactivatedAt: new Date(), deactivationReason: `${marker} отключена после архивной смены` },
  });
  const createdAfterArchive = await createLine(factory.id, 'Создана после архивной смены', LineStatus.STOP, new Date(previousWindow.to.getTime() + 1_000));
  const archive = await request('GET', `/shift/past/${previous.shiftDate}_${previous.shiftType}`, masterId, factory.id);
  const archivedLine = archive.data?.lines?.find((line) => line.lineId === archiveLine.id);
  record('archive uses historical canonical state and exact counts', archive.status === 200 && archive.data?.readOnly === true && archivedLine?.operationalState === 'STOPPED' && archivedLine?.staffingDataStatus === 'AVAILABLE' && archivedLine?.requiredCount === 1 && archivedLine?.peopleCount === 1 && archivedLine?.workPlanRows?.length === 1, { status: archive.status, line: archivedLine && { state: archivedLine.operationalState, required: archivedLine.requiredCount, people: archivedLine.peopleCount } });
  record('line created after archived shift is absent', !archive.data?.lines?.some((line) => line.lineId === createdAfterArchive.id));
  const archiveRowsBefore = await db.lineShiftWorkPlanRow.count({ where: { workPlanId: archiveComposition.plan.id } });
  const archiveMutation = await request('PATCH', `/lines/${archiveLine.id}/shift-assignment/rows`, masterId, factory.id, {
    shiftDate: previous.shiftDate,
    shiftType: previous.shiftType,
    article: 'FORBIDDEN',
    productName: 'Не должно сохраниться',
    plannedGofrCount: 1,
    sortOrder: 2,
  });
  const archiveRowsAfter = await db.lineShiftWorkPlanRow.count({ where: { workPlanId: archiveComposition.plan.id } });
  record('archived shift is read-only through direct API', (archiveMutation.status === 409 || archiveMutation.status === 403) && archiveRowsAfter === archiveRowsBefore, { status: archiveMutation.status, before: archiveRowsBefore, after: archiveRowsAfter });

  const realtimeLine = await createLine(factory.id, 'Линия realtime parity', LineStatus.WORK);
  const realtime = await waitForCommittedLineEvent(masterId, factory.id, realtimeLine.id, () => request('PATCH', `/lines/${realtimeLine.id}/status`, masterId, factory.id, {
    status: 'STOP', comment: 'Проверка after-commit realtime', downtimeReason: 'OTHER',
  }));
  const realtimePayloadKeys = Object.keys(realtime.event?.payload ?? {}).sort();
  record('realtime event observes committed canonical state', realtime.actionResult?.status === 200
    && realtime.dashboard?.status === 200
    && realtime.dashboard?.data?.line?.operationalState === 'STOPPED'
    && realtimePayloadKeys.length === 1
    && realtimePayloadKeys[0] === 'changedAt', {
    action: realtime.actionResult?.status,
    dashboard: realtime.dashboard?.status,
    state: realtime.dashboard?.data?.line?.operationalState,
    payloadKeys: realtimePayloadKeys,
  });

  if (washStart.data?.id) {
    const completeWash = await request('POST', `/wash/${washStart.data.id}/complete`, masterId, factory.id, { operationId: `${marker}-wash-complete` });
    const washLineAfter = await db.line.findUnique({ where: { id: washLine.id } });
    record('wash completion does not auto-start the line', completeWash.status === 201 && washLineAfter?.status === LineStatus.STOP, { status: completeWash.status, lineStatus: washLineAfter?.status });
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    failed.push({ name: 'unhandled regression error', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    try {
      await cleanup();
    } catch (error) {
      failed.push({ name: 'cleanup completed', detail: error instanceof Error ? error.message : String(error) });
    }
    let artifacts = null;
    try {
      artifacts = await activeArtifactCounts();
      record('created active artifacts remaining = 0', Object.values(artifacts).every((value) => value === 0), artifacts);
    } catch (error) {
      failed.push({ name: 'artifact verification', detail: error instanceof Error ? error.message : String(error) });
    }
    await db.$disconnect();
    const result = { marker, passed: passed.length, failed: failed.length, failures: failed, activeArtifacts: artifacts };
    console.log(JSON.stringify(result, null, 2));
    if (failed.length) process.exitCode = 1;
  }
}

run();
