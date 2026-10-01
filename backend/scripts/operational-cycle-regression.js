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
const state = { ok: [], failures: [] };
const stamp = Date.now();
const marker = `Operational cycle ${stamp}`;
let ownedBackend = null;
const cleanup = {
  plannedLineIds: [],
  plannedShiftIds: [],
  willBeIds: [],
  candidateUserId: null,
  candidateOriginalState: null,
  candidateHadActiveShift: false,
  createdCandidateUserId: null,
  lineId: null,
  lineOriginalStatus: null,
};

function record(name, passed, detail) {
  (passed ? state.ok : state.failures).push({ name, ...(detail ? { detail } : {}) });
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
  return { status: response.status, data, text };
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

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function currentTarget(date = new Date()) {
  const target = new Date(date);
  const hour = date.getHours();
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

function hasMojibake(value) {
  return /Р[ђЃєёЀЌўџ]|С[ЃЌЏЎ]/.test(String(value ?? ''));
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

async function loginFactoryId() {
  const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-admin' } });
  return login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
}

async function chooseCandidate(factoryId, target) {
  const preferredIds = ['pilot-worker-1', 'pilot-worker-2', 'pilot-contractor-1'];
  const excluded = new Set(['test-admin', 'test-management', 'test-master', 'test-store', 'test-okk', 'test-tech-holod', 'test-tech-kipia']);
  const accesses = await db.userFactoryAccess.findMany({
    where: {
      factoryId,
      isActive: true,
      isGuest: false,
      role: { in: ['WORKER', 'CONTRACTOR'] },
      user: {
        blockedAt: null,
        deletedAt: null,
        employeeState: 'AVAILABLE',
        assignments: { none: { factoryId, endedAt: null } },
        shiftSessions: { none: { factoryId, status: 'ACTIVE' } },
      },
    },
    include: {
      user: {
        include: {
          shiftWillBe: { where: { factoryId, targetShiftDate: target.shiftDate, shiftType: target.shiftType, status: 'WILL_BE' } },
          plannedLineAssignments: { where: { factoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null } },
          plannedShiftAssignments: { where: { factoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null } },
          shiftSessions: { where: { factoryId, status: 'ACTIVE' } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const isVisibleRuntimeCandidate = (access) =>
    !excluded.has(access.userId) &&
    !/^stage/i.test(access.userId) &&
    !/^recovery-/i.test(access.userId) &&
    !access.user.shiftWillBe.length &&
    !access.user.plannedLineAssignments.length &&
    !access.user.plannedShiftAssignments.length;
  let candidate = preferredIds
    .map((id) => accesses.find((access) => access.userId === id && isVisibleRuntimeCandidate(access)))
    .find(Boolean) ?? accesses.find(isVisibleRuntimeCandidate);
  if (!candidate) {
    const userId = `worker-${stamp}`;
    const department = await db.department.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { factoryId, code: { in: ['workers', 'worker', 'rabochie'] } },
          { factoryId, name: { contains: 'Рабоч' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    await db.user.upsert({
      where: { id: userId },
      update: { factoryId, role: 'WORKER', employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
      create: { id: userId, factoryId, role: 'WORKER', employeeState: 'AVAILABLE' },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId, factoryId } },
      update: { role: 'WORKER', departmentId: department?.id ?? null, isActive: true, isGuest: false, deactivatedAt: null, deactivationReason: null },
      create: { userId, factoryId, role: 'WORKER', departmentId: department?.id ?? null, isActive: true, isGuest: false },
    });
    candidate = await db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId, factoryId } },
      include: {
        user: {
          include: {
            shiftWillBe: { where: { factoryId, targetShiftDate: target.shiftDate, shiftType: target.shiftType, status: 'WILL_BE' } },
            plannedLineAssignments: { where: { factoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null } },
            plannedShiftAssignments: { where: { factoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null } },
            shiftSessions: { where: { factoryId, status: 'ACTIVE' } },
          },
        },
      },
    });
    cleanup.createdCandidateUserId = userId;
  }
  if (!candidate) throw new Error('safe available worker/contractor candidate not found');
  cleanup.candidateUserId = candidate.userId;
  cleanup.candidateOriginalState = candidate.user.employeeState;
  cleanup.candidateHadActiveShift = Boolean((candidate.user.shiftSessions ?? []).length);
  return candidate;
}

async function chooseLine(factoryId) {
  const line = await db.line.findFirst({
    where: {
      factoryId,
      deletedAt: null,
      status: 'WORK',
      name: { not: { startsWith: 'Stage' } },
      positions: { some: { isActive: true, deletedAt: null } },
      staffingTemplates: { some: { isActive: true, deletedAt: null } },
    },
    include: {
      positions: { where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      staffingTemplates: { where: { isActive: true, deletedAt: null }, include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } }, orderBy: { createdAt: 'asc' } },
      washSessions: { where: { status: { in: ['IN_PROGRESS', 'REVIEW'] }, deletedAt: null }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!line) throw new Error('safe WORK line with positions/templates not found');
  cleanup.lineId = line.id;
  cleanup.lineOriginalStatus = line.status;
  return line;
}

async function ageLastAssignments(userId, factoryId) {
  const safeAt = new Date(Date.now() - 10 * 60_000);
  await db.assignment.updateMany({
    where: { userId, factoryId, startedAt: { gt: safeAt } },
    data: { startedAt: safeAt },
  });
}

async function cleanupState(factoryId) {
  for (const id of cleanup.plannedLineIds) {
    await db.plannedLineAssignment.updateMany({
      where: { id, factoryId, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
  }
  for (const id of cleanup.plannedShiftIds) {
    await db.plannedShiftAssignment.updateMany({
      where: { id, factoryId, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
  }
  for (const id of cleanup.willBeIds) {
    await request('POST', '/shift/will-be/cancel', {
      userId: cleanup.candidateUserId,
      factoryId,
      body: { willBeId: id, comment: `${marker}: отмена тестовой отметки` },
    }).catch(() => undefined);
  }
  if (cleanup.candidateUserId) {
    await request('POST', '/assignments/release', { userId: 'test-master', factoryId, body: { targetUserId: cleanup.candidateUserId } }).catch(() => undefined);
    if (!cleanup.candidateHadActiveShift) {
      await db.shiftSession.updateMany({
        where: { factoryId, userId: cleanup.candidateUserId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date(), endedById: cleanup.candidateUserId },
      });
    }
    await db.user.updateMany({
      where: { id: cleanup.candidateUserId },
      data: { employeeState: cleanup.candidateOriginalState ?? 'AVAILABLE', blockedAt: null, deletedAt: null },
    });
    if (cleanup.createdCandidateUserId) {
      await db.userFactoryAccess.updateMany({
        where: { userId: cleanup.createdCandidateUserId, factoryId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: 'test-admin',
          deactivationReason: `${marker}: тестовый сотрудник цикла деактивирован после проверки`,
        },
      });
      await db.user.updateMany({
        where: { id: cleanup.createdCandidateUserId },
        data: { employeeState: 'AVAILABLE', blockedAt: null, deletedAt: new Date() },
      });
    }
  }
  if (cleanup.lineId) {
    await request('PATCH', `/lines/${cleanup.lineId}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: cleanup.lineOriginalStatus ?? 'WORK', comment: `${marker}: восстановление состояния линии после regression` },
    }).catch(() => undefined);
  }
}

async function main() {
  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for operational cycle regression');
  }

  const factoryId = await loginFactoryId();
  if (!factoryId) throw new Error('factory context not found');

  const next = addShift(currentTarget(), 1);
  const targetDate = dateOnly(next.shiftDate);
  const candidate = await chooseCandidate(factoryId, next);
  const line = await chooseLine(factoryId);
  const template = line.staffingTemplates[0];
  const position = template.items[0]?.position ?? line.positions[0];
  if (!position) throw new Error('line position not found');

  try {
    const willBe = await request('POST', '/shift/will-be', {
      userId: candidate.userId,
      factoryId,
      body: { targetShiftDate: targetDate, shiftType: next.shiftType, comment: `${marker}: буду на смене` },
    });
    if (willBe.data?.id) cleanup.willBeIds.push(willBe.data.id);
    record('worker marks will-be for next shift', willBe.status === 201 && willBe.data?.userId === candidate.userId, willBe.data);

    const future = await request('GET', `/shift/future?targetShiftDate=${targetDate}&shiftType=${next.shiftType}`, { userId: 'test-master', factoryId });
    record('master sees will-be worker in next shift', future.status === 200 && future.data?.willBe?.some((item) => item.userId === candidate.userId && item.status === 'WILL_BE'), future.data?.willBe);

    const planning = await request('GET', `/lines/${line.id}/planning-board?shiftDate=${targetDate}&shiftType=${next.shiftType}&staffingTemplateId=${template.id}`, {
      userId: 'test-master',
      factoryId,
    });
    const slot = planning.data?.slots?.find((item) => !item.assignment) ?? planning.data?.slots?.[0];
    record('line planning board exposes explicit future slots', planning.status === 200 && slot?.positionId && slot?.slotIndex, slot);

    const planned = await request('POST', `/lines/${line.id}/planning-board/assign`, {
      userId: 'test-master',
      factoryId,
      body: {
        shiftDate: targetDate,
        shiftType: next.shiftType,
        staffingTemplateId: template.id,
        targetUserId: candidate.userId,
        positionId: slot.positionId,
        slotIndex: slot.slotIndex,
      },
    });
    const plannedRow = await db.plannedLineAssignment.findFirst({
      where: { factoryId, shiftDate: next.shiftDate, shiftType: next.shiftType, userId: candidate.userId, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (plannedRow) cleanup.plannedLineIds.push(plannedRow.id);
    record('future line assignment persists for exact slot', [200, 201].includes(planned.status) && plannedRow?.positionId === slot.positionId && plannedRow?.slotIndex === slot.slotIndex, { status: planned.status, plannedRow });

    const doubleNonLine = await request('POST', '/shift/future-assignments', {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: targetDate, shiftType: next.shiftType, targetUserId: candidate.userId, kind: 'TIME', timeRoleName: 'Повременщики' },
    });
    record('double future planning line plus non-line is rejected', doubleNonLine.status === 409, { status: doubleNonLine.status, data: doubleNonLine.data });

    const activeFromFuture = await db.assignment.findFirst({ where: { factoryId, userId: candidate.userId, endedAt: null } });
    record('future plan does not create live assignment', !activeFromFuture, activeFromFuture);

    if (plannedRow) {
      const releasePlan = await request('POST', `/lines/${line.id}/planning-board/release/${plannedRow.id}`, { userId: 'test-master', factoryId, body: {} });
      record('future line plan can be released safely', [200, 201].includes(releasePlan.status), releasePlan.data);
    }

    const nonLine = await request('POST', '/shift/future-assignments', {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: targetDate, shiftType: next.shiftType, targetUserId: candidate.userId, kind: 'TIME', timeRoleName: 'Повременщики' },
    });
    const nonLineRow = await db.plannedShiftAssignment.findFirst({
      where: { factoryId, shiftDate: next.shiftDate, shiftType: next.shiftType, userId: candidate.userId, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (nonLineRow) cleanup.plannedShiftIds.push(nonLineRow.id);
    record('future non-line plan can be created after line plan release', [200, 201].includes(nonLine.status) && nonLineRow?.kind === 'TIME', { status: nonLine.status, nonLineRow });

    const doubleLine = await request('POST', `/lines/${line.id}/planning-board/assign`, {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: targetDate, shiftType: next.shiftType, targetUserId: candidate.userId, positionId: position.id, slotIndex: 1 },
    });
    record('double future planning non-line plus line is rejected', doubleLine.status === 409, { status: doubleLine.status, data: doubleLine.data });
    if (nonLineRow) await request('POST', `/shift/future-assignments/${nonLineRow.id}/release`, { userId: 'test-master', factoryId, body: {} });

    await ageLastAssignments(candidate.userId, factoryId);
    const activate = await request('POST', `/lines/${line.id}/activate-for-shift`, {
      userId: 'test-master',
      factoryId,
      body: { staffingTemplateId: template.id },
    });
    record('line can be activated for current shift without applying future plan', [200, 201, 409].includes(activate.status), { status: activate.status });

    const peopleBefore = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
    const beforeWorking = peopleBefore.data?.filter((person) => person.currentAssignment).length ?? 0;
    const assign = await request('POST', '/assignments/line', {
      userId: 'test-master',
      factoryId,
      body: { targetUserId: candidate.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id, slotIndex: 1 },
    });
    record('current line assignment uses explicit slot', assign.status === 201 && assign.data?.slotIndex === 1, assign.data);

    const peopleAfterAssign = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
    const afterWorking = peopleAfterAssign.data?.filter((person) => person.currentAssignment).length ?? 0;
    record('working/free counters update after assignment reload', afterWorking === beforeWorking + 1 && peopleAfterAssign.data?.some((person) => person.userId === candidate.userId && person.currentAssignment?.lineId === line.id), { beforeWorking, afterWorking });

    const release = await request('POST', '/assignments/release', { userId: 'test-master', factoryId, body: { targetUserId: candidate.userId } });
    record('current assignment release succeeds', release.status === 201, release.data);

    const rapid = await request('POST', '/assignments/line', {
      userId: 'test-master',
      factoryId,
      body: { targetUserId: candidate.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id, slotIndex: 1 },
    });
    record('5-minute assignment guard rejects rapid reassignment', rapid.status === 409 && !hasMojibake(rapid.text), { status: rapid.status, data: rapid.data });

    await ageLastAssignments(candidate.userId, factoryId);
    const reassign = await request('POST', '/assignments/line', {
      userId: 'test-master',
      factoryId,
      body: { targetUserId: candidate.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id, slotIndex: 1 },
    });
    record('assignment after guard interval succeeds', reassign.status === 201, reassign.data);

    const sendHome = await request('POST', '/shift/send-home', { userId: 'test-master', factoryId, body: { targetUserId: candidate.userId, comment: `${marker}: домой после проверки` } });
    record('master sends worker home with comment', sendHome.status === 201 && sendHome.data?.state === 'OFF_SHIFT', sendHome.data);

    const selfStartDenied = await request('POST', '/shift/start', { userId: candidate.userId, factoryId, body: {} });
    record('sent-home worker cannot self-enter without return approval', selfStartDenied.status === 409 && /запрос|подтверждение|мастер/i.test(JSON.stringify(selfStartDenied.data)) && !hasMojibake(selfStartDenied.text), { status: selfStartDenied.status, data: selfStartDenied.data });

    const returnRequest = await request('POST', '/shift/return-request', { userId: candidate.userId, factoryId, body: { reason: `${marker}: вернуться после проверки` } });
    record('sent-home worker can request return', returnRequest.status === 201, returnRequest.data);

    const returnApprove = await request('PATCH', `/shift/return-requests/${returnRequest.data?.id}`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'APPROVED', decisionComment: `${marker}: approve` },
    });
    record('master approves return request', returnApprove.status === 200, returnApprove.data);

    const selfStart = await request('POST', '/shift/start', { userId: candidate.userId, factoryId, body: {} });
    record('worker can start shift after return approval', [200, 201].includes(selfStart.status), { status: selfStart.status, data: selfStart.data });
    if ([200, 201, 409].includes(selfStart.status)) {
      await request('POST', '/shift/end', { userId: candidate.userId, factoryId, body: {} }).catch(() => undefined);
    }

    const washBefore = await db.washSession.count({ where: { factoryId, lineId: line.id, deletedAt: null } });
    const stop = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'STOP', downtimeReason: 'TECHNICAL', comment: `${marker}: техническая остановка` },
    });
    const repeatStop = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'STOP', downtimeReason: 'TECHNICAL', comment: `${marker}: повторная остановка` },
    });
    const openDowntime = await db.lineEvent.findMany({
      where: { factoryId, lineId: line.id, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null },
      orderBy: { createdAt: 'desc' },
    });
    record('STOP creates exactly one open downtime and repeat STOP is idempotent', stop.status === 200 && repeatStop.status === 200 && repeatStop.data?.id === stop.data?.id && openDowntime.length === 1 && openDowntime[0].id === stop.data?.id, { stop: stop.data, repeatStop: repeatStop.data, openCount: openDowntime.length });

    const lineListStopped = await request('GET', '/lines', { userId: 'test-master', factoryId });
    const stoppedLine = lineListStopped.data?.find((item) => item.id === line.id);
    record('stopped line is not active WORK after reload', stoppedLine?.status === 'STOP' && stoppedLine?.activeDowntimeEvent?.id === stop.data?.id, stoppedLine);

    const techMe = await request('GET', '/auth/me', { userId: 'test-tech-holod', factoryId });
    const recipientDepartmentId = techMe.data?.departmentId;
    const task = await request('POST', '/tasks', {
      userId: 'test-master',
      factoryId,
      body: {
        lineId: line.id,
        lineStatusEventId: stop.data?.id,
        operationId: `operational-cycle-task-${stamp}`,
        type: 'URGENT',
        description: `${marker}: срочная заявка из простоя`,
        departmentRecipientIds: [recipientDepartmentId],
      },
    });
    record('URGENT task from downtime keeps line and line event relation', task.status === 201 && task.data?.lineId === line.id && task.data?.lineStatusEventId === stop.data?.id, task.data);

    const wrongDepartmentTake = await request('POST', `/tasks/${task.data?.id}/take`, { userId: 'test-store', factoryId, body: { operationId: `operational-cycle-wrong-take-${stamp}` } });
    record('wrong department cannot take downtime task', wrongDepartmentTake.status === 403, { status: wrongDepartmentTake.status, data: wrongDepartmentTake.data });

    const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, isActive: true, deletedAt: null } })
      ?? await db.factory.upsert({
        where: { code: 'operational-cycle-other-factory' },
        update: { isActive: true, deletedAt: null },
        create: { code: 'operational-cycle-other-factory', name: 'Operational cycle other factory', isActive: true },
      });
    const crossFactoryTake = await request('POST', `/tasks/${task.data?.id}/take`, { userId: 'test-admin', factoryId: otherFactory.id, body: { operationId: `operational-cycle-cross-take-${stamp}` } });
    record('cross-factory user cannot change downtime task', [403, 409].includes(crossFactoryTake.status), { status: crossFactoryTake.status, data: crossFactoryTake.data });

    const take = await request('POST', `/tasks/${task.data?.id}/take`, { userId: 'test-tech-holod', factoryId, body: { operationId: `operational-cycle-take-${stamp}` } });
    record('allowed technical department takes task', take.status === 201 && take.data?.status === 'IN_PROGRESS' && take.data?.startedAt, take.data);

    const complete = await request('POST', `/tasks/${task.data?.id}/complete`, { userId: 'test-tech-holod', factoryId, body: { operationId: `operational-cycle-done-${stamp}`, comment: `${marker}: выполнено` } });
    record('allowed technical department completes task', complete.status === 201 && complete.data?.status === 'DONE' && complete.data?.doneAt, complete.data);

    const work = await request('PATCH', `/lines/${line.id}/status`, {
      userId: 'test-master',
      factoryId,
      body: { status: 'WORK', comment: `${marker}: линия восстановлена` },
    });
    const closedEvent = await db.lineEvent.findUnique({ where: { id: stop.data?.id } });
    const washAfter = await db.washSession.count({ where: { factoryId, lineId: line.id, deletedAt: null } });
    record('WORK closes exactly the open downtime and does not start wash', work.status === 200 && Boolean(closedEvent?.confirmedEndAt) && washAfter === washBefore, { work: work.data, closedEvent, washBefore, washAfter });

    const dashboard = await request('GET', `/lines/${line.id}/dashboard`, { userId: 'test-master', factoryId });
    record('line history shows downtime and linked task after restore', dashboard.status === 200 && dashboard.data?.recentEvents?.some((event) => event.id === stop.data?.id && event.confirmedEndAt && event.linkedTasks?.some((item) => item.id === task.data?.id)), { events: dashboard.data?.recentEvents?.slice(0, 3), tasks: dashboard.data?.activeTasks });

    const unlinkedTask = await request('POST', '/tasks', {
      userId: 'test-master',
      factoryId,
      body: {
        lineId: line.id,
        operationId: `operational-cycle-unlinked-${stamp}`,
        type: 'URGENT',
        description: `${marker}: заявка без связи с событием`,
        departmentRecipientIds: [recipientDepartmentId],
      },
    });
    const ops = await request('GET', `/ops/operations/downtimes?dateFrom=${dateOnly(new Date(Date.now() - 86_400_000))}&dateTo=${dateOnly(new Date(Date.now() + 86_400_000))}`, { userId: 'test-management', factoryId });
    const linkedText = JSON.stringify(ops.data ?? {});
    record('task without lineStatusEvent is not counted as downtime-linked task', unlinkedTask.status === 201 && linkedText.includes(task.data?.id) && !linkedText.includes(unlinkedTask.data?.id), { linkedTaskId: task.data?.id, unlinkedTaskId: unlinkedTask.data?.id, downtimes: ops.data?.items?.slice?.(0, 3) });

    const activeAssignmentsAfter = await db.assignment.findMany({ where: { factoryId, userId: candidate.userId, endedAt: null } });
    const futureStillSeparate = await db.plannedLineAssignment.count({ where: { factoryId, shiftDate: next.shiftDate, shiftType: next.shiftType, userId: candidate.userId, releasedAt: null } });
    record('ended shift/assignment state does not pollute next shift', activeAssignmentsAfter.length === 0 && futureStillSeparate === 0, { activeAssignmentsAfter: activeAssignmentsAfter.length, futureStillSeparate });

    const audit = await db.auditLog.findMany({
      where: {
        factoryId,
        createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
        action: { in: ['SHIFT_WILL_BE_MARKED', 'FUTURE_LINE_ASSIGNMENT_CREATED', 'FUTURE_SHIFT_ASSIGNMENT_CREATED', 'ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_RELEASED', 'EMPLOYEE_SENT_HOME', 'SHIFT_RETURN_REQUESTED', 'SHIFT_RETURN_APPROVED', 'LINE_STATUS_UPDATED', 'TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE'] },
      },
      select: { action: true },
    });
    for (const action of ['SHIFT_WILL_BE_MARKED', 'FUTURE_LINE_ASSIGNMENT_CREATED', 'FUTURE_SHIFT_ASSIGNMENT_CREATED', 'ASSIGNMENT_LINE_CREATED', 'EMPLOYEE_SENT_HOME', 'SHIFT_RETURN_REQUESTED', 'SHIFT_RETURN_APPROVED', 'LINE_STATUS_UPDATED', 'TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE']) {
      record(`audit action ${action}`, audit.some((item) => item.action === action), { actions: audit.map((item) => item.action) });
    }

    record('API payloads do not expose secrets', !hasSecret({ future, planning, peopleAfterAssign, task, complete, dashboard, ops }));
  } finally {
    await cleanupState(factoryId);
  }

  if (state.failures.length) {
    console.error('Operational cycle regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Operational cycle regression passed');
  }
  console.log(JSON.stringify({ api: API, factoryId, lineId: line.id, candidateUserId: candidate.userId, ok: state.ok.length, failures: state.failures.length }, null, 2));
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
