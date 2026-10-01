const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { hasPilotFixtureMarker } = require('../dist/common/pilot-visibility');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [], warnings: [] };

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const db = new PrismaClient();
const markerRe = /(stage\s*\d+|stage\d+|regression|fixture|simulation|browser\s+regression|\be2e\b|autotest|auto-test|demo|prepilot|pilot-smoke|diagnostic|quality cross factory|error-report-regression|smoke urgent task|smoke stop)/i;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const forbiddenKeyRe = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken/i;

const endpoints = [
  { path: '/auth/factories', authOnly: true },
  { path: '/directory/departments' },
  { path: '/directory/lines' },
  { path: '/directory/users' },
  { path: '/lines' },
  { path: '/tasks' },
  { path: '/tasks/board' },
  { path: '/tasks/recipient-departments' },
  { path: '/checklists/templates/library' },
  { path: '/checklists/available' },
  { path: '/wash' },
  { path: '/okk' },
  { path: '/stock' },
  { path: '/returns' },
  { path: '/orders/items' },
  { path: '/orders/requests' },
  { path: '/defrost' },
  { path: '/defrost/lines' },
  { path: '/shift-log' },
  { path: '/announcements' },
  { path: '/announcements/current' },
  { path: '/announcements/archive' },
  { path: '/chats' },
  { path: '/error-reports' },
  { path: '/ops/overview' },
  { path: '/ops/operations/overview' },
  { path: '/ops/audit' },
  { path: '/archive/downtime/summary' },
];

function ok(name, detail) {
  state.ok.push({ name, detail });
}

function fail(name, detail) {
  state.failures.push({ name, detail });
}

function warn(name, detail) {
  state.warnings.push({ name, detail });
}

function hasRuntimeMarker(value) {
  if (typeof value !== 'string') return false;
  if (uuidRe.test(value) || isoDateRe.test(value)) return false;
  return markerRe.test(value);
}

function scanPayload(value, currentPath = '$', hits = []) {
  if (typeof value === 'string') {
    if (hasRuntimeMarker(value)) hits.push({ path: currentPath, value: value.slice(0, 160) });
    if (forbiddenKeyRe.test(value)) hits.push({ path: currentPath, value: `secret-like:${value.slice(0, 80)}` });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => scanPayload(item, `${currentPath}[${index}]`, hits));
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (forbiddenKeyRe.test(key)) hits.push({ path: `${currentPath}.${key}`, value: 'forbidden-key' });
      scanPayload(inner, `${currentPath}.${key}`, hits);
    }
  }
  return hits;
}

async function request(pathname, userId, factoryId) {
  const headers = { 'x-user-id': userId };
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${pathname}`, { headers });
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(command, ['run', 'start:dev:win'], {
    cwd: backendDir,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
}

async function waitForBackend() {
  for (let index = 0; index < 90; index += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function findRuntimeContext() {
  const access = await db.userFactoryAccess.findFirst({
    where: {
      isActive: true,
      role: 'ADMIN',
      user: { id: 'pilot-pack-admin', deletedAt: null, blockedAt: null },
      factory: { code: 'factory-4', isActive: true, deletedAt: null },
    },
    include: { factory: true },
  });
  if (access && !hasRuntimeMarker(access.factory.name) && !hasRuntimeMarker(access.factory.code)) {
    return { userId: 'pilot-pack-admin', factoryId: access.factoryId, factoryName: access.factory.name };
  }
  const fallback = await db.userFactoryAccess.findFirst({
    where: {
      isActive: true,
      role: 'ADMIN',
      user: { deletedAt: null, blockedAt: null },
      factory: { isActive: true, deletedAt: null },
    },
    include: { factory: true, user: { select: { id: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!fallback) throw new Error('Нет активного ADMIN-доступа для runtime hygiene проверки.');
  if (hasRuntimeMarker(fallback.factory.name) || hasRuntimeMarker(fallback.factory.code)) {
    throw new Error('Найден только диагностический ADMIN-завод; ordinary runtime контекст не определён.');
  }
  return { userId: fallback.user.id, factoryId: fallback.factoryId, factoryName: fallback.factory.name };
}

async function countMarkedRecords() {
  const [factories, lines, orderRequests, errorReports] = await Promise.all([
    db.factory.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, code: true } }),
    db.line.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.orderRequest.findMany({ select: { id: true, title: true, description: true, reasonComment: true } }),
    db.errorReport.findMany({ select: { id: true, section: true, title: true, description: true } }),
  ]);
  return {
    activeFactoriesMarked: factories.filter((item) => hasRuntimeMarker(item.id) || hasRuntimeMarker(item.name) || hasRuntimeMarker(item.code)).length,
    activeLinesMarked: lines.filter((item) => hasRuntimeMarker(item.id) || hasRuntimeMarker(item.name)).length,
    orderRequestsMarked: orderRequests.filter((item) => hasRuntimeMarker(item.id) || hasRuntimeMarker(item.title) || hasRuntimeMarker(item.description) || hasRuntimeMarker(item.reasonComment)).length,
    errorReportsMarked: errorReports.filter((item) => hasRuntimeMarker(item.id) || hasRuntimeMarker(item.section) || hasRuntimeMarker(item.title) || hasRuntimeMarker(item.description)).length,
  };
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('Backend не запустился для runtime hygiene проверки.');
  }
  try {
    const opaqueUuid = 'a47479df-05e1-4d47-bed4-44f0e2e55b55';
    if (hasPilotFixtureMarker(opaqueUuid) || !hasPilotFixtureMarker('Stage67 regression fixture')) {
      fail('fixture marker classifier ignores opaque UUID values', { opaqueUuidClassifiedAsFixture: hasPilotFixtureMarker(opaqueUuid) });
    } else {
      ok('fixture marker classifier ignores opaque UUID values', { status: 'ok' });
    }
    const context = await findRuntimeContext();
    const rawCounts = await countMarkedRecords();
    ok('marked records remain in DB for history/diagnostics', rawCounts);
    for (const endpoint of endpoints) {
      const result = await request(endpoint.path, context.userId, endpoint.authOnly ? null : context.factoryId);
      if (result.status < 200 || result.status >= 300) {
        fail(`${endpoint.path} доступен обычному ADMIN runtime`, { status: result.status, data: result.data });
        continue;
      }
      const hits = scanPayload(result.data);
      if (hits.length) fail(`${endpoint.path} не отдаёт stage/regression/secrets в ordinary runtime`, hits.slice(0, 8));
      else ok(`${endpoint.path} clean`, { status: result.status });
    }
    if (state.failures.length) {
      console.log(JSON.stringify(state, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(state, null, 2));
    }
  } catch (error) {
    fail('runtime data hygiene regression crashed', { message: error.message, stack: error.stack });
    console.log(JSON.stringify(state, null, 2));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }
}

main();
