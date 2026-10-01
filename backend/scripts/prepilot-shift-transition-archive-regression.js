const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'node',
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
});

const { ShiftService } = require('../src/modules/shift/shift.service.ts');

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const archiveViewerId = 'test-prepilot-shift-archive-viewer';

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'pilot-pack-admin';
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

function runPilotPack() {
  const result = spawnSync(process.execPath, ['scripts/pilot-pack-v1.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'pilot-pack-v1 failed');
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftKey(target) {
  return `${localDate(target.targetShiftDate)}_${target.shiftType}`;
}

function shiftWindow(service, target) {
  const from = startOfDay(target.targetShiftDate);
  if (target.shiftType === 'DAY') {
    from.setHours(8, 0, 0, 0);
    const to = new Date(from);
    to.setHours(20, 0, 0, 0);
    return { from, to };
  }
  from.setHours(20, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  to.setHours(8, 0, 0, 0);
  return { from, to };
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i.test(JSON.stringify(value));
}

async function makeUserContext(userId, factoryId) {
  const access = await db.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId, factoryId } },
    include: { user: true },
  });
  if (!access) throw new Error(`pilot user ${userId} has no factory access`);
  return {
    userId,
    selectedFactoryId: factoryId,
    role: access.role,
    departmentId: access.departmentId,
    isAdmin: access.role === 'ADMIN',
    isGuest: Boolean(access.isGuest),
    permissions: ['shift.self.read', 'shift.future.read', 'shift.future.manage', 'shift.past.read', 'assignments.manage'],
    scope: { type: 'FACTORY', factoryId, departmentId: access.departmentId },
  };
}

async function ensureArchiveFixture(service, factoryId) {
  const target = service.addShift(service.getCurrentShiftTarget(new Date()), -1);
  const window = shiftWindow(service, target);
  const key = shiftKey(target);
  const marker = 'STAGE_PREPILOT_SHIFT_TRANSITION';

  const line = await db.line.findFirst({
    where: {
      factoryId,
      deletedAt: null,
      NOT: [
        { name: { contains: 'Stage', mode: 'insensitive' } },
        { name: { contains: 'test', mode: 'insensitive' } },
        { name: { contains: 'diagnostic', mode: 'insensitive' } },
      ],
    },
    include: {
      positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 1 },
      staffingTemplates: { include: { items: { include: { position: true }, orderBy: { sortOrder: 'asc' } } }, take: 1 },
    },
  });
  if (!line) throw new Error('No active production line found for prepilot shift archive fixture');
  const position = line.positions[0] ?? line.staffingTemplates[0]?.items[0]?.position ?? null;
  const kipia = await db.department.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { factoryId, code: 'kipia' },
        { factoryId, name: { contains: 'КИП', mode: 'insensitive' } },
      ],
    },
  }) ?? await db.department.findFirst({ where: { factoryId, deletedAt: null } });
  if (!kipia) throw new Error('No department found for prepilot shift archive fixture');

  await db.shiftSession.upsert({
    where: { id: `${marker}_MASTER_SESSION` },
    create: {
      id: `${marker}_MASTER_SESSION`,
      factoryId,
      userId: 'pilot-master-1',
      startedAt: plusMinutes(window.from, 5),
      endedAt: plusMinutes(window.to, -10),
      shiftType: target.shiftType,
      status: 'ENDED',
      startedById: 'pilot-master-1',
      endedById: 'pilot-master-1',
    },
    update: {
      factoryId,
      userId: 'pilot-master-1',
      startedAt: plusMinutes(window.from, 5),
      endedAt: plusMinutes(window.to, -10),
      shiftType: target.shiftType,
      status: 'ENDED',
      autoClosed: false,
    },
  });

  await db.shiftSession.upsert({
    where: { id: `${marker}_WORKER_SESSION` },
    create: {
      id: `${marker}_WORKER_SESSION`,
      factoryId,
      userId: 'pilot-worker-1',
      startedAt: plusMinutes(window.from, 15),
      endedAt: plusMinutes(window.to, -15),
      shiftType: target.shiftType,
      status: 'ENDED',
      startedById: 'pilot-master-1',
      endedById: 'pilot-master-1',
    },
    update: {
      factoryId,
      userId: 'pilot-worker-1',
      startedAt: plusMinutes(window.from, 15),
      endedAt: plusMinutes(window.to, -15),
      shiftType: target.shiftType,
      status: 'ENDED',
      autoClosed: false,
    },
  });

  const assignment = await db.assignment.upsert({
    where: { id: `${marker}_ASSIGNMENT` },
    create: {
      id: `${marker}_ASSIGNMENT`,
      factoryId,
      userId: 'pilot-worker-1',
      lineId: line.id,
      kind: 'LINE',
      positionId: position?.id ?? null,
      slotIndex: 1,
      staffingTemplateId: line.staffingTemplates[0]?.id ?? null,
      startedById: 'pilot-master-1',
      endedById: 'pilot-master-1',
      startedAt: plusMinutes(window.from, 30),
      endedAt: plusMinutes(window.from, 180),
      comment: `${marker}: archive assignment`,
    },
    update: {
      factoryId,
      userId: 'pilot-worker-1',
      lineId: line.id,
      positionId: position?.id ?? null,
      staffingTemplateId: line.staffingTemplates[0]?.id ?? null,
      startedAt: plusMinutes(window.from, 30),
      endedAt: plusMinutes(window.from, 180),
      comment: `${marker}: archive assignment`,
    },
  });

  const downtime = await db.lineEvent.upsert({
    where: { id: `${marker}_DOWNTIME` },
    create: {
      id: `${marker}_DOWNTIME`,
      factoryId,
      lineId: line.id,
      createdById: 'pilot-master-1',
      status: 'PAUSE',
      downtimeReason: 'TECHNICAL',
      comment: `${marker}: downtime archive evidence`,
      createdAt: plusMinutes(window.from, 70),
      confirmedEndAt: plusMinutes(window.from, 110),
    },
    update: {
      factoryId,
      lineId: line.id,
      createdById: 'pilot-master-1',
      status: 'PAUSE',
      downtimeReason: 'TECHNICAL',
      comment: `${marker}: downtime archive evidence`,
      createdAt: plusMinutes(window.from, 70),
      confirmedEndAt: plusMinutes(window.from, 110),
      correctedStartAt: null,
      correctedEndAt: null,
    },
  });

  const task = await db.task.upsert({
    where: { createdById_operationId: { createdById: 'pilot-master-1', operationId: `${marker}_TASK` } },
    create: {
      factoryId,
      lineId: line.id,
      lineStatusEventId: downtime.id,
      createdById: 'pilot-master-1',
      takenById: 'pilot-tech-kipia-1',
      doneById: 'pilot-tech-kipia-1',
      type: 'URGENT',
      description: `${marker}: linked downtime task`,
      status: 'DONE',
      operationId: `${marker}_TASK`,
      createdAt: plusMinutes(window.from, 75),
      startedAt: plusMinutes(window.from, 82),
      doneAt: plusMinutes(window.from, 104),
    },
    update: {
      lineId: line.id,
      lineStatusEventId: downtime.id,
      takenById: 'pilot-tech-kipia-1',
      doneById: 'pilot-tech-kipia-1',
      status: 'DONE',
      deletedAt: null,
      createdAt: plusMinutes(window.from, 75),
      startedAt: plusMinutes(window.from, 82),
      doneAt: plusMinutes(window.from, 104),
    },
  });
  await db.taskDepartmentRecipient.upsert({
    where: { taskId_departmentId: { taskId: task.id, departmentId: kipia.id } },
    create: { taskId: task.id, departmentId: kipia.id, factoryId, active: true },
    update: { factoryId, active: true },
  });

  return { key, line, assignment, downtime, task };
}

async function main() {
  runPilotPack();
  let ownedBackend = null;
  try {
    if (!(await isReachable())) {
      ownedBackend = startBackend();
      if (!(await waitForBackend())) throw new Error('backend did not start for prepilot shift transition regression');
    }

    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory?.id || !factory.isActive || factory.deletedAt) throw new Error('factory-4 is not active');
    await db.user.upsert({
      where: { id: archiveViewerId },
      create: { id: archiveViewerId, factoryId: factory.id, role: 'ADMIN', employeeState: 'AVAILABLE' },
      update: { factoryId: factory.id, role: 'ADMIN', employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: archiveViewerId, factoryId: factory.id } },
      create: { userId: archiveViewerId, factoryId: factory.id, role: 'ADMIN', isGuest: false, isActive: true },
      update: { role: 'ADMIN', isGuest: false, isActive: true, deactivatedAt: null, deactivatedById: null, deactivationReason: null },
    });
    const service = new ShiftService({ db }, { listPeople: async () => [] }, { writeTx: async () => {}, write: async () => {} }, {});
    const user = await makeUserContext('pilot-master-1', factory.id);

    const beforeDay = await service.timeline(user, new Date(2026, 4, 24, 7, 59, 0));
    const dayStart = await service.timeline(user, new Date(2026, 4, 24, 8, 0, 0));
    const nightStart = await service.timeline(user, new Date(2026, 4, 24, 20, 0, 0));
    const nextDayStart = await service.timeline(user, new Date(2026, 4, 25, 8, 0, 0));

    record('07:59 belongs to previous night shift', beforeDay.current.shiftDate === '2026-05-23' && beforeDay.current.shiftType === 'NIGHT', beforeDay.current);
    record('08:00 opens day shift', dayStart.current.shiftDate === '2026-05-24' && dayStart.current.shiftType === 'DAY', dayStart.current);
    record('20:00 opens night shift', nightStart.current.shiftDate === '2026-05-24' && nightStart.current.shiftType === 'NIGHT', nightStart.current);
    record('future shift becomes current on next boundary', nightStart.next.shiftDate === nextDayStart.current.shiftDate && nightStart.next.shiftType === nextDayStart.current.shiftType, { next: nightStart.next, current: nextDayStart.current });
    record('previous current shift moves to past on next boundary', nextDayStart.past.some((item) => item.shiftDate === nightStart.current.shiftDate && item.shiftType === nightStart.current.shiftType), { previous: nightStart.current, past: nextDayStart.past });

    const dayClose = service.getAutoCloseTarget({ startedAt: new Date(2026, 4, 24, 8, 10, 0), shiftType: 'DAY' });
    const nightClose = service.getAutoCloseTarget({ startedAt: new Date(2026, 4, 24, 20, 10, 0), shiftType: 'NIGHT' });
    record('day shift auto-close target is 21:00', dayClose.getHours() === 21 && dayClose.getMinutes() === 0 && dayClose.getDate() === 24, dayClose.toISOString());
    record('night shift auto-close target is next day 09:00', nightClose.getHours() === 9 && nightClose.getMinutes() === 0 && nightClose.getDate() === 25, nightClose.toISOString());

    const fixture = await ensureArchiveFixture(service, factory.id);
    const past = await request('GET', '/shift/past', { userId: archiveViewerId, factoryId: factory.id });
    const shiftCard = past.data?.shifts?.find((item) => item.key === fixture.key);
    record('past archive list includes completed shift card', past.status === 200 && Boolean(shiftCard), past.data?.shifts?.slice?.(0, 5));
    record('past shift card has counters for line/downtime/task', Number(shiftCard?.lineCount ?? 0) >= 1 && Number(shiftCard?.downtimeCount ?? 0) >= 1 && Number(shiftCard?.taskCount ?? 0) >= 1, shiftCard);

    const detail = await request('GET', `/shift/past/${fixture.key}`, { userId: archiveViewerId, factoryId: factory.id });
    record('past detail is read-only', detail.status === 200 && detail.data?.readOnly === true, detail.data?.allowedActions);
    record('past detail forbids live shift actions', detail.data?.allowedActions?.canAssign === false && detail.data?.allowedActions?.canStartLine === false && detail.data?.allowedActions?.canCreateDowntimeTask === false, detail.data?.allowedActions);
    record('past detail includes completed assignment', detail.data?.people?.some((item) => item.id === fixture.assignment.id && item.endedAt), detail.data?.people);
    record('past detail includes downtime with linked task', detail.data?.downtime?.some((item) => item.sourceEventId === fixture.downtime.id && item.linkedTasks?.some((task) => task.id === fixture.task.id)), detail.data?.downtime);
    record('past archive response has no storage/secrets', !hasSecret(detail.data), undefined);

    const workerDetail = await request('GET', `/shift/past/${fixture.key}`, { userId: 'pilot-worker-1', factoryId: factory.id });
    record('worker can read own past shift in read-only scope', workerDetail.status === 200 && workerDetail.data?.readOnly === true && workerDetail.data?.people?.every((item) => item.userId === 'pilot-worker-1'), workerDetail.data?.people);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage-prepilot-shift-transition-other-factory' },
      create: { code: 'stage-prepilot-shift-transition-other-factory', name: 'Stage prepilot shift transition other factory', isActive: true },
      update: { isActive: true, deletedAt: null },
    });
    const crossFactory = await request('GET', `/shift/past/${fixture.key}`, { userId: 'pilot-master-1', factoryId: otherFactory.id });
    record('cross-factory past archive denied', crossFactory.status >= 400, crossFactory.status);
    await db.factory.update({ where: { id: otherFactory.id }, data: { isActive: false } });
    record('stage-only cross-factory fixture deactivated after check', true, { code: otherFactory.code });
  } finally {
    const deactivatedAt = new Date();
    await db.userFactoryAccess.updateMany({
      where: { userId: archiveViewerId, isActive: true },
      data: { isActive: false, deactivatedAt, deactivationReason: 'Prepilot archive regression завершён' },
    }).catch(() => undefined);
    await db.user.updateMany({
      where: { id: archiveViewerId, blockedAt: null },
      data: { blockedAt: deactivatedAt },
    }).catch(() => undefined);
    stopBackend(ownedBackend);
  }

  if (failures.length) {
    console.error('Prepilot shift transition/archive regression failed');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Prepilot shift transition/archive regression passed (${ok.length} checks).`);
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
