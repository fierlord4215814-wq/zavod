const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const runtimeDir = path.join(rootDir, '.codex-runtime');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast16c');
const statePath = path.join(runtimeDir, 'p16c-controlled-state.json');
const artifactPath = path.join(evidenceDir, 'test-artifacts.json');
const mode = process.argv.includes('--prepare-browser')
  ? 'prepare-browser'
  : process.argv.includes('--cleanup-browser')
    ? 'cleanup-browser'
    : 'full';

fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const existingState = readJson(statePath, null);
const runId = mode === 'cleanup-browser' && existingState?.runId
  ? existingState.runId
  : `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const marker = mode === 'cleanup-browser' && existingState?.marker
  ? existingState.marker
  : `__PFFV5_P16C_${runId}__`;
const suffix = runId.slice(-8).replace(/[^a-z0-9]/gi, '');
const clockFile = existingState?.clockFile ?? path.join(os.tmpdir(), `zavod-p16c-clock-${runId}.txt`);

process.env.NODE_ENV = 'test';
process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
process.env.CHECKLIST_MAINTENANCE_ENABLED = 'false';
process.env.ZAVOD_INTERNAL_TEST_NOW_FILE = clockFile;
if (!fs.existsSync(clockFile)) fs.writeFileSync(clockFile, '2026-08-27T23:30:00+03:00\n', 'utf8');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { ChecklistsService } = require('../dist/modules/checklists/checklists.service');
const { LineService } = require('../dist/modules/line/line.service');
const { OkkService } = require('../dist/modules/okk/okk.service');
const { OpsService } = require('../dist/modules/ops/ops.service');
const { ReturnsService } = require('../dist/modules/returns/returns.service');
const { StockService } = require('../dist/modules/stock/stock.service');
const { TaskService } = require('../dist/modules/task/task.service');
const { WashService } = require('../dist/modules/wash/wash.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

const checks = [];
const failures = [];

function writeClock(iso) {
  fs.writeFileSync(clockFile, `${iso}\n`, 'utf8');
}

function context(userId, factoryId, role, departmentId, permissions = []) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role,
    departmentId: departmentId ?? null,
    companyId: null,
    permissions,
    isAdmin: role === 'ADMIN',
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId: departmentId ?? null },
  };
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function check(name, actual, expected = true, evidence) {
  const passed = same(actual, expected);
  const row = { name, passed, expected, actual, ...(evidence === undefined ? {} : { evidence }) };
  checks.push(row);
  if (!passed) failures.push(row);
  return passed;
}

async function expectRejected(name, action, pattern) {
  try {
    await action();
    check(name, 'resolved', 'rejected');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, pattern ? pattern.test(message) : true, true, message);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function factory4Snapshot(db) {
  const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
  if (!factory) return { factoryId: null, hash: 'factory-4-absent', legacyChecklistChildren: 0, globalLegacyChecklistChildren: 0, ambiguousOpenStops: 0 };
  const [lines, assignments, plans, shiftPlans, tasks, events, washes, checklistRuns, legacyChecklistChildren, globalLegacyChecklistChildren, ambiguousOpenStops] = await Promise.all([
    db.line.findMany({ where: { factoryId: factory.id, deletedAt: null }, select: { id: true, status: true, version: true, deletedAt: true, deactivatedAt: true }, orderBy: { id: 'asc' } }),
    db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true, userId: true, kind: true, lineId: true, washSessionId: true, workAreaId: true, startedAt: true }, orderBy: { id: 'asc' } }),
    db.plannedLineAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, lineId: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.plannedShiftAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, kind: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.task.findMany({ where: { factoryId: factory.id, deletedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] } }, select: { id: true, status: true, lineId: true, lineStatusEventId: true, version: true }, orderBy: { id: 'asc' } }),
    db.lineEvent.findMany({ where: { factoryId: factory.id, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null }, select: { id: true, lineId: true, status: true, createdAt: true, correctedStartAt: true, confirmedEndAt: true }, orderBy: { id: 'asc' } }),
    db.washSession.findMany({ where: { factoryId: factory.id, deletedAt: null, status: { not: 'DONE' } }, select: { id: true, status: true, version: true }, orderBy: { id: 'asc' } }),
    db.checklistRun.findMany({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true, templateId: true, status: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.checklistRunCheck.count({ where: { status: 'ACTIVE', run: { factoryId: factory.id, status: { in: ['CLOSED', 'AUTO_CLOSED'] } } } }),
    db.checklistRunCheck.count({ where: { status: 'ACTIVE', run: { status: { in: ['CLOSED', 'AUTO_CLOSED'] } } } }),
    db.lineEvent.count({ where: { factoryId: factory.id, status: 'STOP', confirmedEndAt: null, line: { deletedAt: null, deactivatedAt: null } } }),
  ]);
  return {
    factoryId: factory.id,
    hash: sha({ lines, assignments, plans, shiftPlans, tasks, events, washes, checklistRuns }),
    legacyChecklistChildren,
    globalLegacyChecklistChildren,
    ambiguousOpenStops,
  };
}

async function createUser(db, state, factoryId, departmentId, role, label) {
  const id = `${label} ${suffix}`;
  await db.user.create({ data: { id, factoryId, role } });
  await db.userFactoryAccess.create({ data: { userId: id, factoryId, role, departmentId, isActive: true, isGuest: false } });
  state.createdUserIds.push(id);
  state.accessUserIds.push(id);
  return id;
}

async function recoverActiveState(db) {
  const factory = await db.factory.findFirst({
    where: { code: { startsWith: 'p16c-' }, NOT: { code: { startsWith: 'p16c-other-' } }, isActive: true, deactivatedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!factory) return null;
  const recoveredRunId = factory.code.slice('p16c-'.length);
  const otherFactory = await db.factory.findFirst({ where: { code: `p16c-other-${recoveredRunId}` } });
  const department = await db.department.findFirst({ where: { factoryId: factory.id }, orderBy: { createdAt: 'asc' } });
  const accesses = await db.userFactoryAccess.findMany({ where: { factoryId: { in: [factory.id, otherFactory?.id].filter(Boolean) }, isActive: true } });
  const byRole = (role, predicate = () => true) => accesses.find((item) => item.role === role && predicate(item))?.userId ?? '';
  const controlledMarker = factory.name.match(/__PFFV5_P16C_[A-Za-z0-9_-]+__/)?.[0] ?? `__PFFV5_P16C_${recoveredRunId}__`;
  const lines = await db.line.findMany({ where: { factoryId: factory.id }, select: { id: true, name: true } });
  const lineIds = lines.map((item) => item.id);
  const [lineEvents, tasks, templates, runs, washes, issues, controls, okk, stock, returns, createdUsers] = await Promise.all([
    db.lineEvent.findMany({ where: { lineId: { in: lineIds }, status: { in: ['PAUSE', 'STOP'] } }, select: { id: true } }),
    db.task.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.checklistTemplate.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.checklistRun.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.washSession.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.washIssue.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.washControlItem.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.okkRecord.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.stockDefect.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.returnRecord.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
    db.user.findMany({ where: { factoryId: { in: [factory.id, otherFactory?.id].filter(Boolean) } }, select: { id: true } }),
  ]);
  const adminUserId = accesses.find((item) => item.role === 'ADMIN' && item.userId === 'test-admin')?.userId ?? byRole('ADMIN');
  const normalAdminUserId = byRole('ADMIN', (item) => item.userId !== adminUserId);
  return {
    version: 1,
    status: 'PREPARED',
    runId: recoveredRunId,
    marker: controlledMarker,
    clockFile,
    dateFrom: '2026-08-27',
    dateTo: '2026-08-27',
    factoryId: factory.id,
    otherFactoryId: otherFactory?.id ?? '',
    departmentId: department?.id ?? '',
    adminUserId,
    normalAdminUserId,
    managementUserId: byRole('MANAGEMENT', (item) => item.factoryId === factory.id),
    masterUserId: byRole('MASTER'),
    workerUserId: byRole('WORKER'),
    okkUserId: byRole('OKK'),
    storeUserId: byRole('STORE'),
    outsiderUserId: byRole('MANAGEMENT', (item) => item.factoryId === otherFactory?.id),
    createdUserIds: createdUsers.map((item) => item.id).filter((id) => id !== adminUserId),
    accessUserIds: accesses.map((item) => item.userId),
    lineIds,
    lineNames: lines.map((item) => item.name),
    lineAId: lines.find((item) => item.name.includes('Линия Альфа'))?.id ?? '',
    lineBId: lines.find((item) => item.name.includes('Линия Бета'))?.id ?? '',
    lineEventIds: lineEvents.map((item) => item.id),
    taskIds: tasks.map((item) => item.id),
    checklistTemplateIds: templates.map((item) => item.id),
    checklistRunIds: runs.map((item) => item.id),
    washIds: washes.map((item) => item.id),
    washIssueIds: issues.map((item) => item.id),
    washControlItemIds: controls.map((item) => item.id),
    okkIds: okk.map((item) => item.id),
    stockIds: stock.map((item) => item.id),
    returnIds: returns.map((item) => item.id),
    protectedBefore: await factory4Snapshot(db),
    recoveredFromInterruptedPrepare: true,
  };
}

async function prepare(db, services) {
  if (existingState?.status === 'PREPARED') {
    const active = await db.factory.count({ where: { id: existingState.factoryId, isActive: true, deactivatedAt: null } });
    if (active) throw new Error(`Есть незавершённый P16C dataset ${existingState.marker}. Сначала выполните --cleanup-browser.`);
  }

  const protectedBefore = await factory4Snapshot(db);
  const state = {
    version: 1,
    status: 'PREPARING',
    runId,
    marker,
    clockFile,
    dateFrom: '2026-08-27',
    dateTo: '2026-08-27',
    factoryId: '',
    otherFactoryId: '',
    departmentId: '',
    adminUserId: '',
    normalAdminUserId: '',
    managementUserId: '',
    masterUserId: '',
    workerUserId: '',
    okkUserId: '',
    storeUserId: '',
    outsiderUserId: '',
    createdUserIds: [],
    accessUserIds: [],
    lineIds: [],
    lineNames: [],
    lineEventIds: [],
    taskIds: [],
    checklistTemplateIds: [],
    checklistRunIds: [],
    washIds: [],
    washIssueIds: [],
    washControlItemIds: [],
    okkIds: [],
    stockIds: [],
    returnIds: [],
    protectedBefore,
  };

  const factory = await db.factory.create({ data: { name: `${marker} Контрольная аналитика`, code: `p16c-${runId}` } });
  const otherFactory = await db.factory.create({ data: { name: `${marker} Чужой завод`, code: `p16c-other-${runId}` } });
  const department = await db.department.create({
    data: {
      factoryId: factory.id,
      name: `${marker} Производство`,
      normalizedName: `p16c-production-${suffix}`,
      code: `P16C_${suffix}`,
      scope: 'LOCAL',
    },
  });
  state.factoryId = factory.id;
  state.otherFactoryId = otherFactory.id;
  state.departmentId = department.id;
  writeJson(statePath, state);

  let diagnosticAdmin = await db.user.findUnique({ where: { id: 'test-admin' }, select: { id: true } });
  if (!diagnosticAdmin) {
    diagnosticAdmin = await db.user.create({ data: { id: `test-p16c-admin-${suffix}`, factoryId: factory.id, role: 'ADMIN' }, select: { id: true } });
    state.createdUserIds.push(diagnosticAdmin.id);
  }
  await db.userFactoryAccess.create({ data: { userId: diagnosticAdmin.id, factoryId: factory.id, role: 'ADMIN', departmentId: department.id, isActive: true, isGuest: false } });
  state.adminUserId = diagnosticAdmin.id;
  state.accessUserIds.push(diagnosticAdmin.id);
  state.normalAdminUserId = await createUser(db, state, factory.id, department.id, 'ADMIN', 'Администратор проверки');
  state.managementUserId = await createUser(db, state, factory.id, department.id, 'MANAGEMENT', 'Руководитель аналитики');
  state.masterUserId = await createUser(db, state, factory.id, department.id, 'MASTER', 'Мастер аналитики');
  state.workerUserId = await createUser(db, state, factory.id, department.id, 'WORKER', 'Работник аналитики');
  state.okkUserId = await createUser(db, state, factory.id, department.id, 'OKK', 'Специалист ОКК');
  state.storeUserId = await createUser(db, state, factory.id, department.id, 'STORE', 'Кладовщик аналитики');
  state.outsiderUserId = await createUser(db, state, otherFactory.id, null, 'MANAGEMENT', 'Чужой руководитель');
  writeJson(statePath, state);

  const actors = actorContexts(state);
  writeClock('2026-08-26T23:40:00+03:00');
  const lineA = await services.admin.createLine(actors.admin, { factoryId: factory.id, name: `${marker} Линия Альфа` });
  const lineB = await services.admin.createLine(actors.admin, { factoryId: factory.id, name: `${marker} Линия Бета` });
  state.lineIds.push(lineA.id, lineB.id);
  state.lineNames.push(lineA.name, lineB.name);
  state.lineAId = lineA.id;
  state.lineBId = lineB.id;
  writeJson(statePath, state);
  await services.line.updateStatus(lineA.id, 'WORK', 'Начало контрольного периода', actors.master);
  await services.line.updateStatus(lineB.id, 'WORK', 'Начало контрольного периода', actors.master);

  writeClock('2026-08-26T23:50:00+03:00');
  const clipped = await services.line.updateStatus(lineB.id, 'PAUSE', `${marker} Ожидание решения`, actors.master, 'OTHER');
  state.lineEventIds.push(clipped.id);
  writeClock('2026-08-27T00:10:00+03:00');
  await services.line.updateStatus(lineB.id, 'WORK', 'Возврат в работу', actors.master);

  writeClock('2026-08-27T21:00:00+03:00');
  const tenMinute = await services.line.updateStatus(lineA.id, 'PAUSE', `${marker} Техническая остановка`, actors.master, 'TECHNICAL');
  state.lineEventIds.push(tenMinute.id);
  writeClock('2026-08-27T21:05:00+03:00');
  const completedTask = await services.task.createTask({
    lineId: lineA.id,
    lineStatusEventId: tenMinute.id,
    actor: actors.master,
    operationId: `${marker}-task-completed`,
    description: `${marker} Связанная заявка`,
    type: 'URGENT',
    departmentRecipientIds: [department.id],
  });
  state.taskIds.push(completedTask.id);
  writeClock('2026-08-27T21:10:00+03:00');
  await services.task.takeTask(completedTask.id, actors.master, `${marker}-task-take`);
  await services.line.updateStatus(lineA.id, 'WORK', 'Возврат после технической остановки', actors.master);
  writeClock('2026-08-27T21:20:00+03:00');
  const twentyMinute = await services.line.updateStatus(lineA.id, 'STOP', `${marker} Контроль качества`, actors.master, 'QUALITY');
  state.lineEventIds.push(twentyMinute.id);
  writeClock('2026-08-27T21:30:00+03:00');
  await services.task.completeTask(completedTask.id, actors.master, `${marker}-task-done`, `${marker} выполнено`);
  writeClock('2026-08-27T21:40:00+03:00');
  await services.line.updateStatus(lineA.id, 'WORK', 'Возврат после контроля', actors.master);

  writeClock('2026-08-27T21:50:00+03:00');
  const urgentOpen = await services.task.createTask({
    lineId: lineA.id,
    actor: actors.master,
    operationId: `${marker}-urgent-open`,
    description: `${marker} Открытая срочная заявка`,
    type: 'URGENT',
    departmentRecipientIds: [department.id],
  });
  state.taskIds.push(urgentOpen.id);
  writeClock('2026-08-27T22:00:00+03:00');
  const longOverdue = await services.task.createTask({
    lineId: lineA.id,
    actor: actors.master,
    operationId: `${marker}-long-overdue`,
    description: `${marker} Просроченная долгая заявка`,
    type: 'LONG',
    deadlineAt: '2026-08-27T22:10:00+03:00',
    departmentRecipientIds: [department.id],
  });
  state.taskIds.push(longOverdue.id);
  writeJson(statePath, state);
  writeClock('2026-08-27T22:05:00+03:00');
  await services.task.takeTask(longOverdue.id, actors.master, `${marker}-long-take`);

  const templateInputs = [
    { key: 'manual', name: 'Ручной контроль', frequencyRule: 'MANUAL' },
    { key: 'early', name: 'Периодический досрочный', frequencyRule: 'EVERY_N_HOURS', frequencyIntervalUnit: 'MINUTES', frequencyIntervalValue: 30 },
    { key: 'auto', name: 'Автозакрытие', frequencyRule: 'EVERY_N_HOURS', frequencyIntervalUnit: 'MINUTES', frequencyIntervalValue: 30 },
    { key: 'active', name: 'Активный динамический', frequencyRule: 'EVERY_N_HOURS', frequencyIntervalUnit: 'MINUTES', frequencyIntervalValue: 30 },
  ];
  const templates = {};
  writeClock('2026-08-27T22:08:00+03:00');
  for (const input of templateInputs) {
    const template = await services.checklists.createTemplate(actors.admin, {
      name: `${marker} ${input.name}`,
      description: `${marker} canonical checklist`,
      departmentId: department.id,
      assignmentRoles: ['WORKER'],
      isActive: true,
      rows: [{ title: `${marker} Подтвердить состояние`, rowType: 'YES_NO', requiredAnswer: true, isRequired: true }],
      ...input,
    });
    templates[input.key] = template;
    state.checklistTemplateIds.push(template.id);
  }

  writeClock('2026-08-27T22:10:00+03:00');
  const manualRun = await services.checklists.startRun(actors.worker, { templateId: templates.manual.id, shiftDate: '2026-08-27', shiftType: 'NIGHT' });
  state.checklistRunIds.push(manualRun.id);
  await services.checklists.completeRow(actors.worker, manualRun.id, manualRun.rows[0].id, { answerBoolean: true, checkId: manualRun.currentCheck?.id, operationId: `${marker}-manual-row` });
  writeClock('2026-08-27T22:12:00+03:00');
  await services.checklists.close(actors.worker, manualRun.id, { reason: `${marker} Ручное завершение` });

  writeClock('2026-08-27T22:15:00+03:00');
  const earlyRun = await services.checklists.startRun(actors.worker, { templateId: templates.early.id, shiftDate: '2026-08-27', shiftType: 'NIGHT' });
  state.checklistRunIds.push(earlyRun.id);
  await services.checklists.completeRow(actors.worker, earlyRun.id, earlyRun.rows[0].id, { answerBoolean: true, checkId: earlyRun.currentCheck.id, operationId: `${marker}-early-row` });
  await services.checklists.completeCurrentCheck(actors.worker, earlyRun.id, { checkId: earlyRun.currentCheck.id, operationId: `${marker}-early-check` });
  writeClock('2026-08-27T22:20:00+03:00');
  await services.checklists.close(actors.worker, earlyRun.id, { reason: `${marker} Досрочное завершение` });

  writeClock('2026-08-27T22:25:00+03:00');
  const autoRun = await services.checklists.startRun(actors.worker, { templateId: templates.auto.id, shiftDate: '2026-08-27', shiftType: 'NIGHT' });
  state.checklistRunIds.push(autoRun.id);
  writeClock('2026-08-27T22:30:00+03:00');
  await services.checklists.autoCloseDueChecklistRuns(actors.admin, { force: true, runId: autoRun.id, comment: `${marker} Конец смены` });

  writeClock('2026-08-27T22:35:00+03:00');
  const activeRun = await services.checklists.startRun(actors.worker, { templateId: templates.active.id, shiftDate: '2026-08-27', shiftType: 'NIGHT' });
  state.checklistRunIds.push(activeRun.id);
  writeJson(statePath, state);

  writeClock('2026-08-27T22:40:00+03:00');
  const completedWash = await services.wash.startWash({ targetType: 'OTHER', objectName: `${marker} Зона завершённой мойки`, objectDescription: 'Контрольная зона' }, state.masterUserId, `${marker}-wash-completed`, factory.id);
  state.washIds.push(completedWash.id);
  writeClock('2026-08-27T22:45:00+03:00');
  await services.wash.completeWash(completedWash.id, state.masterUserId, factory.id, `${marker}-wash-complete`);
  writeClock('2026-08-27T22:50:00+03:00');
  const activeWash = await services.wash.startWash({ targetType: 'OTHER', objectName: `${marker} Активная зона мойки`, objectDescription: 'Контрольная зона' }, state.masterUserId, `${marker}-wash-active`, factory.id);
  state.washIds.push(activeWash.id);
  writeClock('2026-08-27T22:55:00+03:00');
  const washIssue = await services.wash.addIssue(activeWash.id, state.masterUserId, { title: `${marker} Замечание`, description: 'Требует проверки', operationId: `${marker}-wash-issue` }, factory.id);
  state.washIssueIds.push(washIssue.id);
  writeClock('2026-08-27T22:56:00+03:00');
  const miniTask = await services.wash.createControlItem(activeWash.id, state.masterUserId, { title: `${marker} Мини-задание`, type: 'MINI_TASK', requiresPhoto: false }, factory.id);
  state.washControlItemIds.push(miniTask.id);
  writeJson(statePath, state);
  writeClock('2026-08-27T22:57:00+03:00');
  await services.wash.updateControlItem(miniTask.id, state.masterUserId, { status: 'DONE', comment: 'Выполнено' }, factory.id);

  writeClock('2026-08-27T23:00:00+03:00');
  const okk = await services.okk.createRecord(actors.okk, { lineId: lineA.id, assignedMasterId: state.masterUserId, description: `${marker} Контрольный брак`, operationId: `${marker}-okk` });
  state.okkIds.push(okk.id);
  writeJson(statePath, state);
  const stock = await services.stock.createDefect(actors.store, { name: `${marker} Контрольная некондиция`, quantity: 20, unit: 'штуки', operationId: `${marker}-stock` });
  state.stockIds.push(stock.id);
  writeJson(statePath, state);
  const returned = await services.returns.createReturn(actors.admin, { description: `${marker} Контрольный возврат`, photoUrl: 'attachment-pending', operationId: `${marker}-return` });
  state.returnIds.push(returned.id);
  writeJson(statePath, state);
  writeClock('2026-08-27T23:05:00+03:00');
  await services.stock.updateDefect(actors.store, stock.id, { quantity: 15, comment: `${marker} Уточнено` });

  writeClock('2026-08-27T23:00:00+03:00');
  const openThirty = await services.line.updateStatus(lineA.id, 'PAUSE', `${marker} Нехватка людей`, actors.master, 'PEOPLE');
  state.lineEventIds.push(openThirty.id);
  writeClock('2026-08-27T23:30:00+03:00');
  state.status = 'PREPARED';
  writeJson(statePath, state);
  return state;
}

function actorContexts(state) {
  const opsPermissions = ['ops.overview.read', 'ops.statistics.read', 'ops.events.read', 'ops.audit.read', 'ops.audit.full'];
  return {
    admin: context(state.adminUserId, state.factoryId, 'ADMIN', state.departmentId, opsPermissions),
    normalAdmin: context(state.normalAdminUserId, state.factoryId, 'ADMIN', state.departmentId, opsPermissions),
    management: context(state.managementUserId, state.factoryId, 'MANAGEMENT', state.departmentId, opsPermissions),
    master: context(state.masterUserId, state.factoryId, 'MASTER', state.departmentId, ['tasks.read', 'tasks.manage', 'lines.read', 'lines.manage', 'wash.read', 'wash.manage']),
    worker: context(state.workerUserId, state.factoryId, 'WORKER', state.departmentId, ['checklists.runs.self']),
    okk: context(state.okkUserId, state.factoryId, 'OKK', state.departmentId, ['okk.read', 'okk.manage']),
    store: context(state.storeUserId, state.factoryId, 'STORE', state.departmentId, ['stock.read', 'stock.manage']),
    outsider: context(state.outsiderUserId, state.otherFactoryId, 'MANAGEMENT', null, opsPermissions),
  };
}

async function verify(db, services, state) {
  const actors = actorContexts(state);
  writeClock('2026-08-27T23:30:00+03:00');
  const query = { dateFrom: state.dateFrom, dateTo: state.dateTo, includeDiagnostics: 'true' };
  const operations = await services.ops.operationsAnalytics(actors.admin, query);
  const summary = operations.summary;
  const expected = {
    downtimeCount: 4,
    totalLostMinutes: 70,
    averageDowntimeMinutes: 18,
    medianDowntimeMinutes: 10,
    p90DowntimeMinutes: 30,
    openDowntimeCount: 1,
    tasksTotal: 3,
    tasksOpen: 2,
    tasksCompleted: 1,
    urgentOpenTasks: 1,
    overdueLongTasks: 1,
    averageResponseMinutes: 5,
    averageExecutionMinutes: 20,
    averageResolutionMinutes: 25,
  };
  for (const [key, value] of Object.entries(expected)) check(`formula ${key}`, summary[key], value);
  check('period start is factory-local midnight', operations.period.start, '2026-08-26T21:00:00.000Z');
  check('period end is exclusive factory-local midnight', operations.period.endExclusive, '2026-08-27T21:00:00.000Z');
  check('period as-of uses controlled server time', operations.period.asOf, '2026-08-27T20:30:00.000Z');
  check('ten-minute effect is capped by selected-period actual loss', summary.tenMinuteDailyEffect.potentialMinutes, 10);
  check('problem line is deterministic Line A', summary.worstLine?.lineName, `${marker} Линия Альфа`);
  check('problem line total is 60 minutes', summary.worstLine?.lostMinutes, 60);
  const reasons = Object.fromEntries(operations.downtimeReasons.map((item) => [item.reason, { count: item.count, totalMinutes: item.totalMinutes }]));
  check('reason TECHNICAL', reasons.TECHNICAL, { count: 1, totalMinutes: 10 });
  check('reason QUALITY', reasons.QUALITY, { count: 1, totalMinutes: 20 });
  check('reason PEOPLE', reasons.PEOPLE, { count: 1, totalMinutes: 30 });
  check('reason OTHER', reasons.OTHER, { count: 1, totalMinutes: 10 });
  check('all controlled reason labels are Russian', operations.downtimeReasons.every((item) => !/\b(?:People|Quality|Other|Warehouse)\b/i.test(item.reasonLabel)), true);
  const clipped = operations.downtimes.find((item) => item.lineName === `${marker} Линия Бета`);
  check('open interval is clipped to period start', Boolean(clipped?.isClipped && clipped?.durationMinutes === 10), true);
  check('linked downtime task counted exactly once', operations.lineEvents.downtimeLinkedTasks, 1);
  check('unrelated requests are not downtime-linked', operations.tasks.filter((item) => item.downtimeLinked).length, 1);
  check('completed request reaction = created to taken', operations.tasks.find((item) => item.title.includes('Связанная'))?.responseMinutes, 5);
  check('completed request execution = taken to done', operations.tasks.find((item) => item.title.includes('Связанная'))?.executionMinutes, 20);
  check('completed request resolution = created to done', operations.tasks.find((item) => item.title.includes('Связанная'))?.resolutionMinutes, 25);
  check('checklist started count', operations.checklists.started, 4);
  check('checklist active at period end', operations.checklists.active, 1);
  check('checklist manual and manual-early grouping', operations.checklists.manuallyClosed, 2);
  check('checklist shift-close grouping', operations.checklists.shiftClosed, 1);
  check('checklist completed occurrence', operations.checklists.checksCompleted >= 1, true, operations.checklists.checksCompleted);
  check('checklist overdue excludes closed-parent legacy children', operations.checklists.checksOverdue, 1);
  check('wash active count', operations.wash.active, 1);
  check('wash completed count', operations.wash.completed, 1);
  check('wash issue count', operations.wash.issues, 1);
  check('wash open issue count', operations.wash.openIssues, 1);
  check('wash mini-task count', operations.wash.miniTasks, 1);
  check('wash completed mini-task count', operations.wash.miniTasksDone, 1);
  check('quality OKK count', operations.quality.okkDefects, 1);
  check('quality stock count', operations.quality.stockDefects, 1);
  check('quality remaining stock quantity is not double-counted', operations.quality.stockDefectQuantity, 15);
  check('quality returns count', operations.quality.returns, 1);

  const lineAOnly = await services.ops.operationsAnalytics(actors.admin, { ...query, lineId: state.lineAId });
  check('line filter count', lineAOnly.summary.downtimeCount, 3);
  check('line filter total', lineAOnly.summary.totalLostMinutes, 60);
  const openTasks = await services.ops.operationsAnalytics(actors.admin, { ...query, taskScope: 'open' });
  check('task open filter', openTasks.summary.tasksTotal, 2);
  const modules = await services.ops.moduleSummary(actors.admin, query);
  check('all module cards follow selected period', modules.every((item) => item.scope === 'PERIOD' && item.scopeLabel.includes('выбранный период')), true);
  const moduleCounts = Object.fromEntries(modules.map((item) => [item.module, item.count]));
  check('module tasks count', moduleCounts.Tasks, 3);
  check('module wash count', moduleCounts.Wash, 2);
  check('module checklist count', moduleCounts.Checklists, 4);
  check('module OKK count', moduleCounts.OKK, 1);
  check('module Stock count', moduleCounts.Stock, 1);
  check('module Returns count', moduleCounts.Returns, 1);

  const normalView = await services.ops.operationsAnalytics(actors.management, { dateFrom: state.dateFrom, dateTo: state.dateTo });
  check('normal management excludes diagnostic marker lines', normalView.filterOptions.lines.some((line) => line.name.includes(marker)), false);
  check('normal management excludes diagnostic global departments', normalView.filterOptions.departments.some((item) => item.name.includes(marker)), false);
  check('diagnostic admin includes controlled department option', operations.filterOptions.departments.some((item) => item.id === state.departmentId), true);
  check('normal management excludes diagnostic marker metrics', normalView.summary.downtimeCount, 0);
  const normalAdminView = await services.ops.operationsAnalytics(actors.normalAdmin, { ...query });
  check('normal admin cannot enable diagnostics', normalAdminView.filterOptions.lines.some((line) => line.name.includes(marker)), false);
  const outsiderView = await services.ops.operationsAnalytics(actors.outsider, { dateFrom: state.dateFrom, dateTo: state.dateTo, lineId: state.lineAId });
  check('cross-factory line filter returns no controlled data', outsiderView.summary.downtimeCount, 0);
  await expectRejected('worker direct statistics access denied', () => services.ops.operationsAnalytics(actors.worker, query), /доступ|FORBIDDEN/i);
  await expectRejected('worker direct audit access denied', () => services.ops.audit(actors.worker, query), /доступ|FORBIDDEN/i);

  const audit = await services.ops.audit(actors.admin, { ...query, search: marker, limit: '200' });
  check('audit controlled rows exist', audit.length > 0, true, audit.length);
  check('audit uses human action labels', audit.every((item) => item.actionLabel && !/^[A-Z0-9_]+$/.test(item.actionLabel)), true);
  check('audit uses human actor labels', audit.some((item) => item.actorName?.startsWith('Мастер аналитики')), true);
  check('audit uses human object labels', audit.some((item) => item.entityName?.includes('Линия Альфа') || item.entityName?.includes('Контрольная некондиция')), true);
  const quantityAudit = audit.find((item) => item.action === 'STOCK_DEFECT_UPDATED' && item.detailRows?.some((row) => row.label === 'Количество'));
  check('audit before-after quantity row', quantityAudit?.detailRows?.find((row) => row.label === 'Количество'), { label: 'Количество', before: '20', after: '15' });
  check('audit public rows omit raw details and scope ids', audit.every((item) => !Object.hasOwn(item, 'details') && !Object.hasOwn(item, 'userId') && !Object.hasOwn(item, 'entityId') && !Object.hasOwn(item, 'factoryId')), true);
  const auditJson = JSON.stringify(audit);
  check('audit public rows contain no secret field names', /passwordHash|storagePath|DATABASE_URL|accessToken|refreshToken|JWT_SECRET/i.test(auditJson), false);
  check('audit public rows contain no JSON dump', audit.some((item) => item.detailsSummary?.some((value) => /^\s*[\[{]/.test(value))), false);
  const normalAudit = await services.ops.audit(actors.management, { dateFrom: state.dateFrom, dateTo: state.dateTo, limit: '200' });
  check('normal management audit excludes marker rows', JSON.stringify(normalAudit).includes(marker), false);

  const factory4 = await factory4Snapshot(db);
  check('historical forensic cohort remains exactly 723 rows', state.protectedBefore.globalLegacyChecklistChildren, 723);
  check('legacy closed-parent active children unchanged during proof', factory4.legacyChecklistChildren, state.protectedBefore.legacyChecklistChildren);
  check('global historical 723-child cohort unchanged during proof', factory4.globalLegacyChecklistChildren, state.protectedBefore.globalLegacyChecklistChildren);
  check('ambiguous Factory 4 open STOP rows unchanged during proof', factory4.ambiguousOpenStops, state.protectedBefore.ambiguousOpenStops);
  if (factory4.factoryId) {
    const access = await db.userFactoryAccess.findFirst({
      where: { factoryId: factory4.factoryId, isActive: true, isGuest: false, role: { in: ['MANAGEMENT', 'ADMIN'] }, user: { blockedAt: null, deletedAt: null } },
      orderBy: { role: 'asc' },
    });
    if (access) {
      const factory4Actor = context(access.userId, factory4.factoryId, access.role, access.departmentId, ['ops.statistics.read', 'ops.overview.read', 'ops.audit.read']);
      const qualityView = await services.ops.operationsAnalytics(factory4Actor, { dateFrom: state.dateFrom, dateTo: state.dateTo });
      const warning = qualityView.dataQuality.warnings.find((item) => item.code === 'LEGACY_CHECKLIST_CHILD_STATE');
      check('legacy checklist anomaly is exposed as read-only warning', warning?.count ?? 0, state.protectedBefore.legacyChecklistChildren);
    } else {
      check('Factory 4 management context available for data-quality warning', false, true);
    }
  }

  return {
    expected,
    actual: {
      summary,
      downtimeReasons: operations.downtimeReasons,
      checklists: operations.checklists,
      wash: operations.wash,
      quality: operations.quality,
      moduleCounts,
    },
    auditRows: audit.length,
  };
}

async function cleanup(db, services, state) {
  const actors = actorContexts(state);
  const cleanupMarker = state.marker;
  writeClock('2026-08-27T23:40:00+03:00');
  for (const taskId of state.taskIds) {
    await services.task.completeTask(taskId, actors.master, `${cleanupMarker}-cleanup-task-${taskId}`, 'Штатное завершение контрольной записи').catch(() => undefined);
  }
  for (const issueId of state.washIssueIds) {
    await services.wash.setIssueStatus(issueId, state.masterUserId, 'RESOLVED', 'Контроль завершён', state.factoryId).catch(() => undefined);
  }
  for (const washId of state.washIds) {
    await services.wash.completeWash(washId, state.masterUserId, state.factoryId, `${cleanupMarker}-cleanup-wash-${washId}`).catch(() => undefined);
  }
  for (const runIdValue of state.checklistRunIds) {
    await services.checklists.close(actors.admin, runIdValue, { reason: 'Штатное завершение контрольного запуска' }).catch(() => undefined);
  }
  for (const templateId of state.checklistTemplateIds) {
    await services.checklists.archiveTemplate(actors.admin, templateId).catch(() => undefined);
  }
  for (const id of state.okkIds) await services.okk.archive(actors.admin, id).catch(() => undefined);
  for (const id of state.stockIds) await services.stock.archiveDefect(actors.admin, id).catch(() => undefined);
  for (const id of state.returnIds) await services.returns.archiveReturn(actors.admin, id).catch(() => undefined);
  for (const lineId of state.lineIds) {
    await services.line.updateStatus(lineId, 'WORK', 'Штатное завершение контрольного простоя', actors.master).catch(() => undefined);
    await services.admin.updateLine(actors.admin, lineId, { isActive: false, reason: 'Завершён контролируемый P16C regression' }).catch(() => undefined);
  }

  const at = new Date('2026-08-27T23:45:00+03:00');
  await db.userFactoryAccess.updateMany({
    where: { factoryId: { in: [state.factoryId, state.otherFactoryId] }, userId: { in: state.accessUserIds }, isActive: true },
    data: { isActive: false, deactivatedAt: at, deactivatedById: state.adminUserId, deactivationReason: 'Завершён P16C regression' },
  });
  await db.department.updateMany({
    where: { id: state.departmentId, isActive: true },
    data: { isActive: false, deactivatedAt: at, deactivatedById: state.adminUserId, deactivationReason: 'Завершён P16C regression' },
  });
  await db.factory.updateMany({
    where: { id: { in: [state.factoryId, state.otherFactoryId] }, isActive: true },
    data: { isActive: false, deactivatedAt: at, deactivatedById: state.adminUserId, deactivationReason: 'Завершён P16C regression' },
  });
  await db.user.updateMany({ where: { id: { in: state.createdUserIds }, blockedAt: null }, data: { blockedAt: at } });

  const inventory = await activeInventory(db, state);
  for (const [key, value] of Object.entries(inventory)) check(`cleanup ${key}`, value, 0);
  const protectedAfter = await factory4Snapshot(db);
  check('Factory 4 protected hash unchanged', protectedAfter.hash, state.protectedBefore.hash);
  check('legacy checklist rows not mutated', protectedAfter.legacyChecklistChildren, state.protectedBefore.legacyChecklistChildren);
  check('global historical 723-child cohort not mutated', protectedAfter.globalLegacyChecklistChildren, state.protectedBefore.globalLegacyChecklistChildren);
  check('ambiguous open STOP rows not mutated', protectedAfter.ambiguousOpenStops, state.protectedBefore.ambiguousOpenStops);
  state.status = 'CLEANED';
  state.protectedAfter = protectedAfter;
  state.inventory = inventory;
  writeJson(statePath, state);
  return { inventory, protectedAfter };
}

async function activeInventory(db, state) {
  const [lines, lineEvents, tasks, assignments, plans, checklistTemplates, checklistRuns, washes, okk, stock, returns, accesses, factories, users] = await Promise.all([
    db.line.count({ where: { id: { in: state.lineIds }, deletedAt: null, deactivatedAt: null } }),
    db.lineEvent.count({ where: { id: { in: state.lineEventIds }, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null } }),
    db.task.count({ where: { id: { in: state.taskIds }, deletedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] } } }),
    db.assignment.count({ where: { factoryId: state.factoryId, endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: state.factoryId, releasedAt: null } }),
    db.checklistTemplate.count({ where: { id: { in: state.checklistTemplateIds }, isActive: true, archivedAt: null } }),
    db.checklistRun.count({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    db.washSession.count({ where: { id: { in: state.washIds }, deletedAt: null, status: { not: 'DONE' } } }),
    db.okkRecord.count({ where: { id: { in: state.okkIds }, deletedAt: null, archivedAt: null } }),
    db.stockDefect.count({ where: { id: { in: state.stockIds }, deletedAt: null, status: { not: 'ARCHIVED' } } }),
    db.returnRecord.count({ where: { id: { in: state.returnIds }, deletedAt: null, archivedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: { in: [state.factoryId, state.otherFactoryId] }, userId: { in: state.accessUserIds }, isActive: true } }),
    db.factory.count({ where: { id: { in: [state.factoryId, state.otherFactoryId] }, isActive: true, deactivatedAt: null } }),
    db.user.count({ where: { id: { in: state.createdUserIds }, blockedAt: null, deletedAt: null } }),
  ]);
  const values = {
    ACTIVE_P16C_LINES: lines,
    ACTIVE_P16C_LINE_EVENTS: lineEvents,
    ACTIVE_P16C_TASKS: tasks,
    ACTIVE_P16C_ASSIGNMENTS: assignments,
    ACTIVE_P16C_PLANS: plans,
    ACTIVE_P16C_CHECKLIST_TEMPLATES: checklistTemplates,
    ACTIVE_P16C_CHECKLIST_RUNS: checklistRuns,
    ACTIVE_P16C_WASHES: washes,
    ACTIVE_P16C_QUALITY_RECORDS: okk + stock + returns,
    ACTIVE_P16C_ACCESSES: accesses,
    ACTIVE_P16C_FACTORIES: factories,
    ACTIVE_P16C_USERS: users,
  };
  return { ...values, ACTIVE_P16C_TEST_ARTIFACTS: Object.values(values).reduce((sum, value) => sum + value, 0) };
}

function servicesFrom(app) {
  return {
    admin: app.get(AdminService),
    checklists: app.get(ChecklistsService),
    line: app.get(LineService),
    okk: app.get(OkkService),
    ops: app.get(OpsService),
    returns: app.get(ReturnsService),
    stock: app.get(StockService),
    task: app.get(TaskService),
    wash: app.get(WashService),
  };
}

function publicArtifact(state, proof, cleanupResult, status) {
  const previous = readJson(artifactPath, {});
  const isStandaloneCleanup = mode === 'cleanup-browser';
  return {
    ...previous,
    plast: '16C',
    runId: state.runId,
    marker: state.marker,
    status,
    controlledPeriod: { dateFrom: state.dateFrom, dateTo: state.dateTo, timezone: 'Europe/Moscow' },
    expected: proof?.expected ?? previous.expected ?? null,
    actual: proof?.actual ?? previous.actual ?? null,
    auditRows: proof?.auditRows ?? previous.auditRows ?? 0,
    checks: isStandaloneCleanup ? previous.checks ?? [] : checks,
    passed: isStandaloneCleanup ? previous.passed ?? 0 : checks.filter((item) => item.passed).length,
    failed: isStandaloneCleanup ? previous.failed ?? failures.length : failures.length,
    cleanupChecks: cleanupResult ? checks : previous.cleanupChecks ?? [],
    cleanupPassed: cleanupResult ? checks.filter((item) => item.passed).length : previous.cleanupPassed ?? null,
    cleanupFailed: cleanupResult ? failures.length : previous.cleanupFailed ?? null,
    cleanup: cleanupResult?.inventory ?? previous.cleanup ?? null,
    protectedFactory4: {
      beforeHash: state.protectedBefore?.hash ?? null,
      afterHash: cleanupResult?.protectedAfter?.hash ?? previous.protectedFactory4?.afterHash ?? null,
      legacyChecklistChildrenBefore: state.protectedBefore?.legacyChecklistChildren ?? null,
      legacyChecklistChildrenAfter: cleanupResult?.protectedAfter?.legacyChecklistChildren ?? previous.protectedFactory4?.legacyChecklistChildrenAfter ?? null,
      globalLegacyChecklistChildrenBefore: state.protectedBefore?.globalLegacyChecklistChildren ?? null,
      globalLegacyChecklistChildrenAfter: cleanupResult?.protectedAfter?.globalLegacyChecklistChildren ?? previous.protectedFactory4?.globalLegacyChecklistChildrenAfter ?? null,
      ambiguousOpenStopsBefore: state.protectedBefore?.ambiguousOpenStops ?? null,
      ambiguousOpenStopsAfter: cleanupResult?.protectedAfter?.ambiguousOpenStops ?? previous.protectedFactory4?.ambiguousOpenStopsAfter ?? null,
    },
    directPrismaBusinessHappyPathWrites: 0,
    directPrismaSetupAndSoftCleanupOnly: true,
    physicalDeletes: 0,
    migrationCreated: false,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(PrismaService).db;
  const services = servicesFrom(app);
  let state = existingState;
  let proof = null;
  let cleanupResult = null;
  try {
    if (mode === 'cleanup-browser') {
      const storedFactoryActive = state?.factoryId
        ? await db.factory.count({ where: { id: state.factoryId, isActive: true, deactivatedAt: null } })
        : 0;
      if (!storedFactoryActive) {
        state = await recoverActiveState(db);
        if (state) writeJson(statePath, state);
      }
      if (!state?.factoryId) throw new Error('P16C browser state отсутствует');
      cleanupResult = await cleanup(db, services, state);
      writeJson(artifactPath, publicArtifact(state, null, cleanupResult, failures.length ? 'FAIL' : 'CLEANED'));
    } else {
      state = await prepare(db, services);
      proof = await verify(db, services, state);
      if (mode === 'full') {
        cleanupResult = await cleanup(db, services, state);
        writeJson(artifactPath, publicArtifact(state, proof, cleanupResult, failures.length ? 'FAIL' : 'PASS'));
      } else {
        writeJson(artifactPath, publicArtifact(state, proof, null, failures.length ? 'FAIL' : 'PREPARED_FOR_BROWSER'));
      }
    }
  } catch (error) {
    failures.push({ name: 'unexpected exception', passed: false, message: error instanceof Error ? error.stack ?? error.message : String(error) });
    if (mode !== 'cleanup-browser') {
      const recoverableState = readJson(statePath, state);
      if (recoverableState?.factoryId) {
        state = recoverableState;
        cleanupResult = await cleanup(db, services, state).catch(() => null);
      }
    }
    if (state) writeJson(artifactPath, publicArtifact(state, proof, cleanupResult, 'FAIL'));
  } finally {
    await app.close();
  }

  console.log(`P16C_CONTROLLED_FORMULA_REGRESSION: ${failures.length ? 'FAIL' : mode === 'prepare-browser' ? 'PREPARED' : 'PASS'}`);
  console.log(`passed=${checks.filter((item) => item.passed).length} failed=${failures.length}`);
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${JSON.stringify(failure.actual ?? failure.message ?? failure)}`);
  if (mode === 'prepare-browser' && !failures.length) console.log(`P16C_STATE=${statePath}`);
  process.exitCode = failures.length ? 1 : 0;
}

void main();
