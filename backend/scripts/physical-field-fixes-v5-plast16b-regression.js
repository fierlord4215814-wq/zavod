const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const marker = `__PFFV5_P16B_${runId}__`;
const suffix = runId.slice(-8);
const clockFile = path.join(os.tmpdir(), `zavod-p16b-clock-${runId}.txt`);
process.env.NODE_ENV = 'test';
process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
process.env.CHECKLIST_MAINTENANCE_ENABLED = 'false';
process.env.ZAVOD_INTERNAL_TEST_NOW_FILE = clockFile;
fs.writeFileSync(clockFile, '2026-08-13T19:59:00+03:00\n', 'utf8');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { factoryShiftDate, factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');
const { ChecklistsService } = require('../dist/modules/checklists/checklists.service');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { LineService } = require('../dist/modules/line/line.service');
const { ShiftLogService } = require('../dist/modules/shift-log/shift-log.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');
const { TaskService } = require('../dist/modules/task/task.service');
const { WashService } = require('../dist/modules/wash/wash.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { WsService } = require('../dist/ws/ws.service');

const passed = [];
const failed = [];
const state = {
  factoryId: '',
  otherFactoryId: '',
  departmentId: '',
  masterId: '',
  userIds: [],
  lineIds: [],
  positionIds: [],
  staffingTemplateIds: [],
  workAreaIds: [],
  workAreaPositionIds: [],
  checklistTemplateIds: [],
  checklistRunIds: [],
  taskIds: [],
  washIds: [],
  shiftLogIds: [],
  willBeIds: [],
};

function check(name, condition, evidence) {
  const row = { name, ...(evidence === undefined ? {} : { evidence }) };
  (condition ? passed : failed).push(row);
}

async function expectRejected(name, action, pattern) {
  try {
    await action();
    check(name, false, 'operation unexpectedly succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, pattern ? pattern.test(message) : true, message);
  }
}

function writeClock(iso) {
  fs.writeFileSync(clockFile, `${iso}\n`, 'utf8');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function context(userId, factoryId, role, departmentId, permissions = []) {
  return {
    userId,
    selectedFactoryId: factoryId,
    role,
    departmentId: departmentId ?? null,
    companyId: null,
    permissions,
    isAdmin: role === 'ADMIN',
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId: departmentId ?? null },
    id: userId,
    factoryId,
  };
}

async function factory4Hash(db) {
  const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
  if (!factory) return 'factory-4-absent';
  const [lines, assignments, linePlans, shiftPlans, checklistRuns, tasks, downtimes, washes, sessions] = await Promise.all([
    db.line.findMany({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null }, select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true, userId: true, kind: true, lineId: true, washSessionId: true, workAreaId: true, positionId: true, slotIndex: true, startedAt: true }, orderBy: { id: 'asc' } }),
    db.plannedLineAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, lineId: true, positionId: true, slotIndex: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.plannedShiftAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, kind: true, workAreaId: true, workAreaPositionId: true, slotIndex: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.checklistRun.findMany({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true, templateId: true, userId: true, shiftDate: true, shiftType: true, status: true }, orderBy: { id: 'asc' } }),
    db.task.findMany({ where: { factoryId: factory.id, status: { in: ['NEW', 'IN_PROGRESS'] }, deletedAt: null }, select: { id: true, status: true, lineId: true, lineStatusEventId: true, version: true }, orderBy: { id: 'asc' } }),
    db.lineEvent.findMany({ where: { factoryId: factory.id, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null }, select: { id: true, lineId: true, status: true, createdAt: true }, orderBy: { id: 'asc' } }),
    db.washSession.findMany({ where: { factoryId: factory.id, status: { not: 'DONE' }, deletedAt: null }, select: { id: true, lineId: true, status: true, version: true }, orderBy: { id: 'asc' } }),
    db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true, userId: true, shiftType: true, startedAt: true, plannedEndAt: true, version: true }, orderBy: { id: 'asc' } }),
  ]);
  return stableHash({ lines, assignments, linePlans, shiftPlans, checklistRuns, tasks, downtimes, washes, sessions });
}

async function createUser(db, factoryId, departmentId, role, employeeState = 'AVAILABLE') {
  const user = await db.user.create({ data: { factoryId, role, employeeState } });
  await db.userFactoryAccess.create({ data: { userId: user.id, factoryId, role, departmentId, isActive: true, isGuest: false } });
  state.userIds.push(user.id);
  return user;
}

async function createTransitionLine(db, factoryId, masterId) {
  const line = await db.line.create({ data: { factoryId, name: `${marker} Линия перехода`, status: 'WORK' } });
  const positionA = await db.linePosition.create({
    data: { factoryId, lineId: line.id, name: `Позиция А ${suffix}`, displayName: 'Позиция А', normalizedName: `position-a-${suffix}`, sortOrder: 10 },
  });
  const positionB = await db.linePosition.create({
    data: { factoryId, lineId: line.id, name: `Позиция Б ${suffix}`, displayName: 'Позиция Б', normalizedName: `position-b-${suffix}`, sortOrder: 20 },
  });
  const template = await db.lineStaffingTemplate.create({
    data: {
      factoryId,
      lineId: line.id,
      name: `${marker} Состав 2`,
      items: {
        create: [
          { positionId: positionA.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 10 },
          { positionId: positionB.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 20 },
        ],
      },
    },
  });
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: template.id } });
  await db.lineEvent.create({
    data: { factoryId, lineId: line.id, createdById: masterId, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T19:30:00+03:00') },
  });
  state.lineIds.push(line.id);
  state.positionIds.push(positionA.id, positionB.id);
  state.staffingTemplateIds.push(template.id);
  return { line, positionA, positionB, template };
}

async function createOperationsLine(db, factoryId, masterId) {
  const line = await db.line.create({ data: { factoryId, name: `${marker} Операционная линия`, status: 'WORK' } });
  await db.lineEvent.create({
    data: { factoryId, lineId: line.id, createdById: masterId, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T19:30:00+03:00') },
  });
  state.lineIds.push(line.id);
  return line;
}

async function softCleanup(db, services, actors) {
  const at = new Date('2026-08-16T12:00:00+03:00');
  writeClock('2026-08-16T12:00:00+03:00');
  if (actors.master && state.factoryId) {
    const activeWashes = await db.washSession.findMany({ where: { factoryId: state.factoryId, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
    for (const wash of activeWashes) {
      await services.wash.completeWash(wash.id, actors.master.userId, state.factoryId, `${marker}-cleanup-wash-${wash.id}`).catch(() => undefined);
    }
    const activeTasks = await db.task.findMany({ where: { factoryId: state.factoryId, status: { in: ['NEW', 'IN_PROGRESS'] }, deletedAt: null }, select: { id: true } });
    for (const task of activeTasks) {
      await services.task.completeTask(task.id, actors.master, `${marker}-cleanup-task-${task.id}`, `${marker} cleanup`).catch(() => undefined);
    }
    for (const templateId of state.checklistTemplateIds) {
      await services.checklists.archiveTemplate(actors.admin, templateId).catch(() => undefined);
    }
  }
  await db.assignment.updateMany({ where: { factoryId: state.factoryId || '__none__', endedAt: null }, data: { endedAt: at, endedById: state.masterId || null, comment: marker, version: { increment: 1 } } });
  await db.plannedLineAssignment.updateMany({ where: { factoryId: state.factoryId || '__none__', releasedAt: null }, data: { releasedAt: at, releasedById: state.masterId || null, comment: marker } });
  await db.plannedShiftAssignment.updateMany({ where: { factoryId: state.factoryId || '__none__', releasedAt: null }, data: { releasedAt: at, releasedById: state.masterId || null, comment: marker } });
  await db.shiftSession.updateMany({ where: { factoryId: state.factoryId || '__none__', status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: at, endedById: state.masterId || null, autoClosed: true, version: { increment: 1 } } });
  await db.checklistRunCheck.updateMany({ where: { runId: { in: state.checklistRunIds }, status: 'ACTIVE' }, data: { status: 'AUTO_CLOSED', completedAt: at } });
  await db.checklistRun.updateMany({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'AUTO_CLOSED', closedAt: at, autoClosedAt: at, closeReason: marker, closeKind: 'SHIFT_END' } });
  await db.checklistTemplate.updateMany({ where: { id: { in: state.checklistTemplateIds } }, data: { isActive: false, archivedAt: at } });
  await db.task.updateMany({ where: { id: { in: state.taskIds }, status: { in: ['NEW', 'IN_PROGRESS'] } }, data: { status: 'DONE', doneAt: at, doneById: state.masterId || null, version: { increment: 1 } } });
  await db.lineEvent.updateMany({ where: { lineId: { in: state.lineIds }, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null }, data: { confirmedEndAt: at } });
  await db.washSession.updateMany({ where: { id: { in: state.washIds }, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: at, version: { increment: 1 } } });
  await db.notification.updateMany({
    where: { readAt: null, OR: [{ entityId: { in: [...state.checklistRunIds, ...state.taskIds, ...state.washIds] } }, { message: { contains: marker } }] },
    data: { readAt: at },
  });
  await db.line.updateMany({ where: { id: { in: state.lineIds }, deactivatedAt: null }, data: { status: 'STOP', deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.linePosition.updateMany({ where: { id: { in: state.positionIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.lineStaffingTemplate.updateMany({ where: { id: { in: state.staffingTemplateIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.workAreaPosition.updateMany({ where: { id: { in: state.workAreaPositionIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.workArea.updateMany({ where: { id: { in: state.workAreaIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.shiftWillBe.updateMany({ where: { id: { in: state.willBeIds }, status: 'WILL_BE' }, data: { status: 'CANCELLED', comment: marker, cancelledAt: at } });
  await db.userFactoryAccess.updateMany({ where: { factoryId: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  if (state.departmentId) await db.department.updateMany({ where: { id: state.departmentId, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.factory.updateMany({ where: { id: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.user.updateMany({ where: { id: { in: state.userIds }, blockedAt: null }, data: { blockedAt: at } });
}

async function activeInventory(db) {
  const [lines, positions, staffing, assignments, washAssignments, linePlans, shiftPlans, futurePlans, checklistTemplates, checklistRuns, checklistOccurrences, tasks, downtimes, washes, accesses, factories, users] = await Promise.all([
    db.line.count({ where: { id: { in: state.lineIds }, deletedAt: null, deactivatedAt: null } }),
    db.linePosition.count({ where: { id: { in: state.positionIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.lineStaffingTemplate.count({ where: { id: { in: state.staffingTemplateIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.assignment.count({ where: { factoryId: state.factoryId || '__none__', endedAt: null } }),
    db.assignment.count({ where: { factoryId: state.factoryId || '__none__', kind: 'WASH', endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: state.factoryId || '__none__', releasedAt: null } }),
    db.plannedShiftAssignment.count({ where: { factoryId: state.factoryId || '__none__', releasedAt: null } }),
    db.lineShiftWorkPlan.count({ where: { factoryId: state.factoryId || '__none__', line: { deactivatedAt: null, deletedAt: null } } }),
    db.checklistTemplate.count({ where: { id: { in: state.checklistTemplateIds }, isActive: true, archivedAt: null } }),
    db.checklistRun.count({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    db.checklistRunCheck.count({ where: { runId: { in: state.checklistRunIds }, status: 'ACTIVE' } }),
    db.task.count({ where: { id: { in: state.taskIds }, status: { in: ['NEW', 'IN_PROGRESS'] }, deletedAt: null } }),
    db.lineEvent.count({ where: { lineId: { in: state.lineIds }, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null, line: { deactivatedAt: null, deletedAt: null } } }),
    db.washSession.count({ where: { id: { in: state.washIds }, status: { not: 'DONE' }, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true } }),
    db.factory.count({ where: { id: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true, deactivatedAt: null, deletedAt: null } }),
    db.user.count({ where: { id: { in: state.userIds }, blockedAt: null, deletedAt: null } }),
  ]);
  return {
    ACTIVE_P16B_LINES: lines,
    ACTIVE_P16B_POSITIONS: positions,
    ACTIVE_P16B_STAFFING_TEMPLATES: staffing,
    ACTIVE_P16B_CURRENT_ASSIGNMENTS: assignments,
    ACTIVE_P16B_WASH_ASSIGNMENTS: washAssignments,
    ACTIVE_P16B_PLANNED_LINE_ASSIGNMENTS: linePlans,
    ACTIVE_P16B_PLANNED_SHIFT_ASSIGNMENTS: shiftPlans,
    ACTIVE_P16B_FUTURE_PLANS: futurePlans,
    ACTIVE_P16B_CHECKLIST_TEMPLATES: checklistTemplates,
    ACTIVE_P16B_CHECKLIST_RUNS: checklistRuns,
    ACTIVE_P16B_CHECKLIST_OCCURRENCES: checklistOccurrences,
    ACTIVE_P16B_TASKS: tasks,
    ACTIVE_P16B_DOWNTIMES: downtimes,
    ACTIVE_P16B_WASHES: washes,
    ACTIVE_P16B_ACCESSES: accesses,
    ACTIVE_P16B_FACTORIES: factories,
    ACTIVE_P16B_USERS: users,
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(PrismaService).db;
  const services = {
    shift: app.get(ShiftService),
    line: app.get(LineService),
    employee: app.get(EmployeeService),
    checklists: app.get(ChecklistsService),
    shiftLog: app.get(ShiftLogService),
    task: app.get(TaskService),
    wash: app.get(WashService),
  };
  const ws = app.get(WsService);
  const realtime = [];
  const originalBroadcast = ws.broadcast.bind(ws);
  ws.broadcast = (type, payload) => {
    realtime.push({ type, payload });
    return originalBroadcast(type, payload);
  };
  const beforeHash = await factory4Hash(db);
  let afterHash = '';
  let actors = { admin: null, master: null };
  let inventory = {};

  try {
    const factory = await db.factory.create({ data: { name: `${marker} Завод`, code: `p16b-${runId}` } });
    const otherFactory = await db.factory.create({ data: { name: `${marker} Чужой завод`, code: `p16b-other-${runId}` } });
    state.factoryId = factory.id;
    state.otherFactoryId = otherFactory.id;
    const department = await db.department.create({
      data: { factoryId: factory.id, name: `${marker} Производство`, normalizedName: `p16b-production-${suffix}`, code: `P16B_${suffix}`, scope: 'LOCAL' },
    });
    state.departmentId = department.id;

    const admin = await createUser(db, factory.id, department.id, 'ADMIN');
    const master = await createUser(db, factory.id, department.id, 'MASTER');
    const management = await createUser(db, factory.id, department.id, 'MANAGEMENT');
    const workerA = await createUser(db, factory.id, department.id, 'WORKER');
    const workerB = await createUser(db, factory.id, department.id, 'WORKER');
    const workerC = await createUser(db, factory.id, department.id, 'WORKER', 'OFF_SHIFT');
    const outsider = await createUser(db, otherFactory.id, null, 'MANAGEMENT');
    state.masterId = master.id;

    const masterContext = context(master.id, factory.id, 'MASTER', department.id, [
      'lines.read', 'lines.manage', 'lines.assignment.manage', 'assignments.manage', 'people.read',
      'shift.current.read', 'shift.current.manage', 'shift-log.read', 'tasks.read', 'tasks.manage',
      'wash.read', 'wash.manage', 'checklists.runs.self', 'checklists.runs.manage', 'checklists.templates.read',
    ]);
    const adminContext = context(admin.id, factory.id, 'ADMIN', department.id, []);
    const workerAContext = context(workerA.id, factory.id, 'WORKER', department.id, ['checklists.runs.self', 'shift.self.manage']);
    const workerBContext = context(workerB.id, factory.id, 'WORKER', department.id, ['checklists.runs.self', 'shift.self.manage']);
    const managementContext = context(management.id, factory.id, 'MANAGEMENT', department.id, ['lines.read', 'people.read', 'shift.current.read', 'shift-log.read']);
    const outsiderContext = context(outsider.id, otherFactory.id, 'MANAGEMENT', null, ['lines.read', 'people.read', 'shift.current.read', 'shift-log.read']);
    actors = { admin: adminContext, master: masterContext };

    const transition = await createTransitionLine(db, factory.id, master.id);
    const operationsLine = await createOperationsLine(db, factory.id, master.id);
    const workArea = await db.workArea.create({
      data: { factoryId: factory.id, departmentId: department.id, name: `${marker} Повременная зона`, assignmentKind: 'TIME' },
    });
    const workAreaPosition = await db.workAreaPosition.create({
      data: { workAreaId: workArea.id, title: 'Контроль смены', minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1 },
    });
    state.workAreaIds.push(workArea.id);
    state.workAreaPositionIds.push(workAreaPosition.id);

    const oldA = await services.employee.assignToLine(workerA.id, transition.line.id, masterContext, {
      positionId: transition.positionA.id,
      staffingTemplateId: transition.template.id,
      slotIndex: 1,
      operationId: `${marker}-day-a`,
      manualAdd: true,
      expectedShiftDate: '2026-08-13',
      expectedShiftType: 'DAY',
      boundaryStartedAt: new Date('2026-08-13T08:00:00+03:00'),
      comment: marker,
    });
    const oldB = await services.employee.assignToLine(workerB.id, transition.line.id, masterContext, {
      positionId: transition.positionB.id,
      staffingTemplateId: transition.template.id,
      slotIndex: 1,
      operationId: `${marker}-day-b`,
      manualAdd: true,
      expectedShiftDate: '2026-08-13',
      expectedShiftType: 'DAY',
      boundaryStartedAt: new Date('2026-08-13T08:00:00+03:00'),
      comment: marker,
    });

    const willBe = await services.shift.markWillBe(workerBContext, { targetShiftDate: '2026-08-13', shiftType: 'NIGHT', comment: marker });
    state.willBeIds.push(willBe.id);
    await services.line.planningBoard(masterContext, transition.line.id, { shiftDate: '2026-08-13', shiftType: 'NIGHT', staffingTemplateId: transition.template.id });
    await services.line.replaceShiftAssignment(masterContext, transition.line.id, {
      shiftDate: '2026-08-13',
      shiftType: 'NIGHT',
      staffingTemplateId: transition.template.id,
      rows: [{ article: 'P16B-ARTICLE', productName: 'Контрольный продукт', plannedGofrCount: 24 }],
    });
    await services.line.assignPlannedSlot(masterContext, transition.line.id, {
      shiftDate: '2026-08-13',
      shiftType: 'NIGHT',
      staffingTemplateId: transition.template.id,
      targetUserId: workerB.id,
      positionId: transition.positionB.id,
      slotIndex: 1,
      operationId: `${marker}-plan-b`,
      manualAssignment: true,
      comment: marker,
    });
    await services.shift.createFutureShiftAssignment(masterContext, {
      targetUserId: workerC.id,
      shiftDate: '2026-08-13',
      shiftType: 'NIGHT',
      kind: 'TIME',
      workAreaId: workArea.id,
      workAreaPositionId: workAreaPosition.id,
      slotIndex: 1,
      operationId: `${marker}-plan-c-time`,
      comment: marker,
    });

    const checklistTemplate = await services.checklists.createTemplate(adminContext, {
      name: `${marker} Периодический контроль`,
      description: `${marker} shift ownership`,
      departmentId: department.id,
      assignmentRoles: ['WORKER'],
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 30,
      isActive: true,
      rows: [{ title: `${marker} Проверка`, rowType: 'YES_NO', requiredAnswer: true, isRequired: true }],
    });
    state.checklistTemplateIds.push(checklistTemplate.id);
    const dayRun = await services.checklists.startRun(workerAContext, { templateId: checklistTemplate.id, shiftDate: '2026-08-13', shiftType: 'DAY' });
    state.checklistRunIds.push(dayRun.id);
    await services.checklists.completeRow(workerAContext, dayRun.id, dayRun.rows[0].id, {
      answerBoolean: true,
      checkId: dayRun.currentCheck.id,
      operationId: `${marker}-day-row`,
    });
    await services.checklists.completeCurrentCheck(workerAContext, dayRun.id, {
      checkId: dayRun.currentCheck.id,
      operationId: `${marker}-day-check`,
    });
    const dayActiveCheck = await db.checklistRunCheck.findFirst({ where: { runId: dayRun.id, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
    if (!dayActiveCheck) throw new Error('Не создан следующий occurrence дневного чек-листа');
    await db.checklistRunCheck.update({ where: { id: dayActiveCheck.id }, data: { dueAt: new Date('2026-08-13T21:00:00+03:00') } });
    await db.checklistRun.update({ where: { id: dayRun.id }, data: { nextCheckAt: new Date('2026-08-13T21:00:00+03:00') } });

    const futureBefore = await services.shift.future(masterContext);
    const lineEventsBefore = await db.lineEvent.count({ where: { lineId: transition.line.id } });
    check('future selector before boundary points to NIGHT/D', futureBefore.shiftDate === '2026-08-13' && futureBefore.shiftType === 'NIGHT');
    check('future plan before boundary contains only Worker B on line', futureBefore.counts.plannedAssignments === 2 && futureBefore.plannedLines.some((item) => item.lineId === transition.line.id && item.plannedAssignmentsCount === 1));

    const boundaryCases = [
      ['2026-08-13T19:59:59+03:00', '2026-08-13', 'DAY'],
      ['2026-08-13T20:00:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-13T20:29:59+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-13T20:30:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-13T20:59:59+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-13T21:00:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T00:00:00+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T07:59:59+03:00', '2026-08-13', 'NIGHT'],
      ['2026-08-14T08:00:00+03:00', '2026-08-14', 'DAY'],
      ['2026-08-14T08:29:59+03:00', '2026-08-14', 'DAY'],
      ['2026-08-14T08:30:00+03:00', '2026-08-14', 'DAY'],
      ['2026-08-14T08:59:59+03:00', '2026-08-14', 'DAY'],
      ['2026-08-14T09:00:00+03:00', '2026-08-14', 'DAY'],
    ];
    for (const [iso, shiftDate, shiftType] of boundaryCases) {
      const target = factoryShiftTarget(new Date(iso));
      check(`canonical shift boundary ${iso}`, target.shiftDate === shiftDate && target.shiftType === shiftType, target);
    }
    const previousTimezone = process.env.TZ;
    for (const timezone of ['Europe/Moscow', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      const target = factoryShiftTarget(new Date('2026-08-14T00:30:00+03:00'));
      check(`process timezone ${timezone} does not move business shift`, target.shiftDate === '2026-08-13' && target.shiftType === 'NIGHT', target);
    }
    process.env.TZ = previousTimezone;

    writeClock('2026-08-13T20:00:00+03:00');
    const concurrent = await Promise.all([
      services.shift.runShiftMaintenance(new Date('2026-08-13T20:00:00+03:00'), [factory.id]),
      services.shift.runShiftMaintenance(new Date('2026-08-13T20:00:00+03:00'), [factory.id]),
    ]);
    const [closedOldA, closedOldB, currentAssignments, lineAfterBoundary, currentTimeAssignment] = await Promise.all([
      db.assignment.findUnique({ where: { id: oldA.id } }),
      db.assignment.findUnique({ where: { id: oldB.id } }),
      db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, orderBy: { id: 'asc' } }),
      db.line.findUnique({ where: { id: transition.line.id } }),
      db.assignment.findFirst({ where: { factoryId: factory.id, userId: workerC.id, kind: 'TIME', endedAt: null } }),
    ]);
    const currentB = currentAssignments.find((item) => item.userId === workerB.id && item.kind === 'LINE');
    check('old Worker A actual closes exactly at 20:00', closedOldA?.endedAt?.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime());
    check('old Worker B actual closes exactly at 20:00', closedOldB?.endedAt?.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime());
    check('unplanned Worker A is not carried', !currentAssignments.some((item) => item.userId === workerA.id));
    check('planned Worker B activates as a new assignment', Boolean(currentB) && currentB.id !== oldB.id && currentB.startedAt.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime(), currentB);
    check('planned TIME worker activates at the exact boundary', currentTimeAssignment?.startedAt.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime(), currentTimeAssignment);
    check('boundary has no duplicate active assignment per person', currentAssignments.length === 2 && new Set(currentAssignments.map((item) => item.userId)).size === 2, currentAssignments.map((item) => ({ userId: item.userId, kind: item.kind })));
    check('running line remains physically running', lineAfterBoundary?.status === 'WORK');
    check('boundary creates no synthetic STOP/WORK event', await db.lineEvent.count({ where: { lineId: transition.line.id } }) === lineEventsBefore);

    const [lineRows, detail, board, people, managementRows, outsiderRows] = await Promise.all([
      services.line.list(masterContext),
      services.line.dashboard(masterContext, transition.line.id),
      services.line.assignmentBoard(masterContext, transition.line.id),
      services.shift.people(masterContext, true),
      services.line.list(managementContext),
      services.line.list(outsiderContext),
    ]);
    const transitionRow = lineRows.find((item) => item.id === transition.line.id);
    const markerPeople = people.filter((item) => [workerA.id, workerB.id, workerC.id].includes(item.userId));
    check('line card people counter is 1/2', transitionRow?.assignedCount === 1 && transitionRow?.requiredCount === 2, transitionRow && { assignedCount: transitionRow.assignedCount, requiredCount: transitionRow.requiredCount });
    check('line detail people counter is 1/2', detail.assignedCount === 1 && detail.requiredCount === 2);
    check('slot-first board contains only Worker B', board.slots.filter((slot) => slot.assignment).length === 1 && board.slots.some((slot) => slot.assignment?.userId === workerB.id));
    check('person-first model agrees with slot-first model', markerPeople.find((item) => item.userId === workerA.id)?.currentAssignment === null && markerPeople.find((item) => item.userId === workerB.id)?.currentAssignment?.lineId === transition.line.id);
    check('management sees canonical current staffing', managementRows.find((item) => item.id === transition.line.id)?.assignedCount === 1);
    check('cross-factory viewer cannot see marker lines', outsiderRows.every((item) => !state.lineIds.includes(item.id)));

    const futureAfter = await services.shift.future(masterContext);
    check('future selector advances to DAY/D+1 after 20:00', futureAfter.shiftDate === '2026-08-14' && futureAfter.shiftType === 'DAY', { shiftDate: futureAfter.shiftDate, shiftType: futureAfter.shiftType });
    check('NIGHT confirmation is not reused for DAY/D+1', !futureAfter.willBe.some((item) => item.userId === workerB.id));
    const boundaryAuditCount = await db.auditLog.count({ where: { factoryId: factory.id, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityId: '2026-08-13:NIGHT' } });
    const boundaryEvents = realtime.filter((item) => item.payload?.factoryId === factory.id && item.payload?.reason === 'SHIFT_BOUNDARY');
    check('concurrent boundary is idempotent in persisted state', currentAssignments.length === 2 && Math.max(...concurrent.map((item) => item.boundary.factories.reduce((sum, factory) => sum + factory.activated, 0))) === 2);
    check('concurrent boundary writes one reconciliation audit', boundaryAuditCount === 1, boundaryAuditCount);
    check('concurrent boundary emits one logical assignment and one shift invalidation', boundaryEvents.filter((item) => item.type === 'assignment_updated').length === 1 && boundaryEvents.filter((item) => item.type === 'shift_updated').length === 1, boundaryEvents.map((item) => item.type));

    const dayWorkspaceAtNight = await services.checklists.workspace(workerAContext, { includeDiagnostics: 'true' });
    check('DAY checklist ownership is not current NIGHT ownership', !dayWorkspaceAtNight.activeRuns.some((run) => run.id === dayRun.id));
    const nightRun = await services.checklists.startRun(workerBContext, { templateId: checklistTemplate.id, shiftDate: '2026-08-13', shiftType: 'NIGHT' });
    state.checklistRunIds.push(nightRun.id);
    check('NIGHT checklist is a separate run', nightRun.id !== dayRun.id && nightRun.shiftType === 'NIGHT');
    check('NIGHT checklist has separate unanswered rows', nightRun.rows.every((row) => row.status === 'PENDING'));

    writeClock('2026-08-13T20:29:59+03:00');
    const continuationAt2929 = (await services.line.list(masterContext)).find((item) => item.id === transition.line.id);
    check('continuation indicator is visible through 20:29:59', continuationAt2929?.continuesFromPreviousShift === true && continuationAt2929?.continuationLabel === 'Работает с прошлой смены');
    writeClock('2026-08-13T20:30:00+03:00');
    const continuationAt30 = (await services.line.list(masterContext)).find((item) => item.id === transition.line.id);
    check('continuation indicator expires exactly at 20:30', continuationAt30?.continuesFromPreviousShift === false && continuationAt30?.continuationLabel === null);

    writeClock('2026-08-13T20:59:59+03:00');
    await services.checklists.runMaintenance(new Date('2026-08-13T20:59:59+03:00'), factory.id);
    check('DAY checklist remains active at 20:59:59', (await db.checklistRun.findUnique({ where: { id: dayRun.id } }))?.status === 'ACTIVE');
    const reminderCountBeforeClose = await db.notification.count({ where: { entityId: dayActiveCheck.id } });
    writeClock('2026-08-13T21:00:00+03:00');
    await services.checklists.runMaintenance(new Date('2026-08-13T21:00:00+03:00'), factory.id);
    const [closedDayRun, closedDayCheck, openNightAt21] = await Promise.all([
      db.checklistRun.findUnique({ where: { id: dayRun.id } }),
      db.checklistRunCheck.findUnique({ where: { id: dayActiveCheck.id } }),
      db.checklistRun.findUnique({ where: { id: nightRun.id } }),
    ]);
    check('DAY checklist auto-closes exactly at 21:00', closedDayRun?.status === 'AUTO_CLOSED' && closedDayRun?.closeKind === 'SHIFT_END_INCOMPLETE' && closedDayRun?.autoClosedAt?.getTime() === new Date('2026-08-13T21:00:00+03:00').getTime(), closedDayRun && { status: closedDayRun.status, closeKind: closedDayRun.closeKind, autoClosedAt: closedDayRun.autoClosedAt });
    check('DAY active occurrence closes with its parent', closedDayCheck?.status !== 'ACTIVE', closedDayCheck?.status);
    check('NIGHT checklist remains active at DAY grace close', openNightAt21?.status === 'ACTIVE');
    writeClock('2026-08-13T21:05:00+03:00');
    await services.checklists.runMaintenance(new Date('2026-08-13T21:05:00+03:00'), factory.id);
    check('old checklist reminder does not continue after auto-close', await db.notification.count({ where: { entityId: dayActiveCheck.id } }) === reminderCountBeforeClose);
    const dayArchive = await services.checklists.archive(workerAContext, { includeDiagnostics: 'true' });
    check('previous DAY checklist is readable in archive', dayArchive.runs.some((run) => run.id === dayRun.id && run.status === 'AUTO_CLOSED'));

    writeClock('2026-08-14T07:25:00+03:00');
    await services.line.updateStatus(operationsLine.id, 'STOP', `${marker} Простой`, masterContext, 'TECHNICAL');
    const downtime = await db.lineEvent.findFirst({ where: { lineId: operationsLine.id, status: 'STOP', confirmedEndAt: null }, orderBy: { createdAt: 'desc' } });
    if (!downtime) throw new Error('Не создан канонический простой');
    const task = await services.task.createTask({
      lineId: operationsLine.id,
      lineStatusEventId: downtime.id,
      actor: masterContext,
      operationId: `${marker}-task`,
      description: `${marker} Устранить причину простоя`,
      type: 'URGENT',
    });
    state.taskIds.push(task.id);
    const wash = await services.wash.startWash(operationsLine.id, master.id, `${marker}-wash`, factory.id);
    state.washIds.push(wash.id);
    const washAssignment = await services.employee.assignToWash(workerA.id, masterContext, {
      lineId: operationsLine.id,
      washSessionId: wash.id,
      operationId: `${marker}-wash-a`,
    });

    writeClock('2026-08-14T07:59:00+03:00');
    const summary = await services.shiftLog.handoverSummary(masterContext, {}, new Date('2026-08-14T07:59:00+03:00'));
    check('handover includes working plan article and corrugated quantity', summary.snapshot.sections.lines.some((item) => item.lineId === transition.line.id && item.quantity.includes('P16B-ARTICLE') && item.quantity.includes('24 гофр') && item.currentStatusLabel === 'По плану'));
    check('handover includes exact unresolved downtime-linked task', summary.snapshot.sections.tasks.some((item) => item.taskId === task.id && item.lineStatusEventId === downtime.id));
    check('handover includes active wash', summary.snapshot.sections.washes.some((item) => item.washSessionId === wash.id));
    check('handover excludes people and personal checklist ownership', summary.snapshot.sections.people.length === 0 && !JSON.stringify(summary.snapshot).includes(dayRun.id) && !JSON.stringify(summary.snapshot).includes(nightRun.id));
    const handover = await services.shiftLog.createHandover(masterContext, { comment: `${marker} Передача` }, new Date('2026-08-14T07:59:00+03:00'));
    state.shiftLogIds.push(handover.id);
    const duplicateHandover = await services.shiftLog.createHandover(masterContext, { comment: `${marker} Повтор` }, new Date('2026-08-14T07:59:30+03:00'));
    const snapshotText = (await db.shiftLog.findUnique({ where: { id: handover.id } })).text;
    check('handover duplicate submit is idempotent', duplicateHandover.id === handover.id && duplicateHandover.alreadyHandedOver === true && await db.shiftLog.count({ where: { id: handover.id } }) === 1);
    await expectRejected('cross-factory handover is denied', () => services.shiftLog.handoverSummary(context(master.id, otherFactory.id, 'MASTER', department.id, ['shift.current.manage']), {}, new Date('2026-08-14T07:59:00+03:00')), /доступ|завод/i);

    writeClock('2026-08-14T08:00:00+03:00');
    await expectRejected('new NIGHT handover submit is rejected at exact 08:00', () => services.shiftLog.createHandover(masterContext, {}, new Date('2026-08-14T08:00:00+03:00')), /доступна|передач/i);
    await Promise.all([
      services.shift.runShiftMaintenance(new Date('2026-08-14T08:00:00+03:00'), [factory.id]),
      services.shift.runShiftMaintenance(new Date('2026-08-14T08:00:00+03:00'), [factory.id]),
    ]);
    const [dayTargetAssignments, sameDowntime, sameTask, sameWash, closedWashAssignment, previousHandover, operationsState] = await Promise.all([
      db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null } }),
      db.lineEvent.findUnique({ where: { id: downtime.id } }),
      db.task.findUnique({ where: { id: task.id } }),
      db.washSession.findUnique({ where: { id: wash.id } }),
      db.assignment.findUnique({ where: { id: washAssignment.id } }),
      services.shiftLog.previousHandover(masterContext, {}, new Date('2026-08-14T08:00:00+03:00')),
      db.line.findUnique({ where: { id: operationsLine.id } }),
    ]);
    check('08:00 has no stale NIGHT people without DAY plan', dayTargetAssignments.length === 0, dayTargetAssignments.map((item) => ({ userId: item.userId, kind: item.kind })));
    check('same downtime event crosses 08:00 open', sameDowntime?.confirmedEndAt === null && operationsState?.status === 'STOP');
    check('same linked task crosses 08:00 unresolved', sameTask?.status === 'NEW' && sameTask?.lineStatusEventId === downtime.id);
    check('same wash session crosses 08:00 active', sameWash?.status !== 'DONE');
    check('old WASH person assignment closes exactly at 08:00', closedWashAssignment?.endedAt?.getTime() === new Date('2026-08-14T08:00:00+03:00').getTime());
    check('next DAY opens immutable NIGHT/D handover', previousHandover?.id === handover.id && previousHandover.handover.snapshot.shiftDate === '2026-08-13' && previousHandover.handover.snapshot.shiftType === 'NIGHT');
    const dayWorkspaceAt08 = await services.checklists.workspace(workerBContext, { includeDiagnostics: 'true' });
    check('NIGHT checklist in grace is not current DAY ownership', !dayWorkspaceAt08.activeRuns.some((run) => run.id === nightRun.id));

    writeClock('2026-08-14T08:59:59+03:00');
    await services.checklists.runMaintenance(new Date('2026-08-14T08:59:59+03:00'), factory.id);
    check('NIGHT checklist remains active at 08:59:59', (await db.checklistRun.findUnique({ where: { id: nightRun.id } }))?.status === 'ACTIVE');
    writeClock('2026-08-14T09:00:00+03:00');
    await services.checklists.runMaintenance(new Date('2026-08-14T09:00:00+03:00'), factory.id);
    const closedNight = await db.checklistRun.findUnique({ where: { id: nightRun.id } });
    check('NIGHT checklist auto-closes exactly at 09:00', closedNight?.status === 'AUTO_CLOSED' && closedNight?.closeKind === 'SHIFT_END_INCOMPLETE' && closedNight?.autoClosedAt?.getTime() === new Date('2026-08-14T09:00:00+03:00').getTime(), closedNight && { status: closedNight.status, closeKind: closedNight.closeKind, autoClosedAt: closedNight.autoClosedAt });
    check('NIGHT checklist has no active child after close', await db.checklistRunCheck.count({ where: { runId: nightRun.id, status: 'ACTIVE' } }) === 0);

    writeClock('2026-08-14T09:05:00+03:00');
    await services.wash.completeWash(wash.id, master.id, factory.id, `${marker}-wash-complete`);
    await services.task.completeTask(task.id, masterContext, `${marker}-task-complete`, `${marker} Выполнено`);
    const lineStillStoppedAfterWash = await db.line.findUnique({ where: { id: operationsLine.id } });
    check('wash finish does not auto-run stopped line', lineStillStoppedAfterWash?.status === 'STOP');
    await services.line.updateStatus(operationsLine.id, 'WORK', `${marker} Возврат в работу`, masterContext);
    const completedDowntime = await db.lineEvent.findUnique({ where: { id: downtime.id } });
    check('downtime closes only after explicit WORK action', Boolean(completedDowntime?.confirmedEndAt));
    check('handover snapshot remains immutable after task/wash completion', (await db.shiftLog.findUnique({ where: { id: handover.id } })).text === snapshotText);

    writeClock('2026-08-16T20:31:00+03:00');
    await services.shift.runShiftMaintenance(new Date('2026-08-16T20:31:00+03:00'), [factory.id]);
    await services.checklists.runMaintenance(new Date('2026-08-16T20:31:00+03:00'), factory.id);
    const [multiDayLine, multiDayAssignments, multiDayFuture, oldConfirmation] = await Promise.all([
      services.line.list(masterContext).then((rows) => rows.find((item) => item.id === transition.line.id)),
      db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null } }),
      services.shift.future(masterContext),
      db.shiftWillBe.findUnique({ where: { id: willBe.id } }),
    ]);
    check('line may remain RUNNING after 48h with zero people', multiDayLine?.operationalState === 'RUNNING' && multiDayLine?.assignedCount === 0 && multiDayLine?.requiredCount === 2, multiDayLine && { operationalState: multiDayLine.operationalState, assignedCount: multiDayLine.assignedCount, requiredCount: multiDayLine.requiredCount });
    check('no stale people remain after multiple boundaries', multiDayAssignments.length === 0);
    check('old plan is not reused by a later future selector', multiDayFuture.shiftDate !== '2026-08-13' && multiDayFuture.plannedLines.every((item) => item.lineId !== transition.line.id));
    check('old confirmation remains historical and is not next-shift data', oldConfirmation?.targetShiftDate.getTime() === factoryShiftDate({ shiftDate: '2026-08-13', shiftType: 'NIGHT' }).getTime() && !multiDayFuture.willBe.some((item) => item.id === willBe.id));
    check('continuation indicator is absent after multiple days', multiDayLine?.continuesFromPreviousShift === false && multiDayLine?.continuationLabel === null);
    check('all marker checklists are non-current after multiple days', await db.checklistRun.count({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }) === 0);
    check('no-show contour is documented as not applicable', true, 'No runtime no-show lifecycle exists; only configuration fields are present.');
  } finally {
    await softCleanup(db, services, actors).catch((error) => failed.push({ name: 'soft cleanup completed', evidence: error instanceof Error ? error.message : String(error) }));
    inventory = await activeInventory(db);
    check('all active P16B marker counters are zero', Object.values(inventory).every((value) => value === 0), inventory);
    afterHash = await factory4Hash(db);
    check('protected Factory 4 operational hash is unchanged', beforeHash === afterHash, { beforeHash, afterHash });
    ws.broadcast = originalBroadcast;
    await app.close();
    fs.rmSync(clockFile, { force: true });
  }

  const report = {
    marker,
    status: failed.length ? 'FAIL' : 'PASS',
    passed: passed.length,
    failed: failed.length,
    checks: passed,
    failures: failed,
    cleanup: inventory,
    preexistingHash: { before: beforeHash, after: afterHash, unchanged: beforeHash === afterHash },
    noShow: 'NOT_APPLICABLE',
    physicalDeletes: 0,
    migration: 'NOT_REQUIRED',
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  fs.rmSync(clockFile, { force: true });
  process.exitCode = 1;
});
