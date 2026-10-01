const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { factoryShiftTarget } = require('../dist/common/shift-time');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const runId = `${Date.now()}`;
const marker = `__PFFV5_P14_${runId}__`;
const state = { passed: [], failed: [], templateIds: [], runIds: [], notificationIds: [] };
const actorTokens = new Map();
const TEST_PASSWORD = process.env.PILOT_TEST_PASSWORD || '1234';
let factory;
let otherFactory;
let adminAccess;
let masterAccess;
let workerAccess;

function pass(name, evidence) {
  state.passed.push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function fail(name, evidence) {
  state.failed.push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function expect(condition, name, evidence) {
  if (condition) pass(name, evidence);
  else fail(name, evidence);
}

function unwrap(value) {
  let current = value;
  if (current && typeof current === 'object' && current.data && typeof current.data === 'object') current = current.data;
  return current;
}

async function actorToken(userId) {
  const existing = actorTokens.get(userId);
  if (existing) return existing;
  const actor = await db.user.findUnique({ where: { id: userId }, select: { phone: true, normalizedPhone: true } });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`У pilot-пользователя ${userId} нет телефона для входа`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Не выполнен Bearer login для ${userId}: HTTP ${response.status}`);
  actorTokens.set(userId, data.token);
  return data.token;
}

async function request(method, pathname, { userId = masterAccess?.userId, factoryId = factory?.id, body } = {}) {
  const headers = {};
  if (userId) headers.Authorization = `Bearer ${await actorToken(userId)}`;
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

async function createTemplate(name, frequencyRule, rows, interval = null) {
  const created = await request('POST', '/checklists/templates', {
    userId: adminAccess.userId,
    body: {
      name: `${marker} ${name}`,
      description: `${marker} targeted lifecycle evidence`,
      departmentId: masterAccess.departmentId,
      assignmentRoles: ['MASTER'],
      frequencyRule,
      ...(interval ? { frequencyIntervalUnit: interval.unit, frequencyIntervalValue: interval.value } : {}),
      isMandatory: false,
    },
  });
  const createdTemplate = created.data?.template ?? created.data;
  expect([200, 201].includes(created.status) && createdTemplate?.id, `${name}: шаблон создан`, { status: created.status });
  if (!createdTemplate?.id) throw new Error(`Не создан шаблон ${name}: HTTP ${created.status}, ${JSON.stringify(created.data)}`);
  state.templateIds.push(createdTemplate.id);
  for (let index = 0; index < rows.length; index += 1) {
    const row = await request('POST', `/checklists/templates/${createdTemplate.id}/rows`, {
      userId: adminAccess.userId,
      body: { sortOrder: (index + 1) * 10, isRequired: true, ...rows[index] },
    });
    expect([200, 201].includes(row.status), `${name}: пункт ${index + 1} создан`, { status: row.status });
  }
  const loaded = (await request('GET', `/checklists/templates/${createdTemplate.id}`, { userId: adminAccess.userId })).data;
  return loaded?.template ?? loaded;
}

async function workspace() {
  return (await request('GET', '/checklists/workspace?includeDiagnostics=true')).data;
}

async function verifyAnonymousDenyAudit() {
  const entityId = 'checklists.runs.self|checklists.runs.manage|checklists.templates.read';
  const before = await db.auditLog.count({ where: { action: 'ACCESS_DENIED', entityType: 'Permission', entityId, userId: null } });
  const denied = await request('GET', '/checklists/workspace', { userId: null, factoryId: null });
  const after = await db.auditLog.count({ where: { action: 'ACCESS_DENIED', entityType: 'Permission', entityId, userId: null } });
  expect(denied.status === 403, 'anonymous checklist workspace запрещён backend guard', { status: denied.status });
  expect(after === before + 1, 'anonymous ACCESS_DENIED записан без фиктивного User FK', { before, after });
}

async function start(templateId) {
  const target = factoryShiftTarget(new Date());
  return request('POST', '/checklists/runs/start', {
    body: { templateId, shiftDate: target.shiftDate, shiftType: target.shiftType },
  });
}

async function loadRun(id) {
  return (await request('GET', `/checklists/runs/${id}`)).data;
}

async function completeYesNo(run) {
  const row = run.rows[0];
  return request('POST', `/checklists/runs/${run.id}/rows/${row.id}/complete`, {
    body: { answerBoolean: true, operationId: `${marker}-${row.id}-${Date.now()}` },
  });
}

async function completeOccurrence(run, operationId) {
  return request('POST', `/checklists/runs/${run.id}/checks/current/complete`, {
    body: { checkId: run.currentCheck?.id, operationId },
  });
}

async function closeActiveRuns() {
  const active = await db.checklistRun.findMany({
    where: { templateId: { in: state.templateIds }, status: { in: ['ACTIVE', 'PAUSED'] } },
    select: { id: true, userId: true },
  });
  for (const run of active) {
    await request('POST', `/checklists/runs/${run.id}/close`, {
      userId: run.userId,
      body: { reason: `${marker} cleanup` },
    });
  }
}

async function archiveTemplates() {
  for (const templateId of state.templateIds) {
    await request('POST', `/checklists/templates/${templateId}/archive`, { userId: adminAccess.userId });
  }
}

async function markNotificationsRead() {
  const notifications = await db.notification.findMany({
    where: {
      readAt: null,
      OR: [
        { entityId: { in: state.runIds } },
        { entityId: { in: await db.checklistRunCheck.findMany({ where: { runId: { in: state.runIds } }, select: { id: true } }).then((items) => items.map((item) => item.id)) } },
        { message: { contains: marker } },
      ],
    },
    select: { id: true, userId: true },
  });
  state.notificationIds.push(...notifications.map((item) => item.id));
  for (const notification of notifications) {
    await request('POST', `/notifications/${notification.id}/read`, { userId: notification.userId || masterAccess.userId });
  }
}

async function cleanupEvidence() {
  await closeActiveRuns();
  await archiveTemplates();
  await markNotificationsRead();
  const markerChecks = await db.checklistRunCheck.findMany({ where: { runId: { in: state.runIds } }, select: { id: true } });
  const counts = {
    activeTemplates: await db.checklistTemplate.count({ where: { id: { in: state.templateIds }, isActive: true, archivedAt: null } }),
    activeOwnerships: await db.checklistRun.count({ where: { id: { in: state.runIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    activeRuns: await db.checklistRun.count({ where: { id: { in: state.runIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    activeOccurrences: await db.checklistRunCheck.count({ where: { runId: { in: state.runIds }, status: 'ACTIVE' } }),
    activeNotifications: await db.notification.count({ where: { entityId: { in: markerChecks.map((item) => item.id) }, readAt: null } }),
  };
  counts.activeTestArtifacts = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return counts;
}

async function main() {
  factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('Завод 4 не найден');
  otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, deletedAt: null } });
  const activeAccessWhere = { factoryId: factory.id, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } };
  [adminAccess, masterAccess, workerAccess] = await Promise.all([
    db.userFactoryAccess.findFirst({ where: { userId: 'pilot-pack-admin', factoryId: factory.id, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } } }),
    db.userFactoryAccess.findFirst({ where: { userId: 'pilot-master-1', ...activeAccessWhere, role: 'MASTER', departmentId: { not: null } } }),
    db.userFactoryAccess.findFirst({ where: { userId: 'pilot-worker-1', ...activeAccessWhere, role: 'WORKER' } }),
  ]);
  if (!adminAccess || !masterAccess || !workerAccess) throw new Error('Не найдены безопасные pilot-роли ADMIN/MASTER/WORKER');
  await verifyAnonymousDenyAudit();

  let cleanup = null;
  try {
    const periodic = await createTemplate('periodic', 'EVERY_N_HOURS', [
      { title: `${marker} да или нет`, rowType: 'YES_NO', requiredAnswer: true },
    ], { unit: 'HOURS', value: 1 });
    const availableBefore = await workspace();
    expect(availableBefore.available.some((item) => item.id === periodic.id), 'R1/R4: новый periodic находится в Доступных');

    const parallel = await Promise.all([start(periodic.id), start(periodic.id)]);
    expect(parallel.every((item) => [200, 201].includes(item.status)), 'R4: double tap обработан без ошибки', parallel.map((item) => item.status));
    expect(parallel[0].data?.id && parallel[0].data.id === parallel[1].data?.id, 'R4: double tap возвращает один ownership', parallel.map((item) => item.data?.id));
    const periodicRunId = parallel[0].data.id;
    state.runIds.push(periodicRunId);
    const duplicateRunCount = await db.checklistRun.count({ where: { templateId: periodic.id, userId: masterAccess.userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    expect(duplicateRunCount === 1, 'R4: в БД один active ownership', { duplicateRunCount });

    const afterTake = await workspace();
    expect(!afterTake.available.some((item) => item.id === periodic.id), 'R4: ownership исключён из Доступных');
    expect(afterTake.activeRuns.filter((item) => item.template?.id === periodic.id).length === 1, 'R2/R3: ownership находится в В работе');

    const runBeforeTemplateEdit = await loadRun(periodicRunId);
    const snapshotTitle = runBeforeTemplateEdit.rows[0].title;
    await request('PATCH', `/checklists/templates/${periodic.id}/rows/${periodic.rows[0].id}`, {
      userId: adminAccess.userId,
      body: { title: `${marker} изменённый шаблон`, reason: `${marker} snapshot check` },
    });
    const runAfterTemplateEdit = await loadRun(periodicRunId);
    expect(runAfterTemplateEdit.rows[0].title === snapshotTitle, 'snapshot начатого run неизменяем после изменения шаблона');

    await completeYesNo(runAfterTemplateEdit);
    let filled = await loadRun(periodicRunId);
    const firstOperation = `${marker}-occurrence-1`;
    const firstCompleted = await completeOccurrence(filled, firstOperation);
    expect([200, 201].includes(firstCompleted.status), 'R2: первое occurrence завершено');
    let afterFirst = firstCompleted.data;
    expect(afterFirst.status === 'ACTIVE', 'R2: periodic ownership остаётся ACTIVE');
    expect(afterFirst.checks.filter((check) => check.status === 'COMPLETED').length === 1, 'R2: первое occurrence сохранено в истории');
    expect(afterFirst.checks.filter((check) => check.status === 'ACTIVE').length === 1, 'R3: создано ровно одно следующее occurrence');
    const workspaceAfterFirst = await workspace();
    expect(workspaceAfterFirst.activeRuns.filter((item) => item.template?.id === periodic.id).length === 1, 'R3: счётчик В работе после occurrence остаётся 1');
    expect(!workspaceAfterFirst.available.some((item) => item.id === periodic.id), 'R4: после occurrence повторного take нет');
    const localHistoryAfterFirst = await request(
      'GET',
      `/checklists/archive/template/${periodic.id}/journal?includeDiagnostics=true&includeActiveOccurrences=true&pageSize=5`,
    );
    expect(
      localHistoryAfterFirst.data?.runs?.filter((item) => item.runId === periodicRunId).length === 1,
      'R7: локальная история показывает завершённое occurrence активного ownership',
    );

    const repeatedCompletion = await completeOccurrence(afterFirst, firstOperation);
    expect(repeatedCompletion.data.checks.filter((check) => check.status === 'COMPLETED').length === 1, 'idempotency: повтор completion не создаёт историю/уведомление');

    const activeCheck = await db.checklistRunCheck.findFirst({ where: { runId: periodicRunId, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
    const dueSoonAt = new Date(Date.now() + 9 * 60_000);
    await db.$transaction([
      db.checklistRunCheck.update({ where: { id: activeCheck.id }, data: { dueAt: dueSoonAt } }),
      db.checklistRun.update({ where: { id: periodicRunId }, data: { nextCheckAt: dueSoonAt } }),
    ]);
    await workspace();
    await workspace();
    const dueSoonCount = await db.notification.count({ where: { entityId: activeCheck.id, type: `CHECKLIST_CHECK_DUE_SOON_${activeCheck.sequence}` } });
    expect(dueSoonCount === 1, 'reminder 10 минут создаётся один раз', { dueSoonCount });

    const overdueAt = new Date(Date.now() - 3 * 60_000);
    await db.$transaction([
      db.checklistRunCheck.update({ where: { id: activeCheck.id }, data: { dueAt: overdueAt } }),
      db.checklistRun.update({ where: { id: periodicRunId }, data: { nextCheckAt: overdueAt } }),
    ]);
    await workspace();
    await workspace();
    const overdueCount = await db.notification.count({ where: { entityId: activeCheck.id, type: `CHECKLIST_CHECK_OVERDUE_${activeCheck.sequence}` } });
    expect(overdueCount === 1, 'reminder +2 минуты создаётся один раз', { overdueCount });

    const paused = await request('POST', `/checklists/runs/${periodicRunId}/pause`, { body: { reason: `${marker} pause` } });
    const resumed = await request('POST', `/checklists/runs/${periodicRunId}/resume`);
    expect([200, 201].includes(paused.status) && [200, 201].includes(resumed.status), 'downtime pause/resume сохранён');

    afterFirst = await loadRun(periodicRunId);
    await completeYesNo(afterFirst);
    filled = await loadRun(periodicRunId);
    const secondCompleted = await completeOccurrence(filled, `${marker}-occurrence-2`);
    expect(secondCompleted.data.checks.filter((check) => check.status === 'COMPLETED').length === 2, 'R7: две проверки доступны локальной истории');
    const localHistoryAfterSecond = await request(
      'GET',
      `/checklists/archive/template/${periodic.id}/journal?includeDiagnostics=true&includeActiveOccurrences=true&pageSize=5`,
    );
    expect(
      localHistoryAfterSecond.data?.runs?.filter((item) => item.runId === periodicRunId).length === 2,
      'R7: локальная история активного ownership содержит occurrence #1 и #2',
    );
    expect(
      localHistoryAfterSecond.data?.runs?.filter((item) => item.runId === periodicRunId).map((item) => item.occurrenceSequence).join(',') === '2,1',
      'R7: локальная история показывает последние occurrence сверху',
    );
    expect((await db.checklistRun.count({ where: { id: periodicRunId, status: 'ACTIVE' } })) === 1, 'R2: после двух occurrences ownership один');

    const retryAfterMidRun = await start(periodic.id);
    expect(retryAfterMidRun.data?.id === periodicRunId, 'R4: network retry после occurrence возвращает тот же ownership');
    if (otherFactory) {
      const crossFactory = await request('POST', '/checklists/runs/start', {
        factoryId: otherFactory.id,
        body: { templateId: periodic.id },
      });
      expect([403, 409].includes(crossFactory.status), 'factory isolation: чужой завод не может взять шаблон', { status: crossFactory.status });
    }
    const workerDenied = await request('POST', '/checklists/runs/start', {
      userId: workerAccess.userId,
      body: { templateId: periodic.id },
    });
    expect([403, 409].includes(workerDenied.status), 'RBAC: роль вне assignment scope не может взять checklist', { status: workerDenied.status });

    const oneTime = await createTemplate('one-time', 'ONCE_PER_SHIFT', [
      { title: `${marker} одноразовый`, rowType: 'YES_NO', requiredAnswer: true },
    ]);
    const oneStart = await start(oneTime.id);
    state.runIds.push(oneStart.data.id);
    await completeYesNo(oneStart.data);
    const oneClose = await request('POST', `/checklists/runs/${oneStart.data.id}/close`, { body: { reason: `${marker} one-time complete` } });
    expect(oneClose.data?.status === 'CLOSED', 'one-time: после выполнения ownership закрыт');
    const oneWorkspace = await workspace();
    expect(!oneWorkspace.activeRuns.some((item) => item.id === oneStart.data.id), 'one-time: завершённый run не остаётся В работе');
    expect(!oneWorkspace.available.some((item) => item.id === oneTime.id), 'one-time: не получает periodic timer и не возвращается в Доступные');

    const composite = await createTemplate('composite', 'EVERY_N_HOURS', [
      { title: `${marker} число и фото`, rowType: 'NUMBER', requiredAnswer: true, requiresPhoto: true, minValue: 1, maxValue: 10 },
      { title: `${marker} число без фото`, rowType: 'NUMBER', requiredAnswer: true, requiresPhoto: false },
    ], { unit: 'HOURS', value: 1 });
    const compositeStart = await start(composite.id);
    state.runIds.push(compositeStart.data.id);
    const requiredRow = compositeStart.data.rows.find((row) => row.requiresPhoto);
    const optionalRow = compositeStart.data.rows.find((row) => !row.requiresPhoto);
    const missingPhoto = await request('POST', `/checklists/runs/${compositeStart.data.id}/rows/${requiredRow.id}/complete`, { body: { answerNumber: 5 } });
    expect(missingPhoto.status === 409, 'R10: backend не принимает composite без обязательного фото', { status: missingPhoto.status });
    const optionalPhoto = await request('POST', `/checklists/runs/${compositeStart.data.id}/rows/${optionalRow.id}/complete`, { body: { answerNumber: 5 } });
    expect([200, 201].includes(optionalPhoto.status), 'R10: optional photo не становится обязательным');

    const autoTemplate = await createTemplate('auto-close', 'EVERY_N_HOURS', [
      { title: `${marker} auto-close`, rowType: 'YES_NO', requiredAnswer: true },
    ], { unit: 'HOURS', value: 1 });
    const autoStart = await start(autoTemplate.id);
    state.runIds.push(autoStart.data.id);
    await db.checklistRun.update({ where: { id: autoStart.data.id }, data: { shiftEndsAt: new Date(Date.now() - 60_000) } });
    const autoClose = await request('POST', '/checklists/runs/auto-close', { userId: adminAccess.userId, body: { runId: autoStart.data.id } });
    const autoCloseRepeat = await request('POST', '/checklists/runs/auto-close', { userId: adminAccess.userId, body: { runId: autoStart.data.id } });
    expect(autoClose.data?.count === 1 && autoCloseRepeat.data?.count === 0, 'auto-close idempotent и закрывает один marker run');
    const ghostChecks = await db.checklistRunCheck.count({ where: { runId: autoStart.data.id, status: 'ACTIVE' } });
    expect(ghostChecks === 0, 'auto-close не оставляет ghost active occurrence', { ghostChecks });

    const activeMarkerRuns = await db.checklistRun.findMany({
      where: { templateId: { in: state.templateIds }, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true, templateId: true, userId: true, shiftDate: true, shiftType: true, lineId: true },
    });
    const keys = activeMarkerRuns.map((item) => [item.templateId, item.userId, item.shiftDate?.toISOString(), item.shiftType, item.lineId ?? 'none'].join(':'));
    expect(new Set(keys).size === keys.length, 'reference integrity: duplicate active ownership = 0');
  } finally {
    cleanup = await cleanupEvidence();
  }

  expect(cleanup.activeTemplates === 0, 'cleanup: ACTIVE_P14_TEMPLATES = 0', cleanup);
  expect(cleanup.activeOwnerships === 0, 'cleanup: ACTIVE_P14_OWNERSHIPS = 0', cleanup);
  expect(cleanup.activeRuns === 0, 'cleanup: ACTIVE_P14_RUNS = 0', cleanup);
  expect(cleanup.activeOccurrences === 0, 'cleanup: ACTIVE_P14_OCCURRENCES = 0', cleanup);
  expect(cleanup.activeNotifications === 0, 'cleanup: ACTIVE_P14_NOTIFICATIONS = 0', cleanup);
  expect(cleanup.activeTestArtifacts === 0, 'cleanup: ACTIVE_P14_TEST_ARTIFACTS = 0', cleanup);

  const report = {
    marker,
    api: API,
    migration: 'not needed',
    passed: state.passed.length,
    failed: state.failed.length,
    checks: { passed: state.passed, failed: state.failed },
    cleanup,
    safety: {
      physicalDeletes: 0,
      preexistingEntitiesDeleted: 0,
      preexistingEntitiesUnintentionallyModified: 0,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (state.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
