const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const stamp = Date.now();
const lineName = `STAGE_LINE_EFFECTIVE_TIME_${stamp}`;
const createdLineIds = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-master';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
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

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotScenario() {
  const result = spawnSync(process.execPath, ['scripts/stage47-pilot-scenario.js'], { cwd: backendDir, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'stage47 pilot scenario failed');
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

async function cleanup() {
  if (!createdLineIds.length) return;
  await db.line.updateMany({
    where: { id: { in: createdLineIds } },
    data: { status: 'WORK', deletedAt: new Date(), deactivatedAt: new Date(), deactivationReason: 'stage line effective time regression cleanup' },
  });
  await db.lineEvent.updateMany({
    where: { lineId: { in: createdLineIds }, confirmedEndAt: null },
    data: { confirmedEndAt: new Date() },
  });
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  const since = new Date();
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    const line = await db.line.create({ data: { factoryId, name: lineName, status: 'WORK' } });
    createdLineIds.push(line.id);

    const startAt = new Date(Date.now() - 25 * 60_000);
    const pause = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: {
        status: 'PAUSE',
        comment: 'Диагностический простой с фактическим временем',
        downtimeReason: 'TECHNICAL',
        effectiveAt: startAt.toISOString(),
      },
    });
    record('master can set downtime with custom effectiveAt inside 30 minutes', pause.status === 200 && pause.data?.correctedStartAt, pause.data);

    const repeatPause = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: {
        status: 'PAUSE',
        comment: 'Повторное нажатие не должно создать дубль',
        downtimeReason: 'TECHNICAL',
        effectiveAt: startAt.toISOString(),
      },
    });
    const openEventsAfterRepeat = await db.lineEvent.count({ where: { lineId: line.id, status: 'PAUSE', confirmedEndAt: null } });
    record('repeated downtime click is idempotent', repeatPause.status === 200 && repeatPause.data?.id === pause.data?.id && openEventsAfterRepeat === 1, { repeat: repeatPause.data, openEventsAfterRepeat });

    const outsideWindow = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: {
        status: 'STOP',
        comment: 'Фактическое время вне окна',
        downtimeReason: 'TECHNICAL',
        effectiveAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    });
    record('server rejects effectiveAt outside 30 minutes', outsideWindow.status === 400, outsideWindow.data);

    const beforeStart = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: {
        status: 'WORK',
        effectiveAt: new Date(startAt.getTime() - 60_000).toISOString(),
      },
    });
    record('server rejects return to work before downtime start', beforeStart.status === 400, beforeStart.data);

    const endAt = new Date(Date.now() - 5 * 60_000);
    const work = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: {
        status: 'WORK',
        effectiveAt: endAt.toISOString(),
      },
    });
    record('master can return line to work with custom effectiveAt', work.status === 200 && work.data?.status === 'WORK', work.data);

    const closedPause = await db.lineEvent.findUnique({ where: { id: pause.data.id } });
    const durationMinutes = closedPause?.correctedStartAt && closedPause?.correctedEndAt
      ? Math.round((closedPause.correctedEndAt.getTime() - closedPause.correctedStartAt.getTime()) / 60_000)
      : 0;
    record('downtime duration uses actual corrected timestamps', durationMinutes >= 18 && durationMinutes <= 22, {
      durationMinutes,
      hasCorrectedStart: Boolean(closedPause?.correctedStartAt),
      hasCorrectedEnd: Boolean(closedPause?.correctedEndAt),
    });

    const repeatWork = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'WORK' },
    });
    const workEvents = await db.lineEvent.count({ where: { lineId: line.id, status: 'WORK' } });
    record('repeated return to work does not create duplicates', repeatWork.status === 200 && workEvents === 1, { workEvents });

    const workerDenied = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'worker-1',
      factoryId,
      body: {
        status: 'PAUSE',
        comment: 'Запрещено',
        downtimeReason: 'TECHNICAL',
      },
    });
    record('ordinary worker cannot change line status by direct API', workerDenied.status === 403, workerDenied.data);

    const otherFactory = await db.factory.upsert({
      where: { code: 'line-effective-time-other' },
      update: { isActive: true, deletedAt: null },
      create: { code: 'line-effective-time-other', name: 'Line effective time other factory' },
    });
    const crossFactory = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId: otherFactory.id,
      body: {
        status: 'PAUSE',
        comment: 'Чужой завод',
        downtimeReason: 'TECHNICAL',
      },
    });
    record('cross-factory line status change is denied', [403, 409].includes(crossFactory.status), crossFactory.data);

    const audits = await db.auditLog.findMany({
      where: { createdAt: { gte: since }, action: 'LINE_STATUS_UPDATED', entityId: line.id },
      select: { action: true, details: true },
    });
    record('line status audit stores recorded and effective time', audits.some((audit) => {
      const raw = JSON.stringify(audit.details);
      return raw.includes('effectiveAt') && raw.includes('recordedAt') && raw.includes('effectiveTimeMode');
    }), audits);

    record('line effective-time responses do not leak secret-like values', !hasSecret({ pause: pause.data, work: work.data, outsideWindow: outsideWindow.data, crossFactory: crossFactory.data }), { checked: true });
  } finally {
    await cleanup();
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await db.$disconnect();
  } catch {}
  process.exit(1);
});
