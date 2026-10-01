const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, LineStatus } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const marker = `PILOT_CONCURRENCY_V1_${Date.now()}`;

const ADMIN = 'pilot-pack-admin';
const MANAGEMENT = 'pilot-pack-management';
const MASTER = 'pilot-master-1';
const TECH_A = 'pilot-tech-kipia-1';
const TECH_B = 'pilot-pack-kipia-lead';
const TARGET = 'pilot-pack-guest-master-target';
const MASTER_SOURCE = 'pilot-pack-master-source';

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, detail: safe(detail) });
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (/password|token|secret|DATABASE_URL|storagePath/i.test(key)) return '[hidden]';
    return item;
  }));
}

function assert(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(`${API}/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], {
    cwd: root,
    shell: true,
    detached: false,
    stdio: 'ignore',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotPack() {
  const result = spawnSync('npm.cmd run pilot-pack:v1 --workspace backend', [], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `pilot-pack failed ${result.status}`);
}

async function request(method, pathname, { userId = ADMIN, factoryId, body } = {}) {
  const headers = {};
  if (userId !== null) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

async function resolveFixture() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const [kipiaDepartment, mastersDepartment, line] = await Promise.all([
    db.department.findFirst({ where: { factoryId: factory.id, code: 'kipia', deletedAt: null } }),
    db.department.findFirst({ where: { factoryId: factory.id, code: 'masters', deletedAt: null } }),
    db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!kipiaDepartment || !mastersDepartment || !line) throw new Error('pilot fixture is incomplete');
  return { factory, kipiaDepartment, mastersDepartment, line };
}

async function ensurePilotLine(factoryId) {
  return db.line.upsert({
    where: { id: `${marker}_line` },
    update: { factoryId, name: `${marker} линия`, status: LineStatus.WORK, deletedAt: null, deactivatedAt: null },
    create: { id: `${marker}_line`, factoryId, name: `${marker} линия`, status: LineStatus.WORK },
  });
}

async function testConcurrentTaskTake(factoryId, lineId, kipiaDepartmentId) {
  const created = await request('POST', '/tasks', {
    userId: MASTER,
    factoryId,
    body: {
      lineId,
      type: 'LONG',
      description: `${marker} concurrent task`,
      deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      departmentRecipientIds: [kipiaDepartmentId],
      operationId: `${marker}_task`,
    },
  });
  assert('concurrency task created', created.status === 201 && created.data?.id, created);
  const [takeA, takeB] = await Promise.all([
    request('POST', `/tasks/${created.data?.id}/take`, { userId: ADMIN, factoryId, body: { operationId: `${marker}_take_admin` } }),
    request('POST', `/tasks/${created.data?.id}/take`, { userId: MANAGEMENT, factoryId, body: { operationId: `${marker}_take_management` } }),
  ]);
  const task = await db.task.findUnique({ where: { id: created.data?.id } });
  const successCount = [takeA, takeB].filter((item) => [200, 201].includes(item.status)).length;
  const staleCount = [takeA, takeB].filter((item) => [400, 403, 409].includes(item.status)).length;
  assert('two executors taking one task leaves one assignee and no 500', successCount >= 1 && successCount + staleCount === 2 && Boolean(task?.takenById), { takeA, takeB, takenById: task?.takenById });

  const [done, staleTake] = await Promise.all([
    request('POST', `/tasks/${created.data?.id}/complete`, { userId: task.takenById, factoryId, body: { operationId: `${marker}_done`, comment: `${marker} done` } }),
    request('POST', `/tasks/${created.data?.id}/take`, { userId: task.takenById === ADMIN ? MANAGEMENT : ADMIN, factoryId, body: { operationId: `${marker}_late_take` } }),
  ]);
  const after = await db.task.findUnique({ where: { id: created.data?.id } });
  assert('close versus late take keeps single final task state', [200, 201].includes(done.status) && [200, 201, 400, 403, 409].includes(staleTake.status) && after?.status === 'DONE', { done, staleTake, status: after?.status });
}

async function testConcurrentLineStatus(factoryId) {
  const line = await ensurePilotLine(factoryId);
  const [stop, pause] = await Promise.all([
    request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'STOP', comment: `${marker} stop` } }),
    request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'PAUSE', comment: `${marker} pause` } }),
  ]);
  const openEvents = await db.lineEvent.findMany({
    where: { lineId: line.id, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null },
  });
  assert('concurrent STOP/PAUSE leaves at most one open downtime event and no 500', [200, 409].includes(stop.status) && [200, 409].includes(pause.status) && openEvents.length <= 1, { stop, pause, openCount: openEvents.length });
  await request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'WORK', comment: `${marker} restore` } });
}

async function testConcurrentChecklist(factoryId, departmentId) {
  const template = await db.checklistTemplate.create({
    data: {
      factoryId,
      departmentId,
      name: `${marker} checklist`,
      scope: 'DEPARTMENT',
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 30,
      createdById: ADMIN,
      rows: { create: [{ title: `${marker} row`, sortOrder: 1, rowType: 'LEGACY', isRequired: true }] },
    },
  });
  const run = await request('POST', '/checklists/runs/start', {
    userId: MASTER,
    factoryId,
    body: { templateId: template.id, operationId: `${marker}_checklist` },
  });
  assert('concurrency checklist started for current factory shift', run.status === 201 && run.data?.id, run);
  if (!run.data?.id) return;
  const rowId = run.data?.rows?.[0]?.id;
  const [row, close] = await Promise.all([
    request('POST', `/checklists/runs/${run.data?.id}/rows/${rowId}/complete`, { userId: MASTER, factoryId, body: { status: 'OK', answerBoolean: true, operationId: `${marker}_row` } }),
    request('POST', `/checklists/runs/${run.data?.id}/close`, { userId: MASTER, factoryId, body: { reason: `${marker} close` } }),
  ]);
  const finalRun = await db.checklistRun.findUnique({ where: { id: run.data?.id } });
  assert('checklist row versus close has one final state and no 500', [200, 201, 409].includes(row.status) && [200, 201, 409].includes(close.status) && ['ACTIVE', 'CLOSED', 'AUTO_CLOSED'].includes(finalRun?.status), { row, close, status: finalRun?.status });
  if (finalRun?.status === 'ACTIVE') {
    await request('POST', `/checklists/runs/${run.data?.id}/close`, { userId: MASTER, factoryId, body: { reason: `${marker} cleanup` } });
  }
  await db.checklistTemplate.update({ where: { id: template.id }, data: { archivedAt: new Date(), isActive: false } });
}

async function testRightsChangeWhileWorking(factoryId) {
  await request('POST', `/admin/users/${TARGET}/permission-copy-apply`, {
    userId: ADMIN,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId, reason: `${marker} promote target` },
  });
  const [shiftBefore, block] = await Promise.all([
    request('GET', '/shift/current', { userId: TARGET, factoryId }),
    request('PATCH', `/admin/users/${TARGET}/block-status`, { userId: ADMIN, factoryId, body: { blocked: true, reason: `${marker} block target` } }),
  ]);
  const shiftAfter = await request('GET', '/shift/current', { userId: TARGET, factoryId });
  assert('rights change while user works ends with backend 403 after refresh/current request', [200, 403].includes(shiftBefore.status) && block.status === 200 && shiftAfter.status === 403, { shiftBefore, block, shiftAfter });
  await request('PATCH', `/admin/users/${TARGET}/block-status`, { userId: ADMIN, factoryId, body: { blocked: false, reason: `${marker} restore target` } });
}

async function cleanupMarker() {
  const now = new Date();
  await db.line.updateMany({ where: { id: `${marker}_line` }, data: { status: LineStatus.WORK, deactivatedAt: now, deactivationReason: 'resilience concurrency cleanup' } });
  await db.checklistTemplate.updateMany({ where: { name: { contains: marker } }, data: { isActive: false, archivedAt: now } });
  await db.checklistRun.updateMany({ where: { template: { name: { contains: marker } }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'CLOSED', closedAt: now, closedById: ADMIN, closeReason: 'resilience concurrency cleanup', closeKind: 'MANUAL' } });
}

async function main() {
  let backend = null;
  if (!(await isReachable(`${API}/health`))) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for resilience concurrency regression');
  }
  try {
    runPilotPack();
    const { factory, kipiaDepartment, mastersDepartment, line } = await resolveFixture();
    await testConcurrentTaskTake(factory.id, line.id, kipiaDepartment.id);
    await testConcurrentLineStatus(factory.id);
    await testConcurrentChecklist(factory.id, mastersDepartment.id);
    await testRightsChangeWhileWorking(factory.id);
  } catch (error) {
    fail('resilience concurrency regression crashed', { message: error.message, stack: error.stack });
  } finally {
    try {
      await cleanupMarker();
    } catch (error) {
      fail('resilience concurrency cleanup failed', { message: error.message });
    }
    try {
      runPilotPack();
    } catch (error) {
      fail('pilot-pack restore failed', { message: error.message });
    }
    await db.$disconnect();
    stopBackend(backend);
  }
  console.log(JSON.stringify(state, null, 2));
  process.exitCode = state.failures.length ? 1 : 0;
}

main();
