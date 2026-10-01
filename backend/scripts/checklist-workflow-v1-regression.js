const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const stamp = Date.now();
const suffix = String(stamp).slice(-8);
const ids = {
  admin: 'test-admin',
  workerA: `worker-${suffix}1`,
  workerB: `worker-${suffix}2`,
  manager: `worker-${suffix}3`,
  other: `worker-${suffix}4`,
  guest: `worker-${suffix}5`,
};
const state = { passed: [], failed: [], templateIds: [], runIds: [], attachmentIds: [], factoryId: null };

function check(name, condition, detail) {
  (condition ? state.passed : state.failed).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function noSensitive(value) {
  return !/(storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|secret)/i.test(JSON.stringify(value));
}

async function request(method, pathname, { userId = ids.workerA, factoryId = state.factoryId, body, form } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function createUser(userId, role, departmentId, isGuest = false) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId: state.factoryId, role, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId: state.factoryId, role },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId: state.factoryId } },
    update: { role, departmentId, isActive: true, isGuest },
    create: { userId, factoryId: state.factoryId, role, departmentId, isActive: true, isGuest },
  });
}

async function createTemplate({ name, departmentId, lineId = null, rule = 'MANUAL', unit = null, value = null, roles = ['MASTER'], shiftType = null }) {
  const response = await request('POST', '/checklists/templates', {
    userId: ids.admin,
    body: {
      name,
      description: 'Рабочая проверка участка',
      departmentId,
      lineId,
      assignmentRoles: roles,
      shiftType,
      frequencyRule: rule,
      frequencyIntervalUnit: unit,
      frequencyIntervalValue: value,
      isMandatory: rule !== 'MANUAL',
    },
  });
  check(`создан шаблон «${name}»`, response.status === 201 && response.data?.id, { status: response.status });
  if (!response.data?.id) throw new Error(`Не удалось создать шаблон: ${JSON.stringify(response.data)}`);
  state.templateIds.push(response.data.id);
  return response.data;
}

async function createRow(templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: ids.admin,
    body,
  });
  check(`создан пункт «${body.title}»`, response.status === 201 && response.data?.id, { status: response.status });
  if (!response.data?.id) throw new Error(`Не удалось создать пункт: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function startRun(userId, templateId, shift, lineId = null, extra = {}) {
  const response = await request('POST', '/checklists/runs/start', {
    userId,
    body: { templateId, lineId, shiftDate: shift.shiftDate, shiftType: shift.shiftType, ...extra },
  });
  if (response.data?.id && !state.runIds.includes(response.data.id)) state.runIds.push(response.data.id);
  return response;
}

async function completeRow(userId, runId, rowId, body) {
  return request('POST', `/checklists/runs/${runId}/rows/${rowId}/complete`, { userId, body });
}

async function workspace(userId) {
  return request('GET', '/checklists/workspace', { userId });
}

async function notificationCount(checkId, type, userId) {
  return db.notification.count({ where: { entityType: 'CHECKLIST_RUN_CHECK', entityId: checkId, type, userId } });
}

async function uploadPhoto(userId, entryId) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_ENTRY');
  form.append('entityId', entryId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `checklist-photo-${stamp}-${entryId}`);
  form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'utf8')], { type: 'image/png' }), 'primer-kontrolya.png');
  return request('POST', '/attachments/upload', { userId, form });
}

async function closeActiveRuns() {
  const active = await db.checklistRun.findMany({
    where: { factoryId: state.factoryId, status: { in: ['ACTIVE', 'PAUSED'] } },
    select: { id: true },
  });
  for (const run of active) {
    await request('POST', `/checklists/runs/${run.id}/close`, {
      userId: ids.admin,
      body: { reason: 'Завершение целевой проверки' },
    });
  }
}

async function cleanup() {
  if (!state.factoryId) return;
  await closeActiveRuns().catch(() => null);
  for (const id of state.templateIds) {
    await request('POST', `/checklists/templates/${id}/archive`, { userId: ids.admin, body: {} }).catch(() => null);
  }
  for (const id of state.attachmentIds) {
    await request('DELETE', `/attachments/${id}`, { userId: ids.admin }).catch(() => null);
  }
  await db.userFactoryAccess.updateMany({ where: { factoryId: state.factoryId }, data: { isActive: false } });
  await db.department.updateMany({ where: { factoryId: state.factoryId }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Целевая проверка завершена' } });
  await db.line.updateMany({ where: { factoryId: state.factoryId }, data: { deactivatedAt: new Date(), deactivationReason: 'Целевая проверка завершена' } });
  await db.factory.update({
    where: { id: state.factoryId },
    data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Целевая проверка завершена' },
  });
}

async function main() {
  const shift = factoryShiftTarget(new Date());
  const factory = await db.factory.create({ data: { code: `checklist-workflow-${stamp}`, name: `Контур чек-листов ${stamp}` } });
  state.factoryId = factory.id;
  const department = await db.department.create({ data: { factoryId: factory.id, code: 'production-control', name: 'Производственный контроль' } });
  const otherDepartment = await db.department.create({ data: { factoryId: factory.id, code: 'technical-control', name: 'Технический контроль' } });
  const line = await db.line.create({ data: { factoryId: factory.id, name: 'Линия упаковки', status: 'WORK' } });

  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: ids.admin, factoryId: factory.id } },
    update: { role: 'ADMIN', departmentId: department.id, isActive: true, isGuest: false },
    create: { userId: ids.admin, factoryId: factory.id, role: 'ADMIN', departmentId: department.id, isActive: true, isGuest: false },
  });
  await createUser(ids.workerA, 'MASTER', department.id);
  await createUser(ids.workerB, 'MASTER', department.id);
  await createUser(ids.manager, 'MANAGEMENT', department.id);
  await createUser(ids.other, 'MASTER', otherDepartment.id);
  await createUser(ids.guest, 'WORKER', department.id, true);

  const periodic = await createTemplate({
    name: `Контроль температуры ${stamp}`,
    departmentId: department.id,
    lineId: line.id,
    rule: 'EVERY_N_HOURS',
    unit: 'MINUTES',
    value: 30,
    shiftType: shift.shiftType,
  });
  const periodicRow = await createRow(periodic.id, { title: 'Температура соответствует норме', rowType: 'YES_NO', requiredAnswer: true, isRequired: true });

  const available = await request('GET', `/checklists/available?shiftDate=${shift.shiftDate}&shiftType=${shift.shiftType}`, { userId: ids.workerA });
  check('доступный чек-лист виден сотруднику своего отдела', available.status === 200 && available.data.some((item) => item.id === periodic.id));
  check('доступная карточка содержит человекочитаемую периодичность', available.data.some((item) => item.id === periodic.id && /30/.test(item.frequencyLabel)));
  check('ответ доступного списка не раскрывает служебные данные', noSensitive(available.data));

  const future = { shiftDate: '2099-01-01', shiftType: 'DAY' };
  const futureStart = await startRun(ids.workerA, periodic.id, future, line.id, { now: '2099-01-01T10:00:00+03:00' });
  check('frontend не может подменить смену и серверное время', futureStart.status === 409 && /текущ/i.test(futureStart.data?.message ?? ''), futureStart.data);

  const startedAt = Date.now();
  const [takeA, takeB] = await Promise.all([
    startRun(ids.workerA, periodic.id, shift, line.id, { now: '2001-01-01T00:00:00.000Z' }),
    startRun(ids.workerB, periodic.id, shift, line.id, { now: '2001-01-01T00:00:00.000Z' }),
  ]);
  const success = takeA.status === 201 ? { userId: ids.workerA, response: takeA } : { userId: ids.workerB, response: takeB };
  const conflict = takeA.status === 409 ? takeA : takeB;
  const loserId = success.userId === ids.workerA ? ids.workerB : ids.workerA;
  const run = success.response.data;
  check('конкурентное взятие создаёт ровно одного владельца', [takeA.status, takeB.status].sort().join(',') === '201,409', { takeA: takeA.status, takeB: takeB.status });
  check('конфликт взятия сообщает о владельце по-человечески', /Работник|сотрудник/i.test(conflict.data?.message ?? '') && !/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(conflict.data?.message ?? ''), conflict.data);
  check('время запуска фиксирует сервер', new Date(run.startedAt).getTime() >= startedAt - 2000, { startedAt: run.startedAt });
  check('пункты шаблона зафиксированы в запуске', run.rows?.length === 1 && run.rows[0].templateRowId === periodicRow.id);
  check('первое occurrence создано вместе с запуском', run.checks?.length === 1 && run.checks[0].sequence === 1 && run.checks[0].status === 'ACTIVE');

  const repeat = await startRun(success.userId, periodic.id, shift, line.id);
  check('повторное взятие владельцем идемпотентно', repeat.status === 201 && repeat.data?.id === run.id, { status: repeat.status });
  const runCount = await db.checklistRun.count({ where: { factoryId: factory.id, templateId: periodic.id } });
  check('идемпотентность не создаёт второй run', runCount === 1, { runCount });

  const ownerWorkspace = await workspace(success.userId);
  check('workspace сотрудника содержит раздел в работе', ownerWorkspace.status === 200 && ownerWorkspace.data.activeRuns.some((item) => item.id === run.id));
  check('workspace сотрудника не содержит manager-контроль без полномочия', ownerWorkspace.data.manager === null);
  check('workspace содержит заводскую дату и тип текущей смены', ownerWorkspace.data.shift.shiftDate === shift.shiftDate && ownerWorkspace.data.shift.shiftType === shift.shiftType, ownerWorkspace.data.shift);

  const managerWorkspace = await workspace(ids.manager);
  check('руководитель видит контроль своего отдела', managerWorkspace.status === 200 && managerWorkspace.data.manager?.runs.some((item) => item.id === run.id));
  check('контроль отдела содержит счётчики', Number.isInteger(managerWorkspace.data.manager?.summary?.inProgress));

  const pauseWhileWorking = await request('POST', `/checklists/runs/${run.id}/pause`, { userId: success.userId, body: { reason: 'Проверка остановки' } });
  check('работающий line-scoped чек-лист нельзя поставить на паузу', pauseWhileWorking.status === 409 && /работает/i.test(pauseWhileWorking.data?.message ?? ''), pauseWhileWorking.data);
  const lineAfterReject = await db.line.findUnique({ where: { id: line.id } });
  check('отказ паузы не меняет статус линии', lineAfterReject.status === 'WORK');

  await db.line.update({ where: { id: line.id }, data: { status: 'STOP' } });
  const pauseNoReason = await request('POST', `/checklists/runs/${run.id}/pause`, { userId: success.userId, body: {} });
  check('для паузы обязательна причина', pauseNoReason.status === 409 && /причин|комментар/i.test(pauseNoReason.data?.message ?? ''), pauseNoReason.data);
  const paused = await request('POST', `/checklists/runs/${run.id}/pause`, { userId: success.userId, body: { reason: 'Линия остановлена для настройки' } });
  check('остановленный line-scoped чек-лист можно поставить на паузу', paused.status === 201 && paused.data?.status === 'PAUSED');
  check('пауза не запускает и не останавливает линию', (await db.line.findUnique({ where: { id: line.id } })).status === 'STOP');

  const activeCheck = await db.checklistRunCheck.findFirst({ where: { runId: run.id, status: 'ACTIVE' } });
  const soonAt = new Date(Date.now() + 5 * 60_000);
  await db.checklistRunCheck.update({ where: { id: activeCheck.id }, data: { dueAt: soonAt } });
  await db.checklistRun.update({ where: { id: run.id }, data: { nextCheckAt: soonAt } });
  await workspace(ids.manager);
  check('пауза подавляет напоминание', await notificationCount(activeCheck.id, 'CHECKLIST_CHECK_DUE_SOON_1', success.userId) === 0);

  const resumed = await request('POST', `/checklists/runs/${run.id}/resume`, { userId: success.userId, body: {} });
  check('возобновление возвращает чек-лист в работу', resumed.status === 201 && resumed.data?.status === 'ACTIVE');
  await workspace(success.userId);
  await workspace(success.userId);
  check('за 10 минут создаётся одно напоминание без дубля', await notificationCount(activeCheck.id, 'CHECKLIST_CHECK_DUE_SOON_1', success.userId) === 1);
  const overdueAt = new Date(Date.now() - 3 * 60_000);
  await db.checklistRunCheck.update({ where: { id: activeCheck.id }, data: { dueAt: overdueAt } });
  await db.checklistRun.update({ where: { id: run.id }, data: { nextCheckAt: overdueAt } });
  await workspace(success.userId);
  await workspace(success.userId);
  check('через 2 минуты просрочки создаётся одно предупреждение', await notificationCount(activeCheck.id, 'CHECKLIST_CHECK_OVERDUE_1', success.userId) === 1);

  const rowCompleted = await completeRow(success.userId, run.id, run.rows[0].id, { answerBoolean: true, now: '2001-01-01T00:00:00.000Z' });
  check('сотрудник сохраняет типизированный ответ', rowCompleted.status === 201);
  const filledOccurrence = await request('GET', `/checklists/runs/${run.id}`, { userId: success.userId });
  const occurrenceCompleted = await request('POST', `/checklists/runs/${run.id}/checks/current/complete`, {
    userId: success.userId,
    body: {
      checkId: filledOccurrence.data.currentCheck?.id,
      operationId: `workflow-occurrence-${stamp}`,
    },
  });
  check('сотрудник явно завершает текущую периодическую проверку', occurrenceCompleted.status === 201);
  const afterOccurrence = await request('GET', `/checklists/runs/${run.id}`, { userId: success.userId });
  check('завершённая проверка не закрывает периодический чек-лист', afterOccurrence.data.status === 'ACTIVE');
  check('завершённое occurrence остаётся в истории', afterOccurrence.data.checks.some((item) => item.sequence === 1 && item.status === 'COMPLETED'));
  check('после проверки открывается следующее occurrence', afterOccurrence.data.checks.some((item) => item.sequence === 2 && item.status === 'ACTIVE'));
  check('строка следующей проверки сбрасывается', afterOccurrence.data.rows[0].status === 'PENDING');
  check('ответ хранит реального исполнителя и серверное время', afterOccurrence.data.checks[0].rows[0].completedById === success.userId && new Date(afterOccurrence.data.checks[0].rows[0].completedAt).getFullYear() > 2025);

  const twice = await createTemplate({ name: `Двойной контроль смены ${stamp}`, departmentId: department.id, rule: 'TWICE_PER_SHIFT', shiftType: shift.shiftType });
  await createRow(twice.id, { title: 'Проверка состояния зоны', rowType: 'YES_NO', requiredAnswer: true });
  const twiceLoaded = await request('GET', `/checklists/templates/${twice.id}`, { userId: ids.admin });
  check('вариант два раза за смену имеет понятную подпись', twiceLoaded.data.frequencyLabel === '2 раза за смену', twiceLoaded.data.frequencyLabel);
  const twiceRun = await startRun(loserId, twice.id, shift);
  check('два раза за смену фиксируется как единый run', twiceRun.status === 201 && twiceRun.data.frequencyIntervalUnit === 'HOURS' && twiceRun.data.frequencyIntervalValue === 6);

  const photoTemplate = await createTemplate({ name: `Фото контроля ${stamp}`, departmentId: department.id, rule: 'MANUAL', roles: ['MASTER'] });
  const photoTemplateRow = await createRow(photoTemplate.id, { title: 'Фото результата', rowType: 'PHOTO', requiresPhoto: true, requiredAnswer: true });
  const photoStart = await startRun(success.userId, photoTemplate.id, shift);
  const snapshotTitle = photoStart.data.rows[0].title;
  await request('PATCH', `/checklists/templates/${photoTemplate.id}/rows/${photoTemplateRow.id}`, { userId: ids.admin, body: { title: 'Фото результата после изменения' } });
  const snapshotRun = await request('GET', `/checklists/runs/${photoStart.data.id}`, { userId: success.userId });
  check('изменение шаблона не меняет snapshot активного запуска', snapshotRun.data.rows[0].title === snapshotTitle);
  const missingPhoto = await completeRow(success.userId, photoStart.data.id, snapshotRun.data.rows[0].id, {});
  check('обязательное фото проверяется backend guard', missingPhoto.status === 409 && /фото/i.test(missingPhoto.data?.message ?? ''), missingPhoto.data);
  const photo = await uploadPhoto(success.userId, snapshotRun.data.rows[0].entryId);
  check('фото прикрепляется к конкретному occurrence', photo.status === 201 && photo.data?.id && noSensitive(photo.data), photo.data);
  if (photo.data?.id) state.attachmentIds.push(photo.data.id);
  const photoMetadata = await request('GET', `/attachments/${photo.data.id}`, { userId: success.userId });
  check('metadata фото доступна владельцу без storagePath', photoMetadata.status === 200 && noSensitive(photoMetadata.data));
  check('guarded file endpoint отдаёт файл', (await fetch(`${API}/attachments/${photo.data.id}/file`, { headers: { 'x-user-id': success.userId, 'x-factory-id': factory.id } })).status === 200);
  check('фото позволяет завершить пункт', (await completeRow(success.userId, photoStart.data.id, snapshotRun.data.rows[0].id, {})).status === 201);
  check('ручное завершение требует причину', (await request('POST', `/checklists/runs/${photoStart.data.id}/close`, { userId: success.userId, body: {} })).status === 409);
  const photoClosed = await request('POST', `/checklists/runs/${photoStart.data.id}/close`, { userId: success.userId, body: { reason: 'Проверка с фото завершена' } });
  check('ручное завершение сохраняет причину', photoClosed.status === 201 && photoClosed.data?.closeReason === 'Проверка с фото завершена');
  const photoArchive = await request('GET', `/checklists/archive/template/${photoTemplate.id}/journal`, { userId: ids.manager });
  check('архив сохраняет occurrence, фото, автора и время', photoArchive.status === 200 && photoArchive.data.runs.some((item) => item.runId === photoStart.data.id && item.photoCount === 1 && item.rows[0].completedByName && item.rows[0].completedAt), photoArchive.data?.runs);
  check('архив не раскрывает storagePath и секреты', noSensitive(photoArchive.data));

  const otherTemplate = await createTemplate({ name: `Контроль другого отдела ${stamp}`, departmentId: otherDepartment.id, rule: 'MANUAL', roles: ['MASTER'] });
  await createRow(otherTemplate.id, { title: 'Проверка другого отдела', rowType: 'YES_NO', requiredAnswer: true });
  const otherRun = await startRun(ids.other, otherTemplate.id, shift);
  check('сотрудник другого отдела запускает только свой шаблон', otherRun.status === 201);
  const crossDepartmentStart = await startRun(success.userId, otherTemplate.id, shift);
  check('прямой API запрещает запуск чужого отдела', crossDepartmentStart.status === 409 || crossDepartmentStart.status === 403, crossDepartmentStart.data);
  const managerScoped = await workspace(ids.manager);
  check('руководитель не видит run чужого отдела', !managerScoped.data.manager.runs.some((item) => item.id === otherRun.data.id));

  const blockedTemplate = await createTemplate({ name: `Контроль блокировки ${stamp}`, departmentId: department.id, rule: 'EVERY_N_HOURS', unit: 'MINUTES', value: 30, shiftType: shift.shiftType });
  await createRow(blockedTemplate.id, { title: 'Проверка блокировки', rowType: 'YES_NO', requiredAnswer: true });
  const blockedRun = await startRun(loserId, blockedTemplate.id, shift);
  const blockedCheck = await db.checklistRunCheck.findFirst({ where: { runId: blockedRun.data.id, status: 'ACTIVE' } });
  const blockedDue = new Date(Date.now() + 5 * 60_000);
  await db.checklistRunCheck.update({ where: { id: blockedCheck.id }, data: { dueAt: blockedDue } });
  await db.checklistRun.update({ where: { id: blockedRun.data.id }, data: { nextCheckAt: blockedDue } });
  await db.user.update({ where: { id: loserId }, data: { blockedAt: new Date() } });
  check('blocked пользователь получает 403', (await workspace(loserId)).status === 403);
  await workspace(ids.manager);
  check('blocked владельцу не отправляется напоминание', await notificationCount(blockedCheck.id, 'CHECKLIST_CHECK_DUE_SOON_1', loserId) === 0);
  await db.user.update({ where: { id: loserId }, data: { blockedAt: null } });
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: loserId, factoryId: factory.id } }, data: { isActive: false } });
  check('деактивированный доступ получает 403', (await workspace(loserId)).status === 403);
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: loserId, factoryId: factory.id } }, data: { isActive: true } });
  check('гостевой доступ не открывает чек-листы', (await workspace(ids.guest)).status === 403);
  const foreignFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, isActive: true, deletedAt: null } });
  if (foreignFactory) check('cross-factory запрос сотрудника запрещён', (await request('GET', '/checklists/workspace', { userId: success.userId, factoryId: foreignFactory.id })).status === 403);

  const incompleteTemplate = await createTemplate({ name: `Незавершённый контроль ${stamp}`, departmentId: department.id, rule: 'ONCE_PER_SHIFT', shiftType: shift.shiftType });
  await createRow(incompleteTemplate.id, { title: 'Обязательная проверка', rowType: 'YES_NO', requiredAnswer: true, isRequired: true });
  const incompleteRun = await startRun(loserId, incompleteTemplate.id, shift);
  await db.checklistRun.update({ where: { id: incompleteRun.data.id }, data: { shiftEndsAt: new Date(Date.now() - 60_000) } });
  await workspace(ids.manager);
  const incompleteClosed = await db.checklistRun.findUnique({ where: { id: incompleteRun.data.id } });
  check('незаполненный run автозакрывается как незавершённый', incompleteClosed.status === 'AUTO_CLOSED' && incompleteClosed.closeKind === 'SHIFT_END_INCOMPLETE', incompleteClosed.closeKind);
  check('причина автозакрытия понятна по-русски', /не завершён/i.test(incompleteClosed.closeReason ?? ''), incompleteClosed.closeReason);
  const incompleteAuditBefore = await db.auditLog.count({ where: { action: 'CHECKLIST_RUN_AUTO_CLOSED', entityId: incompleteRun.data.id } });
  await workspace(ids.manager);
  check('повторный maintenance не дублирует auto-close', await db.auditLog.count({ where: { action: 'CHECKLIST_RUN_AUTO_CLOSED', entityId: incompleteRun.data.id } }) === incompleteAuditBefore);

  const completeTemplate = await createTemplate({ name: `Завершённый контроль ${stamp}`, departmentId: department.id, rule: 'ONCE_PER_SHIFT', shiftType: shift.shiftType });
  await createRow(completeTemplate.id, { title: 'Контроль выполнен', rowType: 'YES_NO', requiredAnswer: true, isRequired: true });
  const completeRun = await startRun(loserId, completeTemplate.id, shift);
  await completeRow(loserId, completeRun.data.id, completeRun.data.rows[0].id, { answerBoolean: true });
  await db.checklistRun.update({ where: { id: completeRun.data.id }, data: { shiftEndsAt: new Date(Date.now() - 60_000) } });
  await workspace(ids.manager);
  const completeClosed = await db.checklistRun.findUnique({ where: { id: completeRun.data.id } });
  check('заполненный run автозакрывается как завершённый', completeClosed.status === 'AUTO_CLOSED' && completeClosed.closeKind === 'SHIFT_END_COMPLETE', completeClosed.closeKind);

  const pausedTemplate = await createTemplate({ name: `Пауза до конца смены ${stamp}`, departmentId: department.id, rule: 'EVERY_N_HOURS', unit: 'MINUTES', value: 30, shiftType: shift.shiftType });
  await createRow(pausedTemplate.id, { title: 'Проверка после паузы', rowType: 'YES_NO', requiredAnswer: true });
  const pausedRun = await startRun(loserId, pausedTemplate.id, shift);
  await request('POST', `/checklists/runs/${pausedRun.data.id}/pause`, { userId: loserId, body: { reason: 'Ожидание окончания смены' } });
  await db.checklistRun.update({ where: { id: pausedRun.data.id }, data: { shiftEndsAt: new Date(Date.now() - 60_000) } });
  await workspace(ids.manager);
  const pauseEvent = await db.checklistPauseEvent.findFirst({ where: { runId: pausedRun.data.id }, orderBy: { pausedAt: 'desc' } });
  check('auto-close корректно закрывает открытый период паузы', pauseEvent?.resumedAt && pauseEvent.durationSeconds !== null, pauseEvent?.durationSeconds);

  const handoverAvailability = await request('GET', `/shift-log/handover/availability?departmentId=${department.id}`, { userId: ids.admin });
  check('доступность передачи смены определяется серверным окном', handoverAvailability.status === 200 && typeof handoverAvailability.data?.available === 'boolean', { status: handoverAvailability.status });
  const handover = await request('GET', `/shift-log/handover/summary?departmentId=${department.id}`, { userId: ids.admin });
  check(
    'сводка передачи смены соблюдает серверное окно и полномочие',
    handoverAvailability.data?.available ? handover.status === 200 : handover.status === 409,
    { status: handover.status, available: handoverAvailability.data?.available },
  );
  const handoverText = JSON.stringify(handover.data ?? {});
  check('личные незавершённые чек-листы не переносятся в передачу смены', !handoverText.includes(run.id) && !handoverText.includes(periodic.name));

  const dayDeadline = new Date(factoryShiftWindow({ shiftDate: '2026-07-10', shiftType: 'DAY' }).to.getTime() + 60 * 60_000);
  const nightDeadline = new Date(factoryShiftWindow({ shiftDate: '2026-07-10', shiftType: 'NIGHT' }).to.getTime() + 60 * 60_000);
  check('дневной auto-close deadline равен 21:00 заводского времени', dayDeadline.toISOString() === '2026-07-10T18:00:00.000Z');
  check('ночной auto-close deadline равен 09:00 следующего дня', nightDeadline.toISOString() === '2026-07-11T06:00:00.000Z');

  const auditCount = await db.auditLog.count({
    where: { factoryId: factory.id, action: { in: ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_PAUSED', 'CHECKLIST_RUN_RESUMED', 'CHECKLIST_RUN_CLOSED', 'CHECKLIST_RUN_AUTO_CLOSED', 'ACCESS_DENIED'] } },
  });
  check('значимые действия записаны в общий аудит', auditCount >= 10, { auditCount });
  check('публичные ответы нового контура не содержат secrets/storagePath', noSensitive({ available: available.data, workspace: managerScoped.data, archive: photoArchive.data }));
}

(async () => {
  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`Backend health ${health.status}`);
    await main();
  } catch (error) {
    state.failed.push({ name: 'необработанная ошибка regression', detail: error instanceof Error ? error.stack : String(error) });
  } finally {
    await cleanup().catch((error) => state.failed.push({ name: 'cleanup завершился с ошибкой', detail: String(error) }));
    await db.$disconnect();
  }

  const report = {
    api: API,
    passed: state.passed.length,
    failed: state.failed.length,
    checks: [...state.passed, ...state.failed],
    cleanup: 'Шаблоны архивированы, доступы и временный завод деактивированы; физическое удаление записей и файлов не выполнялось.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (state.passed.length < 40 || state.failed.length) process.exitCode = 1;
})();
