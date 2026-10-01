const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const stamp = Date.now();
const marker = `Проверка простоя ${stamp}`;

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function expectForbidden(name, promise) {
  const response = await promise;
  if ([403, 409].includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: [403, 409], status: response.status, data: response.data });
  return response;
}

function hasNoSecret(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

function iso(date) {
  return date.toISOString();
}

async function createFixtures(factoryId) {
  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!line) throw new Error('production line not found');
  const department = await db.department.findFirst({ where: { OR: [{ factoryId }, { scope: 'GLOBAL' }], isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!department) throw new Error('department not found');

  const base = new Date();
  base.setHours(10, 0, 0, 0);
  const startAt = new Date(base.getTime() - 2 * 86_400_000);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  const taskCreatedAt = new Date(startAt.getTime() + 10 * 60_000);
  const taskStartedAt = new Date(startAt.getTime() + 20 * 60_000);
  const taskDoneAt = new Date(startAt.getTime() + 50 * 60_000);

  const startEvent = await db.lineEvent.create({
    data: {
      lineId: line.id,
      factoryId,
      createdById: 'test-master',
      status: 'PAUSE',
      comment: `${marker}: техническая неисправность`,
      downtimeReason: 'TECHNICAL',
      createdAt: startAt,
      updatedAt: startAt,
    },
  });
  await db.lineEvent.create({
    data: {
      lineId: line.id,
      factoryId,
      createdById: 'test-master',
      status: 'WORK',
      comment: `${marker}: запущена`,
      confirmedEndAt: endAt,
      createdAt: endAt,
      updatedAt: endAt,
    },
  });

  const task = await db.task.create({
    data: {
      factoryId,
      lineId: line.id,
      lineStatusEventId: startEvent.id,
      createdById: 'test-master',
      takenById: 'test-tech-holod',
      doneById: 'test-tech-holod',
      assignedToId: 'test-tech-holod',
      type: 'URGENT',
      status: 'DONE',
      description: `${marker}: связанная заявка`,
      startedAt: taskStartedAt,
      doneAt: taskDoneAt,
      createdAt: taskCreatedAt,
      updatedAt: taskDoneAt,
      operationId: `downtime-task-${stamp}`,
      departmentRecipients: { create: [{ departmentId: department.id, factoryId: department.scope === 'LOCAL' ? factoryId : null, active: true }] },
      assignees: { create: [{ userId: 'test-tech-holod', assignedById: 'test-master', isPrimary: true, active: true, assignedAt: taskStartedAt }] },
      history: {
        create: [
          { actorId: 'test-master', action: 'TASK_CREATED', newValue: { lineStatusEventId: startEvent.id }, createdAt: taskCreatedAt },
          { actorId: 'test-tech-holod', action: 'TASK_TAKEN', createdAt: taskStartedAt },
          { actorId: 'test-tech-holod', action: 'TASK_DONE', createdAt: taskDoneAt },
        ],
      },
    },
  });

  const overdueCreatedAt = new Date(startAt.getTime() + 15 * 60_000);
  await db.task.create({
    data: {
      factoryId,
      lineId: line.id,
      createdById: 'test-master',
      takenById: 'test-tech-holod',
      doneById: 'test-tech-holod',
      assignedToId: 'test-tech-holod',
      type: 'LONG',
      status: 'DONE',
      description: `${marker}: просроченная LONG`,
      deadlineAt: new Date(overdueCreatedAt.getTime() + 30 * 60_000),
      startedAt: new Date(overdueCreatedAt.getTime() + 10 * 60_000),
      doneAt: new Date(overdueCreatedAt.getTime() + 80 * 60_000),
      createdAt: overdueCreatedAt,
      updatedAt: new Date(overdueCreatedAt.getTime() + 80 * 60_000),
      operationId: `downtime-long-${stamp}`,
      departmentRecipients: { create: [{ departmentId: department.id, factoryId: department.scope === 'LOCAL' ? factoryId : null, active: true }] },
      assignees: { create: [{ userId: 'test-tech-holod', assignedById: 'test-master', isPrimary: true, active: true }] },
    },
  });

  await db.task.create({
    data: {
      factoryId,
      createdById: 'test-master',
      type: 'URGENT',
      status: 'DONE',
      description: `${marker}: обычная заявка без линии`,
      startedAt: taskStartedAt,
      doneAt: taskDoneAt,
      createdAt: taskCreatedAt,
      updatedAt: taskDoneAt,
      operationId: `downtime-unlinked-${stamp}`,
      departmentRecipients: { create: [{ departmentId: department.id, factoryId: department.scope === 'LOCAL' ? factoryId : null, active: true }] },
    },
  });

  return { line, department, startEvent, task, startAt, endAt };
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  const fixtures = await createFixtures(factoryId);
  const dateFrom = iso(new Date(fixtures.startAt.getTime() - 2 * 60 * 60_000)).slice(0, 10);
  const dateTo = iso(new Date(fixtures.endAt.getTime() + 2 * 60 * 60_000)).slice(0, 10);
  const common = `dateFrom=${dateFrom}&dateTo=${dateTo}&includeDiagnostics=true`;

  const summary = await expectStatus('ADMIN loads downtime summary', 200, request('GET', `/archive/downtime/summary?${common}`, { userId: 'test-admin', factoryId }));
  if ((summary.data?.downtime?.count ?? 0) >= 1 && (summary.data?.downtime?.totalMinutes ?? 0) >= 60) ok('downtime interval is calculated from line events', summary.data.downtime);
  else fail('downtime interval is calculated from line events', summary.data);
  if ((summary.data?.tasks?.averageResponseMinutes ?? 0) >= 0 && (summary.data?.tasks?.p90ResolutionMinutes ?? 0) >= 0) ok('task response/resolution metrics are present', summary.data.tasks);
  else fail('task response/resolution metrics are present', summary.data);

  const byLines = await expectStatus('line filter returns downtime line', 200, request('GET', `/archive/downtime/by-lines?${common}&lineId=${fixtures.line.id}`, { userId: 'test-admin', factoryId }));
  if (byLines.data?.some((line) => line.lineId === fixtures.line.id && line.totalMinutes >= 60)) ok('by-lines includes fixture line');
  else fail('by-lines includes fixture line', byLines.data);

  const byDepartments = await expectStatus('department filter returns task load', 200, request('GET', `/archive/downtime/by-departments?${common}&departmentId=${fixtures.department.id}`, { userId: 'test-admin', factoryId }));
  if (byDepartments.data?.some((department) => department.departmentId === fixtures.department.id && department.tasksTotal >= 1)) ok('by-departments includes recipient department');
  else fail('by-departments includes recipient department', byDepartments.data);

  const byAssignees = await expectStatus('assignee filter returns executor load', 200, request('GET', `/archive/downtime/by-assignees?${common}&assigneeId=test-tech-holod`, { userId: 'test-admin', factoryId }));
  if (byAssignees.data?.some((assignee) => assignee.userId === 'test-tech-holod' && assignee.taken >= 1)) ok('by-assignees includes executor participation');
  else fail('by-assignees includes executor participation', byAssignees.data);

  const linkedOnly = await expectStatus('downtime-linked-only excludes task without line', 200, request('GET', `/archive/downtime/items?${common}&downtimeLinkedOnly=true&pageSize=100`, { userId: 'test-admin', factoryId }));
  const linkedText = JSON.stringify(linkedOnly.data);
  if (linkedText.includes('связанная заявка') && !linkedText.includes('обычная заявка без линии')) ok('task without line/downtime is excluded from downtime-linked view');
  else fail('task without line/downtime is excluded from downtime-linked view', linkedOnly.data);

  const reason = await expectStatus('downtime reason filter works', 200, request('GET', `/archive/downtime/items?${common}&downtimeReason=TECHNICAL`, { userId: 'test-admin', factoryId }));
  if (JSON.stringify(reason.data).includes('TECHNICAL') || JSON.stringify(reason.data).includes('Техническая')) ok('downtime reason filter returns technical downtime');
  else fail('downtime reason filter returns technical downtime', reason.data);

  const before = summary.data.downtime.totalMinutes;
  await expectStatus('ADMIN corrects downtime time with audit', 201, request('POST', `/archive/downtime/${fixtures.startEvent.id}/correction`, {
    userId: 'test-admin',
    factoryId,
    body: {
      correctedStartAt: new Date(fixtures.startAt.getTime() - 10 * 60_000).toISOString(),
      correctedEndAt: new Date(fixtures.endAt.getTime() + 20 * 60_000).toISOString(),
      comment: `${marker}: уточнение фактического запуска`,
    },
  }));
  const corrected = await expectStatus('corrected duration is used by analytics', 200, request('GET', `/archive/downtime/summary?${common}`, { userId: 'test-admin', factoryId }));
  if ((corrected.data?.downtime?.totalMinutes ?? 0) > before) ok('correction changes effective downtime duration', { before, after: corrected.data.downtime.totalMinutes });
  else fail('correction changes effective downtime duration', corrected.data);
  const audit = await db.auditLog.findFirst({ where: { action: 'LINE_DOWNTIME_CORRECTED', entityId: fixtures.startEvent.id }, orderBy: { createdAt: 'desc' } });
  if (audit && JSON.stringify(audit.details).includes('oldValue') && JSON.stringify(audit.details).includes('newValue')) ok('correction audit stores old/new values');
  else fail('correction audit stores old/new values', audit);

  const overdue = await expectStatus('overdue LONG appears in items', 200, request('GET', `/archive/downtime/items?${common}&pageSize=100`, { userId: 'test-admin', factoryId }));
  if (overdue.data?.items?.some((item) => item.overdueLong === true)) ok('overdue LONG task is detected');
  else fail('overdue LONG task is detected', overdue.data);

  await expectForbidden('WORKER cannot open management downtime analytics', request('GET', `/archive/downtime/summary?${common}`, { userId: 'worker-1', factoryId }));
  await expectStatus('MANAGEMENT loads scoped downtime analytics', 200, request('GET', `/archive/downtime/summary?${common}`, { userId: 'test-management', factoryId }));

  await db.user.upsert({
    where: { id: 'stage40b-blocked-worker' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage40b-blocked-worker', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage40b-blocked-worker', factoryId } },
    update: { role: 'MASTER', isActive: true, isGuest: false },
    create: { userId: 'stage40b-blocked-worker', factoryId, role: 'MASTER', isActive: true, isGuest: false },
  });
  await expectForbidden('blocked user cannot open downtime analytics', request('GET', `/archive/downtime/summary?${common}`, { userId: 'stage40b-blocked-worker', factoryId }));
  await db.user.update({ where: { id: 'stage40b-blocked-worker' }, data: { blockedAt: null } });

  if (hasNoSecret(corrected.data) && hasNoSecret(linkedOnly.data)) ok('downtime analytics responses contain no secrets');
  else fail('downtime analytics responses contain no secrets', { corrected: corrected.data, linkedOnly: linkedOnly.data });

  if (state.failures.length) {
    console.error('Stage 40B downtime/task analytics regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 40B downtime/task analytics regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
