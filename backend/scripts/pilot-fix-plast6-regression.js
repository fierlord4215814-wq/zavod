const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { OpsService } = require('../dist/modules/ops/ops.service.js');
const { factoryDateKey, factoryDayWindow, shiftTypeForFactoryTime } = require('../dist/common/shift-time.js');
const db = new PrismaClient();
const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const passed = [];
const failed = [];

function check(name, condition, detail) {
  (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function noPrivateFields(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|"token"|secret=/i.test(JSON.stringify(value));
}

async function request(pathname, userId, factoryId) {
  const response = await fetch(`${API}${pathname}`, {
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  check('fresh backend health is available', Boolean(health?.ok), health?.status ?? 'unreachable');
  if (!health?.ok) throw new Error('Backend is required for Plast 6 regression.');

  const service = new OpsService({}, { write: async () => undefined });
  const day = factoryDayWindow('2026-07-18');
  check('factory day starts at Moscow midnight', day.from.toISOString() === '2026-07-17T21:00:00.000Z', day.from.toISOString());
  check('factory day ends at next Moscow midnight', day.to.toISOString() === '2026-07-18T21:00:00.000Z', day.to.toISOString());
  check('factory date does not follow host calendar', factoryDateKey(new Date('2026-07-17T22:30:00.000Z')) === '2026-07-18');
  check('night before 08:00 is attributed to NIGHT', shiftTypeForFactoryTime(new Date('2026-07-18T04:59:59.000Z')) === 'NIGHT');
  check('08:00 factory boundary is DAY', shiftTypeForFactoryTime(new Date('2026-07-18T05:00:00.000Z')) === 'DAY');
  check('20:00 factory boundary is NIGHT', shiftTypeForFactoryTime(new Date('2026-07-18T17:00:00.000Z')) === 'NIGHT');

  const period = service.resolveOperationsPeriod({ dateFrom: '2026-07-18', dateTo: '2026-07-18' });
  check('analytics period uses canonical factory start', period.start.toISOString() === '2026-07-17T21:00:00.000Z', period);
  check('analytics period uses inclusive factory day end', period.end.toISOString() === '2026-07-18T20:59:59.999Z', period);

  const line = { id: 'line-a', name: 'Линия А' };
  const overlapEvents = [
    { id: 'pause-a', lineId: line.id, line, status: 'PAUSE', createdAt: new Date('2026-07-18T01:00:00.000Z'), comment: 'Проверка' },
    { id: 'pause-b', lineId: line.id, line, status: 'PAUSE', createdAt: new Date('2026-07-18T01:10:00.000Z'), comment: 'Пересечение' },
    { id: 'work-a', lineId: line.id, line, status: 'WORK', createdAt: new Date('2026-07-18T02:00:00.000Z') },
  ];
  const overlapRows = service.buildDowntimeIntervals(overlapEvents, period, new Date('2026-07-18T12:00:00.000Z'));
  check('overlapping downtime is counted once', overlapRows.reduce((sum, item) => sum + item.durationMinutes, 0) === 60, overlapRows);
  check('normalized overlap is explicit quality evidence', overlapRows.some((item) => item.isNormalized), overlapRows);

  const openLine = { id: 'line-open', name: 'Линия Б' };
  const asOf = new Date('2026-07-18T04:25:00.000Z');
  const openRows = service.buildDowntimeIntervals([
    { id: 'open-stop', lineId: openLine.id, line: openLine, status: 'STOP', createdAt: new Date('2026-07-18T03:00:00.000Z'), comment: 'Открытый простой' },
  ], period, asOf);
  check('open downtime is capped at report asOf', openRows.length === 1 && openRows[0].durationMinutes === 85 && openRows[0].endAt.getTime() === asOf.getTime(), openRows);
  check('open downtime is marked preliminary', openRows[0]?.isOpen === true && openRows[0]?.endAt <= asOf, openRows[0]);

  check('median uses nearest rank in minutes', service.percentile([1, 2, 3, 4, 100], 0.5) === 3);
  check('p90 uses nearest rank in minutes', service.percentile([1, 2, 3, 4, 100], 0.9) === 100);

  const downtime = { eventId: 'pause-a', lineId: line.id, startAt: new Date('2026-07-18T01:00:00.000Z'), endAt: new Date('2026-07-18T02:00:00.000Z') };
  const linkedTask = service.serializeOperationalTask({
    id: 'task-linked', lineId: line.id, lineStatusEventId: 'pause-a', line, description: 'Связанная заявка', status: 'NEW', type: 'URGENT',
    createdAt: new Date('2026-07-18T01:15:00.000Z'), updatedAt: new Date('2026-07-18T01:15:00.000Z'), history: [], departmentRecipients: [], assignees: [],
  }, [downtime], asOf);
  const contextualTask = service.serializeOperationalTask({
    id: 'task-context', lineId: line.id, lineStatusEventId: null, line, description: 'Обычная заявка', status: 'NEW', type: 'URGENT',
    createdAt: new Date('2026-07-18T01:20:00.000Z'), updatedAt: new Date('2026-07-18T01:20:00.000Z'), history: [], departmentRecipients: [], assignees: [],
  }, [downtime], asOf);
  check('only explicit lineStatusEventId links task to downtime', linkedTask.downtimeLinked === true && contextualTask.downtimeLinked === false && contextualTask.downtimeContext === true, { linkedTask, contextualTask });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 is unavailable.');
  const dateKey = factoryDateKey(new Date());
  const query = `/ops/operations/overview?dateFrom=${dateKey}&dateTo=${dateKey}`;
  const management = await request(query, 'test-management', factory.id);
  check('MANAGEMENT reads operational analytics', management.status === 200, management.status);
  check('public analytics period matches factory day', management.data?.period?.start === factoryDayWindow(dateKey).from.toISOString(), management.data?.period);
  check('open report exposes asOf and preliminary state', Boolean(management.data?.period?.asOf) && typeof management.data?.summary?.preliminary === 'boolean', management.data?.summary);
  check('checklist counters are reconciled non-negative values', ['started', 'runsCompleted', 'checksCompleted', 'checksOverdue', 'manuallyClosed', 'shiftClosed'].every((key) => Number.isFinite(management.data?.checklists?.[key]) && management.data.checklists[key] >= 0), management.data?.checklists);
  check('analytics response contains no private fields', noPrivateFields(management.data));

  for (const [userId, label] of [['worker-1', 'WORKER'], ['test-master', 'MASTER'], ['contractor-1', 'CONTRACTOR']]) {
    const denied = await request(query, userId, factory.id);
    check(`${label} is denied management analytics`, denied.status === 403, denied.status);
  }

  const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id } } });
  if (otherFactory) {
    const crossFactory = await request(query, 'test-management', otherFactory.id);
    check('cross-factory analytics is denied', crossFactory.status === 403, crossFactory.status);
  } else {
    check('cross-factory analytics is denied', true, 'Only one factory is configured.');
  }

  const source = fs.readFileSync(path.join(backendDir, 'src', 'modules', 'ops', 'ops.service.ts'), 'utf8');
  check('latest line events are selected before analytics limit', /orderBy:\s*\{\s*createdAt:\s*'desc'\s*\}/.test(source));
  check('checklist query includes check activity inside period', /checks:\s*\{\s*some:[\s\S]*startedAt:[\s\S]*dueAt:[\s\S]*completedAt:/.test(source));
  check('completed checks are counted only by completedAt in period', /checksCompleted:[\s\S]*this\.inPeriod\(check\.completedAt, period\)/.test(source));

  const navigationSource = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'navigation', 'permissions.ts'), 'utf8');
  const appSource = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'App.tsx'), 'utf8');
  const adminSource = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'screens', 'AdminConfigScreen.tsx'), 'utf8');
  check('navigation has one canonical screen catalog', navigationSource.includes('export const SCREEN_DEFINITIONS'));
  check('application consumes canonical screen catalog', appSource.includes('const screens = SCREEN_DEFINITIONS'));
  check('admin menu preview consumes canonical screen catalog', adminSource.includes('SCREEN_DEFINITIONS.filter') && adminSource.includes('canShowScreen'));

  console.log(JSON.stringify({ passed: passed.length, failed: failed.length, checks: [...passed, ...failed] }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
