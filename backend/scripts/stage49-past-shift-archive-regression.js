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
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
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

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function currentTarget(date = new Date()) {
  const hour = date.getHours();
  const target = new Date(date);
  if (hour >= 8 && hour < 20) return { shiftDate: startOfDay(target), shiftType: 'DAY' };
  if (hour < 8) target.setDate(target.getDate() - 1);
  return { shiftDate: startOfDay(target), shiftType: 'NIGHT' };
}

function addShift(target, offset) {
  let result = { shiftDate: new Date(target.shiftDate), shiftType: target.shiftType };
  const step = offset >= 0 ? 1 : -1;
  for (let index = 0; index < Math.abs(offset); index += 1) {
    if (step > 0) {
      if (result.shiftType === 'DAY') result = { shiftDate: result.shiftDate, shiftType: 'NIGHT' };
      else {
        const next = new Date(result.shiftDate);
        next.setDate(next.getDate() + 1);
        result = { shiftDate: startOfDay(next), shiftType: 'DAY' };
      }
    } else if (result.shiftType === 'NIGHT') result = { shiftDate: result.shiftDate, shiftType: 'DAY' };
    else {
      const previous = new Date(result.shiftDate);
      previous.setDate(previous.getDate() - 1);
      result = { shiftDate: startOfDay(previous), shiftType: 'NIGHT' };
    }
  }
  return result;
}

function shiftWindow(target) {
  const from = startOfDay(target.shiftDate);
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

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function dateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function containsSecret(value) {
  return /storagePath|passwordHash|token|secret/i.test(JSON.stringify(value));
}

async function ensureStage49Data(factoryId) {
  const target = addShift(currentTarget(), -1);
  const window = shiftWindow(target);
  const shiftKey = `${dateOnly(target.shiftDate)}_${target.shiftType}`;
  const line = await db.line.findFirst({
    where: {
      factoryId,
      deletedAt: null,
      NOT: [{ name: { contains: 'Stage', mode: 'insensitive' } }, { name: { contains: 'test', mode: 'insensitive' } }],
    },
    include: {
      positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 1 },
      staffingTemplates: { include: { items: { include: { position: true }, orderBy: { sortOrder: 'asc' } } }, take: 1 },
    },
  });
  if (!line) throw new Error('production line not found for Stage49 fixture');
  const position = line.positions[0] ?? line.staffingTemplates[0]?.items[0]?.position;
  const kipia = await db.department.findFirst({ where: { factoryId, code: 'kipia', deletedAt: null } })
    ?? await db.department.findFirst({ where: { factoryId, deletedAt: null } });
  if (!kipia) throw new Error('department not found for Stage49 fixture');

  for (const userId of ['pilot-master-1', 'pilot-worker-1', 'pilot-contractor-1']) {
    const existing = await db.shiftSession.findFirst({
      where: { factoryId, userId, startedAt: plusMinutes(window.from, userId === 'pilot-master-1' ? 5 : 15), shiftType: target.shiftType },
    });
    if (!existing) {
      await db.shiftSession.create({
        data: {
          factoryId,
          userId,
          startedAt: plusMinutes(window.from, userId === 'pilot-master-1' ? 5 : 15),
          endedAt: plusMinutes(window.to, -10),
          shiftType: target.shiftType,
          status: 'ENDED',
          startedById: 'pilot-master-1',
          endedById: 'pilot-master-1',
        },
      });
    }
  }

  const assignment = await db.assignment.findFirst({
    where: { factoryId, userId: 'pilot-worker-1', lineId: line.id, startedAt: plusMinutes(window.from, 30), comment: 'Stage49 архив смены' },
  });
  if (!assignment) {
    await db.assignment.create({
      data: {
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
        comment: 'Stage49 архив смены',
      },
    });
  }

  let downtime = await db.lineEvent.findFirst({
    where: { factoryId, lineId: line.id, comment: 'Stage49 простой архивной смены' },
  });
  if (!downtime) {
    downtime = await db.lineEvent.create({
      data: {
        factoryId,
        lineId: line.id,
        createdById: 'pilot-master-1',
        status: 'PAUSE',
        downtimeReason: 'TECHNICAL',
        comment: 'Stage49 простой архивной смены',
        createdAt: plusMinutes(window.from, 70),
        confirmedEndAt: plusMinutes(window.from, 110),
      },
    });
  }
  downtime = await db.lineEvent.update({
    where: { id: downtime.id },
    data: {
      createdById: 'pilot-master-1',
      status: 'PAUSE',
      downtimeReason: 'TECHNICAL',
      createdAt: plusMinutes(window.from, 70),
      confirmedEndAt: plusMinutes(window.from, 110),
    },
  });

  const task = await db.task.upsert({
    where: { createdById_operationId: { createdById: 'pilot-master-1', operationId: 'stage49-past-shift-task' } },
    create: {
      factoryId,
      lineId: line.id,
      lineStatusEventId: downtime.id,
      createdById: 'pilot-master-1',
      takenById: 'pilot-tech-kipia-1',
      doneById: 'pilot-tech-kipia-1',
      type: 'URGENT',
      description: 'Stage49 заявка из архивного простоя',
      status: 'DONE',
      operationId: 'stage49-past-shift-task',
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
      createdAt: plusMinutes(window.from, 75),
      startedAt: plusMinutes(window.from, 82),
      doneAt: plusMinutes(window.from, 104),
      deletedAt: null,
    },
  });
  await db.taskDepartmentRecipient.upsert({
    where: { taskId_departmentId: { taskId: task.id, departmentId: kipia.id } },
    create: { taskId: task.id, departmentId: kipia.id, factoryId, active: true },
    update: { factoryId, active: true },
  });

  const washCreatedAt = plusMinutes(window.from, 160);
  let wash = await db.washSession.findFirst({ where: { factoryId, lineId: line.id, createdAt: washCreatedAt } });
  if (!wash) {
    wash = await db.washSession.create({
      data: {
        factoryId,
        lineId: line.id,
        startedById: 'pilot-master-1',
        status: 'DONE',
        createdAt: washCreatedAt,
        completedAt: plusMinutes(window.from, 205),
      },
    });
    await db.washIssue.create({
      data: {
        factoryId,
        washSessionId: wash.id,
        createdById: 'pilot-master-1',
        message: 'Stage49 замечание мойки',
        title: 'Stage49',
        description: 'Stage49 архив мойки',
        status: 'RESOLVED',
        isResolved: true,
        resolvedById: 'pilot-okk-1',
        resolvedAt: plusMinutes(window.from, 190),
      },
    });
    await db.washOkkReview.create({
      data: {
        factoryId,
        washSessionId: wash.id,
        okkUserId: 'pilot-okk-1',
        status: 'APPROVED',
        rating: 8,
        comment: 'Stage49 проверка мойки',
        createdAt: plusMinutes(window.from, 200),
      },
    });
  }

  const plan = await db.lineShiftWorkPlan.upsert({
    where: { factoryId_lineId_shiftDate_shiftType: { factoryId, lineId: line.id, shiftDate: target.shiftDate, shiftType: target.shiftType } },
    create: { factoryId, lineId: line.id, shiftDate: target.shiftDate, shiftType: target.shiftType, staffingTemplateId: line.staffingTemplates[0]?.id ?? null, createdById: 'pilot-master-1' },
    update: { staffingTemplateId: line.staffingTemplates[0]?.id ?? null, updatedById: 'pilot-master-1' },
  });
  const row = await db.lineShiftWorkPlanRow.findFirst({ where: { workPlanId: plan.id, article: 'STAGE49' } });
  if (!row) {
    await db.lineShiftWorkPlanRow.create({
      data: { workPlanId: plan.id, sortOrder: 1, article: 'STAGE49', productName: 'Архивное задание смены', plannedGofrCount: 12 },
    });
  }

  const log = await db.shiftLog.findFirst({ where: { factoryId, title: 'Stage49 архив пересменки' } });
  if (!log) {
    await db.shiftLog.create({
      data: {
        factoryId,
        departmentId: kipia.id,
        createdById: 'pilot-master-1',
        title: 'Stage49 архив пересменки',
        text: 'Важная запись для архива прошлой смены.',
        isImportant: true,
        status: 'ACTIVE',
        createdAt: plusMinutes(window.from, 220),
      },
    });
  } else {
    await db.shiftLog.update({
      where: { id: log.id },
      data: {
        departmentId: kipia.id,
        createdById: 'pilot-master-1',
        text: 'Важная запись для архива прошлой смены.',
        isImportant: true,
        status: 'ACTIVE',
        createdAt: plusMinutes(window.from, 220),
      },
    });
  }

  return { target, shiftKey, line, task, downtime, wash };
}

let ownedBackend = null;

async function main() {
  runPilotScenario();
  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage49 regression');
  }

  const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-admin' } });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');

  const fixture = await ensureStage49Data(factoryId);

  const past = await request('GET', '/shift/past', { userId: 'test-master', factoryId });
  const shiftCard = past.data?.shifts?.find((item) => item.key === fixture.shiftKey);
  record('past list returns shift cards', past.status === 200 && Boolean(shiftCard), past.data?.shifts?.slice(0, 3));
  record('shift card has human date type and master display', Boolean(shiftCard?.title && shiftCard?.masterLabel && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(shiftCard.masterLabel)), shiftCard);
  record('shift card includes counters', Number(shiftCard?.lineCount ?? 0) >= 1 && Number(shiftCard?.downtimeCount ?? 0) >= 1 && Number(shiftCard?.taskCount ?? 0) >= 1, shiftCard);

  const detail = await request('GET', `/shift/past/${fixture.shiftKey}`, { userId: 'test-master', factoryId });
  record('past detail returns read-only archive', detail.status === 200 && detail.data?.readOnly === true, detail.data);
  record('past detail has no operational actions', detail.data?.allowedActions?.canAssign === false && detail.data?.allowedActions?.canStartLine === false && detail.data?.allowedActions?.canCreateDowntimeTask === false, detail.data?.allowedActions);
  record('people assignments included', detail.data?.people?.some((person) => person.displayName.includes('Тестовый') && person.targetName), detail.data?.people);
  record('line summary included', detail.data?.lines?.some((line) => line.lineId === fixture.line.id && line.workPlanRows?.some((row) => row.article === 'STAGE49')), detail.data?.lines);
  record('downtime included with effective duration', detail.data?.downtime?.some((item) => item.id === fixture.downtime.id && item.durationLabel && item.reason), detail.data?.downtime);
  record('linked task included', detail.data?.tasks?.some((task) => task.id === fixture.task.id && task.statusLabel === 'Выполнена'), detail.data?.tasks);
  record('wash summary included', detail.data?.washes?.some((wash) => wash.id === fixture.wash.id && wash.okkReviews?.some((review) => review.rating === 8)), detail.data?.washes);
  record('shift log department is human name', detail.data?.shiftLogs?.some((log) => log.title === 'Stage49 архив пересменки' && log.departmentName && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(log.departmentName)), detail.data?.shiftLogs);
  record('no storagePath or secrets in response', !containsSecret(detail.data), undefined);

  const workerDetail = await request('GET', `/shift/past/${fixture.shiftKey}`, { userId: 'pilot-worker-1', factoryId });
  record('worker scope can open own past shift without management actions', workerDetail.status === 200 && workerDetail.data?.allowedActions?.canAssign === false && workerDetail.data?.people?.every((person) => person.displayName.includes('Тестовый работник 1')), workerDetail.data);

  await db.user.upsert({
    where: { id: 'stage49-blocked-master' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage49-blocked-master', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage49-blocked-master', factoryId } },
    update: { role: 'MASTER', isActive: true, isGuest: false },
    create: { userId: 'stage49-blocked-master', factoryId, role: 'MASTER', isActive: true, isGuest: false },
  });
  const blocked = await request('GET', `/shift/past/${fixture.shiftKey}`, { userId: 'stage49-blocked-master', factoryId });
  record('blocked user denied', blocked.status >= 400, blocked.status);

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage49-other-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage49-other-factory', name: 'Stage49 другой завод', isActive: true },
  });
  const crossFactory = await request('GET', `/shift/past/${fixture.shiftKey}`, { userId: 'test-master', factoryId: otherFactory.id });
  record('cross-factory denied', crossFactory.status >= 400, crossFactory.status);

  if (failures.length) {
    console.error('Stage49 past shift archive regression failed');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage49 past shift archive regression passed');
  }
  console.log(JSON.stringify({ ok: ok.length, failures: failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    stopBackend(ownedBackend);
    process.exit(process.exitCode ?? 0);
  });
