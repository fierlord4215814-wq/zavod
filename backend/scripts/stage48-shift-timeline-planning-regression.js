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

function currentTarget(date) {
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

function dateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

let ownedBackend = null;

async function main() {
  runPilotScenario();
  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage48 regression');
  }

  const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-admin' } });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');

  const edge0030 = currentTarget(new Date(2026, 4, 24, 0, 30));
  const edge0759 = currentTarget(new Date(2026, 4, 24, 7, 59));
  const edge0800 = currentTarget(new Date(2026, 4, 24, 8, 0));
  const edge2000 = currentTarget(new Date(2026, 4, 24, 20, 0));
  record('00:30 belongs to previous night shift', edge0030.shiftType === 'NIGHT' && edge0030.shiftDate.getDate() === 23, edge0030);
  record('07:59 still belongs to night shift', edge0759.shiftType === 'NIGHT' && edge0759.shiftDate.getDate() === 23, edge0759);
  record('08:00 starts day shift', edge0800.shiftType === 'DAY' && edge0800.shiftDate.getDate() === 24, edge0800);
  record('20:00 starts night shift', edge2000.shiftType === 'NIGHT' && edge2000.shiftDate.getDate() === 24, edge2000);

  const timeline = await request('GET', '/shift/timeline', { userId: 'test-master', factoryId });
  record('timeline exposes current next future past', timeline.status === 200 && timeline.data?.current && timeline.data?.next && timeline.data?.future?.length >= 2 && timeline.data?.past?.length >= 2, timeline.data);

  const expectedNext = addShift(currentTarget(new Date()), 1);
  const targetDate = dateOnly(expectedNext.shiftDate);
  const targetType = expectedNext.shiftType;

  const willBe = await db.shiftWillBe.findMany({
    where: { factoryId, targetShiftDate: expectedNext.shiftDate, shiftType: targetType, status: 'WILL_BE', userId: { in: ['pilot-worker-3', 'pilot-contractor-2'] } },
  });
  record('Stage47 future will-be exists for next shift', willBe.length >= 2, { count: willBe.length, targetDate, targetType });

  const peopleBefore = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
  const busyBefore = Array.isArray(peopleBefore.data) ? peopleBefore.data.filter((person) => person.employeeState !== 'OFF_SHIFT').map((person) => person.userId) : [];
  record('future will-be does not affect current busy counts', !busyBefore.includes('pilot-worker-3') && !busyBefore.includes('pilot-contractor-2'), busyBefore);

  const line = await db.line.findFirst({
    where: { factoryId, deletedAt: null, name: { contains: 'Котлеты', mode: 'insensitive' } },
    include: { staffingTemplates: { where: { isActive: true, deletedAt: null }, include: { items: { include: { position: true } } } } },
  }) ?? await db.line.findFirst({ where: { factoryId, deletedAt: null }, include: { staffingTemplates: { where: { isActive: true, deletedAt: null }, include: { items: { include: { position: true } } } } } });
  if (!line) throw new Error('line not found');
  const template = line.staffingTemplates.find((item) => item.items.some((entry) => entry.position?.isActive && !entry.position?.deletedAt));
  const position = template?.items.find((item) => item.position?.isActive && !item.position?.deletedAt)?.position
    ?? await db.linePosition.findFirst({ where: { factoryId, lineId: line.id, isActive: true, deletedAt: null } });
  if (!position) throw new Error('position not found');

  await db.plannedLineAssignment.updateMany({
    where: { factoryId, shiftDate: expectedNext.shiftDate, shiftType: targetType, userId: { in: ['pilot-worker-3', 'pilot-contractor-2'] }, releasedAt: null },
    data: { releasedAt: new Date(), releasedById: 'test-admin' },
  });

  const planning = await request('GET', `/lines/${line.id}/planning-board?shiftDate=${targetDate}&shiftType=${targetType}&staffingTemplateId=${template?.id ?? ''}`, {
    userId: 'test-master',
    factoryId,
  });
  record('planned future line has plan status instead of live work status', planning.status === 200 && planning.data?.statusLabel === 'Запланирована' && planning.data?.line?.status !== 'PAUSE' && planning.data?.line?.status !== 'STOP', planning.data);
  record('future planning candidates prefer will-be people', planning.data?.candidates?.some((candidate) => candidate.userId === 'pilot-worker-3' && candidate.willBeStatus === 'WILL_BE'), planning.data?.candidates);

  const freePlanningSlot = planning.data?.slots?.find((slot) => slot.positionId === position.id && !slot.assignment)
    ?? planning.data?.slots?.find((slot) => !slot.assignment);
  const plannedPositionId = freePlanningSlot?.positionId ?? position.id;
  const plannedSlotIndex = freePlanningSlot?.slotIndex ?? 1;
  const planned = await request('POST', `/lines/${line.id}/planning-board/assign`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: targetDate, shiftType: targetType, staffingTemplateId: template?.id ?? null, targetUserId: 'pilot-worker-3', positionId: plannedPositionId, slotIndex: plannedSlotIndex },
  });
  record('future assignment created for explicit slot', [200, 201].includes(planned.status) && planned.data?.slots?.some((slot) => slot.positionId === plannedPositionId && slot.slotIndex === plannedSlotIndex && slot.assignment?.userId === 'pilot-worker-3'), planned.data);

  const activeForFutureUser = await db.assignment.findFirst({ where: { factoryId, userId: 'pilot-worker-3', endedAt: null } });
  record('future assignment does not create current assignment', !activeForFutureUser, activeForFutureUser);

  const plannedRow = await db.plannedLineAssignment.findFirst({ where: { factoryId, shiftDate: expectedNext.shiftDate, shiftType: targetType, userId: 'pilot-worker-3', releasedAt: null } });
  record('planned assignment persisted in planned table', Boolean(plannedRow?.positionId === plannedPositionId && plannedRow.slotIndex === plannedSlotIndex), plannedRow);

  if (plannedRow) {
    const replaceDenied = await request('POST', `/lines/${line.id}/planning-board/assign`, {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: targetDate, shiftType: targetType, staffingTemplateId: template?.id ?? null, targetUserId: 'pilot-contractor-2', positionId: plannedPositionId, slotIndex: plannedSlotIndex },
    });
    record('future occupied slot requires explicit replace id', [403, 409].includes(replaceDenied.status), replaceDenied.data);

    const replaced = await request('POST', `/lines/${line.id}/planning-board/assign`, {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: targetDate, shiftType: targetType, staffingTemplateId: template?.id ?? null, targetUserId: 'pilot-contractor-2', positionId: plannedPositionId, slotIndex: plannedSlotIndex, replaceAssignmentId: plannedRow.id },
    });
    record('future occupied slot can be replaced explicitly', [200, 201].includes(replaced.status)
      && replaced.data?.slots?.some((slot) => slot.positionId === plannedPositionId && slot.slotIndex === plannedSlotIndex && slot.assignment?.userId === 'pilot-contractor-2'), replaced.data);

    const oldReleased = await db.plannedLineAssignment.findUnique({ where: { id: plannedRow.id } });
    record('future replaced user is released from old slot', Boolean(oldReleased?.releasedAt), oldReleased);

    const replacementRow = await db.plannedLineAssignment.findFirst({ where: { factoryId, shiftDate: expectedNext.shiftDate, shiftType: targetType, userId: 'pilot-contractor-2', releasedAt: null } });
    if (replacementRow) {
      const release = await request('POST', `/lines/${line.id}/planning-board/release/${replacementRow.id}`, { userId: 'test-master', factoryId, body: {} });
      const released = await db.plannedLineAssignment.findUnique({ where: { id: replacementRow.id } });
      record('future assignment release frees explicit slot', [200, 201].includes(release.status) && Boolean(released?.releasedAt), released);
    } else {
      record('future assignment release frees explicit slot', false, { replacementRow });
    }
  }

  const currentTargetUserId = 'pilot-contractor-1';
  const currentReplacementUserId = 'pilot-worker-1';
  await db.user.update({ where: { id: currentTargetUserId }, data: { employeeState: 'AVAILABLE' } });
  await db.user.update({ where: { id: currentReplacementUserId }, data: { employeeState: 'AVAILABLE' } });
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: [currentTargetUserId, currentReplacementUserId] }, endedAt: null },
    data: { endedAt: new Date(Date.now() - 10 * 60 * 1000), endedById: 'test-admin', comment: 'Stage48 cleanup before current assignment' },
  });
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: [currentTargetUserId, currentReplacementUserId] }, endedAt: { not: null } },
    data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
  });
  const currentBoardBeforeAssign = await request('GET', `/lines/${line.id}/assignment-board`, { userId: 'test-master', factoryId });
  const freeCurrentSlot = currentBoardBeforeAssign.data?.slots?.find((slot) => slot.positionId === position.id && !slot.assignment)
    ?? currentBoardBeforeAssign.data?.slots?.find((slot) => !slot.assignment);
  const currentPositionId = freeCurrentSlot?.positionId ?? position.id;
  const currentSlotIndex = freeCurrentSlot?.slotIndex ?? 2;
  const currentStaffingTemplateId = currentBoardBeforeAssign.data?.activeTemplate?.id ?? null;
  const currentAssign = await request('POST', '/assignments/line', {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: currentTargetUserId, lineId: line.id, positionId: currentPositionId, staffingTemplateId: currentStaffingTemplateId, slotIndex: currentSlotIndex },
  });
  record('current assignment created for explicit slot', [200, 201].includes(currentAssign.status) && currentAssign.data?.slotIndex === currentSlotIndex, currentAssign.data);
  if ([200, 201].includes(currentAssign.status)) {
    const replaceDenied = await request('POST', '/assignments/line', {
      userId: 'test-master',
      factoryId,
      body: { targetUserId: currentReplacementUserId, lineId: line.id, positionId: currentPositionId, staffingTemplateId: currentStaffingTemplateId, slotIndex: currentSlotIndex },
    });
    record('current occupied slot requires explicit replace id', [403, 409].includes(replaceDenied.status), replaceDenied.data);

    const replaced = await request('POST', '/assignments/line', {
      userId: 'test-master',
      factoryId,
      body: { targetUserId: currentReplacementUserId, lineId: line.id, positionId: currentPositionId, staffingTemplateId: currentStaffingTemplateId, slotIndex: currentSlotIndex, replaceAssignmentId: currentAssign.data.id },
    });
    record('current occupied slot can be replaced explicitly', [200, 201].includes(replaced.status) && replaced.data?.userId === currentReplacementUserId && replaced.data?.slotIndex === currentSlotIndex, replaced.data);

    const oldCurrentAssignment = await db.assignment.findUnique({ where: { id: currentAssign.data.id } });
    record('current replaced user is released from old slot', Boolean(oldCurrentAssignment?.endedAt), oldCurrentAssignment);

    const releaseCurrent = await request('POST', '/assignments/release', { userId: 'test-master', factoryId, body: { targetUserId: currentReplacementUserId } });
    record('current explicit slot release works', [200, 201].includes(releaseCurrent.status), releaseCurrent.data);
  } else {
    record('current explicit slot release works', false, { skippedBecauseAssignFailed: currentAssign });
  }

  const boardAfterRelease = await request('GET', `/lines/${line.id}/assignment-board`, { userId: 'test-master', factoryId });
  record('occupied slot profile data readable through board', boardAfterRelease.status === 200 && Array.isArray(boardAfterRelease.data?.slots), boardAfterRelease.data?.slots?.slice(0, 2));
  record('non-worker roles are not assignment candidates', !JSON.stringify(boardAfterRelease.data?.candidates ?? []).includes('test-okk') && !JSON.stringify(boardAfterRelease.data?.candidates ?? []).includes('test-store'), boardAfterRelease.data?.candidates);

  await db.assignment.updateMany({
    where: { factoryId, userId: { in: [currentTargetUserId, currentReplacementUserId] }, endedAt: null },
    data: { endedAt: new Date(), endedById: 'test-admin', comment: 'Stage48 cleanup after slot replacement check' },
  });
  await db.user.updateMany({
    where: { id: { in: [currentTargetUserId, currentReplacementUserId] }, factoryId },
    data: { employeeState: 'AVAILABLE' },
  });

  const workerPlanAttempt = await request('POST', `/lines/${line.id}/planning-board/assign`, {
    userId: 'worker-1',
    factoryId,
    body: { shiftDate: targetDate, shiftType: targetType, targetUserId: 'pilot-contractor-2', positionId: position.id, slotIndex: 1 },
  });
  record('worker cannot manage future assignments', workerPlanAttempt.status >= 400, workerPlanAttempt);

  await db.user.upsert({
    where: { id: 'stage48-blocked-master' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage48-blocked-master', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage48-blocked-master', factoryId } },
    update: { role: 'MASTER', isActive: true, isGuest: false },
    create: { userId: 'stage48-blocked-master', factoryId, role: 'MASTER', isActive: true, isGuest: false },
  });
  const blocked = await request('GET', '/shift/timeline', { userId: 'stage48-blocked-master', factoryId });
  record('blocked user denied', blocked.status >= 400, blocked.status);

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage48-other-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage48-other-factory', name: 'Stage48 другой завод', isActive: true },
  });
  const crossFactory = await request('GET', `/lines/${line.id}/planning-board?shiftDate=${targetDate}&shiftType=${targetType}`, { userId: 'test-admin', factoryId: otherFactory.id });
  record('cross-factory planning board denied', crossFactory.status >= 400, crossFactory.status);

  const audit = await db.auditLog.findMany({
    where: {
      factoryId,
      action: { in: ['FUTURE_LINE_ASSIGNMENT_CREATED', 'FUTURE_LINE_ASSIGNMENT_RELEASED', 'ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_RELEASED'] },
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
  });
  record(
    'planned/current assignment audit actions written',
    ['FUTURE_LINE_ASSIGNMENT_CREATED', 'FUTURE_LINE_ASSIGNMENT_RELEASED', 'ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_RELEASED']
      .every((action) => audit.some((item) => item.action === action)),
    audit.map((item) => item.action),
  );

  if (failures.length) {
    console.error('Stage48 shift timeline planning regression failed');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage48 shift timeline planning regression passed');
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
