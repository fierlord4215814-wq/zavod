const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, 'backend', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const passed = [];
const failed = [];
let ownedBackend = null;

function check(name, condition, detail) {
  (condition ? passed : failed).push({ name, ...(condition || detail === undefined ? {} : { detail: sanitize(detail) }) });
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => /password|token|secret|DATABASE_URL|storagePath|normalizedPhone|phone$/i.test(key) ? '[hidden]' : item));
}

async function request(method, pathname, { userId = 'test-master', factoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function reachable() {
  try { return (await fetch(`${API}/health`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

async function waitForBackend() {
  for (let index = 0; index < 120; index += 1) {
    if (await reachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], { cwd: root, shell: true, windowsHide: true, stdio: 'ignore' });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotPack() {
  const run = spawnSync('npm.cmd run pilot-pack:v1 --workspace backend', [], { cwd: root, shell: true, windowsHide: true, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || 'pilot-pack failed');
}

async function search(factoryId, q, options = {}) {
  const params = new URLSearchParams({ q, mode: options.mode ?? 'ASSIGNMENT' });
  if (options.context) params.set('context', options.context);
  if (options.shiftDate) params.set('shiftDate', options.shiftDate);
  if (options.shiftType) params.set('shiftType', options.shiftType);
  return request('GET', `/people/search?${params}`, { userId: options.userId ?? 'test-master', factoryId });
}

async function findFreeCurrentSlot(factoryId) {
  const lines = await request('GET', '/lines', { userId: 'test-master', factoryId });
  for (const line of lines.data ?? []) {
    const board = await request('GET', `/lines/${line.id}/assignment-board`, { userId: 'test-master', factoryId });
    const slot = board.data?.slots?.find((item) => !item.assignment);
    if (slot) return { line, board: board.data, slot };
  }
  return null;
}

async function cleanupCurrent(factoryId, userId, hadSession) {
  const assignment = await db.assignment.findFirst({ where: { factoryId, userId, endedAt: null } });
  if (assignment) await request('POST', '/assignments/release', { userId: 'test-master', factoryId, body: { targetUserId: userId } });
  if (!hadSession) {
    const session = await db.shiftSession.findFirst({ where: { factoryId, userId, status: 'ACTIVE' } });
    if (session) await request('POST', '/shift/end', { userId, factoryId, body: {} });
  }
}

async function main() {
  runPilotPack();
  if (!(await reachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-master' } });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');
  const peopleServiceSource = fs.readFileSync(path.join(root, 'backend', 'src', 'modules', 'people', 'people.service.ts'), 'utf8');
  const employeeServiceSource = fs.readFileSync(path.join(root, 'backend', 'src', 'modules', 'employee', 'employee.service.ts'), 'utf8');

  const tooShort = await search(factoryId, 'a');
  check('short query returns no broad list', tooShort.status === 200 && tooShort.data?.queryAccepted === false && tooShort.data?.results?.length === 0, tooShort);

  const surname = await search(factoryId, 'беля', { mode: 'PEOPLE_DIRECTORY', userId: 'test-admin' });
  check('partial surname search works', surname.status === 200 && surname.data?.results?.some((item) => /Беляев/i.test(item.displayName)), surname);
  const firstName = await search(factoryId, 'работник', { mode: 'PEOPLE_DIRECTORY', userId: 'test-admin' });
  check('partial name search works', firstName.status === 200 && firstName.data?.results?.length > 0, firstName);
  const caseInsensitive = await search(factoryId, 'РАБОТНИК');
  check('name search is case-insensitive', caseInsensitive.status === 200 && caseInsensitive.data?.results?.length > 0, caseInsensitive);
  const yoNormalized = await search(factoryId, 'наемный');
  check('е matches ё in names', yoNormalized.status === 200 && yoNormalized.data?.results?.some((item) => /наём/i.test(item.displayName)), yoNormalized);

  const phone = await search(factoryId, '9012');
  const source = phone.data?.results?.find((item) => item.userId === 'pilot-pack-worker-source');
  check('partial normalized phone finds scoped employee', phone.status === 200 && source, phone);
  const formattedPhone = await search(factoryId, '+7 (900) 000-90-12');
  check('formatted phone is normalized', formattedPhone.status === 200 && formattedPhone.data?.results?.some((item) => item.userId === 'pilot-pack-worker-source'), formattedPhone);
  check('result limit is 20', (phone.data?.results?.length ?? 99) <= 20, phone.data?.results?.length);
  check('current factory scope is enforced', await db.userFactoryAccess.count({ where: { factoryId, isActive: true, userId: { in: (phone.data?.results ?? []).map((item) => item.userId) } } }) === (phone.data?.results?.length ?? 0), phone.data?.results);
  check('full phone is hidden from master', !JSON.stringify(phone.data).includes('+79000009012'), source);
  check('masked phone is returned safely', source?.phoneLabel === '+7 ••• •••-90-12', source);
  check('search endpoint returns safe DTO only', (phone.data?.results ?? []).every((item) => Object.keys(item).every((key) => ['userId', 'displayName', 'role', 'roleLabel', 'departmentName', 'phoneLabel', 'matchedByPhone', 'presenceStatus', 'assignmentStatus', 'currentAssignmentSummary', 'canAssign', 'requiresManualAdd', 'selfConfirmed', 'reasonCode', 'reason'].includes(key))), phone.data);
  check('phone password token and storage path do not leak', !/passwordHash|storagePath|DATABASE_URL|permissionOverrides|factoryAccess|normalizedPhone|"phone"|token|secret/i.test(JSON.stringify(phone.data)), phone.data);
  check('non-assignable roles excluded from assignment search', !(phone.data?.results ?? []).some((item) => !['WORKER', 'CONTRACTOR'].includes(item.role)), phone.data?.results);
  check('existing assignable helper is reused', /isAssignableEmployeeRole/.test(peopleServiceSource) && /isAssignableEmployeeRole/.test(employeeServiceSource));
  check('blocked users are excluded by canonical query', /blockedAt:\s*null/.test(peopleServiceSource));
  check('deleted and deactivated users are excluded by canonical query', /deletedAt:\s*null/.test(peopleServiceSource) && /deactivatedAt:\s*null/.test(peopleServiceSource));
  check('diagnostic users are excluded from ordinary search', /isPilotFixtureUser/.test(peopleServiceSource));

  const workerDenied = await search(factoryId, '9012', { userId: 'pilot-worker-1' });
  check('ordinary worker cannot use assignment search', workerDenied.status === 403, workerDenied);
  const workerDirectory = await search(factoryId, 'работник', { mode: 'PEOPLE_DIRECTORY', userId: 'pilot-worker-1' });
  check('directory search does not grant broad scope', workerDirectory.status === 200 && (workerDirectory.data?.results ?? []).every((item) => item.userId === 'pilot-worker-1'), workerDirectory);
  check('people search does not grant assignment permission', workerDirectory.status === 200 && (workerDirectory.data?.results ?? []).every((item) => item.canAssign === false), workerDirectory);

  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, isActive: true } });
  if (otherFactory) {
    const crossFactory = await search(otherFactory.id, '9012', { userId: 'test-admin' });
    check('cross-factory employee cannot be enumerated', crossFactory.status === 200 && !(crossFactory.data?.results ?? []).some((item) => item.userId === 'pilot-pack-worker-source'), crossFactory);
  } else {
    check('cross-factory employee cannot be enumerated', true);
  }

  const masterAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-master', factoryId } } });
  const managementDirectory = await search(factoryId, '9012', { mode: 'PEOPLE_DIRECTORY', userId: 'test-management' });
  check('management directory department scope is preserved', managementDirectory.status === 200 && (managementDirectory.data?.results ?? []).every((item) => !masterAccess?.departmentId || item.departmentName !== 'Мастера' || item.userId === 'test-management'), managementDirectory);
  const adminDirectory = await search(factoryId, '9012', { mode: 'PEOPLE_DIRECTORY', userId: 'test-admin' });
  check('management and admin scope remains distinct', adminDirectory.status === 200 && adminDirectory.data?.results?.some((item) => item.userId === 'pilot-pack-worker-source'), adminDirectory);
  check('people directory finds employee outside local list filters', surname.status === 200 && surname.data?.results?.some((item) => /Беляев/i.test(item.displayName)), surname);

  const inaccessibleFactory = await db.factory.findFirst({
    where: { id: { not: factoryId }, isActive: true, userAccess: { none: { userId: 'test-master', isActive: true, deactivatedAt: null } } },
  });
  if (inaccessibleFactory) {
    const deniedFactory = await search(inaccessibleFactory.id, '9012');
    check('factory access removal before submit is denied', deniedFactory.status === 403, deniedFactory);
  } else {
    check('factory access removal before submit is denied', /selectedFactoryId/.test(peopleServiceSource));
  }

  const { factoryShiftTarget, factoryShiftWindow } = require('../dist/common/shift-time');
  const boundaries = [
    ['2026-07-15T04:59:59Z', 'NIGHT', '2026-07-14'],
    ['2026-07-15T05:00:00Z', 'DAY', '2026-07-15'],
    ['2026-07-15T16:59:59Z', 'DAY', '2026-07-15'],
    ['2026-07-15T17:00:00Z', 'NIGHT', '2026-07-15'],
    ['2026-07-15T21:00:00Z', 'NIGHT', '2026-07-15'],
  ];
  check('factory shift-time boundaries drive search and manual add', boundaries.every(([iso, type, date]) => {
    const target = factoryShiftTarget(new Date(iso));
    return target.shiftType === type && target.shiftDate === date && factoryShiftWindow(target).from < factoryShiftWindow(target).to;
  }));
  check('night shift after midnight keeps its start date', factoryShiftTarget(new Date('2026-07-15T21:00:00Z')).shiftDate === '2026-07-15' && factoryShiftTarget(new Date('2026-07-15T21:00:00Z')).shiftType === 'NIGHT');
  check('no-show handling does not invent a parallel search lifecycle', !/reasonCode:\s*['"]NO_SHOW/.test(peopleServiceSource));

  const broadCurrent = await search(factoryId, '9000');
  const currentSource = broadCurrent.data?.results?.find((item) => item.canAssign && item.requiresManualAdd && item.userId !== 'pilot-pack-contractor-source');
  if (!currentSource) throw new Error('manual assignment diagnostic source is not available');
  check('current shift unmarked employee is found', currentSource.presenceStatus === 'Не отмечен на смене' && currentSource.requiresManualAdd === true, currentSource);
  const slotFixture = await findFreeCurrentSlot(factoryId);
  if (!slotFixture) throw new Error('free current slot not found');
  const hadSession = Boolean(await db.shiftSession.findFirst({ where: { factoryId, userId: currentSource.userId, status: 'ACTIVE' } }));
  const currentOperation = `people-manual-current-${Date.now()}`;
  const currentStartedAt = new Date();
  const notificationsBefore = await db.notification.count({ where: { factoryId, userId: currentSource.userId, createdAt: { gte: currentStartedAt } } });
  const currentBody = {
    targetUserId: currentSource.userId,
    lineId: slotFixture.line.id,
    positionId: slotFixture.slot.positionId,
    slotIndex: slotFixture.slot.slotIndex,
    staffingTemplateId: slotFixture.board.activeTemplate?.id ?? null,
    manualAdd: currentSource.requiresManualAdd,
    expectedShiftDate: broadCurrent.data.context.shiftDate,
    expectedShiftType: broadCurrent.data.context.shiftType,
    operationId: currentOperation,
  };
  const [currentA, currentB] = await Promise.all([
    request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: currentBody }),
    request('POST', '/assignments/line', { userId: 'test-admin', factoryId, body: currentBody }),
  ]);
  const liveAssignments = await db.assignment.findMany({ where: { factoryId, userId: currentSource.userId, endedAt: null } });
  const liveSessions = await db.shiftSession.findMany({ where: { factoryId, userId: currentSource.userId, status: 'ACTIVE' } });
  const canonicalCurrent = [currentA, currentB].find((item) => [200, 201].includes(item.status));
  const currentRetry = await request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: currentBody });
  check('atomic current shift add and assignment succeeds once', [currentA.status, currentB.status].filter((status) => [200, 201].includes(status)).length === 1 && [currentA.status, currentB.status].some((status) => status === 409) && liveAssignments.length === 1 && liveSessions.length === 1, { currentA, currentB, assignments: liveAssignments.length, sessions: liveSessions.length });
  check('double submit remains idempotent', [200, 201].includes(currentRetry.status) && currentRetry.data?.id === canonicalCurrent?.data?.id && liveAssignments.length === 1, { currentA: currentA.status, currentB: currentB.status, retry: currentRetry.status });
  check('two masters cannot double-assign one employee', [currentA.status, currentB.status].some((status) => status === 409) && liveAssignments.length === 1, { assignmentId: canonicalCurrent?.data?.id });
  const audit = await db.auditLog.findFirst({ where: { factoryId, action: 'SHIFT_MANUAL_ADD_AND_ASSIGN', entityId: liveSessions[0]?.id }, orderBy: { createdAt: 'desc' } });
  check('manual add audit stores actor shift target and operation without phone', audit?.userId === 'test-master' && audit?.details && JSON.stringify(audit.details).includes(currentOperation) && !/phone/i.test(JSON.stringify(audit.details)), audit);
  check('audit actor and time are correct', ['test-master', 'test-admin'].includes(audit?.userId) && audit?.createdAt >= currentStartedAt, audit);
  const auditUi = await request('GET', '/ops/audit?action=SHIFT_MANUAL_ADD_AND_ASSIGN&limit=10', { userId: 'test-admin', factoryId });
  check('manual assignment audit has a human Russian label', auditUi.status === 200 && auditUi.data?.some((item) => item.action === 'SHIFT_MANUAL_ADD_AND_ASSIGN' && item.actionLabel === 'Мастер добавил сотрудника в смену и назначил'), auditUi);
  const notificationsAfter = await db.notification.count({ where: { factoryId, userId: currentSource.userId, createdAt: { gte: currentStartedAt } } });
  check('manual retry creates no duplicate notification', notificationsAfter - notificationsBefore <= 1, { notificationsBefore, notificationsAfter });
  const afterCurrent = await search(factoryId, '9000');
  const assignedResult = afterCurrent.data?.results?.find((item) => item.userId === currentSource.userId);
  check('already assigned employee is returned disabled with location', assignedResult?.canAssign === false && assignedResult?.reasonCode === 'ALREADY_ASSIGNED' && assignedResult?.currentAssignmentSummary, assignedResult);
  const downgradedSubmit = await request('POST', '/assignments/line', { userId: 'pilot-worker-1', factoryId, body: { ...currentBody, operationId: `people-manual-role-denied-${Date.now()}` } });
  check('role downgrade before submit is denied', downgradedSubmit.status === 403, downgradedSubmit);

  const sentHome = await request('POST', '/shift/send-home', { userId: 'test-master', factoryId, body: { targetUserId: currentSource.userId, comment: `People search guard ${Date.now()}` } });
  const sentHomeSubmit = await request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: { ...currentBody, operationId: `people-manual-sent-home-${Date.now()}` } });
  check('sent-home employee cannot bypass return lifecycle', sentHome.status === 201 && sentHomeSubmit.status === 409 && /возврат|домой/i.test(JSON.stringify(sentHomeSubmit.data)), { sentHome: sentHome.status, submit: sentHomeSubmit });
  const returnRequest = await request('POST', '/shift/return-request', { userId: currentSource.userId, factoryId, body: { reason: `People search regression return ${Date.now()}` } });
  const returnApprove = returnRequest.data?.id
    ? await request('PATCH', `/shift/return-requests/${returnRequest.data.id}`, { userId: 'test-master', factoryId, body: { status: 'APPROVED', decisionComment: 'Возврат после проверки поиска' } })
    : { status: 0, data: null };
  check('sent-home regression restores employee through master flow', returnRequest.status === 201 && returnApprove.status === 200, { returnRequest: returnRequest.status, returnApprove: returnApprove.status });
  await cleanupCurrent(factoryId, currentSource.userId, hadSession);

  const rollbackTarget = broadCurrent.data?.results?.find((item) => item.canAssign && item.requiresManualAdd && item.userId !== currentSource.userId && item.userId !== 'pilot-pack-contractor-source');
  if (rollbackTarget) {
    const sessionsBefore = await db.shiftSession.count({ where: { factoryId, userId: rollbackTarget.userId, status: 'ACTIVE' } });
    const rejected = await request('POST', '/assignments/line', {
      userId: 'test-master', factoryId, body: { ...currentBody, targetUserId: rollbackTarget.userId, positionId: 'missing-position', operationId: `people-manual-rollback-${Date.now()}` },
    });
    const sessionsAfter = await db.shiftSession.count({ where: { factoryId, userId: rollbackTarget.userId, status: 'ACTIVE' } });
    check('failed assignment rolls back attendance part', [400, 409].includes(rejected.status) && sessionsAfter === sessionsBefore, { rejected, sessionsBefore, sessionsAfter });
  }

  const raceSearch = await search(factoryId, '9000');
  const raceCandidates = (raceSearch.data?.results ?? []).filter((item) => item.canAssign && item.requiresManualAdd && item.userId !== currentSource.userId).slice(0, 2);
  const raceSlot = await findFreeCurrentSlot(factoryId);
  if (raceCandidates.length === 2 && raceSlot) {
    const raceSessionState = await Promise.all(raceCandidates.map(async (item) => ({
      userId: item.userId,
      hadSession: Boolean(await db.shiftSession.findFirst({ where: { factoryId, userId: item.userId, status: 'ACTIVE' } })),
    })));
    const raceBase = {
      lineId: raceSlot.line.id,
      positionId: raceSlot.slot.positionId,
      slotIndex: raceSlot.slot.slotIndex,
      staffingTemplateId: raceSlot.board.activeTemplate?.id ?? null,
      manualAdd: true,
      expectedShiftDate: raceSearch.data.context.shiftDate,
      expectedShiftType: raceSearch.data.context.shiftType,
    };
    const [slotA, slotB] = await Promise.all([
      request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: { ...raceBase, targetUserId: raceCandidates[0].userId, operationId: `people-slot-a-${Date.now()}` } }),
      request('POST', '/assignments/line', { userId: 'test-admin', factoryId, body: { ...raceBase, targetUserId: raceCandidates[1].userId, operationId: `people-slot-b-${Date.now()}` } }),
    ]);
    const occupied = await db.assignment.findMany({
      where: { factoryId, lineId: raceSlot.line.id, positionId: raceSlot.slot.positionId, slotIndex: raceSlot.slot.slotIndex, endedAt: null },
    });
    check('two users cannot occupy one slot', [slotA.status, slotB.status].filter((status) => [200, 201].includes(status)).length === 1 && occupied.length === 1 && [slotA.status, slotB.status].some((status) => status === 409), { slotA: slotA.status, slotB: slotB.status, occupied: occupied.length });
    for (const state of raceSessionState) await cleanupCurrent(factoryId, state.userId, state.hadSession);
  } else {
    check('two users cannot occupy one slot', false, { candidates: raceCandidates.length, hasSlot: Boolean(raceSlot) });
  }

  const timeline = await request('GET', '/shift/timeline', { userId: 'test-master', factoryId });
  const next = timeline.data?.next;
  const future = await search(factoryId, '9012', { context: 'FUTURE', shiftDate: next.shiftDate, shiftType: next.shiftType });
  const futureCandidate = future.data?.results?.find((item) => item.canAssign && item.selfConfirmed === false);
  check('future employee without self-confirmation is found', future.status === 200 && futureCandidate, future);
  if (futureCandidate) {
    const lines = await request('GET', '/lines', { userId: 'test-master', factoryId });
    let futureSlot = null;
    for (const line of lines.data ?? []) {
      const board = await request('GET', `/lines/${line.id}/planning-board?${new URLSearchParams({ shiftDate: next.shiftDate, shiftType: next.shiftType })}`, { userId: 'test-master', factoryId });
      const slot = board.data?.slots?.find((item) => !item.assignment);
      if (slot) { futureSlot = { line, board: board.data, slot }; break; }
    }
    if (!futureSlot) throw new Error('free future slot not found');
    const willBeBefore = await db.shiftWillBe.count({ where: { factoryId, userId: futureCandidate.userId, targetShiftDate: new Date(`${next.shiftDate}T00:00:00+03:00`), shiftType: next.shiftType, status: 'WILL_BE' } });
    const operationId = `people-manual-future-${Date.now()}`;
    const body = { shiftDate: next.shiftDate, shiftType: next.shiftType, targetUserId: futureCandidate.userId, positionId: futureSlot.slot.positionId, slotIndex: futureSlot.slot.slotIndex, staffingTemplateId: futureSlot.board.staffingTemplate?.id ?? null, operationId, manualAssignment: true };
    const [plannedA, plannedB] = await Promise.all([
      request('POST', `/lines/${futureSlot.line.id}/planning-board/assign`, { userId: 'test-master', factoryId, body }),
      request('POST', `/lines/${futureSlot.line.id}/planning-board/assign`, { userId: 'test-master', factoryId, body }),
    ]);
    const plans = await db.plannedLineAssignment.findMany({ where: { factoryId, userId: futureCandidate.userId, shiftDate: new Date(`${next.shiftDate}T00:00:00+03:00`), shiftType: next.shiftType, releasedAt: null } });
    const willBeAfter = await db.shiftWillBe.count({ where: { factoryId, userId: futureCandidate.userId, targetShiftDate: new Date(`${next.shiftDate}T00:00:00+03:00`), shiftType: next.shiftType, status: 'WILL_BE' } });
    check('future retry is idempotent and does not create self-confirmation', [200, 201].includes(plannedA.status) && [200, 201].includes(plannedB.status) && plans.length === 1 && willBeAfter === willBeBefore, { plannedA: plannedA.status, plannedB: plannedB.status, plans: plans.length, willBeBefore, willBeAfter });
    const futureAudit = await db.auditLog.findFirst({ where: { factoryId, entityType: 'PlannedLineAssignment', entityId: plans[0]?.id }, orderBy: { createdAt: 'desc' } });
    check('future assignment audit preserves missing self-confirmation', JSON.stringify(futureAudit?.details ?? {}).includes('"selfConfirmed":false') && JSON.stringify(futureAudit?.details ?? {}).includes(operationId), futureAudit);
    const laterConfirmation = await request('POST', '/shift/will-be', {
      userId: futureCandidate.userId,
      factoryId,
      body: { targetShiftDate: next.shiftDate, shiftType: next.shiftType, comment: 'Подтверждение после ручного плана' },
    });
    const plansAfterConfirmation = await db.plannedLineAssignment.count({ where: { factoryId, userId: futureCandidate.userId, shiftDate: new Date(`${next.shiftDate}T00:00:00+03:00`), shiftType: next.shiftType, releasedAt: null } });
    check('later self-confirmation does not duplicate planned assignment', laterConfirmation.status === 201 && plansAfterConfirmation === 1, { confirmation: laterConfirmation.status, plansAfterConfirmation });
    if (laterConfirmation.data?.id) {
      await request('POST', '/shift/will-be/cancel', { userId: futureCandidate.userId, factoryId, body: { willBeId: laterConfirmation.data.id, comment: 'Завершение regression-проверки' } });
    }
    if (plans[0]) await request('POST', `/lines/${futureSlot.line.id}/planning-board/release/${plans[0].id}`, { userId: 'test-master', factoryId, body: {} });
  }

  const stale = await request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: { ...currentBody, operationId: `people-manual-stale-${Date.now()}`, expectedShiftDate: '2000-01-01' } });
  check('stale shift target is rejected without HTTP 500', [400, 409].includes(stale.status), stale);

  console.log(JSON.stringify({ passed: passed.length, failed: failed.length, checks: [...passed, ...failed] }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  stopBackend(ownedBackend);
  await db.$disconnect().catch(() => undefined);
});
