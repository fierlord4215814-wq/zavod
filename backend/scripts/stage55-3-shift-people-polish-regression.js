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

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];

function record(name, passed, detail) {
  let safeDetail = detail;
  const serialized = detail === undefined ? '' : JSON.stringify(detail);
  if (serialized.length > 1200) {
    safeDetail = {
      summary: 'detail omitted because response is large',
      length: serialized.length,
      keys: detail && typeof detail === 'object' ? Object.keys(detail).slice(0, 12) : [],
    };
  }
  (passed ? ok : failures).push({ name, ...(safeDetail ? { detail: safeDetail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
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
  const result = spawnSync(process.execPath, ['scripts/stage47-pilot-scenario.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'stage47 pilot scenario failed');
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

let ownedBackend = null;

async function main() {
  runPilotScenario();
  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage55.3 regression');
  }

  try {
    const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-admin' } });
    const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
    if (!factoryId) throw new Error('factory context not found');

    const timeline = await request('GET', '/shift/timeline', { userId: 'test-master', factoryId });
    const futureTarget = timeline.data?.future?.[0];
    record('timeline returns selectable future shifts', timeline.status === 200 && timeline.data?.next && futureTarget, timeline.data);

    const nextFuture = await request('GET', '/shift/future', { userId: 'test-master', factoryId });
    const selectedFuture = await request('GET', `/shift/future?targetShiftDate=${futureTarget.shiftDate}&shiftType=${futureTarget.shiftType}`, { userId: 'test-master', factoryId });
    record('future endpoint can load selected future shift', selectedFuture.status === 200
      && selectedFuture.data?.shiftType === futureTarget.shiftType
      && selectedFuture.data?.shiftDate === futureTarget.shiftDate, selectedFuture.data);
    record('next and selected future are distinct when target differs', nextFuture.status === 200
      && selectedFuture.status === 200
      && (`${nextFuture.data?.targetShiftDate}-${nextFuture.data?.shiftType}` !== `${selectedFuture.data?.targetShiftDate}-${selectedFuture.data?.shiftType}`), {
      next: nextFuture.data,
      selected: selectedFuture.data,
    });

    const line = await db.line.findFirst({
      where: { factoryId, deletedAt: null },
      include: { staffingTemplates: { where: { isActive: true, deletedAt: null }, include: { items: { include: { position: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!line) throw new Error('production line not found');
    const template = line.staffingTemplates[0] ?? null;

    await db.plannedLineAssignment.updateMany({
      where: { factoryId, lineId: line.id, shiftDate: new Date(`${futureTarget.shiftDate}T00:00:00`), shiftType: futureTarget.shiftType, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
    await db.lineShiftWorkPlan.deleteMany({
      where: { factoryId, lineId: line.id, shiftDate: new Date(`${futureTarget.shiftDate}T00:00:00`), shiftType: futureTarget.shiftType },
    });

    const beforePlan = await request('GET', `/shift/future?targetShiftDate=${futureTarget.shiftDate}&shiftType=${futureTarget.shiftType}`, { userId: 'test-master', factoryId });
    record('selected future list shows only explicitly planned lines before add', beforePlan.status === 200
      && !(beforePlan.data?.plannedLines ?? []).some((item) => item.lineId === line.id), beforePlan.data?.plannedLines);

    const planning = await request('GET', `/lines/${line.id}/planning-board?shiftDate=${futureTarget.shiftDate}&shiftType=${futureTarget.shiftType}&staffingTemplateId=${template?.id ?? ''}`, {
      userId: 'test-master',
      factoryId,
    });
    record('planning-board adds line to selected future plan', planning.status === 200
      && planning.data?.statusLabel === 'Запланирована'
      && planning.data?.line?.status !== 'WORK', planning.data);

    const afterPlan = await request('GET', `/shift/future?targetShiftDate=${futureTarget.shiftDate}&shiftType=${futureTarget.shiftType}`, { userId: 'test-master', factoryId });
    record('planned line appears in selected future list after add', afterPlan.status === 200
      && afterPlan.data?.plannedLines?.some((item) => item.lineId === line.id && item.statusLabel === 'Запланирована'), afterPlan.data?.plannedLines);

    const slot = planning.data?.slots?.find((item) => !item.assignment);
    if (!slot) throw new Error('free planning slot not found');
    await db.plannedLineAssignment.updateMany({
      where: { factoryId, shiftDate: new Date(`${futureTarget.shiftDate}T00:00:00`), shiftType: futureTarget.shiftType, userId: 'pilot-worker-3', releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
    const assign = await request('POST', `/lines/${line.id}/planning-board/assign`, {
      userId: 'test-master',
      factoryId,
      body: {
        shiftDate: futureTarget.shiftDate,
        shiftType: futureTarget.shiftType,
        staffingTemplateId: template?.id ?? null,
        targetUserId: 'pilot-worker-3',
        positionId: slot.positionId,
        slotIndex: slot.slotIndex,
      },
    });
    const liveAssignment = await db.assignment.findFirst({ where: { factoryId, userId: 'pilot-worker-3', endedAt: null } });
    const assignedSlot = assign.data?.slots?.find((item) => item.positionId === slot.positionId && item.slotIndex === slot.slotIndex);
    record('future assignment uses explicit slot and does not create live assignment', [200, 201].includes(assign.status)
      && assignedSlot?.assignment?.userId === 'pilot-worker-3'
      && !liveAssignment, {
      assignStatus: assign.status,
      assignMessage: assign.data?.message ?? assign.data?.code ?? null,
      slot: { positionId: slot.positionId, slotIndex: slot.slotIndex },
      assignedSlot,
      liveAssignment,
    });

    const people = await request('GET', '/people?onShift=true', { userId: 'test-master', factoryId });
    record('people list exposes onShift badges', people.status === 200 && people.data?.people?.some((person) => person.onShift === true), people.data?.people?.slice?.(0, 5));

    const electric = await db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: 'pilot-tech-electric-1', factoryId } },
      include: { department: true, user: true },
    });
    record('pilot electrician exists with factory-4 access only', Boolean(electric?.role === 'TECH_ELECTRIC' && electric.department?.code === 'electric' && !electric.user.blockedAt), electric);

    const task = await db.task.upsert({
      where: { id: 'stage55-3-electric-task' },
      update: {
        factoryId,
        status: 'IN_PROGRESS',
        assignedToId: 'pilot-tech-electric-1',
        takenById: 'pilot-tech-electric-1',
        deletedAt: null,
        description: 'Stage55.3 заявка для статуса электрика',
      },
      create: {
        id: 'stage55-3-electric-task',
        factoryId,
        type: 'URGENT',
        status: 'IN_PROGRESS',
        description: 'Stage55.3 заявка для статуса электрика',
        createdById: 'test-master',
        assignedToId: 'pilot-tech-electric-1',
        takenById: 'pilot-tech-electric-1',
      },
    });
    const profile = await request('GET', '/people/pilot-tech-electric-1/profile', { userId: 'test-master', factoryId });
    record('service profile shows active task status', profile.status === 200
      && profile.data?.serviceTaskStatus?.state === 'ON_TASK'
      && profile.data?.serviceTaskStatus?.taskId === task.id, profile.data?.serviceTaskStatus);

    const workerPlanning = await request('GET', `/shift/future?targetShiftDate=${futureTarget.shiftDate}&shiftType=${futureTarget.shiftType}`, { userId: 'pilot-worker-1', factoryId });
    record('worker can read planned lines without management data leakage', workerPlanning.status === 200
      && Array.isArray(workerPlanning.data?.plannedLines)
      && !hasSecret(workerPlanning.data), workerPlanning.data);

    const blocked = await db.user.upsert({
      where: { id: 'stage55-3-blocked-user' },
      update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
      create: { id: 'stage55-3-blocked-user', factoryId, role: 'WORKER', blockedAt: new Date() },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: blocked.id, factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: blocked.id, factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blockedFuture = await request('GET', '/shift/future', { userId: blocked.id, factoryId });
    record('blocked user denied future planning runtime', blockedFuture.status === 403, blockedFuture.data);

    record('Stage55.3 responses hide secrets', !hasSecret({
      timeline: timeline.data,
      selectedFuture: selectedFuture.data,
      afterPlan: afterPlan.data,
      profile: profile.data,
    }), { checked: true });
  } finally {
    stopBackend(ownedBackend);
    await db.$disconnect();
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  stopBackend(ownedBackend);
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
