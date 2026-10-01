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
const marker = `__PFFV5_P13_${runId}__`;
const suffix = runId.slice(-6);
const clockFile = path.join(os.tmpdir(), `zavod-p13-regression-clock-${runId}.txt`);
process.env.NODE_ENV = 'test';
process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
process.env.ZAVOD_INTERNAL_TEST_NOW_FILE = clockFile;
fs.writeFileSync(clockFile, '2026-08-13T19:59:00+03:00\n', 'utf8');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { factoryShiftDate, factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { LineService } = require('../dist/modules/line/line.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { WsService } = require('../dist/ws/ws.service');

const checks = [];
const failures = [];
const state = {
  factoryId: '',
  isolationFactoryId: '',
  masterId: '',
  managementId: '',
  outsiderId: '',
  userIds: [],
  lineIds: [],
  positionIds: [],
  templateIds: [],
};

function check(name, condition, detail) {
  const row = { name, ...(detail === undefined ? {} : { detail }) };
  (condition ? checks : failures).push(row);
}

function writeClock(value) {
  fs.writeFileSync(clockFile, `${value}\n`, 'utf8');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function factory4Hash(db) {
  const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
  if (!factory) return 'missing';
  const [lines, assignments, plans, sessions] = await Promise.all([
    db.line.findMany({ where: { factoryId: factory.id }, select: { id: true, status: true, version: true, deletedAt: true, deactivatedAt: true }, orderBy: { id: 'asc' } }),
    db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true, userId: true, lineId: true, positionId: true, slotIndex: true, startedAt: true }, orderBy: { id: 'asc' } }),
    db.plannedLineAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, lineId: true, positionId: true, slotIndex: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true, userId: true, startedAt: true, plannedEndAt: true }, orderBy: { id: 'asc' } }),
  ]);
  return stableHash({ lines, assignments, plans, sessions });
}

function context(userId, factoryId, role, permissions = []) {
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

async function createLineFixture(db, factoryId, name, requiredCount) {
  const line = await db.line.create({ data: { factoryId, name, status: 'WORK' } });
  const position = await db.linePosition.create({
    data: { factoryId, lineId: line.id, name: `Оператор ${suffix}`, displayName: 'Оператор', normalizedName: `operator-${suffix}`, sortOrder: 1 },
  });
  const template = await db.lineStaffingTemplate.create({
    data: {
      factoryId,
      lineId: line.id,
      name: `Состав ${requiredCount} места`,
      items: { create: { positionId: position.id, requiredCount, minRequired: requiredCount, maxRequired: requiredCount, defaultPlanned: requiredCount, plannedCount: requiredCount, sortOrder: 1 } },
    },
  });
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: template.id } });
  await db.lineEvent.create({
    data: { factoryId, lineId: line.id, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T19:30:00+03:00') },
  });
  state.lineIds.push(line.id);
  state.positionIds.push(position.id);
  state.templateIds.push(template.id);
  return { line, position, template };
}

async function createUser(db, factoryId, role, employeeState = 'ASSIGNED') {
  const user = await db.user.create({ data: { factoryId, role, employeeState } });
  await db.userFactoryAccess.create({ data: { userId: user.id, factoryId, role, isActive: true, isGuest: false } });
  state.userIds.push(user.id);
  return user;
}

async function createLegacySession(db, factoryId, userId) {
  return db.shiftSession.create({
    data: {
      factoryId,
      userId,
      startedAt: new Date('2026-08-13T08:00:00+03:00'),
      shiftType: 'DAY',
      status: 'ACTIVE',
      durationHours: 12,
      plannedEndAt: null,
      startedById: state.masterId,
    },
  });
}

async function cleanup(db) {
  const at = new Date();
  if (state.factoryId) {
    await db.assignment.updateMany({ where: { factoryId: state.factoryId, endedAt: null }, data: { endedAt: at, endedById: state.masterId || null, comment: marker, version: { increment: 1 } } });
    await db.plannedLineAssignment.updateMany({ where: { factoryId: state.factoryId, releasedAt: null }, data: { releasedAt: at, releasedById: state.masterId || null, comment: marker } });
    await db.shiftSession.updateMany({ where: { factoryId: state.factoryId, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: at, endedById: state.masterId || null, autoClosed: true, version: { increment: 1 } } });
    await db.line.updateMany({ where: { factoryId: state.factoryId, deactivatedAt: null }, data: { deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
    await db.linePosition.updateMany({ where: { factoryId: state.factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
    await db.lineStaffingTemplate.updateMany({ where: { factoryId: state.factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
    await db.userFactoryAccess.updateMany({ where: { factoryId: state.factoryId, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
    await db.factory.updateMany({ where: { id: state.factoryId }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  }
  if (state.isolationFactoryId) {
    await db.userFactoryAccess.updateMany({ where: { factoryId: state.isolationFactoryId, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivationReason: marker } });
    await db.factory.updateMany({ where: { id: state.isolationFactoryId }, data: { isActive: false, deactivatedAt: at, deactivationReason: marker } });
  }
  if (state.userIds.length) await db.user.updateMany({ where: { id: { in: state.userIds }, blockedAt: null }, data: { blockedAt: at } });
}

async function activeInventory(db) {
  const [factories, lines, accesses, assignments, plans, sessions] = await Promise.all([
    db.factory.count({ where: { id: { in: [state.factoryId, state.isolationFactoryId].filter(Boolean) }, isActive: true, deactivatedAt: null } }),
    db.line.count({ where: { id: { in: state.lineIds }, deactivatedAt: null, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: { in: [state.factoryId, state.isolationFactoryId].filter(Boolean) }, isActive: true } }),
    db.assignment.count({ where: { factoryId: state.factoryId || '__none__', endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: state.factoryId || '__none__', releasedAt: null } }),
    db.shiftSession.count({ where: { factoryId: state.factoryId || '__none__', status: 'ACTIVE' } }),
  ]);
  return { factories, lines, accesses, assignments, plans, sessions };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(PrismaService).db;
  const shiftService = app.get(ShiftService);
  const lineService = app.get(LineService);
  const employeeService = app.get(EmployeeService);
  const wsService = app.get(WsService);
  const realtime = [];
  const originalBroadcast = wsService.broadcast.bind(wsService);
  wsService.broadcast = (type, payload) => {
    realtime.push({ type, payload });
    return originalBroadcast(type, payload);
  };
  const beforeHash = await factory4Hash(db);
  let afterHash = '';
  try {
    const factory = await db.factory.create({ data: { name: `Контур границы смены ${suffix}`, code: `p13-boundary-${runId}` } });
    const isolationFactory = await db.factory.create({ data: { name: `Контур изоляции ${suffix}`, code: `p13-isolation-${runId}` } });
    state.factoryId = factory.id;
    state.isolationFactoryId = isolationFactory.id;
    const master = await createUser(db, factory.id, 'MASTER', 'AVAILABLE');
    const management = await createUser(db, factory.id, 'MANAGEMENT', 'AVAILABLE');
    const outsider = await createUser(db, isolationFactory.id, 'MANAGEMENT', 'AVAILABLE');
    state.masterId = master.id;
    state.managementId = management.id;
    state.outsiderId = outsider.id;
    const oldEmpty = await createUser(db, factory.id, 'WORKER');
    const workerA = await createUser(db, factory.id, 'WORKER');
    const workerB = await createUser(db, factory.id, 'WORKER');
    const workerC = await createUser(db, factory.id, 'WORKER', 'OFF_SHIFT');
    const empty = await createLineFixture(db, factory.id, `Нулевая смена ${suffix}`, 2);
    const populated = await createLineFixture(db, factory.id, `Плановая смена ${suffix}`, 3);

    for (const user of [oldEmpty, workerA, workerB]) await createLegacySession(db, factory.id, user.id);
    await db.assignment.createMany({ data: [
      { factoryId: factory.id, userId: oldEmpty.id, lineId: empty.line.id, kind: 'LINE', positionId: empty.position.id, staffingTemplateId: empty.template.id, slotIndex: 1, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
      { factoryId: factory.id, userId: workerA.id, lineId: populated.line.id, kind: 'LINE', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 1, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
      { factoryId: factory.id, userId: workerB.id, lineId: populated.line.id, kind: 'LINE', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 2, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
    ] });

    const nightTarget = factoryShiftTarget(new Date('2026-08-13T20:01:00+03:00'));
    const nightShiftDate = factoryShiftDate(nightTarget);
    await db.lineShiftWorkPlan.create({ data: { factoryId: factory.id, lineId: populated.line.id, shiftDate: nightShiftDate, shiftType: 'NIGHT', staffingTemplateId: populated.template.id, createdById: master.id } });
    await db.plannedLineAssignment.createMany({ data: [
      { factoryId: factory.id, lineId: populated.line.id, shiftDate: nightShiftDate, shiftType: 'NIGHT', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 1, userId: workerB.id, createdById: master.id, comment: marker },
      { factoryId: factory.id, lineId: populated.line.id, shiftDate: nightShiftDate, shiftType: 'NIGHT', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 2, userId: workerC.id, createdById: master.id, comment: marker },
    ] });

    const laterWorker = await createUser(db, factory.id, 'WORKER');
    const dueSession = await db.shiftSession.create({
      data: {
        factoryId: factory.id,
        userId: laterWorker.id,
        startedAt: new Date('2026-08-13T08:00:00+03:00'),
        shiftType: 'DAY',
        status: 'ACTIVE',
        durationHours: 12,
        plannedEndAt: new Date('2026-08-13T20:00:00+03:00'),
        startedById: master.id,
      },
    });
    const laterAssignment = await db.assignment.create({
      data: {
        factoryId: factory.id,
        userId: laterWorker.id,
        lineId: empty.line.id,
        kind: 'LINE',
        positionId: empty.position.id,
        staffingTemplateId: empty.template.id,
        slotIndex: 2,
        startedAt: new Date('2026-08-13T20:05:00+03:00'),
        startedById: master.id,
        comment: marker,
      },
    });
    const autoClose = await shiftService.autoCloseDueShiftSessions(new Date('2026-08-13T20:10:00+03:00'), [factory.id]);
    const [closedDueSession, preservedLaterAssignment, laterCreditCount] = await Promise.all([
      db.shiftSession.findUnique({ where: { id: dueSession.id } }),
      db.assignment.findUnique({ where: { id: laterAssignment.id } }),
      db.userSkillCredit.count({ where: { assignmentId: laterAssignment.id } }),
    ]);
    check('due session auto-closes inside requested factory scope', autoClose.closed === 1 && closedDueSession?.status === 'ENDED');
    check('due session does not close an assignment started after its end', preservedLaterAssignment?.endedAt === null);
    check('preserved later assignment receives no premature skill credit', laterCreditCount === 0);
    await db.assignment.update({
      where: { id: laterAssignment.id },
      data: { endedAt: new Date('2026-08-13T20:10:00+03:00'), endedById: master.id, comment: marker, version: { increment: 1 } },
    });
    await db.user.update({ where: { id: laterWorker.id }, data: { employeeState: 'AVAILABLE', version: { increment: 1 } } });

    const masterContext = context(master.id, factory.id, 'MASTER', ['lines.read', 'lines.manage', 'assignments.manage', 'people.read', 'shift.current.read']);
    const managementContext = context(management.id, factory.id, 'MANAGEMENT', ['lines.read', 'people.read', 'shift.current.read']);
    const outsiderContext = context(outsider.id, isolationFactory.id, 'MANAGEMENT', ['lines.read', 'people.read', 'shift.current.read']);
    const before = await lineService.list(masterContext);
    check('BEFORE empty-plan line has one DAY actual person', before.find((line) => line.id === empty.line.id)?.assignedCount === 1);
    check('BEFORE populated line has A+B DAY actual people', before.find((line) => line.id === populated.line.id)?.assignedCount === 2);

    const boundaryCases = [
      ['2026-08-13T07:59:59+03:00', '2026-08-12', 'NIGHT'],
      ['2026-08-13T08:00:00+03:00', '2026-08-13', 'DAY'],
      ['2026-08-13T19:59:59+03:00', '2026-08-13', 'DAY'],
      ['2026-08-13T20:00:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T00:00:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T07:59:59+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T08:00:00+03:00', '2026-08-14', 'DAY'],
    ];
    for (const [iso, shiftDate, shiftType] of boundaryCases) {
      const actual = factoryShiftTarget(new Date(iso));
      check(`server boundary ${iso}`, actual.shiftDate === shiftDate && actual.shiftType === shiftType, actual);
    }
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    const timezoneTarget = factoryShiftTarget(new Date('2026-08-14T00:30:00+03:00'));
    process.env.TZ = previousTimezone;
    check('browser/process timezone does not shift server business date', timezoneTarget.shiftDate === '2026-08-13' && timezoneTarget.shiftType === 'NIGHT', timezoneTarget);

    writeClock('2026-08-13T20:01:00+03:00');
    const first = await shiftService.reconcileCurrentShiftAssignments(new Date('2026-08-13T20:01:00+03:00'), [factory.id]);
    const afterAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null, kind: 'LINE' }, orderBy: [{ lineId: 'asc' }, { slotIndex: 'asc' }] });
    const emptyActual = afterAssignments.filter((item) => item.lineId === empty.line.id);
    const populatedActual = afterAssignments.filter((item) => item.lineId === populated.line.id);
    check('empty NIGHT plan produces 0/N actual', emptyActual.length === 0, emptyActual.map((item) => item.userId));
    check('populated NIGHT plan produces exact B+C', populatedActual.length === 2 && populatedActual.map((item) => item.userId).sort().join('|') === [workerB.id, workerC.id].sort().join('|'), populatedActual.map((item) => item.userId));
    check('planned slots activate exactly', populatedActual.map((item) => item.slotIndex).sort().join('|') === '1|2');
    check('new actual assignments start at exact boundary', populatedActual.every((item) => item.startedAt.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime()));
    check('old DAY assignments are closed at exact boundary', await db.assignment.count({ where: { factoryId: factory.id, startedAt: { lt: new Date('2026-08-13T20:00:00+03:00') }, endedAt: new Date('2026-08-13T20:00:00+03:00') } }) === 3);
    check('RUNNING line state survives staffing boundary', (await db.line.count({ where: { id: { in: state.lineIds }, status: 'WORK' } })) === 2);

    const [lineRows, detail, board, people, managementRows, outsiderRows] = await Promise.all([
      lineService.list(masterContext),
      lineService.dashboard(masterContext, populated.line.id),
      lineService.assignmentBoard(masterContext, populated.line.id),
      shiftService.people(masterContext, true),
      lineService.list(managementContext),
      lineService.list(outsiderContext),
    ]);
    const popRow = lineRows.find((line) => line.id === populated.line.id);
    const visiblePeople = people.filter((person) => [workerA.id, workerB.id, workerC.id].includes(person.userId));
    check('Shift read-model parity is B+C', popRow?.assignedCount === 2 && new Set(popRow.activeAssignments.map((item) => item.userId)).size === 2);
    check('Line detail parity is B+C', detail.assignedCount === 2 && detail.currentAssignments.length === 2);
    check('slot-first board parity is B+C', board.slots.filter((slot) => slot.assignment).length === 2 && new Set(board.slots.filter((slot) => slot.assignment).map((slot) => slot.assignment.userId)).size === 2);
    check('person-first people parity excludes A and assigns B+C', visiblePeople.find((person) => person.userId === workerA.id)?.currentAssignment === null && visiblePeople.filter((person) => person.currentAssignment?.lineId === populated.line.id).length === 2);
    check('safe MANAGEMENT sees canonical current staffing', managementRows.find((line) => line.id === populated.line.id)?.assignedCount === 2);
    check('cross-factory viewer cannot see fixture lines', outsiderRows.every((line) => !state.lineIds.includes(line.id)));
    check('B+C have current NIGHT ShiftSessions', await db.shiftSession.count({ where: { factoryId: factory.id, userId: { in: [workerB.id, workerC.id] }, status: 'ACTIVE', shiftType: 'NIGHT', startedAt: new Date('2026-08-13T20:00:00+03:00') } }) === 2);
    check('existing realtime invalidations were emitted', realtime.some((item) => item.type === 'assignment_updated') && realtime.some((item) => item.type === 'shift_updated'), realtime.map((item) => item.type));
    check('continuation indicator is derived at 20:01', popRow?.continuesFromPreviousShift === true && popRow?.continuationLabel === 'Работает с прошлой смены');

    const firstAuditCount = await db.auditLog.count({ where: { factoryId: factory.id, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityId: '2026-08-13:NIGHT' } });
    const second = await shiftService.reconcileCurrentShiftAssignments(new Date('2026-08-13T20:01:00+03:00'), [factory.id]);
    const afterSecondAssignments = await db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null, kind: 'LINE' } });
    const secondAuditCount = await db.auditLog.count({ where: { factoryId: factory.id, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityId: '2026-08-13:NIGHT' } });
    check('duplicate boundary processing creates no duplicate assignments', afterSecondAssignments.length === 2 && new Set(afterSecondAssignments.map((item) => item.userId)).size === 2, second);
    check('duplicate boundary processing creates no duplicate summary audit', firstAuditCount === 1 && secondAuditCount === 1, { firstAuditCount, secondAuditCount });
    check('second pass closes nothing again', second.factories[0]?.assignmentsClosed === 0 && second.factories[0]?.activated === 0, second.factories[0]);

    writeClock('2026-08-13T20:31:00+03:00');
    const afterThirty = (await lineService.list(masterContext)).find((line) => line.id === populated.line.id);
    check('continuation indicator disappears after 30 minutes', afterThirty?.continuesFromPreviousShift === false && afterThirty?.continuationLabel === null);
    writeClock('2026-08-13T20:05:00+03:00');
    await db.lineEvent.createMany({ data: [
      { factoryId: factory.id, lineId: populated.line.id, status: 'STOP', comment: marker, createdAt: new Date('2026-08-13T20:02:00+03:00'), confirmedEndAt: new Date('2026-08-13T20:03:00+03:00') },
      { factoryId: factory.id, lineId: populated.line.id, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T20:03:00+03:00') },
    ] });
    const afterRestart = (await lineService.list(masterContext)).find((line) => line.id === populated.line.id);
    check('STOP then WORK removes continuation indicator', afterRestart?.operationalState === 'RUNNING' && afterRestart?.continuesFromPreviousShift === false);
    check('first boundary result reports 3 closed and 2 activated', first.factories[0]?.assignmentsClosed === 3 && first.factories[0]?.activated === 2, first.factories[0]);
  } finally {
    await cleanup(db).catch((error) => failures.push({ name: 'cleanup completed', detail: error instanceof Error ? error.message : String(error) }));
    afterHash = await factory4Hash(db);
    const inventory = await activeInventory(db);
    check('ACTIVE_P13_TEST_ARTIFACTS is zero', Object.values(inventory).every((value) => value === 0), inventory);
    check('pre-existing Factory 4 operational hash is unchanged', beforeHash === afterHash, { beforeHash, afterHash });
    wsService.broadcast = originalBroadcast;
    await app.close();
    fs.rmSync(clockFile, { force: true });
  }

  const report = {
    marker,
    status: failures.length ? 'FAIL' : 'PASS',
    passed: checks.length,
    failed: failures.length,
    checks,
    failures,
    physicalDeletes: 0,
    migration: 'NOT_REQUIRED',
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  fs.rmSync(clockFile, { force: true });
  process.exitCode = 1;
});
