const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { ArchiveService } = require('../dist/modules/archive/archive.service.js');
const { DirectoryService } = require('../dist/modules/directory/directory.service.js');
const { OpsService } = require('../dist/modules/ops/ops.service.js');
const { hasPhysicalFieldFixtureMarker, hasPilotFixtureMarker } = require('../dist/common/pilot-visibility.js');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const archive = new ArchiveService({ db });
const directory = new DirectoryService({ db });
const ops = new OpsService({ db }, { write: async () => undefined });
const passed = [];
const failed = [];

function check(condition, name, details) {
  (condition ? passed : failed).push({ name, ...(details === undefined ? {} : { details }) });
}

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function context({ userId, factoryId, isAdmin = true }) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role: 'ADMIN',
    departmentId: null,
    companyId: null,
    permissions: [],
    isAdmin,
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId: null },
  };
}

async function activeMarkerInventory(factoryId) {
  const marker = '__PFFV5_P16A_';
  const lines = await db.line.findMany({
    where: { factoryId, name: { contains: marker } },
    select: { id: true },
  });
  const lineIds = lines.map((line) => line.id);
  const templates = await db.checklistTemplate.findMany({
    where: { factoryId, name: { contains: marker } },
    select: { id: true },
  });
  const templateIds = templates.map((template) => template.id);
  const runs = templateIds.length
    ? await db.checklistRun.findMany({ where: { templateId: { in: templateIds } }, select: { id: true } })
    : [];
  const runIds = runs.map((run) => run.id);
  const [activeLines, activePositions, activeStaffingTemplates, activeChecklistTemplates, activeRuns, activeChecks, openTasks, openDowntimes, activeAssignments, futureAssignments] = await Promise.all([
    db.line.count({ where: { id: { in: lineIds }, deletedAt: null, deactivatedAt: null } }),
    db.linePosition.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.lineStaffingTemplate.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.checklistTemplate.count({ where: { id: { in: templateIds }, isActive: true, archivedAt: null } }),
    db.checklistRun.count({ where: { id: { in: runIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    db.checklistRunCheck.count({ where: { runId: { in: runIds }, status: 'ACTIVE' } }),
    db.task.count({ where: { lineId: { in: lineIds }, status: { not: 'DONE' } } }),
    db.lineEvent.count({ where: { lineId: { in: lineIds }, status: 'PAUSE', confirmedEndAt: null } }),
    db.assignment.count({ where: { lineId: { in: lineIds }, endedAt: null } }),
    db.plannedLineAssignment.count({ where: { lineId: { in: lineIds }, releasedAt: null } }),
  ]);
  return { activeLines, activePositions, activeStaffingTemplates, activeChecklistTemplates, activeRuns, activeChecks, openTasks, openDowntimes, activeAssignments, futureAssignments };
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден');
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, deletedAt: null }, select: { id: true } });
  const admin = await db.userFactoryAccess.findFirst({
    where: { factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false, userId: { not: 'test-admin' }, user: { blockedAt: null, deletedAt: null } },
    select: { userId: true },
  });
  if (!admin) throw new Error('Активный ADMIN Завода 4 не найден');

  const normal = await archive.options(context({ userId: admin.userId, factoryId: factory.id }), {});
  const normalAttempt = await archive.options(context({ userId: admin.userId, factoryId: factory.id }), { includeDiagnostics: 'true' });
  const diagnostic = await archive.options(context({ userId: 'test-admin', factoryId: factory.id }), { includeDiagnostics: 'true' });
  const isMarker = (item) => hasPilotFixtureMarker(item.id, item.name) || hasPhysicalFieldFixtureMarker(item.id, item.name);
  const normalMarkers = [...normal.lines, ...normal.checklistTemplates].filter(isMarker);
  const attemptedMarkers = [...normalAttempt.lines, ...normalAttempt.checklistTemplates].filter(isMarker);
  const diagnosticMarkers = [...diagnostic.lines, ...diagnostic.checklistTemplates].filter(isMarker);
  check(normalMarkers.length === 0, 'Обычный Archive не показывает diagnostic/physical markers', { count: normalMarkers.length });
  check(hasPhysicalFieldFixtureMarker('__PFFV5_P16A_12345__'), 'Canonical detector распознаёт буквенный суффикс physical marker');
  check(attemptedMarkers.length === 0, 'Обычный ADMIN не включает diagnostic options параметром', { count: attemptedMarkers.length });
  check(diagnosticMarkers.length > 0, 'Restricted diagnostic ADMIN получает marker options для контролируемого evidence', { count: diagnosticMarkers.length });
  check(
    diagnostic.lines.some((line) => hasPhysicalFieldFixtureMarker(line.id, line.name)),
    'Archive сохраняет diagnostic историческую линию в фильтре после штатной деактивации',
  );
  check(
    archive.answerText({ answerBoolean: null, answerNumber: 5.5, unit: '°C' }) === '5,5 °C',
    'Числовой ответ чек-листа в Archive форматируется по-русски',
  );

  const normalDirectoryAttempt = await directory.lines(context({ userId: admin.userId, factoryId: factory.id }), { includeDiagnostics: 'true' });
  const diagnosticDirectory = await directory.lines(context({ userId: 'test-admin', factoryId: factory.id }), { includeDiagnostics: 'true' });
  check(normalDirectoryAttempt.filter(isMarker).length === 0, 'Обычный ADMIN не включает diagnostic линии справочника параметром');
  check(diagnosticDirectory.filter(isMarker).length > 0, 'Restricted diagnostic ADMIN получает marker линии canonical справочника');
  check(
    ops.includeOpsDiagnostics(context({ userId: admin.userId, factoryId: factory.id }), { includeDiagnostics: 'true' }) === false,
    'Обычный ADMIN не включает diagnostic Statistics/Audit параметром',
  );
  check(
    ops.includeOpsDiagnostics(context({ userId: 'test-admin', factoryId: factory.id }), { includeDiagnostics: 'true' }) === true,
    'Restricted diagnostic ADMIN включает Statistics/Audit evidence',
  );

  const shiftPeople = read('frontend/src/screens/ShiftPeopleScreen.tsx');
  const checklistScreen = read('frontend/src/screens/ChecklistsScreen.tsx');
  const tasksScreen = read('frontend/src/screens/TasksScreen.tsx');
  const taskService = read('backend/src/modules/task/task.service.ts');
  const archiveScreen = read('frontend/src/screens/ArchiveScreen.tsx');
  const opsScreen = read('frontend/src/screens/OpsAuditScreen.tsx');
  const adminScreen = read('frontend/src/screens/AdminConfigScreen.tsx');
  const lineService = read('backend/src/modules/line/line.service.ts');
  const checklistService = read('backend/src/modules/checklists/checklists.service.ts');
  const opsService = read('backend/src/modules/ops/ops.service.ts');

  check(
    shiftPeople.includes("apiClient.get<Line[]>(isManagerView ? '/lines' : '/lines/shift-overview')")
      && shiftPeople.includes("apiClient.get<Line[]>('/lines/shift-overview')"),
    'Смена использует canonical line read-model для руководителя и сотрудника',
  );
  check(
    checklistScreen.includes('`/directory/lines${diagnosticsQuery}`')
      && checklistScreen.includes("scope === 'LINE'")
      && checklistScreen.includes('hidePilotFixtures ? lines.filter'),
    'Конструктор чек-листов использует canonical линии и ограниченный diagnostic seam',
  );
  check(
    tasksScreen.includes("apiClient.get<{ lines?: LineOption[] }>('/archive/options')")
      && tasksScreen.includes('setLines(archiveOptions.lines ?? [])'),
    'Заявки используют canonical line options архива',
  );
  check(
    tasksScreen.includes('`/tasks/board${fixtureQuery}`')
      && taskService.includes("query.includeFixtures === 'true' && isDiagnosticFixtureActor(user.userId)"),
    'Diagnostic task board доступен только test actor через существующий seam',
  );
  check(
    archiveScreen.includes("apiClient.get<ArchiveOptions>('/archive/options')")
      && archiveScreen.includes('options.lines.map')
      && archiveScreen.includes('options.checklistTemplates.map')
      && archiveScreen.includes("params.set('templateId', filters.templateId)"),
    'Архив использует canonical options для линии и шаблона',
  );
  check(opsScreen.includes('filterOptions.lines') && opsScreen.includes('lineId'), 'Статистика использует server-provided line filter options');
  check(opsService.includes("run.closeKind === 'MANUAL_EARLY'"), 'Статистика учитывает досрочное ручное закрытие периодического чек-листа');
  check(adminScreen.includes('/admin/lines') && adminScreen.includes('staffing-control'), 'Админка создаёт линии и штатные шаблоны через существующие endpoints');
  check(lineService.includes('LINE_STATUS_UPDATED') && lineService.includes('operationId'), 'Статус линии сохраняет audit и operation idempotency');
  check(checklistService.includes('CHECKLIST_RUN_CHECK_COMPLETED') && checklistService.includes('CHECKLIST_TEMPLATE_ARCHIVED'), 'Checklist lifecycle пишет occurrence и archive audit');

  for (const [action, label] of [
    ['LINE_CREATED', 'Линия создана'],
    ['LINE_DEACTIVATED', 'Линия отключена'],
    ['LINE_POSITION_CREATED', 'Позиция линии создана'],
    ['LINE_POSITION_DEACTIVATED', 'Позиция линии отключена'],
    ['LINE_STAFFING_TEMPLATE_CREATED', 'Штатный шаблон создан'],
    ['STAFFING_TEMPLATE_DEACTIVATED', 'Штатный шаблон отключён'],
    ['CHECKLIST_TEMPLATE_ARCHIVED', 'Шаблон чек-листа перенесён в архив'],
  ]) {
    check(opsService.includes(`${action}: '${label}'`), `Audit label человекочитаем: ${action}`);
  }

  const otherFactoryLeak = otherFactory
    ? await db.line.count({ where: { factoryId: otherFactory.id, id: { in: normal.lines.map((line) => line.id) } } })
    : 0;
  check(otherFactoryLeak === 0, 'Archive options не смешивают линии заводов', { count: otherFactoryLeak });

  const active = await activeMarkerInventory(factory.id);
  check(Object.values(active).every((count) => count === 0), 'До/после cohesive run нет активных хвостов P16A', active);

  const result = {
    plast: '16A',
    mode: 'read-only',
    factory: factory.name,
    passed: passed.length,
    failed: failed.length,
    checks: [...passed.map((item) => ({ status: 'PASS', ...item })), ...failed.map((item) => ({ status: 'FAIL', ...item }))],
    activeMarkerInventory: active,
    directDatabaseWrites: 0,
    migrationCreated: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
