const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, LineStatus, OkkStatus, ReturnProductionStatus, StockStatus } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const backendDir = path.join(root, 'backend');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const marker = `PILOT_RESILIENCE_V1_${Date.now()}`;

const ADMIN = 'pilot-pack-admin';
const MASTER = 'pilot-master-1';
const TECH = 'pilot-tech-kipia-1';
const OKK = 'pilot-okk-1';
const STORE = 'pilot-store-1';
const WORKER = 'pilot-worker-1';

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail: safe(detail) } : {}) });
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (/password|token|secret|DATABASE_URL|storagePath/i.test(key)) return '[hidden]';
    return item;
  }));
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
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
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

function assert(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}

async function resolveFixture() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const [line, mastersDepartment, masterAccess] = await Promise.all([
    db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null }, orderBy: { createdAt: 'asc' } }),
    db.department.findFirst({ where: { factoryId: factory.id, code: 'masters', deletedAt: null } }),
    db.userFactoryAccess.findFirst({ where: { factoryId: factory.id, userId: MASTER, isActive: true } }),
  ]);
  if (!line || !mastersDepartment || !masterAccess) throw new Error('pilot fixture is incomplete');
  return { factory, line, mastersDepartment };
}

async function ensurePilotLine(factoryId) {
  return db.line.upsert({
    where: { id: `${marker}_line` },
    update: { factoryId, name: `${marker} линия`, status: LineStatus.WORK, deletedAt: null, deactivatedAt: null },
    create: { id: `${marker}_line`, factoryId, name: `${marker} линия`, status: LineStatus.WORK },
  });
}

async function testTaskIdempotency(factoryId, lineId) {
  const operationId = `${marker}_task_create`;
  const body = {
    lineId,
    type: 'URGENT',
    description: `${marker} заявка double submit`,
    departmentRecipientIds: [],
    operationId,
  };
  const first = await request('POST', '/tasks', { userId: MASTER, factoryId, body });
  const second = await request('POST', '/tasks', { userId: MASTER, factoryId, body });
  assert('task create retry returns same task', first.status === 201 && second.status === 201 && first.data?.id === second.data?.id, { first, second });

  const takeBody = { operationId: `${marker}_task_take` };
  const take1 = await request('POST', `/tasks/${first.data?.id}/take`, { userId: MASTER, factoryId, body: takeBody });
  const take2 = await request('POST', `/tasks/${first.data?.id}/take`, { userId: MASTER, factoryId, body: takeBody });
  assert('task take retry is safe', [200, 201].includes(take1.status) && [200, 201].includes(take2.status), { take1, take2 });

  const completeBody = { operationId: `${marker}_task_complete`, comment: `${marker} закрыто` };
  const done1 = await request('POST', `/tasks/${first.data?.id}/complete`, { userId: MASTER, factoryId, body: completeBody });
  const done2 = await request('POST', `/tasks/${first.data?.id}/complete`, { userId: MASTER, factoryId, body: completeBody });
  assert('task complete retry is safe', [200, 201].includes(done1.status) && [200, 201].includes(done2.status), { done1, done2 });
}

async function testLineStatusIdempotency(factoryId) {
  const line = await ensurePilotLine(factoryId);
  const before = await db.lineEvent.count({ where: { lineId: line.id, status: LineStatus.STOP, comment: `${marker} stop` } });
  const stop1 = await request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'STOP', comment: `${marker} stop` } });
  const stop2 = await request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'STOP', comment: `${marker} stop` } });
  const after = await db.lineEvent.count({ where: { lineId: line.id, status: LineStatus.STOP, comment: `${marker} stop` } });
  assert('repeat STOP creates no duplicate stopped event', stop1.status === 200 && stop2.status === 200 && after - before === 1, { stop1, stop2, before, after });
  const work = await request('PATCH', `/lines/${line.id}/status`, { userId: MASTER, factoryId, body: { status: 'WORK', comment: `${marker} restore` } });
  assert('line restored to WORK after resilience check', work.status === 200, { work });
}

async function testChecklistIdempotency(factoryId, departmentId) {
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
  const body = { templateId: template.id, operationId: `${marker}_checklist_start` };
  const first = await request('POST', '/checklists/runs/start', { userId: MASTER, factoryId, body });
  const second = await request('POST', '/checklists/runs/start', { userId: MASTER, factoryId, body });
  assert('periodic checklist start retry returns active duplicate instead of new run', first.status === 201 && second.status === 201 && first.data?.id === second.data?.id, { firstId: first.data?.id, secondId: second.data?.id });
  const rowId = first.data?.rows?.[0]?.id;
  const row1 = await request('POST', `/checklists/runs/${first.data?.id}/rows/${rowId}/complete`, { userId: MASTER, factoryId, body: { status: 'OK', answerBoolean: true, operationId: `${marker}_row` } });
  const row2 = await request('POST', `/checklists/runs/${first.data?.id}/rows/${rowId}/complete`, { userId: MASTER, factoryId, body: { status: 'OK', answerBoolean: true, operationId: `${marker}_row` } });
  assert('checklist row retry stays usable and does not close whole periodic run', [200, 201].includes(row1.status) && [200, 201].includes(row2.status), { row1, row2 });
  const close = await request('POST', `/checklists/runs/${first.data?.id}/close`, { userId: MASTER, factoryId, body: { reason: `${marker} cleanup` } });
  assert('checklist test run closed through normal endpoint', [200, 201].includes(close.status), { close });
  await db.checklistTemplate.update({ where: { id: template.id }, data: { archivedAt: new Date(), isActive: false } });
}

async function testAnnouncementAck(factoryId) {
  const announcement = await db.announcement.create({
    data: {
      factoryId,
      title: `${marker} title`,
      text: `${marker} text`,
      priority: 'IMPORTANT',
      authorId: ADMIN,
      visibleFrom: new Date(Date.now() - 60_000),
      visibleUntil: new Date(Date.now() + 60 * 60_000),
    },
  });
  const first = await request('POST', `/announcements/${announcement.id}/ack`, { userId: WORKER, factoryId, body: {} });
  const second = await request('POST', `/announcements/${announcement.id}/ack`, { userId: WORKER, factoryId, body: {} });
  const reads = await db.announcementRead.count({ where: { announcementId: announcement.id, userId: WORKER } });
  assert('announcement ack retry is idempotent per user', [200, 201].includes(first.status) && [200, 201].includes(second.status) && reads === 1, { first, second, reads });
  await db.announcement.update({ where: { id: announcement.id }, data: { archivedAt: new Date() } });
}

async function testQualityAndReports(factoryId, lineId) {
  const okkBody = {
    lineId,
    assignedMasterId: MASTER,
    defectDate: new Date().toISOString(),
    shiftLabel: 'День',
    productName: `${marker} продукт`,
    mismatchReason: `${marker} причина`,
    defectQuantity: '1',
    operationId: `${marker}_okk`,
  };
  const okk1 = await request('POST', '/okk', { userId: OKK, factoryId, body: okkBody });
  const okk2 = await request('POST', '/okk', { userId: OKK, factoryId, body: okkBody });
  assert('OKK create retry returns same record', okk1.status === 201 && okk2.status === 201 && okk1.data?.id === okk2.data?.id, { okk1, okk2 });
  if (okk1.data?.id) await request('POST', `/okk/${okk1.data.id}/archive`, { userId: OKK, factoryId, body: {} });

  const stockBody = { name: `${marker} stock`, quantity: 1, unit: 'pieces', operationId: `${marker}_stock` };
  const stock1 = await request('POST', '/stock', { userId: ADMIN, factoryId, body: stockBody });
  const stock2 = await request('POST', '/stock', { userId: ADMIN, factoryId, body: stockBody });
  assert('stock defect create retry returns same record', stock1.status === 201 && stock2.status === 201 && stock1.data?.id === stock2.data?.id, { stock1, stock2 });
  if (stock1.data?.id) await request('POST', `/stock/${stock1.data.id}/archive`, { userId: ADMIN, factoryId, body: {} });

  const returnBody = { description: `${marker} return`, photoUrl: 'attachment-pending', operationId: `${marker}_return` };
  const ret1 = await request('POST', '/returns', { userId: OKK, factoryId, body: returnBody });
  const ret2 = await request('POST', '/returns', { userId: OKK, factoryId, body: returnBody });
  assert('return create retry returns same record', ret1.status === 201 && ret2.status === 201 && ret1.data?.id === ret2.data?.id, { ret1, ret2 });
  if (ret1.data?.id) await request('POST', `/returns/${ret1.data.id}/archive`, { userId: OKK, factoryId, body: {} });

  const reportBody = { section: 'Pilot', title: `${marker} report`, description: `${marker} report description`, operationId: `${marker}_error_report` };
  const report1 = await request('POST', '/error-reports', { userId: WORKER, factoryId, body: reportBody });
  const report2 = await request('POST', '/error-reports', { userId: WORKER, factoryId, body: reportBody });
  assert('error report create retry returns same record', report1.status === 201 && report2.status === 201 && report1.data?.id === report2.data?.id, { report1, report2 });
  if (report1.data?.id) await request('PATCH', `/error-reports/${report1.data.id}/status`, { userId: ADMIN, factoryId, body: { status: 'CLOSED' } });
}

async function testChatAndAttachment(factoryId) {
  const chats = await request('GET', '/chats', { userId: MASTER, factoryId });
  const chatId = Array.isArray(chats.data) ? chats.data[0]?.id : chats.data?.items?.[0]?.id;
  assert('master has chat for resilience message check', chats.status === 200 && Boolean(chatId), { chats });
  if (!chatId) return;
  const body = { text: `${marker} chat message`, operationId: `${marker}_chat` };
  const first = await request('POST', `/chats/${chatId}/messages`, { userId: MASTER, factoryId, body });
  const second = await request('POST', `/chats/${chatId}/messages`, { userId: MASTER, factoryId, body });
  assert('chat message retry returns same message', first.status === 201 && second.status === 201 && first.data?.id === second.data?.id, { first, second });
  assert('chat public payload hides storagePath/secrets', !/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i.test(JSON.stringify({ first: first.data, second: second.data })), { checked: true });
}

async function cleanupMarker() {
  const now = new Date();
  await db.line.updateMany({ where: { id: `${marker}_line` }, data: { status: LineStatus.WORK, deactivatedAt: now, deactivationReason: 'resilience v1 cleanup' } });
  await db.okkRecord.updateMany({ where: { OR: [{ description: { contains: marker } }, { productName: { contains: marker } }, { mismatchReason: { contains: marker } }] }, data: { status: OkkStatus.ARCHIVED, archivedAt: now, deletedAt: now } });
  await db.stockDefect.updateMany({ where: { OR: [{ productName: { contains: marker } }, { name: { contains: marker } }] }, data: { status: StockStatus.ARCHIVED, deletedAt: now } });
  await db.returnRecord.updateMany({ where: { OR: [{ description: { contains: marker } }, { productName: { contains: marker } }] }, data: { status: ReturnProductionStatus.ARCHIVED, archivedAt: now, deletedAt: now } });
  await db.errorReport.updateMany({ where: { title: { contains: marker } }, data: { status: 'CLOSED', closedAt: now, closedById: ADMIN } });
  await db.announcement.updateMany({ where: { title: { contains: marker } }, data: { archivedAt: now } });
  await db.checklistTemplate.updateMany({ where: { name: { contains: marker } }, data: { isActive: false, archivedAt: now } });
  await db.checklistRun.updateMany({ where: { template: { name: { contains: marker } }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'CLOSED', closedAt: now, closedById: ADMIN, closeReason: 'resilience v1 cleanup', closeKind: 'MANUAL' } });
}

async function main() {
  let backend = null;
  if (!(await isReachable(`${API}/health`))) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for resilience regression');
  }
  try {
    runPilotPack();
    const { factory, line, mastersDepartment } = await resolveFixture();
    await testTaskIdempotency(factory.id, line.id);
    await testLineStatusIdempotency(factory.id);
    await testChecklistIdempotency(factory.id, mastersDepartment.id);
    await testAnnouncementAck(factory.id);
    await testQualityAndReports(factory.id, line.id);
    await testChatAndAttachment(factory.id);
  } catch (error) {
    fail('resilience regression crashed', { message: error.message, stack: error.stack });
  } finally {
    try {
      await cleanupMarker();
    } catch (error) {
      fail('resilience cleanup failed', { message: error.message });
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
