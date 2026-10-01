const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  AssignmentKind,
  ChecklistRunStatus,
  DefrostStatus,
  EmployeeState,
  LineStatus,
  PrismaClient,
  ShiftType,
  TaskStatus,
  UserRole,
  WashStatus,
} = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const row = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (row) process.env.DATABASE_URL = row.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const stamp = Date.now();
const marker = `stage-semantic-v1-${stamp}`;
const state = { passed: [], warnings: [], failures: [], concurrency: [], dataQuality: {} };
const fixture = { userIds: [], lineIds: [], positionIds: [], templateIds: [], runIds: [], chatIds: [], taskIds: [] };

const ADMIN = 'pilot-pack-admin';
const MANAGEMENT = 'pilot-pack-management';
const MASTER = 'pilot-master-1';

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (/password|token|secret|database_?url|storagePath|authorization/i.test(key)) return '[hidden]';
    return item;
  }));
}

function pass(name, detail) {
  state.passed.push({ name, ...(detail === undefined ? {} : { detail: safe(detail) }) });
}

function warn(name, detail) {
  state.warnings.push({ name, detail: safe(detail) });
}

function fail(name, detail) {
  state.failures.push({ name, detail: safe(detail) });
}

function check(name, condition, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}

function concurrency(name, responses, canonical) {
  const statuses = responses.map((item) => item.status);
  const noServerError = statuses.every((status) => status < 500);
  state.concurrency.push({ name, statuses, noServerError, canonical: safe(canonical) });
  check(`${name}: no HTTP 500`, noServerError, { statuses, responses });
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await reachable(`${API}/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], {
    cwd: root,
    shell: true,
    windowsHide: true,
    stdio: 'ignore',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotPack() {
  const result = spawnSync('npm.cmd run pilot-pack:v1 --workspace backend', [], {
    cwd: root,
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `pilot-pack exited ${result.status}`);
}

async function request(method, pathname, { userId = ADMIN, factoryId, body } = {}) {
  const headers = {};
  if (userId !== null) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${API}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  } catch (error) {
    return { status: 599, data: { message: error.message } };
  }
}

async function createFixtures() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 is missing');
  const [mastersDepartment, kipiaDepartment] = await Promise.all([
    db.department.findFirst({ where: { factoryId: factory.id, code: 'masters', isActive: true, deletedAt: null } }),
    db.department.findFirst({ where: { factoryId: factory.id, code: 'kipia', isActive: true, deletedAt: null } }),
  ]);
  if (!mastersDepartment || !kipiaDepartment) throw new Error('pilot departments are incomplete');

  for (let index = 1; index <= 6; index += 1) {
    const id = `${marker}-worker-${index}`;
    fixture.userIds.push(id);
    await db.user.create({ data: { id, factoryId: factory.id, role: UserRole.WORKER, employeeState: EmployeeState.AVAILABLE } });
    await db.userFactoryAccess.create({
      data: { userId: id, factoryId: factory.id, role: UserRole.WORKER, departmentId: mastersDepartment.id, isActive: true, isGuest: false },
    });
  }
  const permission = await db.permission.findUnique({ where: { code: 'checklists.runs.self' } });
  if (permission) {
    await db.userPermissionOverride.createMany({
      data: fixture.userIds.map((userId) => ({ userId, factoryId: factory.id, permissionCode: permission.code, effect: 'ALLOW' })),
      skipDuplicates: true,
    });
  }

  for (let index = 1; index <= 2; index += 1) {
    const line = await db.line.create({
      data: { factoryId: factory.id, name: `Контроль параллельности ${stamp}-${index}`, status: LineStatus.WORK },
    });
    const position = await db.linePosition.create({
      data: { factoryId: factory.id, lineId: line.id, name: `Control position ${index}`, displayName: `Control position ${index}`, sortOrder: 1 },
    });
    fixture.lineIds.push(line.id);
    fixture.positionIds.push(position.id);
  }
  return { factory, mastersDepartment, kipiaDepartment };
}

function testShiftBoundaries() {
  const { factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');
  const cases = [
    ['2026-07-10T07:59:59+03:00', ShiftType.NIGHT, '2026-07-09'],
    ['2026-07-10T08:00:00+03:00', ShiftType.DAY, '2026-07-10'],
    ['2026-07-10T19:59:59+03:00', ShiftType.DAY, '2026-07-10'],
    ['2026-07-10T20:00:00+03:00', ShiftType.NIGHT, '2026-07-10'],
    ['2026-07-11T00:00:00+03:00', ShiftType.NIGHT, '2026-07-10'],
    ['2026-07-11T07:59:59+03:00', ShiftType.NIGHT, '2026-07-10'],
    ['2026-07-11T08:00:00+03:00', ShiftType.DAY, '2026-07-11'],
  ];
  for (const [value, shiftType, shiftDate] of cases) {
    const actual = factoryShiftTarget(new Date(value));
    check(`shift boundary ${value}`, actual.shiftType === shiftType && actual.shiftDate === shiftDate, { actual, shiftType, shiftDate });
  }
  const night = factoryShiftWindow({ shiftDate: '2026-07-10', shiftType: ShiftType.NIGHT });
  check('night shift window uses factory-local start date', night.from.toISOString() === '2026-07-10T17:00:00.000Z' && night.to.toISOString() === '2026-07-11T05:00:00.000Z', night);
  const utcEquivalent = factoryShiftTarget(new Date('2026-07-10T22:30:00.000Z'));
  check('UTC/browser timezone cannot move night shift date', utcEquivalent.shiftType === ShiftType.NIGHT && utcEquivalent.shiftDate === '2026-07-10', utcEquivalent);
}

async function setLineStatus(factoryId, lineId, status, suffix) {
  return request('PATCH', `/lines/${lineId}/status`, {
    userId: ADMIN,
    factoryId,
    body: { status, comment: `${marker}-${suffix}` },
  });
}

async function finishActiveLineProcesses(factoryId, lineId) {
  const wash = await db.washSession.findFirst({ where: { factoryId, lineId, status: { not: WashStatus.DONE } }, orderBy: { createdAt: 'desc' } });
  if (wash) await request('POST', `/wash/${wash.id}/complete`, { userId: ADMIN, factoryId, body: { operationId: `${marker}-complete-${wash.id}` } });
  const defrost = await db.defrostEvent.findFirst({ where: { factoryId, lineId, eventType: 'DEFROST', status: DefrostStatus.ACTIVE }, orderBy: { startAt: 'desc' } });
  if (defrost) await request('POST', `/defrost/lines/${lineId}/complete-today`, { userId: ADMIN, factoryId, body: { operationId: `${marker}-defrost-complete-${defrost.id}` } });
}

async function testLineProcessConcurrency(factoryId) {
  const lineId = fixture.lineIds[0];
  const stopped = await setLineStatus(factoryId, lineId, LineStatus.STOP, 'prepare-line-process');
  check('line prepared in STOP before wash/defrost race', stopped.status === 200, stopped);

  const [wash, defrost] = await Promise.all([
    request('POST', '/wash/start', { userId: ADMIN, factoryId, body: { lineId, operationId: `${marker}-wash-race` } }),
    request('POST', `/defrost/lines/${lineId}/start-today`, { userId: ADMIN, factoryId, body: { comment: marker, operationId: `${marker}-defrost-race` } }),
  ]);
  const [activeWashes, activeDefrosts] = await Promise.all([
    db.washSession.count({ where: { factoryId, lineId, status: { not: WashStatus.DONE } } }),
    db.defrostEvent.count({ where: { factoryId, lineId, eventType: 'DEFROST', status: DefrostStatus.ACTIVE } }),
  ]);
  concurrency('wash versus defrost start', [wash, defrost], { activeWashes, activeDefrosts });
  check('wash and defrost cannot be active together', activeWashes + activeDefrosts === 1, { wash, defrost, activeWashes, activeDefrosts });

  const workWhileBusy = await setLineStatus(factoryId, lineId, LineStatus.WORK, 'work-while-busy');
  check('WORK is rejected while wash or defrost is active', workWhileBusy.status === 409, workWhileBusy);
  await finishActiveLineProcesses(factoryId, lineId);
  const afterProcess = await db.line.findUnique({ where: { id: lineId } });
  check('finishing wash/defrost does not auto-start line', afterProcess?.status === LineStatus.STOP, afterProcess);
  const restored = await setLineStatus(factoryId, lineId, LineStatus.WORK, 'restore-line-process');
  check('explicit WORK succeeds after process completion', restored.status === 200, restored);
}

async function testFixtureWashRuntimeIsolation(factoryId) {
  const lineId = fixture.lineIds[1];
  await finishActiveLineProcesses(factoryId, lineId);
  const stopped = await setLineStatus(factoryId, lineId, LineStatus.STOP, 'fixture-wash-prepare');
  check('fixture wash isolation line prepared', stopped.status === 200, stopped);
  const overviewBefore = await request('GET', '/ops/overview', { userId: ADMIN, factoryId });

  const fixtureWash = await db.washSession.create({
    data: {
      factoryId,
      lineId,
      targetType: 'LINE',
      startedById: 'test-admin',
      status: WashStatus.IN_PROGRESS,
      objectDescription: `${marker} diagnostic fixture`,
    },
  });
  const [washList, lineList, overview] = await Promise.all([
    request('GET', '/wash', { userId: ADMIN, factoryId }),
    request('GET', '/lines', { userId: ADMIN, factoryId }),
    request('GET', '/ops/overview', { userId: ADMIN, factoryId }),
  ]);
  check('diagnostic wash is absent from ordinary wash list', washList.status === 200 && !washList.data?.some?.((item) => item.id === fixtureWash.id), washList);
  const runtimeLine = lineList.data?.find?.((item) => item.id === lineId);
  check('diagnostic wash is absent from ordinary line state', lineList.status === 200 && runtimeLine && !runtimeLine.activeWash, { status: lineList.status, runtimeLine });
  check(
    'diagnostic wash is absent from ordinary operations overview',
    overviewBefore.status === 200 && overview.status === 200 && overview.data?.activeWashCount === overviewBefore.data?.activeWashCount,
    { before: overviewBefore, after: overview },
  );

  const restored = await setLineStatus(factoryId, lineId, LineStatus.WORK, 'fixture-wash-does-not-block');
  check('diagnostic wash does not block ordinary line lifecycle', restored.status === 200, restored);
}

async function assignLine(factoryId, userId, lineIndex, slotIndex, extra = {}) {
  return request('POST', '/assignments/line', {
    userId: MASTER,
    factoryId,
    body: {
      targetUserId: userId,
      lineId: fixture.lineIds[lineIndex],
      positionId: fixture.positionIds[lineIndex],
      slotIndex,
      ...extra,
    },
  });
}

async function releaseUser(factoryId, userId) {
  return request('POST', '/assignments/release', { userId: MASTER, factoryId, body: { targetUserId: userId } });
}

async function testCurrentAssignmentConcurrency(factoryId) {
  const [sameSlotA, sameSlotB] = await Promise.all([
    assignLine(factoryId, fixture.userIds[0], 0, 1),
    assignLine(factoryId, fixture.userIds[1], 0, 1),
  ]);
  const slotRows = await db.assignment.findMany({ where: { factoryId, lineId: fixture.lineIds[0], positionId: fixture.positionIds[0], slotIndex: 1, endedAt: null } });
  concurrency('two workers versus one current slot', [sameSlotA, sameSlotB], { activeAssignments: slotRows.length });
  check('one current slot has exactly one active worker', slotRows.length === 1, { sameSlotA, sameSlotB, count: slotRows.length });
  await Promise.all(fixture.userIds.slice(0, 2).map((id) => releaseUser(factoryId, id)));

  const [sameUserA, sameUserB] = await Promise.all([
    assignLine(factoryId, fixture.userIds[2], 0, 2),
    assignLine(factoryId, fixture.userIds[2], 1, 1),
  ]);
  const userRows = await db.assignment.findMany({ where: { factoryId, userId: fixture.userIds[2], endedAt: null } });
  concurrency('one worker versus two current slots', [sameUserA, sameUserB], { activeAssignments: userRows.length });
  check('one worker has exactly one active assignment', userRows.length === 1, { sameUserA, sameUserB, count: userRows.length });
  await releaseUser(factoryId, fixture.userIds[2]);
}

async function testAssignmentMoveVersusWash(factoryId) {
  const userId = fixture.userIds[3];
  const initial = await assignLine(factoryId, userId, 0, 3);
  check('worker assigned before move/wash race', initial.status === 201, initial);
  const assignmentId = initial.data?.id;
  await setLineStatus(factoryId, fixture.lineIds[0], LineStatus.STOP, 'prepare-move-wash');
  const [move, wash] = await Promise.all([
    assignLine(factoryId, userId, 1, 2, { sourceAssignmentId: assignmentId }),
    request('POST', '/wash/start', { userId: ADMIN, factoryId, body: { lineId: fixture.lineIds[0], operationId: `${marker}-move-wash` } }),
  ]);
  const active = await db.assignment.findMany({ where: { factoryId, userId, endedAt: null } });
  concurrency('assignment move versus wash start', [move, wash], { activeAssignments: active.length, activeKinds: active.map((item) => item.kind) });
  check('move/wash race leaves one canonical worker assignment', active.length === 1, { move, wash, activeKinds: active.map((item) => item.kind) });
  await finishActiveLineProcesses(factoryId, fixture.lineIds[0]);
  await releaseUser(factoryId, userId);
  await setLineStatus(factoryId, fixture.lineIds[0], LineStatus.WORK, 'restore-move-wash');
}

async function testFutureAssignments(factoryId) {
  const { addFactoryShifts, factoryShiftTarget } = require('../dist/common/shift-time');
  const target = addFactoryShifts(factoryShiftTarget(new Date()), 1);
  const body = (userId, lineIndex, slotIndex) => ({
    shiftDate: target.shiftDate,
    shiftType: target.shiftType,
    targetUserId: userId,
    positionId: fixture.positionIds[lineIndex],
    slotIndex,
  });
  const [slotA, slotB] = await Promise.all([
    request('POST', `/lines/${fixture.lineIds[0]}/planning-board/assign`, { userId: MASTER, factoryId, body: body(fixture.userIds[0], 0, 1) }),
    request('POST', `/lines/${fixture.lineIds[0]}/planning-board/assign`, { userId: MASTER, factoryId, body: body(fixture.userIds[1], 0, 1) }),
  ]);
  const targetDate = new Date(`${target.shiftDate}T00:00:00+03:00`);
  const slotRows = await db.plannedLineAssignment.findMany({
    where: { factoryId, lineId: fixture.lineIds[0], shiftDate: targetDate, shiftType: target.shiftType, positionId: fixture.positionIds[0], slotIndex: 1, releasedAt: null },
  });
  concurrency('two workers versus one future slot', [slotA, slotB], { activePlans: slotRows.length });
  check('one future slot has exactly one worker', slotRows.length === 1, { slotA, slotB, count: slotRows.length });

  const [userA, userB] = await Promise.all([
    request('POST', `/lines/${fixture.lineIds[0]}/planning-board/assign`, { userId: MASTER, factoryId, body: body(fixture.userIds[2], 0, 2) }),
    request('POST', `/lines/${fixture.lineIds[1]}/planning-board/assign`, { userId: MASTER, factoryId, body: body(fixture.userIds[2], 1, 1) }),
  ]);
  const userRows = await db.plannedLineAssignment.findMany({ where: { factoryId, shiftDate: targetDate, shiftType: target.shiftType, userId: fixture.userIds[2], releasedAt: null } });
  concurrency('one worker versus two future slots', [userA, userB], { activePlans: userRows.length });
  check('one worker has exactly one future assignment', userRows.length === 1, { userA, userB, count: userRows.length });

  const activePlans = await db.plannedLineAssignment.findMany({ where: { factoryId, userId: { in: fixture.userIds }, releasedAt: null } });
  for (const plan of activePlans) {
    await request('POST', `/lines/${plan.lineId}/planning-board/release/${plan.id}`, { userId: MASTER, factoryId });
  }
}

async function createTask(factoryId, lineId, departmentId, operationId, description) {
  return request('POST', '/tasks', {
    userId: MASTER,
    factoryId,
    body: { lineId, type: 'LONG', description, deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(), departmentRecipientIds: [departmentId], operationId },
  });
}

async function testTaskConcurrency(factoryId, kipiaDepartmentId, mastersDepartmentId) {
  const operationId = `${marker}-task-create`;
  const [createA, createB] = await Promise.all([
    createTask(factoryId, fixture.lineIds[0], kipiaDepartmentId, operationId, `${marker} duplicate create`),
    createTask(factoryId, fixture.lineIds[0], kipiaDepartmentId, operationId, `${marker} duplicate create`),
  ]);
  const createdRows = await db.task.findMany({ where: { createdById: MASTER, operationId } });
  fixture.taskIds.push(...createdRows.map((item) => item.id));
  concurrency('duplicate task create operation', [createA, createB], { rows: createdRows.length });
  check('duplicate task create returns one task', createdRows.length === 1 && createA.data?.id === createB.data?.id, { createA, createB, rows: createdRows.length });

  const task = await createTask(factoryId, fixture.lineIds[0], kipiaDepartmentId, `${marker}-task-redirect`, `${marker} redirect race`);
  check('task for redirect/take race created', task.status === 201 && task.data?.id, task);
  if (!task.data?.id) return;
  fixture.taskIds.push(task.data.id);
  const [take, redirect] = await Promise.all([
    request('POST', `/tasks/${task.data.id}/take`, { userId: ADMIN, factoryId, body: { operationId: `${marker}-task-take` } }),
    request('POST', `/tasks/${task.data.id}/redirect`, { userId: ADMIN, factoryId, body: { newDepartmentRecipientIds: [mastersDepartmentId], comment: `${marker} redirect` } }),
  ]);
  const final = await db.task.findUnique({ where: { id: task.data.id }, include: { departmentRecipients: true } });
  concurrency('task take versus redirect', [take, redirect], { status: final?.status, version: final?.version });
  check('task take/redirect has canonical persisted state', Boolean(final) && final.version >= 2 && [TaskStatus.NEW, TaskStatus.IN_PROGRESS].includes(final.status), { take, redirect, final });
}

async function testChecklistConcurrency(factoryId, departmentId) {
  const template = await db.checklistTemplate.create({
    data: {
      factoryId,
      departmentId,
      name: `${marker} checklist`,
      scope: 'DEPARTMENT',
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 30,
      assignmentRoles: [UserRole.WORKER],
      assignmentUserIds: fixture.userIds.slice(0, 2),
      createdById: ADMIN,
      rows: { create: [{ title: `${marker} row`, sortOrder: 1, rowType: 'YES_NO', requiredAnswer: true, isRequired: true }] },
    },
  });
  fixture.templateIds.push(template.id);
  const [startA, startB] = await Promise.all([
    request('POST', '/checklists/runs/start', { userId: fixture.userIds[0], factoryId, body: { templateId: template.id } }),
    request('POST', '/checklists/runs/start', { userId: fixture.userIds[1], factoryId, body: { templateId: template.id } }),
  ]);
  const runs = await db.checklistRun.findMany({ where: { templateId: template.id, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } }, include: { rows: true, checks: { include: { rows: true } } } });
  fixture.runIds.push(...runs.map((run) => run.id));
  concurrency('two workers take one periodic checklist', [startA, startB], { activeRuns: runs.length });
  check('periodic checklist has one active owner', runs.length === 1, { startA, startB, count: runs.length });
  if (runs.length !== 1) return;
  const run = runs[0];
  const ownerId = run.userId;
  const repeated = await request('POST', '/checklists/runs/start', { userId: ownerId, factoryId, body: { templateId: template.id } });
  check('same checklist owner repeat is idempotent', repeated.status === 201 && repeated.data?.id === run.id, repeated);

  const activeCheck = run.checks.find((item) => item.status === 'ACTIVE');
  const row = run.rows[0];
  const [answerA, answerB] = await Promise.all([
    request('POST', `/checklists/runs/${run.id}/rows/${row.id}/complete`, { userId: ownerId, factoryId, body: { checkId: activeCheck?.id, status: 'OK', answerBoolean: true, operationId: `${marker}-answer-a` } }),
    request('POST', `/checklists/runs/${run.id}/rows/${row.id}/complete`, { userId: ownerId, factoryId, body: { checkId: activeCheck?.id, status: 'OK', answerBoolean: true, operationId: `${marker}-answer-b` } }),
  ]);
  const checkAfterAnswer = await db.checklistRunCheck.findUnique({ where: { id: activeCheck.id }, include: { rows: true } });
  const completedRows = checkAfterAnswer?.rows.filter((item) => item.status !== 'PENDING') ?? [];
  concurrency('two answers for one checklist occurrence', [answerA, answerB], { completedRows: completedRows.length, checkStatus: checkAfterAnswer?.status });
  check('one checklist occurrence is completed once', completedRows.length === 1 && Boolean(completedRows[0].completedById) && Boolean(completedRows[0].completedAt), { answerA, answerB, completedRows });

  const nextCheck = await db.checklistRunCheck.findFirst({ where: { runId: run.id, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
  check('periodic checklist opened next occurrence', Boolean(nextCheck), nextCheck);
  if (nextCheck) {
    const dueAt = new Date(Date.now() + 5 * 60_000);
    await db.$transaction([
      db.checklistRunCheck.update({ where: { id: nextCheck.id }, data: { dueAt } }),
      db.checklistRun.update({ where: { id: run.id }, data: { nextCheckAt: dueAt, shiftEndsAt: new Date(Date.now() + 60 * 60_000) } }),
    ]);
    const [workspaceA, workspaceB] = await Promise.all([
      request('GET', '/checklists/workspace', { userId: ownerId, factoryId }),
      request('GET', '/checklists/workspace', { userId: ownerId, factoryId }),
    ]);
    const reminders = await db.notification.count({
      where: { userId: ownerId, entityType: 'CHECKLIST_RUN_CHECK', entityId: nextCheck.id, type: `CHECKLIST_CHECK_DUE_SOON_${nextCheck.sequence}` },
    });
    concurrency('parallel checklist scheduler reminders', [workspaceA, workspaceB], { reminders });
    check('checklist reminder is created once', reminders === 1, { workspaceA, workspaceB, reminders });

    const availability = await request('GET', `/shift-log/handover/availability?departmentId=${departmentId}`, { userId: ADMIN, factoryId });
    const handover = await request('GET', `/shift-log/handover/summary?departmentId=${departmentId}`, { userId: ADMIN, factoryId });
    const handoverText = JSON.stringify(handover.data ?? {});
    const shiftLogSource = fs.readFileSync(path.join(root, 'backend', 'src', 'modules', 'shift-log', 'shift-log.service.ts'), 'utf8');
    const snapshotSource = shiftLogSource.match(/private async buildHandoverSnapshot[\s\S]*?private async assertHandoverAccess/)?.[0] ?? '';
    const checklistExcluded = !/checklist/i.test(snapshotSource);
    const handoverVerified = availability.data?.available
      ? handover.status === 200 && !handoverText.includes(template.id) && !handoverText.includes(marker)
      : handover.status === 409 && checklistExcluded;
    check('unfinished personal checklist is absent from handover', handoverVerified, {
      availabilityStatus: availability.status,
      available: availability.data?.available,
      handoverStatus: handover.status,
      checklistExcluded,
    });

    await db.checklistRun.update({ where: { id: run.id }, data: { shiftEndsAt: new Date(Date.now() - 1000) } });
    const activeRow = await db.checklistRunRow.findFirst({ where: { runId: run.id } });
    const [lateAnswer, autoClose] = await Promise.all([
      request('POST', `/checklists/runs/${run.id}/rows/${activeRow.id}/complete`, { userId: ownerId, factoryId, body: { checkId: nextCheck.id, status: 'OK', answerBoolean: true, operationId: `${marker}-late-answer` } }),
      request('GET', '/checklists/workspace', { userId: ownerId, factoryId }),
    ]);
    const closed = await db.checklistRun.findUnique({ where: { id: run.id } });
    concurrency('checklist answer versus automatic close', [lateAnswer, autoClose], { status: closed?.status });
    check('expired checklist has one automatic final state', closed?.status === ChecklistRunStatus.AUTO_CLOSED, { lateAnswer, autoClose, status: closed?.status });
  }
}

async function createChat(factoryId, title, userIds) {
  return request('POST', '/chats', { userId: ADMIN, factoryId, body: { type: 'CUSTOM', title, userIds } });
}

async function testChatConcurrency(factoryId) {
  const chatA = await createChat(factoryId, `${marker} chat A`, fixture.userIds.slice(0, 2));
  const chatB = await createChat(factoryId, `${marker} chat B`, fixture.userIds.slice(0, 2));
  check('semantic chats created', chatA.status === 201 && chatB.status === 201, { chatA, chatB });
  if (!chatA.data?.id || !chatB.data?.id) return;
  fixture.chatIds.push(chatA.data.id, chatB.data.id);
  const operationId = `${marker}-chat-send`;
  const [sendA, sendB] = await Promise.all([
    request('POST', `/chats/${chatA.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} message`, operationId } }),
    request('POST', `/chats/${chatA.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} message`, operationId } }),
  ]);
  const messages = await db.chatMessage.findMany({ where: { authorId: fixture.userIds[0], operationId } });
  concurrency('duplicate chat send operation', [sendA, sendB], { messages: messages.length });
  check('duplicate chat send creates one message', messages.length === 1 && sendA.data?.id === sendB.data?.id, { sendA, sendB, count: messages.length });
  const crossChat = await request('POST', `/chats/${chatB.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} cross chat`, operationId } });
  check('same chat operation cannot be reused in another chat', crossChat.status === 409, crossChat);

  const raceMessage = await request('POST', `/chats/${chatA.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} edit-delete`, operationId: `${marker}-edit-delete` } });
  check('chat message prepared for edit/delete race', raceMessage.status === 201 && raceMessage.data?.id, raceMessage);
  if (raceMessage.data?.id) {
    const [edit, remove] = await Promise.all([
      request('PATCH', `/chats/${chatA.data.id}/messages/${raceMessage.data.id}`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} edited` } }),
      request('DELETE', `/chats/${chatA.data.id}/messages/${raceMessage.data.id}`, { userId: fixture.userIds[0], factoryId }),
    ]);
    const final = await db.chatMessage.findUnique({ where: { id: raceMessage.data.id } });
    concurrency('chat edit versus delete', [edit, remove], { deleted: Boolean(final?.deletedAt), edited: Boolean(final?.editedAt) });
    check('chat delete wins canonical visible state', Boolean(final?.deletedAt), { edit, remove, final });
  }

  const reactionMessage = messages[0];
  if (reactionMessage) {
    const [reactionA, reactionB] = await Promise.all([
      request('POST', `/chats/${chatA.data.id}/messages/${reactionMessage.id}/reactions`, { userId: fixture.userIds[1], factoryId, body: { emoji: '👍' } }),
      request('POST', `/chats/${chatA.data.id}/messages/${reactionMessage.id}/reactions`, { userId: fixture.userIds[1], factoryId, body: { emoji: '👍' } }),
    ]);
    const activeReactions = await db.chatMessageReaction.count({ where: { messageId: reactionMessage.id, userId: fixture.userIds[1], emoji: '👍', deletedAt: null } });
    concurrency('parallel chat reaction toggles', [reactionA, reactionB], { activeReactions });
    check('reaction toggle leaves at most one active row', activeReactions <= 1, { reactionA, reactionB, activeReactions });
  }

  const [sendDuringRemoval, removeMember] = await Promise.all([
    request('POST', `/chats/${chatA.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} member race`, operationId: `${marker}-member-race` } }),
    request('DELETE', `/chats/${chatA.data.id}/members/${fixture.userIds[0]}`, { userId: ADMIN, factoryId }),
  ]);
  concurrency('chat send versus membership removal', [sendDuringRemoval, removeMember], {});
  check('membership removal succeeds and concurrent send is canonical', removeMember.status === 200 && [201, 403].includes(sendDuringRemoval.status), { sendDuringRemoval, removeMember });
  const afterRemoval = await request('POST', `/chats/${chatA.data.id}/messages`, { userId: fixture.userIds[0], factoryId, body: { text: `${marker} denied`, operationId: `${marker}-after-removal` } });
  check('removed chat member cannot send through direct API', afterRemoval.status === 403, afterRemoval);
}

async function testAggregateRbac(factoryId) {
  const worker = fixture.userIds[5];
  const ownFactory = await request('GET', '/shift-log/handover/summary', { userId: worker, factoryId });
  check('ordinary worker cannot read aggregate handover endpoint', ownFactory.status === 403, ownFactory);
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, deletedAt: null } });
  if (otherFactory) {
    const crossFactory = await request('GET', '/shift-log/handover/summary', { userId: worker, factoryId: otherFactory.id });
    check('cross-factory aggregate request is denied', crossFactory.status === 403, crossFactory);
  } else {
    warn('cross-factory aggregate request', 'No second active factory is available');
  }
}

function testFrontendMutationContract() {
  const client = fs.readFileSync(path.join(root, 'frontend', 'src', 'api', 'client.ts'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.tsx'), 'utf8');
  const combined = `${client}\n${app}`;
  check('critical mutations are not acknowledged through offline queue', !/queueOnNetworkError|startSyncLoop|queued\s*:\s*true/.test(combined), null);
  check('network failure has explicit Russian non-persistence message', combined.includes('Нет связи с сервером. Действие не сохранено.'), null);
}

async function collectDataQuality(factoryId) {
  const { hasPilotFixtureMarker, isDiagnosticFixtureActor } = require('../dist/common/pilot-visibility');
  const isFixtureActor = (userId) => isDiagnosticFixtureActor(String(userId ?? ''));
  const [assignments, washes, defrosts, tasks, runs, checks, reminders, completedRows, handovers, chatAttachments] = await Promise.all([
    db.assignment.findMany({ where: { factoryId, endedAt: null }, select: { userId: true, lineId: true, positionId: true, slotIndex: true, kind: true } }),
    db.washSession.findMany({
      where: { factoryId, status: { not: WashStatus.DONE }, deletedAt: null },
      select: { id: true, lineId: true, objectName: true, objectDescription: true, startedById: true, createdAt: true, line: { select: { name: true, status: true } } },
    }),
    db.defrostEvent.findMany({ where: { factoryId, eventType: 'DEFROST', status: DefrostStatus.ACTIVE }, select: { id: true, lineId: true, startAt: true } }),
    db.task.findMany({ where: { factoryId, deletedAt: null }, select: { id: true, description: true, operationId: true, createdById: true, status: true, startedAt: true, doneAt: true, createdAt: true } }),
    db.checklistRun.findMany({ where: { factoryId, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } }, select: { id: true, templateId: true, lineId: true, shiftDate: true, shiftType: true, userId: true, frequencyIntervalValue: true } }),
    db.checklistRunCheck.findMany({ where: { run: { factoryId }, status: 'ACTIVE' }, select: { runId: true } }),
    db.notification.findMany({ where: { factoryId, type: { startsWith: 'CHECKLIST_CHECK_' } }, select: { userId: true, type: true, entityType: true, entityId: true } }),
    db.checklistRunCheckRow.findMany({ where: { run: { factoryId }, status: { not: 'PENDING' } }, select: { completedById: true, completedAt: true } }),
    db.shiftLog.findMany({ where: { factoryId, text: { startsWith: '__ZAVOD_SHIFT_HANDOVER_V1__' } }, select: { text: true } }),
    db.attachment.findMany({ where: { entityType: 'CHAT_MESSAGE', deletedAt: null }, select: { entityId: true } }),
  ]);

  const duplicateKeys = (items, key) => {
    const counts = new Map();
    for (const item of items) {
      const value = key(item);
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.values()].filter((count) => count > 1).length;
  };
  const activeWashLines = new Set(washes.map((item) => item.lineId).filter(Boolean));
  const nonFixtureWashes = washes.filter((item) => !isFixtureActor(item.startedById) && !hasPilotFixtureMarker(item.id, item.line?.name, item.objectName, item.objectDescription));
  const fixtureWashes = washes.filter((item) => !nonFixtureWashes.includes(item));
  const nonFixtureTasks = tasks.filter((item) => !isFixtureActor(item.createdById) && !hasPilotFixtureMarker(item.id, item.description, item.operationId));
  const fixtureTasks = tasks.filter((item) => !nonFixtureTasks.includes(item));
  const handoverProblems = handovers.filter((item) => {
    try {
      const payload = JSON.parse(item.text.replace('__ZAVOD_SHIFT_HANDOVER_V1__', ''));
      const sectionKeys = Object.keys(payload.sections ?? {});
      return sectionKeys.some((key) => /wash|okk|checklist/i.test(key));
    } catch {
      return true;
    }
  }).length;
  const messageIds = [...new Set(chatAttachments.map((item) => item.entityId))];
  const existingMessages = messageIds.length ? await db.chatMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true } }) : [];
  const existingMessageIds = new Set(existingMessages.map((item) => item.id));

  state.dataQuality = {
    duplicateActiveAssignmentUsers: duplicateKeys(assignments, (item) => item.userId),
    duplicateActiveAssignmentSlots: duplicateKeys(assignments, (item) => item.lineId && item.positionId && item.slotIndex !== null ? `${item.lineId}:${item.positionId}:${item.slotIndex}` : null),
    linesWithWashAndDefrost: defrosts.filter((item) => activeWashLines.has(item.lineId)).length,
    staleActiveWashesOver24h: washes.filter((item) => Date.now() - item.createdAt.getTime() > 24 * 60 * 60_000).length,
    staleActiveWashesOver24hNonFixture: nonFixtureWashes.filter((item) => Date.now() - item.createdAt.getTime() > 24 * 60 * 60_000).length,
    staleActiveWashesOver24hFixture: fixtureWashes.filter((item) => Date.now() - item.createdAt.getTime() > 24 * 60 * 60_000).length,
    nonFixtureWorkingLinesWithActiveWash: nonFixtureWashes.filter((item) => item.line?.status === LineStatus.WORK).length,
    staleActiveDefrostsOver24h: defrosts.filter((item) => Date.now() - item.startAt.getTime() > 24 * 60 * 60_000).length,
    doneTasksWithoutDoneAt: tasks.filter((item) => item.status === TaskStatus.DONE && !item.doneAt).length,
    inProgressTasksWithoutStartedAt: tasks.filter((item) => item.status === TaskStatus.IN_PROGRESS && !item.startedAt).length,
    nonFixtureInProgressTasksWithoutStartedAt: nonFixtureTasks.filter((item) => item.status === TaskStatus.IN_PROGRESS && !item.startedAt).length,
    fixtureInProgressTasksWithoutStartedAt: fixtureTasks.filter((item) => item.status === TaskStatus.IN_PROGRESS && !item.startedAt).length,
    taskTimestampOrderProblems: tasks.filter((item) => (item.startedAt && item.startedAt < item.createdAt) || (item.doneAt && item.startedAt && item.doneAt < item.startedAt)).length,
    nonFixtureTaskTimestampOrderProblems: nonFixtureTasks.filter((item) => (item.startedAt && item.startedAt < item.createdAt) || (item.doneAt && item.startedAt && item.doneAt < item.startedAt)).length,
    fixtureTaskTimestampOrderProblems: fixtureTasks.filter((item) => (item.startedAt && item.startedAt < item.createdAt) || (item.doneAt && item.startedAt && item.doneAt < item.startedAt)).length,
    duplicateActivePeriodicRuns: duplicateKeys(runs.filter((item) => item.frequencyIntervalValue), (item) => `${item.templateId}:${item.shiftDate?.toISOString()}:${item.shiftType}:${item.lineId ?? 'none'}`),
    duplicateActiveChecklistChecks: duplicateKeys(checks, (item) => item.runId),
    duplicateChecklistReminderKeys: duplicateKeys(reminders, (item) => `${item.userId}:${item.type}:${item.entityType}:${item.entityId}`),
    completedChecklistAnswersMissingActorOrTime: completedRows.filter((item) => !item.completedById || !item.completedAt).length,
    malformedOrLegacyHandoverSnapshots: handoverProblems,
    orphanChatAttachmentRecords: chatAttachments.filter((item) => !existingMessageIds.has(item.entityId)).length,
  };
  pass('read-only data-quality inventory collected', state.dataQuality);
  if (state.dataQuality.staleActiveWashesOver24hNonFixture === 0) {
    pass('no stale active non-fixture washes');
  } else {
    warn('stale active non-fixture washes require operational review', {
      count: state.dataQuality.staleActiveWashesOver24hNonFixture,
      workingLines: state.dataQuality.nonFixtureWorkingLinesWithActiveWash,
    });
  }
  check('no non-fixture WORK line has an active wash', state.dataQuality.nonFixtureWorkingLinesWithActiveWash === 0, state.dataQuality);
  check(
    'no non-fixture task timestamp anomalies',
    state.dataQuality.nonFixtureInProgressTasksWithoutStartedAt === 0 && state.dataQuality.nonFixtureTaskTimestampOrderProblems === 0,
    state.dataQuality,
  );
}

async function cleanup() {
  const now = new Date();
  if (fixture.lineIds.length) {
    await db.washSession.updateMany({ where: { lineId: { in: fixture.lineIds }, status: { not: WashStatus.DONE } }, data: { status: WashStatus.DONE, completedAt: now, version: { increment: 1 } } });
    await db.defrostEvent.updateMany({ where: { lineId: { in: fixture.lineIds }, eventType: 'DEFROST', status: DefrostStatus.ACTIVE }, data: { status: DefrostStatus.COMPLETED, endAt: now, durationSeconds: 0, endComment: `${marker} cleanup` } });
    await db.line.updateMany({ where: { id: { in: fixture.lineIds } }, data: { status: LineStatus.WORK, deactivatedAt: now, deactivationReason: `${marker} cleanup` } });
    await db.linePosition.updateMany({ where: { id: { in: fixture.positionIds } }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} cleanup` } });
  }
  if (fixture.userIds.length) {
    await db.assignment.updateMany({ where: { userId: { in: fixture.userIds }, endedAt: null }, data: { endedAt: now, endedById: ADMIN, comment: `${marker} cleanup`, version: { increment: 1 } } });
    await db.plannedLineAssignment.updateMany({ where: { userId: { in: fixture.userIds }, releasedAt: null }, data: { releasedAt: now, releasedById: ADMIN, comment: `${marker} cleanup` } });
    await db.plannedShiftAssignment.updateMany({ where: { userId: { in: fixture.userIds }, releasedAt: null }, data: { releasedAt: now, releasedById: ADMIN, comment: `${marker} cleanup` } });
    await db.user.updateMany({ where: { id: { in: fixture.userIds } }, data: { employeeState: EmployeeState.AVAILABLE, blockedAt: now, version: { increment: 1 } } });
    await db.userFactoryAccess.updateMany({ where: { userId: { in: fixture.userIds } }, data: { isActive: false, deactivatedAt: now, deactivatedById: ADMIN, deactivationReason: `${marker} cleanup` } });
  }
  if (fixture.templateIds.length) {
    await db.checklistRun.updateMany({ where: { templateId: { in: fixture.templateIds }, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } }, data: { status: ChecklistRunStatus.CLOSED, closedAt: now, closedById: ADMIN, closeReason: `${marker} cleanup`, closeKind: 'MANUAL', nextCheckAt: null } });
    await db.checklistTemplate.updateMany({ where: { id: { in: fixture.templateIds } }, data: { isActive: false, archivedAt: now } });
  }
  if (fixture.chatIds.length) await db.chat.updateMany({ where: { id: { in: fixture.chatIds } }, data: { isActive: false, archivedAt: now } });
  if (fixture.taskIds.length) await db.task.updateMany({ where: { id: { in: fixture.taskIds } }, data: { status: TaskStatus.DONE, doneAt: now, doneById: ADMIN, archivedAt: now, version: { increment: 1 } } });
}

async function main() {
  let backend = null;
  if (!(await reachable(`${API}/health`))) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    runPilotPack();
    const { factory, mastersDepartment, kipiaDepartment } = await createFixtures();
    testShiftBoundaries();
    testFrontendMutationContract();
    await testLineProcessConcurrency(factory.id);
    await testFixtureWashRuntimeIsolation(factory.id);
    await testCurrentAssignmentConcurrency(factory.id);
    await testAssignmentMoveVersusWash(factory.id);
    await testFutureAssignments(factory.id);
    await testTaskConcurrency(factory.id, kipiaDepartment.id, mastersDepartment.id);
    await testChecklistConcurrency(factory.id, mastersDepartment.id);
    await testChatConcurrency(factory.id);
    await testAggregateRbac(factory.id);
    await collectDataQuality(factory.id);
  } catch (error) {
    fail('semantic integrity regression crashed', { message: error.message, stack: error.stack });
  } finally {
    try { await cleanup(); } catch (error) { fail('semantic integrity fixture cleanup failed', { message: error.message }); }
    try { runPilotPack(); } catch (error) { fail('pilot pack restore failed', { message: error.message }); }
    await db.$disconnect();
    stopBackend(backend);
  }
  console.log(JSON.stringify(safe(state), null, 2));
  console.log(`semantic-integrity-v1: ${state.passed.length} passed, ${state.warnings.length} warnings, ${state.failures.length} failed`);
  process.exitCode = state.failures.length ? 1 : 0;
}

main().catch(async (error) => {
  fail('semantic integrity runner failed', { message: error.message, stack: error.stack });
  try { await cleanup(); } catch {}
  await db.$disconnect();
  console.error(JSON.stringify(safe(state), null, 2));
  process.exitCode = 1;
});
