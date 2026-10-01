const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const marker = `__SCHEDULER_BOUNDARY_${runId}__`;
const suffix = runId.slice(-6);
const clockFile = path.join(os.tmpdir(), `zavod-scheduler-boundary-${runId}.txt`);
const runtimeDir = path.join(rootDir, '.codex-runtime', 'scheduler-boundary-proof');

process.env.NODE_ENV = 'test';
process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
process.env.CHECKLIST_MAINTENANCE_ENABLED = 'false';
process.env.ANNOUNCEMENT_MAINTENANCE_ENABLED = 'false';
process.env.ZAVOD_INTERNAL_TEST_NOW_FILE = clockFile;

const D = '2031-04-15';
const D1 = '2031-04-16';
const TIMES = {
  dayStart: `${D}T08:00:00+03:00`,
  beforeNight: `${D}T19:59:59+03:00`,
  nightStart: `${D}T20:00:00+03:00`,
  nightMinute: `${D}T20:01:00+03:00`,
  nightThirtyOne: `${D}T20:31:00+03:00`,
  beforeMidnight: `${D}T23:59:59+03:00`,
  midnight: `${D1}T00:00:00+03:00`,
  afterMidnight: `${D1}T00:30:00+03:00`,
  beforeDay: `${D1}T07:59:59+03:00`,
  dayStartNext: `${D1}T08:00:00+03:00`,
};

fs.writeFileSync(clockFile, `${TIMES.beforeNight}\n`, 'utf8');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { factoryShiftDate, factoryShiftTarget } = require('../dist/common/shift-time');
const { LineService } = require('../dist/modules/line/line.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { WsService } = require('../dist/ws/ws.service');

const passed = [];
const failed = [];
const state = {
  factoryIds: [],
  userIds: [],
  lineIds: [],
  positionIds: [],
  templateIds: [],
  taskIds: [],
  masterIds: [],
};

function check(name, condition, evidence) {
  const row = { name, ...(evidence === undefined ? {} : { evidence }) };
  (condition ? passed : failed).push(row);
}

function writeClock(value) {
  fs.writeFileSync(clockFile, `${value}\n`, 'utf8');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function targetDate(shiftDate, shiftType) {
  return factoryShiftDate({ shiftDate, shiftType });
}

function context(userId, factoryId, role = 'MASTER', permissions = []) {
  return {
    userId,
    selectedFactoryId: factoryId,
    role,
    departmentId: null,
    companyId: null,
    permissions,
    isAdmin: role === 'ADMIN',
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId: null },
    id: userId,
    factoryId,
  };
}

async function operationalHash(db, excludedFactoryIds = [], excludedUserIds = []) {
  const factoryFilter = excludedFactoryIds.length ? { notIn: excludedFactoryIds } : undefined;
  const userFilter = excludedUserIds.length ? { notIn: excludedUserIds } : undefined;
  const [factories, users, lines, assignments, sessions, linePlans, shiftPlans, tasks] = await Promise.all([
    db.factory.findMany({
      where: factoryFilter ? { id: factoryFilter } : {},
      select: { id: true, isActive: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.user.findMany({
      where: userFilter ? { id: userFilter } : {},
      select: { id: true, employeeState: true, version: true, blockedAt: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.line.findMany({
      where: factoryFilter ? { factoryId: factoryFilter } : {},
      select: { id: true, factoryId: true, status: true, version: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.assignment.findMany({
      where: { endedAt: null, ...(factoryFilter ? { factoryId: factoryFilter } : {}) },
      select: { id: true, factoryId: true, userId: true, kind: true, lineId: true, positionId: true, slotIndex: true, startedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.shiftSession.findMany({
      where: { status: 'ACTIVE', ...(factoryFilter ? { factoryId: factoryFilter } : {}) },
      select: { id: true, factoryId: true, userId: true, startedAt: true, plannedEndAt: true, shiftType: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedLineAssignment.findMany({
      where: { releasedAt: null, ...(factoryFilter ? { factoryId: factoryFilter } : {}) },
      select: { id: true, factoryId: true, userId: true, lineId: true, shiftDate: true, shiftType: true, slotIndex: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedShiftAssignment.findMany({
      where: { releasedAt: null, ...(factoryFilter ? { factoryId: factoryFilter } : {}) },
      select: { id: true, factoryId: true, userId: true, shiftDate: true, shiftType: true, kind: true },
      orderBy: { id: 'asc' },
    }),
    db.task.findMany({
      where: { archivedAt: null, deletedAt: null, ...(factoryFilter ? { factoryId: factoryFilter } : {}) },
      select: { id: true, factoryId: true, status: true, type: true, version: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  return stableHash({ factories, users, lines, assignments, sessions, linePlans, shiftPlans, tasks });
}

async function createFactory(db, label) {
  const factory = await db.factory.create({
    data: { name: `${label} ${suffix}`, code: `scheduler-${label.toLowerCase()}-${runId}` },
  });
  state.factoryIds.push(factory.id);
  return factory;
}

async function createUser(db, factoryId, role, employeeState = 'AVAILABLE') {
  const user = await db.user.create({ data: { factoryId, role, employeeState } });
  await db.userFactoryAccess.create({ data: { userId: user.id, factoryId, role, isActive: true, isGuest: false } });
  state.userIds.push(user.id);
  if (role === 'MASTER') state.masterIds.push(user.id);
  return user;
}

async function createLineFixture(db, factoryId, name, requiredCount, eventAt) {
  const line = await db.line.create({ data: { factoryId, name: `${name} ${suffix}`, status: 'WORK' } });
  const position = await db.linePosition.create({
    data: {
      factoryId,
      lineId: line.id,
      name: `Оператор ${suffix}`,
      displayName: 'Оператор',
      normalizedName: `operator-${suffix}-${state.lineIds.length}`,
      sortOrder: 1,
    },
  });
  const template = await db.lineStaffingTemplate.create({
    data: {
      factoryId,
      lineId: line.id,
      name: `Состав на ${requiredCount}`,
      items: {
        create: {
          positionId: position.id,
          requiredCount,
          minRequired: requiredCount,
          maxRequired: requiredCount,
          defaultPlanned: requiredCount,
          plannedCount: requiredCount,
          sortOrder: 1,
        },
      },
    },
  });
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: template.id } });
  await db.lineEvent.create({
    data: { factoryId, lineId: line.id, status: 'WORK', comment: marker, createdAt: new Date(eventAt) },
  });
  state.lineIds.push(line.id);
  state.positionIds.push(position.id);
  state.templateIds.push(template.id);
  return { line, position, template };
}

async function createSession(db, factoryId, userId, masterId, startedAt, shiftType, plannedEndAt) {
  return db.shiftSession.create({
    data: {
      factoryId,
      userId,
      startedAt: new Date(startedAt),
      shiftType,
      status: 'ACTIVE',
      durationHours: 12,
      plannedEndAt: new Date(plannedEndAt),
      startedById: masterId,
    },
  });
}

async function createActual(db, input) {
  return db.assignment.create({
    data: {
      factoryId: input.factoryId,
      userId: input.userId,
      lineId: input.line.line.id,
      kind: 'LINE',
      positionId: input.line.position.id,
      staffingTemplateId: input.line.template.id,
      slotIndex: input.slotIndex,
      startedAt: new Date(input.startedAt),
      startedById: input.masterId,
      comment: marker,
    },
  });
}

async function createLinePlan(db, input) {
  const shiftDate = targetDate(input.shiftDate, input.shiftType);
  await db.lineShiftWorkPlan.upsert({
    where: {
      factoryId_lineId_shiftDate_shiftType: {
        factoryId: input.factoryId,
        lineId: input.line.line.id,
        shiftDate,
        shiftType: input.shiftType,
      },
    },
    create: {
      factoryId: input.factoryId,
      lineId: input.line.line.id,
      shiftDate,
      shiftType: input.shiftType,
      staffingTemplateId: input.line.template.id,
      createdById: input.masterId,
    },
    update: { staffingTemplateId: input.line.template.id, updatedById: input.masterId },
  });
  return db.plannedLineAssignment.create({
    data: {
      factoryId: input.factoryId,
      lineId: input.line.line.id,
      shiftDate,
      shiftType: input.shiftType,
      positionId: input.line.position.id,
      staffingTemplateId: input.line.template.id,
      slotIndex: input.slotIndex,
      userId: input.userId,
      createdById: input.masterId,
      comment: marker,
    },
  });
}

async function factoryStateHash(db, factoryId) {
  const [line, assignments, sessions, tasks, events] = await Promise.all([
    db.line.findMany({ where: { factoryId }, select: { id: true, status: true, version: true }, orderBy: { id: 'asc' } }),
    db.assignment.findMany({ where: { factoryId }, select: { id: true, userId: true, startedAt: true, endedAt: true, version: true }, orderBy: { id: 'asc' } }),
    db.shiftSession.findMany({ where: { factoryId }, select: { id: true, userId: true, status: true, startedAt: true, endedAt: true, version: true }, orderBy: { id: 'asc' } }),
    db.task.findMany({ where: { factoryId }, select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    db.lineEvent.findMany({ where: { factoryId }, select: { id: true, status: true, createdAt: true, confirmedEndAt: true }, orderBy: { id: 'asc' } }),
  ]);
  return stableHash({ line, assignments, sessions, tasks, events });
}

async function activeInventory(db) {
  const factoryIds = state.factoryIds.length ? state.factoryIds : ['__none__'];
  const userIds = state.userIds.length ? state.userIds : ['__none__'];
  const lineIds = state.lineIds.length ? state.lineIds : ['__none__'];
  const [factories, users, accesses, sessions, linePlans, plannedLine, plannedShift, assignments, lines, tasks, other] = await Promise.all([
    db.factory.count({ where: { id: { in: factoryIds }, isActive: true, deactivatedAt: null, deletedAt: null } }),
    db.user.count({ where: { id: { in: userIds }, blockedAt: null, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { userId: { in: userIds }, isActive: true } }),
    db.shiftSession.count({ where: { factoryId: { in: factoryIds }, status: 'ACTIVE' } }),
    db.lineShiftWorkPlan.count({ where: { factoryId: { in: factoryIds }, factory: { isActive: true, deactivatedAt: null } } }),
    db.plannedLineAssignment.count({ where: { factoryId: { in: factoryIds }, releasedAt: null } }),
    db.plannedShiftAssignment.count({ where: { factoryId: { in: factoryIds }, releasedAt: null } }),
    db.assignment.count({ where: { factoryId: { in: factoryIds }, endedAt: null } }),
    db.line.count({ where: { id: { in: lineIds }, deactivatedAt: null, deletedAt: null } }),
    db.task.count({ where: { factoryId: { in: factoryIds }, archivedAt: null, deletedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] } } }),
    db.lineEvent.count({ where: { factoryId: { in: factoryIds }, line: { deactivatedAt: null, deletedAt: null } } }),
  ]);
  return { factories, users, accesses, sessions, linePlans, plannedLine, plannedShift, assignments, lines, tasks, other };
}

async function cleanup(db) {
  const at = new Date();
  const factoryIds = state.factoryIds.length ? state.factoryIds : ['__none__'];
  const userIds = state.userIds.length ? state.userIds : ['__none__'];
  await db.assignment.updateMany({
    where: { factoryId: { in: factoryIds }, endedAt: null },
    data: { endedAt: at, comment: marker, version: { increment: 1 } },
  });
  await db.shiftSession.updateMany({
    where: { factoryId: { in: factoryIds }, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: at, autoClosed: true, version: { increment: 1 } },
  });
  await db.plannedLineAssignment.updateMany({
    where: { factoryId: { in: factoryIds }, releasedAt: null },
    data: { releasedAt: at, comment: marker },
  });
  await db.plannedShiftAssignment.updateMany({
    where: { factoryId: { in: factoryIds }, releasedAt: null },
    data: { releasedAt: at, comment: marker },
  });
  await db.task.updateMany({
    where: { factoryId: { in: factoryIds }, archivedAt: null, deletedAt: null },
    data: { status: 'DONE', doneAt: at, archivedAt: at, version: { increment: 1 } },
  });
  await db.line.updateMany({
    where: { factoryId: { in: factoryIds }, deactivatedAt: null },
    data: { deactivatedAt: at, deactivationReason: marker },
  });
  await db.linePosition.updateMany({
    where: { factoryId: { in: factoryIds }, deactivatedAt: null },
    data: { isActive: false, deactivatedAt: at, deactivationReason: marker },
  });
  await db.lineStaffingTemplate.updateMany({
    where: { factoryId: { in: factoryIds }, deactivatedAt: null },
    data: { isActive: false, deactivatedAt: at, deactivationReason: marker },
  });
  await db.userFactoryAccess.updateMany({
    where: { userId: { in: userIds }, isActive: true },
    data: { isActive: false, deactivatedAt: at, deactivationReason: marker },
  });
  await db.user.updateMany({ where: { id: { in: userIds }, blockedAt: null }, data: { blockedAt: at } });
  await db.factory.updateMany({
    where: { id: { in: factoryIds }, deactivatedAt: null },
    data: { isActive: false, deactivatedAt: at, deactivationReason: marker },
  });
}

async function main() {
  let app = null;
  let raceApp = null;
  let db = null;
  let originalBroadcast = null;
  let raceOriginalBroadcast = null;
  let beforeOperationalHash = '';
  let afterOperationalHash = '';
  const realtime = [];

  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    db = app.get(PrismaService).db;
    const shiftService = app.get(ShiftService);
    const lineService = app.get(LineService);
    const wsService = app.get(WsService);
    originalBroadcast = wsService.broadcast.bind(wsService);
    wsService.broadcast = (type, payload) => {
      realtime.push({ source: 'primary', type, payload });
      return originalBroadcast(type, payload);
    };
    beforeOperationalHash = await operationalHash(db);

    const factory = await createFactory(db, 'Граница');
    const isolationFactory = await createFactory(db, 'Изоляция');
    const raceFactory = await createFactory(db, 'Конкурентность');
    const guardFactory = await createFactory(db, 'Защита');

    const master = await createUser(db, factory.id, 'MASTER');
    const oldEmpty = await createUser(db, factory.id, 'WORKER', 'ASSIGNED');
    const oldA = await createUser(db, factory.id, 'WORKER', 'ASSIGNED');
    const oldB = await createUser(db, factory.id, 'WORKER', 'ASSIGNED');
    const newC = await createUser(db, factory.id, 'WORKER', 'OFF_SHIFT');
    const emptyLine = await createLineFixture(db, factory.id, 'Линия без ночного плана', 2, `${D}T19:30:00+03:00`);
    const populatedLine = await createLineFixture(db, factory.id, 'Линия с ночным планом', 3, `${D}T19:30:00+03:00`);

    for (const worker of [oldEmpty, oldA, oldB]) {
      await createSession(db, factory.id, worker.id, master.id, TIMES.dayStart, 'DAY', TIMES.nightStart);
    }
    await createActual(db, { factoryId: factory.id, userId: oldEmpty.id, line: emptyLine, slotIndex: 1, startedAt: TIMES.dayStart, masterId: master.id });
    await createActual(db, { factoryId: factory.id, userId: oldA.id, line: populatedLine, slotIndex: 1, startedAt: TIMES.dayStart, masterId: master.id });
    await createActual(db, { factoryId: factory.id, userId: oldB.id, line: populatedLine, slotIndex: 2, startedAt: TIMES.dayStart, masterId: master.id });
    await createLinePlan(db, { factoryId: factory.id, line: populatedLine, shiftDate: D, shiftType: 'NIGHT', slotIndex: 1, userId: oldB.id, masterId: master.id });
    await createLinePlan(db, { factoryId: factory.id, line: populatedLine, shiftDate: D, shiftType: 'NIGHT', slotIndex: 2, userId: newC.id, masterId: master.id });
    await createLinePlan(db, { factoryId: factory.id, line: populatedLine, shiftDate: D1, shiftType: 'DAY', slotIndex: 1, userId: oldA.id, masterId: master.id });

    const tasks = await Promise.all(['URGENT', 'LONG'].map((type) => db.task.create({
      data: {
        factoryId: factory.id,
        lineId: populatedLine.line.id,
        createdById: master.id,
        type,
        description: marker,
        status: 'NEW',
        operationId: `${marker}:${type}`,
        createdAt: new Date(`${D}T18:30:00+03:00`),
      },
    })));
    state.taskIds.push(...tasks.map((task) => task.id));
    const taskBaseline = tasks.map((task) => ({ id: task.id, status: task.status, version: task.version, updatedAt: task.updatedAt.getTime() }));
    const lineEventBaseline = await db.lineEvent.findMany({
      where: { lineId: { in: [emptyLine.line.id, populatedLine.line.id] } },
      select: { id: true, status: true, createdAt: true },
      orderBy: { id: 'asc' },
    });

    const isolationMaster = await createUser(db, isolationFactory.id, 'MASTER');
    const isolationWorker = await createUser(db, isolationFactory.id, 'WORKER', 'ASSIGNED');
    const isolationLine = await createLineFixture(db, isolationFactory.id, 'Независимая линия', 1, `${D}T19:30:00+03:00`);
    await createSession(db, isolationFactory.id, isolationWorker.id, isolationMaster.id, TIMES.dayStart, 'DAY', TIMES.nightStart);
    await createActual(db, { factoryId: isolationFactory.id, userId: isolationWorker.id, line: isolationLine, slotIndex: 1, startedAt: TIMES.dayStart, masterId: isolationMaster.id });
    const isolationBefore = await factoryStateHash(db, isolationFactory.id);

    const masterContext = context(master.id, factory.id, 'MASTER', ['lines.read', 'people.read', 'shift.current.read']);
    writeClock(TIMES.beforeNight);
    const beforeRows = await lineService.list(masterContext);
    const beforeTick = await shiftService.runShiftMaintenance(undefined, [factory.id]);
    const beforeAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true } });
    check('19:59:59 resolves DAY business date D', beforeTick.boundary.shiftDate === D && beforeTick.boundary.shiftType === 'DAY', beforeTick.boundary);
    check('19:59:59 does not close DAY sessions or assignments', beforeTick.autoClosed.closed === 0 && beforeAssignments.length === 3);
    check('current read-model before boundary contains old DAY people', beforeRows.find((row) => row.id === emptyLine.line.id)?.assignedCount === 1 && beforeRows.find((row) => row.id === populatedLine.line.id)?.assignedCount === 2);

    writeClock(TIMES.nightStart);
    const nightTick = await shiftService.runShiftMaintenance(undefined, [factory.id]);
    const nightAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null, kind: 'LINE' }, orderBy: [{ lineId: 'asc' }, { slotIndex: 'asc' }] });
    const emptyNight = nightAssignments.filter((assignment) => assignment.lineId === emptyLine.line.id);
    const populatedNight = nightAssignments.filter((assignment) => assignment.lineId === populatedLine.line.id);
    const endedDayAssignments = await db.assignment.findMany({
      where: { factoryId: factory.id, startedAt: new Date(TIMES.dayStart) },
      select: { endedAt: true },
    });
    const nightSessions = await db.shiftSession.findMany({
      where: { factoryId: factory.id, status: 'ACTIVE' },
      select: { id: true, userId: true, shiftType: true, startedAt: true },
    });
    const lineStatesAfterNight = await db.line.findMany({ where: { id: { in: [emptyLine.line.id, populatedLine.line.id] } }, select: { status: true } });
    const lineEventsAfterNight = await db.lineEvent.findMany({
      where: { lineId: { in: [emptyLine.line.id, populatedLine.line.id] } },
      select: { id: true, status: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    check('20:00 actual scheduler entrypoint resolves NIGHT business date D', nightTick.boundary.shiftDate === D && nightTick.boundary.shiftType === 'NIGHT', nightTick.boundary);
    check('20:00 closes every old DAY actual exactly at boundary', endedDayAssignments.length === 3 && endedDayAssignments.every((assignment) => assignment.endedAt?.getTime() === new Date(TIMES.nightStart).getTime()));
    check('no-next-plan line has zero NIGHT actual people', emptyNight.length === 0);
    check('populated NIGHT plan activates exactly planned B and C', populatedNight.length === 2 && populatedNight.map((assignment) => assignment.userId).sort().join('|') === [oldB.id, newC.id].sort().join('|'));
    check('planned NIGHT slots remain exact with no duplicate', populatedNight.map((assignment) => assignment.slotIndex).sort().join('|') === '1|2');
    check('new NIGHT actuals start exactly at 20:00', populatedNight.every((assignment) => assignment.startedAt.getTime() === new Date(TIMES.nightStart).getTime()));
    check('NIGHT sessions are exactly the planned people', nightSessions.length === 2 && nightSessions.every((session) => session.shiftType === 'NIGHT' && session.startedAt.getTime() === new Date(TIMES.nightStart).getTime()));
    check('RUNNING lines remain WORK through 20:00', lineStatesAfterNight.length === 2 && lineStatesAfterNight.every((line) => line.status === 'WORK'));
    check('scheduler creates no artificial STOP or WORK line event at 20:00', stableHash(lineEventsAfterNight) === stableHash(lineEventBaseline));

    writeClock(TIMES.nightMinute);
    const nightRows = await lineService.list(masterContext);
    const nightPeople = await shiftService.people(masterContext, true);
    const populatedNightRow = nightRows.find((row) => row.id === populatedLine.line.id);
    const visibleTrackedPeople = nightPeople.filter((person) => [oldA.id, oldB.id, newC.id].includes(person.userId));
    check('current NIGHT line read-model exposes only B and C', populatedNightRow?.assignedCount === 2 && new Set(populatedNightRow.activeAssignments.map((assignment) => assignment.userId)).size === 2);
    check('person-first current read-model excludes old unplanned A', visibleTrackedPeople.find((person) => person.userId === oldA.id)?.currentAssignment === null && visibleTrackedPeople.filter((person) => person.currentAssignment?.lineId === populatedLine.line.id).length === 2);
    check('no-next-plan read-model is 0/N with configured required count', nightRows.find((row) => row.id === emptyLine.line.id)?.assignedCount === 0 && nightRows.find((row) => row.id === emptyLine.line.id)?.requiredCount === 2);
    check('continuous RUNNING line shows continuation during first 30 minutes', populatedNightRow?.continuesFromPreviousShift === true && populatedNightRow?.continuationLabel === 'Работает с прошлой смены');

    const stableNightIds = nightAssignments.map((assignment) => assignment.id).sort();
    const stableNightSessionIds = nightSessions.map((session) => session.id).sort();
    const repeatedNightTicks = [];
    for (let index = 0; index < 3; index += 1) repeatedNightTicks.push(await shiftService.runShiftMaintenance(undefined, [factory.id]));
    const afterRepeatedNight = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true } });
    const afterRepeatedNightSessions = await db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true } });
    const nightSummaryCount = await db.auditLog.count({ where: { factoryId: factory.id, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityId: `${D}:NIGHT` } });
    check('three repeated 20:00 ticks preserve one assignment set', afterRepeatedNight.map((item) => item.id).sort().join('|') === stableNightIds.join('|'));
    check('three repeated 20:00 ticks preserve one active session set', afterRepeatedNightSessions.map((item) => item.id).sort().join('|') === stableNightSessionIds.join('|'));
    check('three repeated 20:00 ticks create one boundary summary', nightSummaryCount === 1, { nightSummaryCount, repeatedNightTicks });

    writeClock(TIMES.nightThirtyOne);
    const afterThirty = (await lineService.list(masterContext)).find((row) => row.id === populatedLine.line.id);
    check('continuation indicator disappears after accepted 30 minute window', afterThirty?.continuesFromPreviousShift === false && afterThirty?.continuationLabel === null);
    await db.lineEvent.createMany({ data: [
      { factoryId: factory.id, lineId: populatedLine.line.id, status: 'STOP', comment: marker, createdAt: new Date(`${D}T20:02:00+03:00`), confirmedEndAt: new Date(`${D}T20:03:00+03:00`) },
      { factoryId: factory.id, lineId: populatedLine.line.id, status: 'WORK', comment: marker, createdAt: new Date(`${D}T20:03:00+03:00`) },
    ] });
    writeClock(`${D}T20:05:00+03:00`);
    const afterRestart = (await lineService.list(masterContext)).find((row) => row.id === populatedLine.line.id);
    check('STOP then WORK breaks old continuation semantics', afterRestart?.operationalState === 'RUNNING' && afterRestart?.continuesFromPreviousShift === false);

    const midnightAssignmentIds = (await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true } })).map((item) => item.id).sort();
    const midnightSessionIds = (await db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true } })).map((item) => item.id).sort();
    for (const clock of [TIMES.beforeMidnight, TIMES.midnight, TIMES.afterMidnight, TIMES.beforeDay]) {
      writeClock(clock);
      const tick = await shiftService.runShiftMaintenance(undefined, [factory.id]);
      const activeIds = (await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true } })).map((item) => item.id).sort();
      const activeSessionIds = (await db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true } })).map((item) => item.id).sort();
      check(`${clock} remains NIGHT business date D`, tick.boundary.shiftDate === D && tick.boundary.shiftType === 'NIGHT', tick.boundary);
      check(`${clock} creates no midnight assignment transition`, activeIds.join('|') === midnightAssignmentIds.join('|'));
      check(`${clock} creates no midnight ShiftSession`, activeSessionIds.join('|') === midnightSessionIds.join('|'));
    }
    const phantomMidnightSessions = await db.shiftSession.count({
      where: { factoryId: factory.id, startedAt: { gt: new Date(TIMES.midnight), lt: new Date(TIMES.dayStartNext) } },
    });
    check('calendar midnight creates no phantom shift session', phantomMidnightSessions === 0);

    const lineEventsBeforeDay = await db.lineEvent.count({ where: { lineId: { in: [emptyLine.line.id, populatedLine.line.id] } } });
    writeClock(TIMES.dayStartNext);
    const dayTick = await shiftService.runShiftMaintenance(undefined, [factory.id]);
    const dayAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null, kind: 'LINE' } });
    const daySessions = await db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' } });
    const dayRows = await lineService.list(masterContext);
    const lineEventsAfterDay = await db.lineEvent.count({ where: { lineId: { in: [emptyLine.line.id, populatedLine.line.id] } } });
    check('08:00 actual scheduler entrypoint resolves DAY business date D+1', dayTick.boundary.shiftDate === D1 && dayTick.boundary.shiftType === 'DAY', dayTick.boundary);
    check('08:00 closes NIGHT D actuals and activates exact DAY D+1 plan', dayAssignments.length === 1 && dayAssignments[0].userId === oldA.id && dayAssignments[0].startedAt.getTime() === new Date(TIMES.dayStartNext).getTime());
    check('08:00 leaves exactly one matching DAY session', daySessions.length === 1 && daySessions[0].userId === oldA.id && daySessions[0].shiftType === 'DAY');
    check('current DAY read-model contains only new DAY factual person', dayRows.find((row) => row.id === populatedLine.line.id)?.assignedCount === 1 && dayRows.find((row) => row.id === populatedLine.line.id)?.activeAssignments[0]?.userId === oldA.id);
    check('historical DAY and NIGHT assignments remain archived by endedAt', await db.assignment.count({ where: { factoryId: factory.id, endedAt: { not: null } } }) === 5);
    check('08:00 creates no line status event', lineEventsAfterDay === lineEventsBeforeDay);
    check('line state remains independent and RUNNING at 08:00', await db.line.count({ where: { id: { in: [emptyLine.line.id, populatedLine.line.id] }, status: 'WORK' } }) === 2);

    const tasksAfter = await db.task.findMany({ where: { id: { in: state.taskIds } }, select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } });
    const sortedTaskBaseline = [...taskBaseline].sort((a, b) => a.id.localeCompare(b.id));
    check('URGENT and LONG remain unchanged solely across boundaries', tasksAfter.every((task, index) => task.status === sortedTaskBaseline[index].status && task.version === sortedTaskBaseline[index].version && task.updatedAt.getTime() === sortedTaskBaseline[index].updatedAt));

    const isolationAfter = await factoryStateHash(db, isolationFactory.id);
    check('factory-scoped maintenance for X does not mutate Y', isolationBefore === isolationAfter, { isolationBefore, isolationAfter });
    check('realtime invalidations are emitted for affected X only', realtime.some((event) => event.type === 'assignment_updated' && event.payload?.factoryId === factory.id) && realtime.some((event) => event.type === 'shift_updated' && event.payload?.factoryId === factory.id) && realtime.every((event) => event.payload?.factoryId !== isolationFactory.id));

    const raceMaster = await createUser(db, raceFactory.id, 'MASTER');
    const raceOld = await createUser(db, raceFactory.id, 'WORKER', 'ASSIGNED');
    const raceNext = await createUser(db, raceFactory.id, 'WORKER', 'OFF_SHIFT');
    const raceLine = await createLineFixture(db, raceFactory.id, 'Конкурентная линия', 1, `${D}T19:30:00+03:00`);
    await createSession(db, raceFactory.id, raceOld.id, raceMaster.id, TIMES.dayStart, 'DAY', TIMES.nightStart);
    await createActual(db, { factoryId: raceFactory.id, userId: raceOld.id, line: raceLine, slotIndex: 1, startedAt: TIMES.dayStart, masterId: raceMaster.id });
    const racePlan = await createLinePlan(db, { factoryId: raceFactory.id, line: raceLine, shiftDate: D, shiftType: 'NIGHT', slotIndex: 1, userId: raceNext.id, masterId: raceMaster.id });
    writeClock(TIMES.nightStart);
    raceApp = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const raceShiftService = raceApp.get(ShiftService);
    const raceWsService = raceApp.get(WsService);
    raceOriginalBroadcast = raceWsService.broadcast.bind(raceWsService);
    raceWsService.broadcast = (type, payload) => {
      realtime.push({ source: 'secondary', type, payload });
      return raceOriginalBroadcast(type, payload);
    };
    const concurrent = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => {
      const owner = index % 2 === 0 ? shiftService : raceShiftService;
      return owner.runShiftMaintenance(undefined, [raceFactory.id]);
    }));
    const raceAssignments = await db.assignment.findMany({ where: { factoryId: raceFactory.id }, orderBy: { startedAt: 'asc' } });
    const raceActiveAssignments = raceAssignments.filter((assignment) => assignment.endedAt === null);
    const raceActiveSessions = await db.shiftSession.findMany({ where: { factoryId: raceFactory.id, status: 'ACTIVE' } });
    const raceProcessed = await db.processedOperation.count({ where: { userId: raceMaster.id, operationId: `shift-boundary:${D}:NIGHT:${racePlan.id}` } });
    const raceSummary = await db.auditLog.count({ where: { factoryId: raceFactory.id, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityId: `${D}:NIGHT` } });
    check('six concurrent actual scheduler entrypoints complete without normal-race failure', concurrent.every((result) => result.status === 'fulfilled'), concurrent.filter((result) => result.status === 'rejected').map((result) => String(result.reason)));
    check('concurrent boundary closes old actual exactly once', raceAssignments.filter((assignment) => assignment.userId === raceOld.id).length === 1 && raceAssignments.find((assignment) => assignment.userId === raceOld.id)?.endedAt?.getTime() === new Date(TIMES.nightStart).getTime());
    check('concurrent boundary creates one planned actual', raceActiveAssignments.length === 1 && raceActiveAssignments[0].userId === raceNext.id && raceActiveAssignments[0].startedAt.getTime() === new Date(TIMES.nightStart).getTime());
    check('concurrent boundary creates one active ShiftSession', raceActiveSessions.length === 1 && raceActiveSessions[0].userId === raceNext.id);
    check('processed-operation and summary remain unique under race', raceProcessed === 1 && raceSummary === 1, { raceProcessed, raceSummary });
    const raceStable = stableHash({ assignments: raceAssignments, sessions: raceActiveSessions });
    await shiftService.runShiftMaintenance(undefined, [raceFactory.id]);
    await raceShiftService.runShiftMaintenance(undefined, [raceFactory.id]);
    const raceAfterRetry = stableHash({
      assignments: await db.assignment.findMany({ where: { factoryId: raceFactory.id }, orderBy: { startedAt: 'asc' } }),
      sessions: await db.shiftSession.findMany({ where: { factoryId: raceFactory.id, status: 'ACTIVE' } }),
    });
    check('cross-instance retry after concurrent winner is idempotent', raceStable === raceAfterRetry);

    const guardMaster = await createUser(db, guardFactory.id, 'MASTER');
    const guardWorker = await createUser(db, guardFactory.id, 'WORKER', 'ASSIGNED');
    const guardLine = await createLineFixture(db, guardFactory.id, 'Линия защиты нового назначения', 1, `${D}T20:05:00+03:00`);
    const guardSession = await createSession(db, guardFactory.id, guardWorker.id, guardMaster.id, TIMES.dayStart, 'DAY', TIMES.nightStart);
    const newerAssignment = await createActual(db, { factoryId: guardFactory.id, userId: guardWorker.id, line: guardLine, slotIndex: 1, startedAt: `${D}T20:05:00+03:00`, masterId: guardMaster.id });
    writeClock(`${D}T20:10:00+03:00`);
    const guardTick = await shiftService.runShiftMaintenance(undefined, [guardFactory.id]);
    const [closedGuardSession, preservedNewerAssignment, guardSkillCredits] = await Promise.all([
      db.shiftSession.findUnique({ where: { id: guardSession.id } }),
      db.assignment.findUnique({ where: { id: newerAssignment.id } }),
      db.userSkillCredit.count({ where: { assignmentId: newerAssignment.id } }),
    ]);
    const guardRow = (await lineService.list(context(guardMaster.id, guardFactory.id, 'MASTER', ['lines.read', 'people.read']))).find((row) => row.id === guardLine.line.id);
    check('actual scheduler closes due old ShiftSession in guard fixture', guardTick.autoClosed.closed === 1 && closedGuardSession?.status === 'ENDED');
    check('old-session close preserves assignment started after endedAt', preservedNewerAssignment?.endedAt === null && preservedNewerAssignment.startedAt.getTime() > closedGuardSession.endedAt.getTime());
    check('preserved newer assignment receives no premature skill credit', guardSkillCredits === 0);
    check('preserved newer assignment remains in current factual read-model', guardRow?.assignedCount === 1 && guardRow.activeAssignments[0]?.userId === guardWorker.id);

    const targetCases = [
      [TIMES.beforeNight, D, 'DAY'],
      [TIMES.nightStart, D, 'NIGHT'],
      [TIMES.beforeMidnight, D, 'NIGHT'],
      [TIMES.midnight, D, 'NIGHT'],
      [TIMES.afterMidnight, D, 'NIGHT'],
      [TIMES.beforeDay, D, 'NIGHT'],
      [TIMES.dayStartNext, D1, 'DAY'],
    ];
    for (const [value, expectedDate, expectedType] of targetCases) {
      const target = factoryShiftTarget(new Date(value));
      check(`canonical factory time ${value}`, target.shiftDate === expectedDate && target.shiftType === expectedType, target);
    }
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    const timezoneIndependent = factoryShiftTarget(new Date(TIMES.afterMidnight));
    process.env.TZ = previousTimezone;
    check('process/browser timezone cannot shift factory business date', timezoneIndependent.shiftDate === D && timezoneIndependent.shiftType === 'NIGHT', timezoneIndependent);
  } finally {
    if (db) {
      await cleanup(db).catch((error) => failed.push({ name: 'fixture cleanup completed', evidence: error instanceof Error ? error.message : String(error) }));
      const inventory = await activeInventory(db).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
      check('all active scheduler proof artifacts are zero', !inventory.error && Object.values(inventory).every((value) => value === 0), inventory);
      afterOperationalHash = await operationalHash(db, state.factoryIds, state.userIds).catch(() => 'hash-failed');
      check('pre-existing operational state is unchanged', beforeOperationalHash && beforeOperationalHash === afterOperationalHash, { beforeOperationalHash, afterOperationalHash });
    }
    if (raceApp) {
      if (raceOriginalBroadcast) raceApp.get(WsService).broadcast = raceOriginalBroadcast;
      await raceApp.close();
    }
    if (app) {
      if (originalBroadcast) app.get(WsService).broadcast = originalBroadcast;
      await app.close();
    }
    fs.rmSync(clockFile, { force: true });
  }

  const report = {
    status: failed.length ? 'FAIL' : 'PASS',
    passed: passed.length,
    failed: failed.length,
    checks: passed,
    failures: failed,
    owners: {
      scheduler: 'ShiftService.runShiftMaintenance',
      trigger: 'ShiftService.onModuleInit immediate call + 60 second interval',
      shiftTime: 'backend/src/common/shift-time.ts',
      shiftSession: 'ShiftService + ShiftSession',
      assignment: 'EmployeeService + Assignment',
      plan: 'PlannedLineAssignment + PlannedShiftAssignment',
      idempotency: 'ProcessedOperation',
      concurrency: 'operationLockKey.shiftBoundary/assignment locks + boundaryReconciliations',
      realtime: 'WsService',
    },
    cleanup: {
      physicalDeletes: 0,
      preexistingOperationalChanged: beforeOperationalHash !== afterOperationalHash ? 1 : 0,
    },
    migration: 'NOT_REQUIRED',
  };
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  fs.rmSync(clockFile, { force: true });
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
