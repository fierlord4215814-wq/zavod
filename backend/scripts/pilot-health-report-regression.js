const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const {
  hasForbidden,
  runPilotHealthReport,
  writeReports,
} = require('./pilot-health-report');

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
const validSeverities = new Set(['OK', 'INFO', 'WARNING', 'P2', 'P1', 'P0']);

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function warn(name, detail) {
  state.warnings.push({ name, ...(detail ? { detail } : {}) });
}

function safeDetail(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /password|token|secret|DATABASE_URL|storagePath/i.test(key) ? '[redacted]' : inner
  )));
}

async function request(pathname, { userId, factoryId } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${pathname}`, { headers, signal: AbortSignal.timeout(5000) });
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

async function countSnapshot() {
  const [
    users,
    factories,
    lines,
    tasks,
    checklistRuns,
    washSessions,
    defrostEvents,
    announcements,
    auditLogs,
  ] = await Promise.all([
    db.user.count(),
    db.factory.count(),
    db.line.count(),
    db.task.count(),
    db.checklistRun.count(),
    db.washSession.count(),
    db.defrostEvent.count(),
    db.announcement.count(),
    db.auditLog.count(),
  ]);
  return { users, factories, lines, tasks, checklistRuns, washSessions, defrostEvents, announcements, auditLogs };
}

function assertEqual(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(name, actual);
  else fail(name, { actual, expected });
}

function findCheck(report, code) {
  for (const section of report.sections ?? []) {
    const hit = (section.checks ?? []).find((check) => check.code === code);
    if (hit) return hit;
  }
  return null;
}

function scanDestructiveOperations() {
  const source = fs.readFileSync(path.join(backendDir, 'scripts', 'pilot-health-report.js'), 'utf8');
  const forbiddenDbMutation = /\bdb\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
  const forbiddenSql = /\b(TRUNCATE\s+TABLE|DROP\s+TABLE|DROP\s+DATABASE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|INSERT\s+INTO|ALTER\s+TABLE)\b/i;
  const forbiddenProcess = /prisma\s+(?:migrate\s+)?reset\b|restore\s+--create|pg_restore/i;
  const hits = [
    ...(source.match(forbiddenDbMutation) ?? []),
    ...(source.match(forbiddenSql) ?? []),
    ...(source.match(forbiddenProcess) ?? []),
  ];
  if (hits.length) fail('pilot health report has no destructive operations', hits);
  else ok('pilot health report has no destructive operations');
}

async function checkEndpointAccess(factoryId) {
  const cases = [
    ['ADMIN can read latest pilot health report', 'pilot-pack-admin', 200],
    ['MANAGEMENT can read latest pilot health report', 'pilot-pack-management', 200],
  ];
  for (const [name, userId, expected] of cases) {
    const response = await request('/admin/pilot-health-report/latest', { userId, factoryId });
    if (response.status === expected) ok(name, { status: response.status });
    else fail(name, { expected, status: response.status, data: safeDetail(response.data) });
    if (hasForbidden(response.data).length) fail(`${name}: payload hides secrets`, safeDetail(response.data));
  }
  const source = fs.readFileSync(path.join(backendDir, 'src', 'modules', 'admin', 'admin.controller.ts'), 'utf8');
  if (/pilot-health-report\/latest[\s\S]{0,160}RequirePermission\('ops\.statistics\.read'\)/.test(source)) {
    ok('pilot health endpoint uses ops.statistics.read guard');
  } else {
    fail('pilot health endpoint uses ops.statistics.read guard');
  }
  const permissions = await db.rolePermission.findMany({
    where: { permissionCode: 'ops.statistics.read', role: { in: ['OTHER', 'WORKER', 'MANAGEMENT'] } },
    select: { role: true, permissionCode: true },
  });
  const managementAllowed = permissions.some((item) => item.role === 'MANAGEMENT');
  const guestDenied = !permissions.some((item) => item.role === 'OTHER');
  const workerDenied = !permissions.some((item) => item.role === 'WORKER');
  if (managementAllowed) ok('MANAGEMENT has diagnostic permission');
  else fail('MANAGEMENT has diagnostic permission');
  if (guestDenied) ok('Guest permission shape denies pilot health report');
  else fail('Guest permission shape denies pilot health report');
  if (workerDenied) ok('Worker permission shape denies pilot health report');
  else fail('Worker permission shape denies pilot health report');
}

async function main() {
  let backend = null;
  try {
    const before = await countSnapshot();
    const report = await runPilotHealthReport({ db, writeFiles: false, includePrismaChecks: false });
    const after = await countSnapshot();
    assertEqual('pilot health report is read-only for core tables', after, before);

    if (report.sections?.length >= 10) ok('report has expected section coverage', { sections: report.sections.length });
    else fail('report has expected section coverage', { sections: report.sections?.length ?? 0 });
    if (report.manualChecks?.length >= 6) ok('report has manual-only checklist', { manualChecks: report.manualChecks.length });
    else fail('report has manual-only checklist', { manualChecks: report.manualChecks?.length ?? 0 });

    const invalidSeverity = [];
    for (const section of report.sections ?? []) {
      for (const check of section.checks ?? []) {
        if (!validSeverities.has(check.severity)) invalidSeverity.push({ code: check.code, severity: check.severity });
      }
    }
    if (invalidSeverity.length) fail('report severities are known values', invalidSeverity);
    else ok('report severities are known values');

    const oldDowntime = findCheck(report, 'lines.old-open-downtime');
    if (oldDowntime && ['OK', 'WARNING'].includes(oldDowntime.severity)) ok('old open downtime is warning/ok, not auto-cleanup blocker', { severity: oldDowntime.severity });
    else fail('old open downtime is warning/ok, not auto-cleanup blocker', oldDowntime);

    if (hasForbidden(report).length) fail('report object hides secrets/storage paths', safeDetail(report));
    else ok('report object hides secrets/storage paths');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-pilot-health-empty-'));
    const emptyReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'READY',
      summary: { OK: 0, INFO: 0, WARNING: 0, P2: 0, P1: 0, P0: 0, blockerCount: 0, warningCount: 0 },
      sections: [],
      manualChecks: ['Ручная проверка телефона'],
    };
    writeReports(emptyReport, { runtimeDir: path.join(tempDir, 'runtime'), docsDir: path.join(tempDir, 'docs') });
    ok('report writer handles empty data shape');

    scanDestructiveOperations();

    const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } });
    if (!factory) {
      fail('factory-4 exists for access regression');
    } else {
      if (!(await isReachable())) {
        backend = startBackend();
        if (!(await waitForBackend())) throw new Error('Backend не запустился для pilot health endpoint regression.');
      }
      await checkEndpointAccess(factory.id);
    }
  } catch (error) {
    fail('pilot health report regression crashed', { message: error.message, stack: error.stack });
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main();
