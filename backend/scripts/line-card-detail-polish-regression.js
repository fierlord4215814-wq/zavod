const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const { LineService } = require(path.join(root, 'backend', 'dist', 'modules', 'line', 'line.service.js'));

let passed = 0;
let failed = 0;

function check(label, condition, details) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}${details ? `: ${details}` : ''}`);
}

function task(overrides = {}) {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    factoryId: 'factory-a',
    lineId: 'line-a',
    lineStatusEventId: null,
    createdById: 'master-a',
    assignedToId: null,
    takenById: null,
    doneById: null,
    type: 'URGENT',
    status: 'NEW',
    description: 'Рабочая заявка',
    operationId: null,
    createdAt: new Date('2026-07-15T06:00:00.000Z'),
    startedAt: null,
    deadlineAt: null,
    assignedTo: null,
    takenBy: null,
    assignees: [],
    departmentRecipients: [{ active: true, departmentId: 'dept-a', department: { id: 'dept-a', name: 'Механики' } }],
    ...overrides,
  };
}

async function main() {
  const tasks = [
    task({ id: 'task-in-progress-assigned', status: 'IN_PROGRESS', assignedToId: 'Иванов И. И.', assignedTo: { id: 'Иванов И. И.' }, startedAt: new Date('2026-07-15T06:05:00.000Z') }),
    task({ id: 'task-in-progress-waiting', status: 'IN_PROGRESS', createdAt: new Date('2026-07-15T05:59:00.000Z') }),
    task({ id: 'task-urgent-new', createdAt: new Date('2026-07-15T05:58:00.000Z') }),
    task({ id: 'task-long-overdue', type: 'LONG', deadlineAt: new Date('2020-01-01T00:00:00.000Z'), createdAt: new Date('2026-07-15T05:57:00.000Z') }),
    task({ id: 'task-long-new', type: 'LONG', deadlineAt: new Date('2030-01-01T00:00:00.000Z'), createdAt: new Date('2026-07-15T05:56:00.000Z') }),
    task({ id: 'task-event-linked', lineId: null, lineStatusEventId: 'event-b', departmentRecipients: [{ active: true, departmentId: 'dept-b', department: { id: 'dept-b', name: 'КИПиА' } }] }),
    task({ id: 'task-done', status: 'DONE' }),
    task({ id: 'stage99-fixture-task', description: 'stage99 fixture' }),
    task({ id: 'task-cross-factory', factoryId: 'factory-b' }),
  ];
  let taskQueries = 0;
  let eventQueries = 0;
  const prisma = {
    db: {
      task: { findMany: async () => { taskQueries += 1; return tasks; } },
      lineEvent: { findMany: async () => { eventQueries += 1; return [{ id: 'event-b', lineId: 'line-b' }]; } },
    },
  };
  const service = new LineService(prisma, {}, {});
  const eventTitles = {
    stop: service.lineStatusEventTitle({ status: 'STOP', reason: null }),
    returned: service.lineStatusEventTitle({ status: 'WORK', reason: null }, { status: 'STOP', reason: null }),
    pause: service.lineStatusEventTitle({ status: 'PAUSE', reason: 'TECHNICAL' }),
    wash: service.lineStatusEventTitle({ status: 'STOP', reason: 'WASH' }),
  };
  check('STOP has human event title', eventTitles.stop === 'Линия остановлена');
  check('return to work has human event title', eventTitles.returned === 'Линия возвращена в работу');
  check('PAUSE has human event title', eventTitles.pause === 'Начался простой');
  check('WASH has human event title', eventTitles.wash === 'Линия переведена на мойку');
  check('human event titles contain no technical codes', !/\b(?:STOP|WORK|PAUSE|WASH)\b|operationId|\d{8,}/.test(JSON.stringify(eventTitles)));
  const admin = { userId: 'admin-a', selectedFactoryId: 'factory-a', departmentId: null, permissions: ['lines.read', 'tasks.manage'], isAdmin: true, isGuest: false };
  const grouped = await service.loadVisibleActiveLineTasks(admin, ['line-a', 'line-b', 'line-c']);
  const lineA = grouped.get('line-a') || [];
  const lineB = grouped.get('line-b') || [];

  check('one bounded task query for several lines', taskQueries === 1, `queries=${taskQueries}`);
  check('one bounded event-link query for several lines', eventQueries === 1, `queries=${eventQueries}`);
  check('IN_PROGRESS with assignee has first priority', lineA[0]?.taskId === 'task-in-progress-assigned');
  check('IN_PROGRESS without assignee has second priority', lineA[1]?.taskId === 'task-in-progress-waiting');
  check('URGENT NEW precedes overdue LONG', lineA[2]?.taskId === 'task-urgent-new' && lineA[3]?.taskId === 'task-long-overdue');
  check('lineStatusEventId-only task resolves to its line', lineB.some((item) => item.taskId === 'task-event-linked'));
  check('DONE task is absent', !lineA.some((item) => item.taskId === 'task-done'));
  check('diagnostic task is absent', !lineA.some((item) => item.taskId === 'stage99-fixture-task'));
  check('cross-factory task is absent', !lineA.some((item) => item.taskId === 'task-cross-factory'));
  check('safe assignee summary uses human text', lineA[0]?.assigneeDisplayName === 'Иванов И. И.' && lineA[0]?.serviceLabel === 'Механики');
  check('waiting summary does not invent an assignee', lineA[1]?.hasAssignee === false && lineA[1]?.assigneeDisplayName === null);
  check('line/event source remains explicit', lineA[0]?.sourceKind === 'LINE' && lineB[0]?.sourceKind === 'DOWNTIME');
  check('safe DTO has no raw task entity fields', !('description' in lineA[0]) && !('operationId' in lineA[0]) && !('createdById' in lineA[0]));

  const noPermission = { ...admin, isAdmin: false, permissions: ['lines.read'] };
  const hidden = await service.loadVisibleActiveLineTasks(noPermission, ['line-a']);
  check('user without task permission receives no summaries', (hidden.get('line-a') || []).length === 0);

  const otherDepartment = { ...admin, isAdmin: false, userId: 'worker-other', departmentId: 'dept-other', permissions: ['lines.read', 'tasks.read'] };
  const scoped = await service.loadVisibleActiveLineTasks(otherDepartment, ['line-a']);
  check('task scope is enforced inside line read-model', (scoped.get('line-a') || []).length === 0);

  const lineSource = fs.readFileSync(path.join(root, 'backend', 'src', 'modules', 'line', 'line.service.ts'), 'utf8');
  const screenSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'screens', 'SituationScreen.tsx'), 'utf8');
  const shiftSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'screens', 'ShiftPeopleScreen.tsx'), 'utf8');
  const checklistSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'screens', 'ChecklistsScreen.tsx'), 'utf8');
  check('compact line card does not enumerate production workers', !/renderLineCard[\s\S]*?workers\.map/.test(screenSource));
  check('line list has no per-line task request', !/cleanLines\.map[\s\S]*?\/tasks/.test(screenSource));
  check('dashboard returns safe active task summaries', /activeTasks,/.test(lineSource) && !/activeTasks:\s*line\.tasks/.test(lineSource));
  check('line actions use unambiguous human labels', screenSource.includes('Запустить новую линию') && screenSource.includes('Вернуть в работу') && !screenSource.includes('Запустить / вернуть в работу'));
  check('line detail renders human event and actor fields', screenSource.includes('recentEvents[0].humanTitle') && screenSource.includes('recentEvents[0].actorName'));
  check('shift line event avoids raw comment/id fallback', shiftSource.includes('recentEvents[0].humanTitle') && shiftSource.includes('recentEvents[0].actorName'));
  check('work area summary has one shortage concept', screenSource.includes('Не хватает: {area.deficit}') && !screenSource.includes('Свободно: {area.free}') && !screenSource.includes('Дефицит: {area.deficit}'));
  check('checklist manage action follows KPI', checklistSource.indexOf('premium-manager-toolbar') > checklistSource.indexOf('<PremiumKpiStrip'));

  const publicPayload = JSON.stringify([...grouped.values()].flat());
  check('summary contains no sensitive fields', !/passwordHash|storagePath|token|secret|phone/i.test(publicPayload));

  console.log(`\nLINE_CARD_DETAIL_POLISH regression: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
