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
const stamp = Date.now();
const marker = `Stage line pilot ready ${stamp}`;
const state = { ok: [], failures: [] };
const created = { lineIds: [], taskIds: [], eventIds: [] };

function record(name, passed, detail) {
  (passed ? state.ok : state.failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
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
  return { status: response.status, data, text };
}

function hasNoSecret(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function cleanup(factoryId) {
  const now = new Date();
  if (created.eventIds.length) {
    await db.lineEvent.updateMany({
      where: { id: { in: created.eventIds }, confirmedEndAt: null },
      data: { confirmedEndAt: now },
    });
  }
  if (created.taskIds.length) {
    await db.task.updateMany({
      where: { id: { in: created.taskIds }, deletedAt: null },
      data: { deletedAt: now },
    });
  }
  if (created.lineIds.length) {
    await db.line.updateMany({
      where: { id: { in: created.lineIds }, factoryId },
      data: {
        status: 'WORK',
        deactivatedAt: now,
        deactivatedById: 'test-admin',
        deactivationReason: `${marker}: regression finished`,
      },
    });
  }
}

async function main() {
  const health = await request('GET', '/health', { userId: null });
  record('backend health ok', health.status === 200 && health.data?.status === 'ok', { status: health.status });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, isActive: true, deletedAt: null } })
    ?? await db.factory.upsert({
      where: { code: `stage-line-other-${stamp}` },
      update: { isActive: true, deletedAt: null },
      create: { code: `stage-line-other-${stamp}`, name: `Stage line other factory ${stamp}`, isActive: true },
    });

  const line = await db.line.create({
    data: {
      factoryId,
      name: `${marker} line`,
      status: 'WORK',
    },
  });
  created.lineIds.push(line.id);

  const hiddenLine = await db.line.create({
    data: {
      factoryId,
      name: `${marker} hidden line`,
      status: 'WORK',
      deletedAt: new Date(),
    },
  });
  created.lineIds.push(hiddenLine.id);

  try {
    const workerPatch = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'worker-1',
      factoryId,
      body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: worker denied` },
    });
    record('WORKER cannot change line status by direct API', workerPatch.status === 403, { status: workerPatch.status });

    const hiddenPatch = await request('PATCH', `/lines/${hiddenLine.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: hidden denied` },
    });
    record('hidden/deleted line cannot receive new downtime', [403, 404, 409].includes(hiddenPatch.status), { status: hiddenPatch.status, data: hiddenPatch.data });

    const crossFactory = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-admin',
      factoryId: otherFactory.id,
      body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: cross factory denied` },
    });
    record('cross-factory line status change denied', [403, 404, 409].includes(crossFactory.status), { status: crossFactory.status });

    const pause = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: active downtime` },
    });
    created.eventIds.push(pause.data?.id);
    record('MASTER creates downtime with reason/comment', pause.status === 200 && pause.data?.status === 'PAUSE' && pause.data?.downtimeReason === 'TECHNICAL', { status: pause.status, eventId: pause.data?.id });

    const repeatPause = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: repeat downtime` },
    });
    const openAfterRepeat = await db.lineEvent.count({ where: { lineId: line.id, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null } });
    record('repeat downtime is idempotent and does not duplicate open event', repeatPause.status === 200 && repeatPause.data?.id === pause.data?.id && openAfterRepeat === 1, { status: repeatPause.status, openAfterRepeat });

    const department = await db.department.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [{ factoryId, code: 'kipia' }, { scope: 'GLOBAL', code: 'kipia' }, { factoryId }, { scope: 'GLOBAL' }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!department) throw new Error('recipient department not found');

    const linkedTask = await request('POST', '/tasks', {
      userId: 'test-master',
      factoryId,
      body: {
        lineId: line.id,
        lineStatusEventId: pause.data?.id,
        operationId: `${marker}: linked-task`,
        type: 'URGENT',
        description: `${marker}: linked downtime task`,
        departmentRecipientIds: [department.id],
      },
    });
    created.taskIds.push(linkedTask.data?.id);
    record('URGENT task from downtime stores line and event relation', linkedTask.status === 201 && linkedTask.data?.lineId === line.id && linkedTask.data?.lineStatusEventId === pause.data?.id, { status: linkedTask.status, taskId: linkedTask.data?.id });

    const duplicateTask = await request('POST', '/tasks', {
      userId: 'test-master',
      factoryId,
      body: {
        lineId: line.id,
        lineStatusEventId: pause.data?.id,
        operationId: `${marker}: linked-task`,
        type: 'URGENT',
        description: `${marker}: duplicate linked downtime task`,
        departmentRecipientIds: [department.id],
      },
    });
    record('repeated task operationId returns same downtime task', duplicateTask.status === 201 && duplicateTask.data?.id === linkedTask.data?.id, { status: duplicateTask.status, taskId: duplicateTask.data?.id });

    const unlinkedTask = await request('POST', '/tasks', {
      userId: 'test-master',
      factoryId,
      body: {
        lineId: line.id,
        operationId: `${marker}: line-task-without-event`,
        type: 'URGENT',
        description: `${marker}: line task without downtime event`,
        departmentRecipientIds: [department.id],
      },
    });
    created.taskIds.push(unlinkedTask.data?.id);
    record('ordinary line task without lineStatusEvent can be created', unlinkedTask.status === 201 && unlinkedTask.data?.lineId === line.id && !unlinkedTask.data?.lineStatusEventId, { status: unlinkedTask.status, taskId: unlinkedTask.data?.id });

    const periodQuery = `dateFrom=${dateOnly(new Date(Date.now() - 86_400_000))}&dateTo=${dateOnly(new Date(Date.now() + 86_400_000))}&downtimeLinkedOnly=true&pageSize=100&includeDiagnostics=true`;
    const linkedItems = await request('GET', `/archive/downtime/items?${periodQuery}`, { userId: 'test-admin', factoryId });
    const linkedText = JSON.stringify(linkedItems.data ?? {});
    record('archive downtime-linked view includes only explicit lineStatusEventId task', linkedItems.status === 200 && linkedText.includes(linkedTask.data?.id) && !linkedText.includes(unlinkedTask.data?.id), { status: linkedItems.status });

    const work = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'WORK', comment: `${marker}: return to work` },
    });
    created.eventIds.push(work.data?.id);
    const repeatWork = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'WORK', comment: `${marker}: repeat return to work` },
    });
    const openAfterWork = await db.lineEvent.count({ where: { lineId: line.id, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null } });
    record('return to work closes active downtime and repeat WORK does not reopen it', work.status === 200 && repeatWork.status === 200 && openAfterWork === 0, { status: work.status, repeatStatus: repeatWork.status, openAfterWork });

    const fixtureEvent = await db.lineEvent.create({
      data: {
        lineId: line.id,
        factoryId,
        createdById: 'test-master',
        status: 'PAUSE',
        comment: `${marker}: fixture event should stay out of normal archive`,
        downtimeReason: 'TECHNICAL',
        confirmedEndAt: new Date(Date.now() + 60_000),
      },
    });
    created.eventIds.push(fixtureEvent.id);
    const normalArchive = await request('GET', `/archive/downtime/items?dateFrom=${dateOnly(new Date(Date.now() - 86_400_000))}&dateTo=${dateOnly(new Date(Date.now() + 86_400_000))}&pageSize=100`, { userId: 'test-admin', factoryId });
    const diagnosticArchive = await request('GET', `/archive/downtime/items?dateFrom=${dateOnly(new Date(Date.now() - 86_400_000))}&dateTo=${dateOnly(new Date(Date.now() + 86_400_000))}&pageSize=100&includeDiagnostics=true`, { userId: 'test-admin', factoryId });
    record('Stage/test line events are hidden from normal downtime archive', normalArchive.status === 200 && !JSON.stringify(normalArchive.data ?? {}).includes(fixtureEvent.id), { status: normalArchive.status });
    record('diagnostic downtime archive can include Stage/test line events', diagnosticArchive.status === 200 && JSON.stringify(diagnosticArchive.data ?? {}).includes(fixtureEvent.id), { status: diagnosticArchive.status });

    const dashboard = await request('GET', `/lines/${line.id}/dashboard`, { userId: 'test-master', factoryId });
    record('line dashboard exposes history and no active downtime after WORK', dashboard.status === 200 && dashboard.data?.line?.status === 'WORK' && !dashboard.data?.activeDowntimeEvent, { status: dashboard.status });

    record('responses contain no secret fields', hasNoSecret({
      workerPatch: workerPatch.data,
      hiddenPatch: hiddenPatch.data,
      pause: pause.data,
      linkedTask: linkedTask.data,
      linkedItems: linkedItems.data,
      dashboard: dashboard.data,
    }));
  } finally {
    await cleanup(factoryId);
  }

  if (state.failures.length) {
    console.error('Line downtime pilot-ready regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Line downtime pilot-ready regression passed');
  }
  console.log(JSON.stringify({ api: API, ok: state.ok.length, failures: state.failures.length, created }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
