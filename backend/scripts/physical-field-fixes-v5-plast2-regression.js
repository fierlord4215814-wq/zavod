const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const {
  AssignmentKind,
  EmployeeState,
  LineStatus,
  PrismaClient,
  ShiftSessionStatus,
} = require('@prisma/client');

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
const marker = `__PFFV5_P2_${runId}__`;
const artifactPath = path.resolve(backendDir, '..', 'docs', 'physical-field-fixes-v5-plast2', 'test-artifacts.json');
const ids = { factoryId: null, otherFactoryId: null, userIds: [] };

function record(name, condition, detail) {
  const target = condition ? passed : failed;
  target.push({ name, ...(detail === undefined ? {} : { detail }) });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}`);
}

function accepted(response, statuses = [200, 201]) {
  return statuses.includes(response?.status);
}

function safePayload(value) {
  return !/(storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+|secret\s*[:=])/i
    .test(JSON.stringify(value ?? {}));
}

async function request(method, route, userId, factoryId, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Connection: 'close',
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function createUser(factoryId, departmentId, role, label) {
  const id = `pffv5p2-${label}-${runId}`;
  await db.user.create({ data: { id, factoryId, role, employeeState: EmployeeState.AVAILABLE } });
  await db.userFactoryAccess.create({
    data: { userId: id, factoryId, departmentId, role, isGuest: false, isActive: true },
  });
  ids.userIds.push(id);
  return id;
}

async function createLine(factoryId, name, status = LineStatus.WORK) {
  return db.line.create({ data: { factoryId, name: `${marker} ${name}`, status } });
}

async function createTemplate(factoryId, lineId, name, specs) {
  const template = await db.lineStaffingTemplate.create({
    data: { factoryId, lineId, name: `${marker} ${name}` },
  });
  for (const [index, spec] of specs.entries()) {
    await db.lineStaffingTemplateItem.create({
      data: {
        templateId: template.id,
        positionId: spec.positionId,
        requiredCount: spec.count,
        plannedCount: spec.count,
        minRequired: spec.count,
        maxRequired: spec.count,
        sortOrder: index + 1,
      },
    });
  }
  return template;
}

async function waitForAssignmentEvent(userId, factoryId, action) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_API}/ws?userId=${encodeURIComponent(userId)}&factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1']);
    let actionPromise = null;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket assignment_updated timeout'));
    }, 12_000);
    socket.on('open', async () => {
      try { actionPromise = action(); } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.on('message', async (raw) => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type !== 'assignment_updated' || event.payload?.factoryId !== factoryId) return;
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
    await db.plannedLineAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now } });
    await db.plannedShiftAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now } });
    await db.washSession.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: now } });
    await db.shiftSession.updateMany({ where: { factoryId, status: ShiftSessionStatus.ACTIVE }, data: { status: ShiftSessionStatus.COMPLETED, endedAt: now } });
    await db.workArea.updateMany({ where: { factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
    await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
    await db.department.updateMany({ where: { factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
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

async function activeArtifactCounts() {
  if (!ids.factoryId) return {};
  const [factories, lines, workAreas, washes, assignments, plannedLine, plannedShift, accesses] = await Promise.all([
    db.factory.count({ where: { id: ids.factoryId, isActive: true } }),
    db.line.count({ where: { factoryId: ids.factoryId, deactivatedAt: null } }),
    db.workArea.count({ where: { factoryId: ids.factoryId, isActive: true, deactivatedAt: null } }),
    db.washSession.count({ where: { factoryId: ids.factoryId, status: { not: 'DONE' } } }),
    db.assignment.count({ where: { factoryId: ids.factoryId, endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: ids.factoryId, releasedAt: null } }),
    db.plannedShiftAssignment.count({ where: { factoryId: ids.factoryId, releasedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: ids.factoryId, isActive: true } }),
  ]);
  return { factories, lines, workAreas, washes, assignments, plannedLine, plannedShift, accesses };
}

async function main() {
  const health = await fetch(`${API}/health`, { headers: { Connection: 'close' } }).then((response) => response.json()).catch(() => null);
  record('Свежий backend отвечает на /health', health?.status === 'ok', health);
  if (health?.status !== 'ok') throw new Error('Backend health недоступен');

  const current = factoryShiftTarget();
  const future = addFactoryShifts(current, 1);
  const currentWindow = factoryShiftWindow(current);
  const factory = await db.factory.create({ data: { code: `pffv5-p2-${runId}`, name: `${marker} Назначения`, isActive: true } });
  ids.factoryId = factory.id;
  const otherFactory = await db.factory.create({ data: { code: `pffv5-p2-other-${runId}`, name: `${marker} Другой завод`, isActive: true } });
  ids.otherFactoryId = otherFactory.id;
  const department = await db.department.create({ data: { factoryId: factory.id, code: `staff-${runId}`, name: `${marker} Производство` } });
  await db.shiftSettings.create({ data: { factoryId: factory.id, minAssignmentMoveIntervalMinutes: 0 } });

  const masterId = await createUser(factory.id, department.id, 'MASTER', 'master');
  const workerId = await createUser(factory.id, department.id, 'WORKER', 'worker');
  const workers = [];
  for (let index = 1; index <= 12; index += 1) workers.push(await createUser(factory.id, department.id, 'WORKER', `worker-${index}`));
  await db.shiftSession.create({
    data: {
      factoryId: factory.id,
      userId: masterId,
      startedById: masterId,
      startedAt: new Date(Math.max(currentWindow.from.getTime(), Date.now() - 60_000)),
      plannedEndAt: currentWindow.to,
      durationHours: 12,
      shiftType: current.shiftType,
      status: ShiftSessionStatus.ACTIVE,
    },
  });

  const line = await createLine(factory.id, 'Каноническая линия');
  const operator = await db.linePosition.create({ data: { factoryId: factory.id, lineId: line.id, name: 'Оператор', displayName: 'Оператор', normalizedName: 'оператор', skillFamilyKey: 'operator', sortOrder: 1 } });
  const packer = await db.linePosition.create({ data: { factoryId: factory.id, lineId: line.id, name: 'Упаковщик', displayName: 'Упаковщик', normalizedName: 'упаковщик', skillFamilyKey: 'packer', sortOrder: 2 } });
  const controller = await db.linePosition.create({ data: { factoryId: factory.id, lineId: line.id, name: 'Контролёр', displayName: 'Контролёр', normalizedName: 'контролёр', skillFamilyKey: 'controller', sortOrder: 3 } });
  const templateA = await createTemplate(factory.id, line.id, 'Состав А', [
    { positionId: operator.id, count: 2 },
    { positionId: packer.id, count: 1 },
  ]);
  const templateB = await createTemplate(factory.id, line.id, 'Состав Б', [
    { positionId: operator.id, count: 1 },
    { positionId: controller.id, count: 1 },
  ]);
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: templateA.id } });

  const activationPreview = await request('POST', `/lines/${line.id}/activate-template/preview`, masterId, factory.id, {});
  const activation = await request('POST', `/lines/${line.id}/activate-for-shift`, masterId, factory.id, {
    expectedVersion: activationPreview.data?.lineVersion,
    operationId: `${marker}-activate-default`,
    confirmRemap: true,
  });
  const currentPlan = await db.lineShiftWorkPlan.findUnique({
    where: { factoryId_lineId_shiftDate_shiftType: { factoryId: factory.id, lineId: line.id, shiftDate: factoryShiftDate(current), shiftType: current.shiftType } },
  });
  record('Default template выбирается автоматически', accepted(activation) && currentPlan?.staffingTemplateId === templateA.id, {
    previewStatus: activationPreview.status,
    activationStatus: activation.status,
    response: activation.data,
  });
  const lineDefault = await db.line.findUnique({ where: { id: line.id }, select: { defaultStaffingTemplateId: true } });
  record('У линии хранится один scalar default template', lineDefault?.defaultStaffingTemplateId === templateA.id);

  const collisionA = `${marker}-collision-a`;
  const collisionB = `${marker}-collision-b`;
  const collision = await Promise.all([
    request('POST', '/assignments/line', masterId, factory.id, { targetUserId: workers[0], lineId: line.id, positionId: operator.id, slotIndex: 1, staffingTemplateId: templateA.id, operationId: collisionA }),
    request('POST', '/assignments/line', masterId, factory.id, { targetUserId: workers[1], lineId: line.id, positionId: operator.id, slotIndex: 1, staffingTemplateId: templateA.id, operationId: collisionB }),
  ]);
  const successfulCollision = collision.find((item) => accepted(item));
  const rejectedCollision = collision.find((item) => item.status === 409);
  const winningUserId = successfulCollision?.data?.userId;
  const losingUserId = winningUserId === workers[0] ? workers[1] : workers[0];
  const winningOperationId = winningUserId === workers[0] ? collisionA : collisionB;
  const occupiedCount = await db.assignment.count({ where: { factoryId: factory.id, lineId: line.id, positionId: operator.id, slotIndex: 1, endedAt: null } });
  record('Один слот не получает двух active сотрудников', Boolean(successfulCollision && rejectedCollision) && occupiedCount === 1, { statuses: collision.map((item) => item.status), occupiedCount });

  const repeated = await request('POST', '/assignments/line', masterId, factory.id, {
    targetUserId: winningUserId,
    lineId: line.id,
    positionId: operator.id,
    slotIndex: 1,
    staffingTemplateId: templateA.id,
    operationId: winningOperationId,
  });
  const winnerActiveCount = await db.assignment.count({ where: { factoryId: factory.id, userId: winningUserId, endedAt: null } });
  record('Double tap возвращает одно назначение', accepted(repeated) && repeated.data?.id === successfulCollision?.data?.id && winnerActiveCount === 1, { status: repeated.status, active: winnerActiveCount });

  const loserSlot = await request('POST', '/assignments/line', masterId, factory.id, {
    targetUserId: losingUserId,
    lineId: line.id,
    positionId: operator.id,
    slotIndex: 2,
    staffingTemplateId: templateA.id,
    operationId: `${marker}-loser-slot`,
  });
  const replace = await request('POST', '/assignments/line', masterId, factory.id, {
    targetUserId: winningUserId,
    lineId: line.id,
    positionId: operator.id,
    slotIndex: 2,
    staffingTemplateId: templateA.id,
    sourceAssignmentId: successfulCollision?.data?.id,
    replaceAssignmentId: loserSlot.data?.id,
    operationId: `${marker}-replace`,
  });
  const activeWinner = await db.assignment.findMany({ where: { factoryId: factory.id, userId: winningUserId, endedAt: null } });
  const replaced = await db.assignment.findUnique({ where: { id: loserSlot.data?.id ?? 'missing' } });
  record('Atomic replace завершает старые назначения и оставляет одно active', accepted(replace) && activeWinner.length === 1 && Boolean(replaced?.endedAt), { status: replace.status, active: activeWinner.length });

  const reassignLoser = await request('POST', '/assignments/line', masterId, factory.id, { targetUserId: losingUserId, lineId: line.id, positionId: operator.id, slotIndex: 1, staffingTemplateId: templateA.id, operationId: `${marker}-loser-return` });
  const packerAssignment = await request('POST', '/assignments/line', masterId, factory.id, { targetUserId: workers[2], lineId: line.id, positionId: packer.id, slotIndex: 1, staffingTemplateId: templateA.id, operationId: `${marker}-packer` });
  record('Person-first и position-first используют один canonical endpoint', accepted(reassignLoser) && accepted(packerAssignment));

  const workerDenied = await request('POST', '/assignments/line', workerId, factory.id, { targetUserId: workers[3], lineId: line.id, positionId: controller.id, slotIndex: 1, staffingTemplateId: templateB.id, operationId: `${marker}-worker-denied` });
  const otherLine = await createLine(otherFactory.id, 'Чужая линия');
  const crossFactory = await request('POST', '/assignments/line', masterId, factory.id, { targetUserId: workers[3], lineId: otherLine.id, operationId: `${marker}-cross-factory` });
  record('WORKER mutation запрещена backend', workerDenied.status === 403, { status: workerDenied.status });
  record('Cross-factory assignment запрещён', [403, 409].includes(crossFactory.status), { status: crossFactory.status });

  const remapPreview = await request('POST', `/lines/${line.id}/activate-template/preview`, masterId, factory.id, { staffingTemplateId: templateB.id });
  const remapWithoutConfirm = await request('POST', `/lines/${line.id}/activate-template`, masterId, factory.id, {
    staffingTemplateId: templateB.id,
    expectedVersion: remapPreview.data?.lineVersion,
    operationId: `${marker}-remap-unconfirmed`,
  });
  const remap = await request('POST', `/lines/${line.id}/activate-template`, masterId, factory.id, {
    staffingTemplateId: templateB.id,
    expectedVersion: remapPreview.data?.lineVersion,
    operationId: `${marker}-remap`,
    confirmRemap: true,
  });
  const remappedAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, lineId: line.id }, orderBy: { startedAt: 'asc' } });
  const activeAfterRemap = remappedAssignments.filter((item) => !item.endedAt);
  record('Template remap требует preview/подтверждение', remapPreview.status === 201 && remapPreview.data?.requiresConfirmation === true && remapWithoutConfirm.status === 409, { preview: remapPreview.status, applyWithoutConfirm: remapWithoutConfirm.status });
  record('Template remap сохраняет эквивалентное и освобождает лишнее без неверного match', accepted(remap) && activeAfterRemap.length === 1 && activeAfterRemap[0].positionId === operator.id && activeAfterRemap[0].staffingTemplateId === templateB.id && remappedAssignments.filter((item) => item.endedAt).length >= 3, { status: remap.status, active: activeAfterRemap.length });

  const washLine = await createLine(factory.id, 'Линия мойки', LineStatus.STOP);
  const washStart = await request('POST', '/wash/start', masterId, factory.id, { targetType: 'LINE', lineId: washLine.id, operationId: `${marker}-wash-start` });
  const washEvent = await waitForAssignmentEvent(masterId, factory.id, () => request('POST', '/assignments/wash', masterId, factory.id, {
    targetUserId: workers[4],
    washSessionId: washStart.data?.id,
    operationId: `${marker}-wash-assign-1`,
  }));
  const washSecond = await request('POST', '/assignments/wash', masterId, factory.id, { targetUserId: workers[5], washSessionId: washStart.data?.id, operationId: `${marker}-wash-assign-2` });
  const washActiveBefore = await db.assignment.count({ where: { washSessionId: washStart.data?.id, kind: AssignmentKind.WASH, endedAt: null } });
  const washComplete = await request('POST', `/wash/${washStart.data?.id}/complete`, masterId, factory.id, { operationId: `${marker}-wash-complete` });
  const washActiveAfter = await db.assignment.count({ where: { washSessionId: washStart.data?.id, kind: AssignmentKind.WASH, endedAt: null } });
  record('WASH assignment создаётся через active WashSession и публикует realtime after commit', accepted(washEvent.actionResult) && washSecond.status === 201 && washActiveBefore === 2 && washEvent.event?.type === 'assignment_updated', { first: washEvent.actionResult?.status, second: washSecond.status, active: washActiveBefore });
  record('Завершение мойки освобождает всех участников без resurrection', washComplete.status === 201 && washActiveAfter === 0, { status: washComplete.status, activeAfter: washActiveAfter });

  const workArea = await db.workArea.create({ data: { factoryId: factory.id, departmentId: department.id, name: `${marker} Повременщики`, assignmentKind: AssignmentKind.TIME } });
  const workPosition = await db.workAreaPosition.create({ data: { workAreaId: workArea.id, title: 'Грузчик', minRequired: 1, maxRequired: 2, defaultPlanned: 2, plannedCount: 2, isFlexible: true } });
  const areaA = await request('POST', `/work-areas/${workArea.id}/assign`, masterId, factory.id, { targetUserId: workers[6], workAreaPositionId: workPosition.id, slotIndex: 1, operationId: `${marker}-area-1` });
  const areaB = await request('POST', `/work-areas/${workArea.id}/assign`, masterId, factory.id, { targetUserId: workers[7], workAreaPositionId: workPosition.id, slotIndex: 2, operationId: `${marker}-area-2` });
  const areaPreview = await request('POST', `/work-areas/${workArea.id}/positions/${workPosition.id}/planned-count/preview`, masterId, factory.id, { plannedCount: 1 });
  const areaUnsafeUpdate = await request('PATCH', `/work-areas/${workArea.id}/positions/${workPosition.id}/planned-count`, masterId, factory.id, { plannedCount: 1 });
  const areaAssignments = await db.assignment.count({ where: { factoryId: factory.id, workAreaId: workArea.id, endedAt: null } });
  record('WorkArea использует canonical Assignment', accepted(areaA) && accepted(areaB) && areaAssignments === 2, { statuses: [areaA.status, areaB.status], active: areaAssignments });
  record('Снижение потребности сначала показывает освобождаемых и не меняет данные молча', areaPreview.status === 201 && areaPreview.data?.requiresRelease === true && areaPreview.data?.counts?.current === 1 && areaUnsafeUpdate.status === 409 && areaAssignments === 2, { preview: areaPreview.status, update: areaUnsafeUpdate.status });

  const futureLine = await createLine(factory.id, 'Будущая линия');
  const futureOperator = await db.linePosition.create({ data: { factoryId: factory.id, lineId: futureLine.id, name: 'Оператор', displayName: 'Оператор', normalizedName: 'оператор', skillFamilyKey: 'operator', sortOrder: 1 } });
  const futureTemplateA = await createTemplate(factory.id, futureLine.id, 'Будущий состав А', [{ positionId: futureOperator.id, count: 2 }]);
  const futureTemplateB = await createTemplate(factory.id, futureLine.id, 'Будущий состав Б', [{ positionId: futureOperator.id, count: 1 }]);
  await db.line.update({ where: { id: futureLine.id }, data: { defaultStaffingTemplateId: futureTemplateA.id } });
  const actualFutureLine = await request('POST', '/assignments/line', masterId, factory.id, { targetUserId: workers[8], lineId: futureLine.id, positionId: futureOperator.id, slotIndex: 2, staffingTemplateId: futureTemplateA.id, operationId: `${marker}-actual-future-line` });
  const futureQuery = new URLSearchParams({ shiftDate: future.shiftDate, shiftType: future.shiftType }).toString();
  const planningBoard = await request('GET', `/lines/${futureLine.id}/planning-board?${futureQuery}`, masterId, factory.id);
  const futureAssign = await request('POST', `/lines/${futureLine.id}/planning-board/assign`, masterId, factory.id, {
    shiftDate: future.shiftDate,
    shiftType: future.shiftType,
    targetUserId: workers[9],
    positionId: futureOperator.id,
    slotIndex: 1,
    operationId: `${marker}-future-assign`,
  });
  const actualForPlannedUser = await db.assignment.count({ where: { factoryId: factory.id, userId: workers[9], endedAt: null } });
  const planAfterAssign = await db.lineShiftWorkPlan.findUnique({ where: { factoryId_lineId_shiftDate_shiftType: { factoryId: factory.id, lineId: futureLine.id, shiftDate: factoryShiftDate(future), shiftType: future.shiftType } } });
  record('Future board автоматически использует default template', planningBoard.status === 200 && planningBoard.data?.staffingTemplate?.id === futureTemplateA.id && planAfterAssign?.staffingTemplateId === futureTemplateA.id, { status: planningBoard.status });
  record('Future plan assignment не создаёт actual Assignment', accepted(futureAssign) && actualForPlannedUser === 0, { status: futureAssign.status, actual: actualForPlannedUser });

  const futurePreview = await request('POST', `/lines/${futureLine.id}/planning-board/template/preview`, masterId, factory.id, { shiftDate: future.shiftDate, shiftType: future.shiftType, staffingTemplateId: futureTemplateB.id });
  const futureRemap = await request('POST', `/lines/${futureLine.id}/planning-board/template/apply`, masterId, factory.id, {
    shiftDate: future.shiftDate,
    shiftType: future.shiftType,
    staffingTemplateId: futureTemplateB.id,
    expectedPlanUpdatedAt: futurePreview.data?.planUpdatedAt,
    operationId: `${marker}-future-remap`,
    confirmRemap: true,
  });
  const actualStillCurrent = await db.assignment.findUnique({ where: { id: actualFutureLine.data?.id ?? 'missing' } });
  const plannedStillActive = await db.plannedLineAssignment.findFirst({ where: { factoryId: factory.id, lineId: futureLine.id, userId: workers[9], releasedAt: null } });
  record('Future template remap не меняет actual current assignment', futurePreview.status === 201 && accepted(futureRemap) && !actualStillCurrent?.endedAt && actualStillCurrent?.staffingTemplateId === futureTemplateA.id && plannedStillActive?.staffingTemplateId === futureTemplateB.id, { preview: futurePreview.status, apply: futureRemap.status });

  const source = fs.readFileSync(path.resolve(backendDir, '..', 'frontend', 'src', 'screens', 'ShiftPeopleScreen.tsx'), 'utf8');
  record('Оба frontend маршрута вызывают canonical assignment contracts', source.includes("postCurrentShiftAction('/assignments/line'") && source.includes("postCurrentShiftAction(`/work-areas/${workAreaBoard.workArea.id}/assign`") && !source.includes("postCurrentShiftAction('/assign'"));
  record('Targeted API payloads не раскрывают secrets/storagePath', safePayload({ activationPreview: activationPreview.data, remapPreview: remapPreview.data, areaPreview: areaPreview.data, planningBoard: planningBoard.data }));

  const auditCount = await db.auditLog.count({
    where: {
      factoryId: factory.id,
      action: { in: ['ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_LINE_MOVED', 'LINE_STAFFING_TEMPLATE_ACTIVATED', 'ASSIGNMENT_WASH_CREATED', 'ASSIGNMENT_WORK_AREA_CREATED', 'LINE_PLANNED_ASSIGNMENT_CREATED', 'LINE_PLANNING_TEMPLATE_UPDATED'] },
    },
  });
  record('Значимые assignment/remap действия фиксируются в общем аудите', auditCount >= 7, { count: auditCount });
}

async function run() {
  let artifacts = {};
  try {
    await main();
  } catch (error) {
    failed.push({ name: 'unhandled regression error', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    try { await cleanup(); } catch (error) {
      failed.push({ name: 'cleanup completed', detail: error instanceof Error ? error.message : String(error) });
    }
    try {
      artifacts = await activeArtifactCounts();
      record('Created active artifacts remaining = 0', Object.values(artifacts).every((value) => value === 0), artifacts);
    } catch (error) {
      failed.push({ name: 'artifact verification', detail: error instanceof Error ? error.message : String(error) });
    }
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify({
      runMarker: marker,
      createdInIsolatedFactory: true,
      cleanupMode: 'soft-close/deactivate only',
      activeArtifactsRemaining: artifacts,
      preexistingEntitiesDeleted: 0,
      passed: passed.length,
      failed: failed.length,
    }, null, 2)}\n`, 'utf8');
    await db.$disconnect();
  }

  console.log(`\nPhysical Field Fixes V5 / Plast2: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    for (const item of failed) console.error(`- ${item.name}`, item.detail ?? '');
    process.exitCode = 1;
  }
}

void run();
