const assert = require('node:assert/strict');

const {
  hasPilotFixtureMarker,
  hasRuntimeFixtureMarker,
  isRuntimeVisibleShiftLog,
  isRuntimeVisibleTask,
} = require('../dist/common/pilot-visibility.js');

const checks = [];
const check = (name, condition) => {
  assert.equal(Boolean(condition), true, name);
  checks.push(name);
};

const { dataHygieneReasons } = require('../dist/common/data-hygiene.js');
check('documented department-first browser template is diagnostic', hasPilotFixtureMarker('Отделовой контроль UI 1783172836416'));
for (const name of ['Отделовой контроль', 'Отделовой контроль UI', 'Отделовой контроль UI 2026', 'Отделовой контроль UI 1783172836416 утверждено']) {
  check(`ordinary department checklist name retained: ${name}`, !hasPilotFixtureMarker(name));
}
check('documented error report export fixture is diagnostic', hasPilotFixtureMarker('Проверка файловой копии error-report-export-1782974961008'));
for (const name of ['Проверка файловой копии', 'Ошибка при экспорте отчёта', 'error-report-export-2026', 'error-report-export-1782974961008 утверждено']) {
  check(`ordinary error report title retained: ${name}`, !hasPilotFixtureMarker(name));
}
const { presentAuditDetails } = require('../dist/common/audit-presentation.js');
for (const [status, label] of Object.entries({ blocker: 'Есть блокирующие замечания', warning: 'Требует проверки', ready: 'Готово', ok: 'В порядке' })) {
  check(`readiness audit status has a Russian label: ${status}`, presentAuditDetails({ status }).rows[0]?.value === label);
}
const statusPair = presentAuditDetails({ oldStatus: 'blocker', newStatus: 'ready' }).rows[0];
check('audit status transition uses the same labels', statusPair.before === 'Есть блокирующие замечания' && statusPair.after === 'Готово');
check('status translation does not rewrite free text', presentAuditDetails({ comment: 'ready' }).rows[0]?.value === 'ready');
check('physical marker routes retained admin record to diagnostics', dataHygieneReasons({
  name: '__PFFV5_P10_1788000000000__ Отдел',
}).some((reason) => reason.group === 'test-records'));
check('physical v4 marker routes retained admin record to diagnostics', dataHygieneReasons({
  description: '__PFFV4_PFFV4_20260727T075200Z__ причина отключения',
}).some((reason) => reason.group === 'test-records'));
for (const name of ['Отдел испытаний', 'Проверка упаковки', 'PFFV5 оборудование', 'Демонстрационный стенд']) {
  check(`ordinary descriptive name is not a physical marker: ${name}`, !dataHygieneReasons({ name }).some((reason) => reason.group === 'test-records'));
}
for (const name of ['Stage hierarchy mqz2oz1j', 'Stage hierarchy lead mqz2oz1j', 'Stage hierarchy worker mqz2oz1j', 'Stage hierarchy foreign parent mqz2oz1j']) {
  check(`documented hierarchy fixture is diagnostic: ${name}`, dataHygieneReasons({ name }).some((reason) => reason.group === 'test-records'));
}
for (const name of ['Stage hierarchy', 'Иерархия отдела', 'Проверка иерархии', 'Служба восстановления']) {
  check(`ordinary hierarchy/recovery wording is preserved: ${name}`, !dataHygieneReasons({ name }).some((reason) => reason.group === 'test-records'));
}

check('обычная заявка остаётся видимой', isRuntimeVisibleTask({
  id: 'task-production',
  createdById: 'production-user',
  description: 'Проверить привод линии',
}));
check('заявка диагностического автора скрыта', !isRuntimeVisibleTask({
  id: 'task-runtime',
  createdById: 'test-master',
  description: 'Realtime v1 task 1788000000000',
}));
check('документированный realtime operationId скрыт', !isRuntimeVisibleTask({
  id: 'task-runtime-pilot',
  createdById: 'pilot-pack-senior-master',
  operationId: 'realtime-v1-task-1788000000000',
  description: 'Проверка доставки события',
}));
check('точный physical marker скрыт', !isRuntimeVisibleTask({
  id: 'task-pff',
  createdById: 'production-user',
  description: '__PFFV5_P11_1788000000000__ заявка',
}));
check('physical v4 marker recognised as diagnostic', hasPilotFixtureMarker('__PFFV4_PFFV4_20260727T075200Z__ Линия'));
check('physical v4 code recognised as diagnostic', hasPilotFixtureMarker('pffv4-stage2-line'));
check('человеческое слово realtime без operation marker не скрывается', !hasRuntimeFixtureMarker('Обновление статуса в реальном времени'));
check('обычная пересменка остаётся видимой', isRuntimeVisibleShiftLog({
  id: 'shift-log-production',
  createdById: 'production-user',
  title: 'Передача дневной смены',
  text: 'Линия передана без замечаний',
}));
check('physical пересменка скрыта в обычном runtime', !isRuntimeVisibleShiftLog({
  id: 'shift-log-pff',
  createdById: 'production-user',
  title: '__PFFV5_P12_1788000000000__ журнал',
  text: 'Диагностическая запись',
}));
check('пересменка диагностического автора скрыта', !isRuntimeVisibleShiftLog({
  id: 'shift-log-runtime',
  createdById: 'test-master',
  title: 'Проверка передачи',
  text: 'Техническая запись',
}));

async function checkReadModels() {
  const { OpsService } = require('../dist/modules/ops/ops.service.js');
  const { ShiftLogService } = require('../dist/modules/shift-log/shift-log.service.js');
  const now = new Date();
  const tasks = [
    { id: 'normal', createdById: 'production-user', description: 'Проверить привод', type: 'URGENT', status: 'NEW', createdAt: now },
    { id: 'actor-fixture', createdById: 'test-master', description: 'Проверить привод', type: 'URGENT', status: 'NEW', createdAt: now },
    { id: 'operation-fixture', createdById: 'production-user', operationId: 'realtime-v1-task-1788000000000', description: 'Проверить привод', type: 'URGENT', status: 'NEW', createdAt: now },
  ];
  const logs = [
    { id: 'normal-log', createdById: 'production-user', text: 'Передано без замечаний', comments: [] },
    { id: 'marker-log', createdById: 'production-user', text: '__PFFV5_P12_1788000000000__ журнал', comments: [] },
  ];
  const queries = [];
  const models = ['washSession', 'defrostEvent', 'orderRequest', 'notification', 'checklistRun', 'auditLog', 'minimumStockItem', 'okkRecord', 'stockDefect', 'returnRecord', 'department'];
  const db = Object.fromEntries(models.map((name) => [name, { findMany: async () => [] }]));
  db.task = { findMany: async (query) => { queries.push(query); return tasks; } };
  db.shiftLog = { findMany: async (query) => { queries.push(query); return logs; } };
  const user = { userId: 'production-admin', selectedFactoryId: 'controlled-factory', role: 'ADMIN', isAdmin: true, isGuest: false, permissions: [] };
  const diagnostic = { ...user, userId: 'test-admin' };
  const manager = { ...user, userId: 'production-manager', role: 'MANAGEMENT', isAdmin: false };
  const ops = new OpsService({ db }, {});
  check('overview excludes diagnostic tasks', (await ops.overview(user)).activeTasksCount === 1);
  check('ordinary admin cannot opt in diagnostic counters', (await ops.overview(user, { includeDiagnostics: 'true' })).activeTasksCount === 1);
  check('management cannot opt in diagnostic counters', (await ops.overview(manager, { includeDiagnostics: 'true' })).activeTasksCount === 1);
  check('diagnostic admin explicitly sees controlled fixtures', (await ops.overview(diagnostic, { includeDiagnostics: 'true' })).activeTasksCount === 3);
  const modules = await ops.moduleSummary(user);
  check('module summary agrees with overview', modules.find((row) => row.module === 'Tasks').count === 1);
  for (const role of ['WORKER', 'CONTRACTOR', 'MASTER', 'TECH_KIPIA']) {
    await assert.rejects(() => ops.overview({ ...user, role, isAdmin: false }), (error) => error.getStatus() === 403);
    checks.push(`statistics deny preserved: ${role}`);
  }
  const attachments = { listForEntities: async () => new Map() };
  const shiftLog = new ShiftLogService({ db }, {}, attachments, {});
  for (const archive of ['false', 'true']) {
    const visible = await shiftLog.listLogs(user, { archive, includeClosed: 'true' });
    check(`shift log ${archive === 'true' ? 'archive' : 'active'} excludes marker`, visible.length === 1 && visible[0].id === 'normal-log');
    check('ordinary admin cannot opt in diagnostic logs', (await shiftLog.listLogs(user, { archive, includeDiagnostics: 'true' })).length === 1);
  }
  check('diagnostic admin can inspect retained log fixtures', (await shiftLog.listLogs(diagnostic, { includeDiagnostics: 'true' })).length === 2);
  check('all tested read models retain factory predicate', queries.every((query) => query.where.factoryId === user.selectedFactoryId));
  const { AdminService } = require('../dist/modules/admin/admin.service.js');
  const recoveryQueries = [];
  const accessRows = [
    { id: 'ordinary-access', user: { id: 'employee-ordinary', displayName: 'Сотрудник отдела испытаний' }, role: 'OTHER', isGuest: false },
    { id: 'controlled-access', user: { id: 'stage-auth-onboarding-guest' }, role: 'OTHER', isGuest: true },
  ].map((row) => ({ ...row, factoryId: user.selectedFactoryId, factory: { name: 'Завод' }, isActive: false, updatedAt: now }));
  const admin = new AdminService({ db: { userFactoryAccess: { findMany: async (query) => { recoveryQueries.push(query); return accessRows; } } } }, {}, {}, {}, {});
  const ordinaryRecovery = await admin.recovery(user, { type: 'factory-access' });
  const diagnosticRecovery = await admin.recovery(user, { type: 'factory-access', diagnostic: 'true' });
  check('recovery keeps ordinary disabled access', ordinaryRecovery.items.length === 1 && ordinaryRecovery.items[0].id === 'ordinary-access');
  check('recovery uses linked diagnostic user, not only access title', diagnosticRecovery.items.length === 1 && diagnosticRecovery.items[0].id === 'controlled-access');
  check('diagnostic recovery preserves guest identity label', diagnosticRecovery.items[0].title === 'Диагностический сотрудник — Гость');
  check('unassigned role has a human label', ordinaryRecovery.items[0].title.endsWith('Без назначенной роли'));
  check('recovery queries preserve selected factory scope', recoveryQueries.every((query) => query.where.factoryId === user.selectedFactoryId && query.where.isActive === false));
  for (const actor of [manager, { ...user, isAdmin: false, role: 'WORKER' }]) {
    await assert.rejects(() => admin.recovery(actor, { type: 'factory-access' }), (error) => error.getStatus() === 403);
    checks.push(`admin recovery deny preserved: ${actor.role}`);
  }
  await assert.rejects(() => admin.recovery(user, { factoryId: 'another-factory', type: 'factory-access' }), (error) => error.getStatus() === 403);
  checks.push('cross-factory recovery denied');
  const { ArchiveService } = require('../dist/modules/archive/archive.service.js');
  const createdAt = new Date('2026-09-01T12:00:00Z');
  const person = { id: 'production-person', firstName: 'Иван', lastName: 'Иванов' };
  const wash = {
    id: 'ordinary-wash', factoryId: user.selectedFactoryId, targetType: 'LINE', line: { name: 'Упаковка' },
    startedById: person.id, startedBy: person, status: 'COMPLETED', createdAt,
    assignments: [], issues: [], controlItems: [], okkReviews: [],
    messages: [
      { id: 'ordinary-message', message: 'Regression обсуждается на совещании', user: person, createdAt },
      { id: 'marked-message', message: '__PFFV5_P17C_BROWSER_1788105576992__ сообщение', user: person, createdAt },
      { id: 'diagnostic-author-message', message: 'Контрольный запуск', user: { id: 'test-master' }, createdAt },
    ],
    events: [
      { id: 'ordinary-event', type: 'COMPLETE', text: 'Мойка завершена', actor: person, createdAt },
      { id: 'marked-event', type: 'MESSAGE', text: '__PFFV5_P17C_BROWSER_1788105576992__ событие', actor: person, createdAt },
    ],
  };
  let attachmentRefs = [];
  const archive = new ArchiveService({ db: { washSession: { findFirst: async (query) => {
    assert.equal(query.where.factoryId, user.selectedFactoryId);
    return wash;
  } } } });
  archive.detailAttachments = async (_actor, refs) => { attachmentRefs = refs; return []; };
  const ordinaryWashDetail = await archive.washDetail(user, 'WASH_SESSION', wash.id, false);
  const ordinaryEvents = ordinaryWashDetail.sections.find((section) => section.title === 'Сообщения и события').entries;
  check('ordinary wash remains in archive', ordinaryWashDetail.title === 'Мойка: Упаковка');
  check('ordinary child entries retained without filtering general regression word', ordinaryEvents.length === 2 && ordinaryEvents.some((entry) => entry.text === 'Regression обсуждается на совещании'));
  check('diagnostic child attachments not included in ordinary wash detail refs', !attachmentRefs.some((ref) => ['marked-message', 'diagnostic-author-message'].includes(ref.entityId)));
  const diagnosticWashDetail = await archive.washDetail(user, 'WASH_SESSION', wash.id, true);
  check('explicit diagnostic serialization preserves all child events', diagnosticWashDetail.sections.find((section) => section.title === 'Сообщения и события').entries.length === 5);
  check('underlying wash messages not mutated', wash.messages.length === 3 && wash.events.length === 2);
  console.log(`FULL_UI_RUNTIME_VISIBILITY: PASS (${checks.length} checks; no database connection or writes)`);
}

checkReadModels().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
