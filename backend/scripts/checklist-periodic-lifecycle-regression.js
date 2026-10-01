const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [], createdTemplates: [], createdRuns: [] };
const stamp = Date.now();
const marker = `StagePeriodicLifecycle ${stamp}`;

const USER_ID = 'checklist-periodic-master';
const ADMIN_ID = 'test-admin';

function unwrapData(data) {
  if (data && typeof data === 'object' && data.data && typeof data.data === 'object') return data.data;
  if (data && typeof data === 'object' && data.template && typeof data.template === 'object') return data.template;
  return data;
}

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function request(method, pathname, { factoryId, body, userId = USER_ID } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
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
  return { status: response.status, data };
}

function expect(condition, name, detail) {
  if (condition) ok(name, detail);
  else fail(name, detail);
}

function isoMs(value) {
  return new Date(value).getTime();
}

function closeEnough(actual, expected, toleranceMs = 2000) {
  return Math.abs(isoMs(actual) - isoMs(expected)) <= toleranceMs;
}

async function createTemplate(factoryId, departmentId, { name, unit, value }) {
  const created = await request('POST', '/checklists/templates', {
    userId: ADMIN_ID,
    factoryId,
    body: {
      name,
      description: `${marker} fixture`,
      departmentId,
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: unit,
      frequencyIntervalValue: value,
      assignmentRoles: ['MASTER'],
      isMandatory: false,
    },
  });
  expect(created.status === 201 || created.status === 200, `template created: ${name}`, { status: created.status, data: created.data });
  const createdPayload = unwrapData(created.data);
  const templateId = createdPayload?.id;
  if (!templateId) throw new Error(`template id missing for ${name}: status=${created.status} body=${JSON.stringify(created.data)}`);
  state.createdTemplates.push(templateId);
  const row = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: ADMIN_ID,
    factoryId,
    body: {
      title: `${name} row`,
      rowType: 'YES_NO',
      sortOrder: 10,
      requiredAnswer: true,
      isRequired: true,
    },
  });
  expect(row.status === 201 || row.status === 200, `template row created: ${name}`, { status: row.status, data: row.data });
  const loaded = await request('GET', `/checklists/templates/${templateId}`, { userId: ADMIN_ID, factoryId });
  return unwrapData(loaded.data);
}

async function startRun(factoryId, templateId, shiftDate, shiftType, now) {
  const started = await request('POST', '/checklists/runs/start', {
    factoryId,
    body: { templateId, shiftDate, shiftType, now },
  });
  expect(started.status === 201 || started.status === 200, 'run started', { status: started.status, id: started.data?.id });
  if (started.data?.id) state.createdRuns.push(started.data.id);
  return started.data;
}

async function completeFirstRow(factoryId, run, now) {
  const row = run.rows?.[0];
  if (!row?.id) throw new Error('run row missing');
  const response = await request('POST', `/checklists/runs/${run.id}/rows/${row.id}/complete`, {
    factoryId,
    body: { answerBoolean: true, now },
  });
  expect(response.status === 201 || response.status === 200, 'row completed', { status: response.status });
  const loaded = await request('GET', `/checklists/runs/${run.id}`, { factoryId });
  return loaded.data;
}

async function completeCurrentCheck(factoryId, run, operationId = `periodic-check-${run.id}-${Date.now()}`) {
  const response = await request('POST', `/checklists/runs/${run.id}/checks/current/complete`, {
    factoryId,
    body: { checkId: run.currentCheck?.id, operationId },
  });
  expect(response.status === 201 || response.status === 200, 'current check completed explicitly', { status: response.status, data: response.data });
  return response;
}

async function archiveCreatedTemplates(factoryId) {
  for (const id of state.createdTemplates) {
    await request('POST', `/checklists/templates/${id}/archive`, { userId: ADMIN_ID, factoryId });
  }
}

async function closeActiveCreatedRuns(factoryId) {
  for (const id of new Set(state.createdRuns)) {
    const loaded = await request('GET', `/checklists/runs/${id}`, { factoryId });
    if (!['ACTIVE', 'PAUSED'].includes(loaded.data?.status)) continue;
    const closed = await request('POST', `/checklists/runs/${id}/close`, {
      factoryId,
      body: { comment: `${marker} cleanup` },
    });
    if (![200, 201].includes(closed.status)) {
      throw new Error(`Не удалось штатно закрыть test run ${id}: HTTP ${closed.status}`);
    }
  }
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const department = await db.department.findFirst({ where: { factoryId: factory.id, code: 'masters', isActive: true } });
  if (!department) throw new Error('department not found');
  await db.user.upsert({
    where: { id: USER_ID },
    update: { factoryId: factory.id, role: 'MASTER', blockedAt: null, deletedAt: null },
    create: { id: USER_ID, factoryId: factory.id, role: 'MASTER' },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: USER_ID, factoryId: factory.id } },
    update: { role: 'MASTER', departmentId: department.id, isActive: true, isGuest: false },
    create: { userId: USER_ID, factoryId: factory.id, role: 'MASTER', departmentId: department.id, isActive: true, isGuest: false },
  });

  const factoryId = factory.id;
  const currentShift = factoryShiftTarget(new Date());
  const shiftDate = currentShift.shiftDate;
  const shiftType = currentShift.shiftType;

  try {
    const every30 = await createTemplate(factoryId, department.id, { name: `${marker} every 30 minutes`, unit: 'MINUTES', value: 30 });
    expect(every30.frequencyIntervalUnit === 'MINUTES' && every30.frequencyIntervalValue === 30, '30 minute interval saved without hour conversion', every30);
    expect(every30.frequencyLabel === 'каждые 30 минут', '30 minute label is human-readable', { label: every30.frequencyLabel });

    const every2h = await createTemplate(factoryId, department.id, { name: `${marker} every 2 hours`, unit: 'HOURS', value: 2 });
    expect(every2h.frequencyIntervalUnit === 'HOURS' && every2h.frequencyIntervalValue === 2, '2 hour interval saved', every2h);
    expect(every2h.frequencyLabel === 'каждые 2 часа', '2 hour label is human-readable', { label: every2h.frequencyLabel });

    const spoofedPast = '2001-01-01T00:00:00.000Z';
    const beforeStart = Date.now();
    const run1 = await startRun(factoryId, every30.id, shiftDate, shiftType, spoofedPast);
    const duplicate = await startRun(factoryId, every30.id, shiftDate, shiftType, spoofedPast);
    expect(duplicate.id === run1.id, 'repeated take-in-work returns existing active run', { first: run1.id, second: duplicate.id });
    expect(new Date(run1.startedAt).getTime() >= beforeStart - 2000, 'client timestamp does not replace server start time', { startedAt: run1.startedAt });

    const firstCompletedAt = Date.now();
    const firstFilled = await completeFirstRow(factoryId, run1, spoofedPast);
    expect(firstFilled.checks?.filter((check) => check.status === 'COMPLETED').length === 0, 'saving final row does not close the periodic check', firstFilled.checks);
    expect(firstFilled.currentCheck?.status === 'ACTIVE', 'filled periodic check remains active until explicit completion', firstFilled.currentCheck);
    const firstOperationId = `periodic-first-${stamp}`;
    const firstCompletion = await completeCurrentCheck(factoryId, firstFilled, firstOperationId);
    const afterFirst = firstCompletion.data;
    expect(afterFirst.checks?.filter((check) => check.status === 'COMPLETED').length === 1, 'first check stored in run history', afterFirst.checks);
    expect(afterFirst.checks?.some((check) => check.sequence === 2 && check.status === 'ACTIVE'), 'second check created inside same run', afterFirst.checks);
    expect(Math.abs(new Date(afterFirst.nextCheckAt).getTime() - (firstCompletedAt + 30 * 60_000)) < 5000, 'next check time is +30 minutes from server completion', { nextCheckAt: afterFirst.nextCheckAt });
    expect(afterFirst.rows?.[0]?.status === 'PENDING', 'current row reset for next check', afterFirst.rows?.[0]);
    const repeatedFirstCompletion = await completeCurrentCheck(factoryId, afterFirst, firstOperationId);
    expect(repeatedFirstCompletion.data?.checks?.filter((check) => check.status === 'COMPLETED').length === 1, 'repeated explicit completion is idempotent', repeatedFirstCompletion.data?.checks);

    const secondFilled = await completeFirstRow(factoryId, afterFirst, spoofedPast);
    const secondCompletion = await completeCurrentCheck(factoryId, secondFilled, `periodic-second-${stamp}`);
    const afterSecond = secondCompletion.data;
    expect(afterSecond.checks?.filter((check) => check.status === 'COMPLETED').length === 2, 'multiple check records are stored in one run', afterSecond.checks);
    expect(afterSecond.checks?.some((check) => check.sequence === 3 && check.status === 'ACTIVE'), 'third check created without predefined repeat limit', afterSecond.checks);

    const dayWindow = factoryShiftWindow({ shiftDate: '2026-06-07', shiftType: 'DAY' });
    const nightWindow = factoryShiftWindow({ shiftDate: '2026-06-07', shiftType: 'NIGHT' });
    expect(new Date(dayWindow.to.getTime() + 60 * 60_000).toISOString() === '2026-06-07T18:00:00.000Z', 'day checklist auto-close deadline is 21:00 factory time');
    expect(new Date(nightWindow.to.getTime() + 60 * 60_000).toISOString() === '2026-06-08T06:00:00.000Z', 'night checklist auto-close deadline is 09:00 factory time');

    const dayTemplate = await createTemplate(factoryId, department.id, { name: `${marker} day boundary`, unit: 'HOURS', value: 1 });
    const dayRun = await startRun(factoryId, dayTemplate.id, shiftDate, shiftType, spoofedPast);
    const dayDeadline = new Date(Date.now() + 60_000);
    await db.checklistRun.update({ where: { id: dayRun.id }, data: { shiftEndsAt: dayDeadline } });
    const dayFilled = await completeFirstRow(factoryId, dayRun, spoofedPast);
    const dayAfter = (await completeCurrentCheck(factoryId, dayFilled, `periodic-day-${stamp}`)).data;
    expect(dayAfter.checks?.length === 1, 'no new day repeat when next check crosses 21:00', dayAfter.checks);
    expect(closeEnough(dayAfter.nextCheckAt, dayDeadline), 'day run waits for configured shift close', { nextCheckAt: dayAfter.nextCheckAt });
    await db.checklistRun.update({ where: { id: dayRun.id }, data: { shiftEndsAt: new Date(Date.now() - 1000) } });
    const dayClose = await request('POST', '/checklists/runs/auto-close', {
      userId: ADMIN_ID,
      factoryId,
      body: { runId: dayRun.id },
    });
    expect(dayClose.status === 201 || dayClose.status === 200, 'day auto-close request accepted', { status: dayClose.status, data: dayClose.data });
    expect(dayClose.data?.count === 1, 'day auto-close closes exactly one test run', dayClose.data);
    const dayCloseRepeat = await request('POST', '/checklists/runs/auto-close', {
      userId: ADMIN_ID,
      factoryId,
      body: { runId: dayRun.id },
    });
    expect(dayCloseRepeat.data?.count === 0, 'day auto-close repeated request is idempotent', dayCloseRepeat.data);

    const nightTemplate = await createTemplate(factoryId, department.id, { name: `${marker} night boundary`, unit: 'HOURS', value: 1 });
    const nightRun = await startRun(factoryId, nightTemplate.id, shiftDate, shiftType, spoofedPast);
    const nightDeadline = new Date(Date.now() + 60_000);
    await db.checklistRun.update({ where: { id: nightRun.id }, data: { shiftEndsAt: nightDeadline } });
    const nightFilled = await completeFirstRow(factoryId, nightRun, spoofedPast);
    const nightAfter = (await completeCurrentCheck(factoryId, nightFilled, `periodic-night-${stamp}`)).data;
    expect(nightAfter.checks?.length === 1, 'no new night repeat when next check crosses 09:00', nightAfter.checks);
    expect(closeEnough(nightAfter.nextCheckAt, nightDeadline), 'night run waits for configured shift close', { nextCheckAt: nightAfter.nextCheckAt });
    await db.checklistRun.update({ where: { id: nightRun.id }, data: { shiftEndsAt: new Date(Date.now() - 1000) } });
    const nightClose = await request('POST', '/checklists/runs/auto-close', {
      userId: ADMIN_ID,
      factoryId,
      body: { runId: nightRun.id },
    });
    expect(nightClose.data?.count === 1, 'night auto-close closes exactly one test run', nightClose.data);

    const manualTemplate = await createTemplate(factoryId, department.id, { name: `${marker} manual close`, unit: 'MINUTES', value: 30 });
    const manualRun = await startRun(factoryId, manualTemplate.id, shiftDate, shiftType, spoofedPast);
    const emptyManualClose = await request('POST', `/checklists/runs/${manualRun.id}/close`, {
      factoryId,
      body: { comment: '   ' },
    });
    expect(emptyManualClose.status === 409, 'manual full close rejects an empty reason', { status: emptyManualClose.status, data: emptyManualClose.data });
    const manualClose = await request('POST', `/checklists/runs/${manualRun.id}/close`, {
      factoryId,
      body: { comment: 'manual regression close', now: spoofedPast },
    });
    expect(manualClose.status === 201 || manualClose.status === 200, 'manual close accepted with reason', { status: manualClose.status });
    const manualLoaded = await request('GET', `/checklists/runs/${manualRun.id}`, { factoryId });
    expect(manualLoaded.data?.status === 'CLOSED' && manualLoaded.data?.closeReason === 'manual regression close' && manualLoaded.data?.closeKind === 'MANUAL_EARLY', 'manual close saves early-close reason and status', manualLoaded.data);
    expect(manualLoaded.data?.nextCheckAt === null, 'manual full close removes future reminders', { nextCheckAt: manualLoaded.data?.nextCheckAt });
    const repeatedManualClose = await request('POST', `/checklists/runs/${manualRun.id}/close`, {
      factoryId,
      body: { comment: 'manual regression close again', now: spoofedPast },
    });
    expect(repeatedManualClose.data?.closedAt === manualLoaded.data?.closedAt, 'manual close repeated request does not create second close', repeatedManualClose.data);

    const auditCount = await db.auditLog.count({
      where: {
        action: { in: ['CHECKLIST_RUN_STARTED', 'CHECKLIST_RUN_CLOSED', 'CHECKLIST_RUN_AUTO_CLOSED'] },
        entityId: { in: state.createdRuns },
      },
    });
    expect(auditCount >= 3, 'audit actions written for lifecycle', { auditCount });
    const completedCheckIds = afterSecond.checks?.filter((check) => check.status === 'COMPLETED').map((check) => check.id) ?? [];
    const checkAuditCount = await db.auditLog.count({
      where: { action: 'CHECKLIST_RUN_CHECK_COMPLETED', entityId: { in: completedCheckIds } },
    });
    expect(checkAuditCount === completedCheckIds.length, 'each explicit periodic completion is audited once', { checkAuditCount, completedCheckIds: completedCheckIds.length });
  } finally {
    try {
      await closeActiveCreatedRuns(factoryId);
    } finally {
      await archiveCreatedTemplates(factoryId);
      await db.$disconnect();
    }
  }

  const report = {
    api: API,
    marker,
    createdTemplates: state.createdTemplates,
    createdRuns: state.createdRuns,
    ok: state.ok,
    failures: state.failures,
    note: 'Active test runs are closed and templates are archived by API; history remains as regression evidence. No production records were deleted.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (state.failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
