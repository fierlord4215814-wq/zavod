const fs = require('node:fs');
const path = require('node:path');
const { NestFactory } = require('@nestjs/core');
const {
  AssignmentKind,
  EmployeeState,
  LineStatus,
  PrismaClient,
  ShiftSessionStatus,
  ShiftType,
  ShiftWillBeStatus,
  UserRole,
} = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { ShiftService } = require('../dist/modules/shift/shift.service');
const {
  addFactoryShifts,
  factoryShiftDate,
  factoryShiftSessionSchedule,
  factoryShiftTarget,
  factoryShiftWindow,
} = require('../dist/common/shift-time');

const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const RUN_ID = process.env.PFFV4_RUN_ID || 'PFFV4_20260727T075200Z';
const MARKER = `__PFFV4_${RUN_ID}__`;
const ATTEMPT_ID = `${RUN_ID}-${Date.now()}`;
const FACTORY_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const ADMIN_ID = 'pilot-pack-admin';
const MASTER_ID = 'pilot-master-1';
const ids = {
  title12: 'pffv4-stage2-title-12',
  title24: 'pffv4-stage2-title-24',
  user12: 'pffv4-stage2-user-12',
  user24: 'pffv4-stage2-user-24',
  userWorkArea: 'pffv4-stage2-user-work-area',
  line: 'pffv4-stage2-line',
  linePosition: 'pffv4-stage2-line-position',
  template: 'pffv4-stage2-line-template',
  templateItem: 'pffv4-stage2-line-template-item',
  workArea: 'pffv4-stage2-work-area',
  workAreaPosition: 'pffv4-stage2-work-area-position',
  shiftWillBe: 'pffv4-stage2-shift-will-be',
};
const manifestPath = path.resolve(__dirname, '../../docs/physical-fixes-v4-test-artifacts.json');
const db = new PrismaClient();
const result = { passed: [], failed: [], warnings: [] };
const dynamicArtifacts = [];

function pass(name, detail) {
  result.passed.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  result.failed.push({ name, ...(detail ? { detail } : {}) });
}

function check(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return condition;
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /storagePath|passwordHash|database_url|jwt|accessToken|refreshToken|authToken|token|secret/i.test(key)
      ? '[hidden]'
      : inner
  )));
}

function containsForbidden(value) {
  return /storagePath|passwordHash|database_url|bearer\s+|accessToken|refreshToken|authToken|secret/i.test(JSON.stringify(value ?? {}));
}

async function request(pathname, { method = 'GET', body, userId = MASTER_ID, factoryId = FACTORY_ID } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      'x-factory-id': factoryId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (containsForbidden(data)) fail(`${method} ${pathname}: public response has forbidden fields`, sanitize(data));
  return { status: response.status, data };
}

async function expectSuccess(name, promise) {
  const response = await promise;
  if (response.status >= 200 && response.status < 300) pass(name, { status: response.status });
  else fail(name, { status: response.status, data: sanitize(response.data) });
  return response;
}

async function expectDenied(name, promise) {
  const response = await promise;
  if ([400, 403, 404, 409].includes(response.status)) pass(name, { status: response.status });
  else fail(name, { status: response.status, data: sanitize(response.data) });
  return response;
}

function remember(model, id, businessKey) {
  if (!id) return;
  dynamicArtifacts.push({
    model,
    id,
    businessKey,
    marker: MARKER,
    createdByRun: RUN_ID,
    cleanupStatus: 'PENDING_FINAL_CLEANUP',
  });
}

function saveManifest() {
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Set((manifest.artifacts ?? []).map((item) => `${item.model}:${item.id}`));
  for (const item of dynamicArtifacts) {
    if (known.has(`${item.model}:${item.id}`)) continue;
    manifest.artifacts.push(item);
    known.add(`${item.model}:${item.id}`);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function upsertUser(userId, titleId) {
  await db.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      factoryId: FACTORY_ID,
      role: UserRole.WORKER,
      employeeState: EmployeeState.AVAILABLE,
    },
    update: {
      factoryId: FACTORY_ID,
      role: UserRole.WORKER,
      employeeState: EmployeeState.AVAILABLE,
      blockedAt: null,
      deletedAt: null,
    },
  });
  const access = await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId: FACTORY_ID } },
    create: {
      userId,
      factoryId: FACTORY_ID,
      role: UserRole.WORKER,
      jobTitleId: titleId,
      isGuest: false,
      isActive: true,
    },
    update: {
      role: UserRole.WORKER,
      jobTitleId: titleId,
      isGuest: false,
      isActive: true,
      deactivatedAt: null,
    },
  });
  remember('User', userId, `${MARKER}:${userId}`);
  remember('UserFactoryAccess', access.id, `${MARKER}:${userId}:factory-access`);
}

async function setupFixtures() {
  const staleUserIds = [ids.user12, ids.user24, ids.userWorkArea];
  const now = new Date();
  await db.assignment.updateMany({
    where: { userId: { in: staleUserIds }, endedAt: null },
    data: { endedAt: now, endedById: ADMIN_ID, comment: 'PFFV4 stage2 rerun setup', version: { increment: 1 } },
  });
  await db.shiftSession.updateMany({
    where: { userId: { in: staleUserIds }, status: ShiftSessionStatus.ACTIVE },
    data: { status: ShiftSessionStatus.ENDED, endedAt: now, endedById: ADMIN_ID, version: { increment: 1 } },
  });
  await db.plannedShiftAssignment.updateMany({
    where: { userId: { in: staleUserIds }, releasedAt: null },
    data: { releasedAt: now, releasedById: ADMIN_ID },
  });

  for (const [id, code, duration] of [
    [ids.title12, 'pffv4-stage2-worker-12', 12],
    [ids.title24, 'pffv4-stage2-worker-24', 24],
  ]) {
    await db.jobTitle.upsert({
      where: { id },
      create: {
        id,
        factoryId: FACTORY_ID,
        name: `${MARKER} ${duration} часов`,
        code,
        baseRole: UserRole.WORKER,
        shiftDurationHours: duration,
      },
      update: {
        factoryId: FACTORY_ID,
        name: `${MARKER} ${duration} часов`,
        baseRole: UserRole.WORKER,
        shiftDurationHours: duration,
        isActive: true,
        deletedAt: null,
      },
    });
    remember('JobTitle', id, code);
  }
  await upsertUser(ids.user12, ids.title12);
  await upsertUser(ids.user24, ids.title24);
  await upsertUser(ids.userWorkArea, ids.title12);

  await db.line.upsert({
    where: { id: ids.line },
    create: { id: ids.line, factoryId: FACTORY_ID, name: `${MARKER} lifecycle line`, status: LineStatus.WORK },
    update: {
      factoryId: FACTORY_ID,
      name: `${MARKER} lifecycle line`,
      status: LineStatus.WORK,
      deletedAt: null,
      deactivatedAt: null,
      version: { increment: 1 },
    },
  });
  await db.linePosition.upsert({
    where: { id: ids.linePosition },
    create: {
      id: ids.linePosition,
      factoryId: FACTORY_ID,
      lineId: ids.line,
      name: `${MARKER} operator`,
      normalizedName: `${MARKER.toLowerCase()} operator`,
      sortOrder: 1,
    },
    update: {
      factoryId: FACTORY_ID,
      lineId: ids.line,
      name: `${MARKER} operator`,
      isActive: true,
      deletedAt: null,
      sortOrder: 1,
    },
  });
  await db.lineStaffingTemplate.upsert({
    where: { id: ids.template },
    create: {
      id: ids.template,
      factoryId: FACTORY_ID,
      lineId: ids.line,
      name: `${MARKER} active template`,
      isActive: true,
    },
    update: {
      name: `${MARKER} active template`,
      isActive: true,
      deletedAt: null,
    },
  });
  await db.lineStaffingTemplateItem.upsert({
    where: { id: ids.templateItem },
    create: {
      id: ids.templateItem,
      templateId: ids.template,
      positionId: ids.linePosition,
      requiredCount: 1,
      minRequired: 1,
      maxRequired: 1,
      defaultPlanned: 1,
      plannedCount: 1,
      sortOrder: 1,
    },
    update: {
      templateId: ids.template,
      positionId: ids.linePosition,
      requiredCount: 1,
      minRequired: 1,
      maxRequired: 1,
      defaultPlanned: 1,
      plannedCount: 1,
      sortOrder: 1,
    },
  });
  remember('Line', ids.line, `${MARKER} lifecycle line`);
  remember('LinePosition', ids.linePosition, `${MARKER} operator`);
  remember('LineStaffingTemplate', ids.template, `${MARKER} active template`);
  remember('LineStaffingTemplateItem', ids.templateItem, `${MARKER} active template item`);

  await db.workArea.upsert({
    where: { id: ids.workArea },
    create: {
      id: ids.workArea,
      factoryId: FACTORY_ID,
      name: `${MARKER} time area`,
      assignmentKind: AssignmentKind.TIME,
    },
    update: {
      factoryId: FACTORY_ID,
      name: `${MARKER} time area`,
      assignmentKind: AssignmentKind.TIME,
      isActive: true,
      deletedAt: null,
    },
  });
  await db.workAreaPosition.upsert({
    where: { id: ids.workAreaPosition },
    create: {
      id: ids.workAreaPosition,
      workAreaId: ids.workArea,
      title: `${MARKER} cleaner`,
      minRequired: 1,
      maxRequired: 4,
      defaultPlanned: 3,
      plannedCount: 3,
      isFlexible: true,
      sortOrder: 1,
    },
    update: {
      workAreaId: ids.workArea,
      title: `${MARKER} cleaner`,
      minRequired: 1,
      maxRequired: 4,
      defaultPlanned: 3,
      plannedCount: 3,
      isFlexible: true,
      isActive: true,
      deletedAt: null,
      sortOrder: 1,
    },
  });
  remember('WorkArea', ids.workArea, `${MARKER} time area`);
  remember('WorkAreaPosition', ids.workAreaPosition, `${MARKER} cleaner`);
}

function verifyPureSchedules() {
  const samples = [
    ['DAY starts at 08:00', '2026-07-10T05:00:00.000Z', ShiftType.DAY, '2026-07-10', '2026-07-10T17:00:00.000Z'],
    ['NIGHT starts at 20:00', '2026-07-10T17:00:00.000Z', ShiftType.NIGHT, '2026-07-10', '2026-07-11T05:00:00.000Z'],
    ['NIGHT after midnight keeps previous date', '2026-07-11T00:00:00.000Z', ShiftType.NIGHT, '2026-07-10', '2026-07-11T05:00:00.000Z'],
  ];
  for (const [name, iso, shiftType, shiftDate, plannedEndIso] of samples) {
    const schedule = factoryShiftSessionSchedule(new Date(iso), 12);
    check(`${name}: type`, schedule.shiftType === shiftType, sanitize(schedule));
    check(`${name}: date`, schedule.shiftDate === shiftDate, sanitize(schedule));
    check(`${name}: 12h end`, schedule.plannedEndAt.toISOString() === plannedEndIso, sanitize(schedule));
  }
  const night24 = factoryShiftSessionSchedule(new Date('2026-07-10T18:30:00.000Z'), 24);
  check('24h NIGHT session ends at the next NIGHT boundary', night24.plannedEndAt.toISOString() === '2026-07-11T17:00:00.000Z', sanitize(night24));
  check('24h session crosses exactly one 12h production boundary before ending', night24.plannedEndAt.getTime() - factoryShiftWindow(night24).to.getTime() === 12 * 60 * 60 * 1000, sanitize(night24));
}

async function createFuturePlanAndWillBe() {
  const next = addFactoryShifts(factoryShiftTarget(), 1);
  const future = await expectSuccess('future WorkArea slot is planned', request('/shift/future-assignments', {
    method: 'POST',
    body: {
      targetUserId: ids.user12,
      shiftDate: next.shiftDate,
      shiftType: next.shiftType,
      kind: 'TIME',
      workAreaId: ids.workArea,
      workAreaPositionId: ids.workAreaPosition,
      slotIndex: 2,
    },
  }));
  if (future.data?.id) remember('PlannedShiftAssignment', future.data.id, `${MARKER}:future-slot-2`);
  const willBe = await db.shiftWillBe.upsert({
    where: { id: ids.shiftWillBe },
    create: {
      id: ids.shiftWillBe,
      factoryId: FACTORY_ID,
      userId: ids.user12,
      targetShiftDate: factoryShiftDate(next),
      shiftType: next.shiftType,
      status: ShiftWillBeStatus.WILL_BE,
      comment: MARKER,
    },
    update: {
      targetShiftDate: factoryShiftDate(next),
      shiftType: next.shiftType,
      status: ShiftWillBeStatus.WILL_BE,
      comment: MARKER,
      cancelledAt: null,
      removedAt: null,
      removedById: null,
    },
  });
  remember('ShiftWillBe', willBe.id, `${MARKER}:will-be`);
  return future.data;
}

async function testLineStopAndTwelveHours(shiftService) {
  const started = await expectSuccess('12h worker starts shift', request('/shift/start', {
    method: 'POST',
    userId: ids.user12,
  }));
  if (!started.data?.id) return;
  remember('ShiftSession', started.data.id, `${MARKER}:12h-session`);
  const expected = factoryShiftSessionSchedule(new Date(started.data.startedAt), 12);
  check('12h duration snapshot is stored', started.data.durationHours === 12, sanitize(started.data));
  check('12h planned end uses canonical factory boundary', new Date(started.data.plannedEndAt).getTime() === expected.plannedEndAt.getTime(), sanitize(started.data));

  const assigned = await expectSuccess('worker is assigned to line slot', request('/assignments/line', {
    method: 'POST',
    body: {
      targetUserId: ids.user12,
      lineId: ids.line,
      positionId: ids.linePosition,
      slotIndex: 1,
      staffingTemplateId: ids.template,
      operationId: `${ATTEMPT_ID}-line-assign-12`,
    },
  }));
  if (!assigned.data?.id) return;
  remember('Assignment', assigned.data.id, `${MARKER}:line-assignment-12`);

  const futurePlan = await createFuturePlanAndWillBe();
  const paused = await expectSuccess('PAUSE is accepted', request(`/lines/${ids.line}/status`, {
    method: 'PATCH',
    body: { status: 'PAUSE', comment: `${MARKER} downtime`, downtimeReason: 'OTHER' },
  }));
  if (paused.data?.id) remember('LineEvent', paused.data.id, `${MARKER}:pause-event`);
  const assignmentDuringPause = await db.assignment.findUnique({ where: { id: assigned.data.id } });
  check('PAUSE retains active assignment', assignmentDuringPause?.endedAt === null, sanitize(assignmentDuringPause));

  await expectSuccess('line resumes after PAUSE', request(`/lines/${ids.line}/status`, {
    method: 'PATCH',
    body: { status: 'WORK' },
  }));
  const stopped = await expectSuccess('STOP is accepted', request(`/lines/${ids.line}/status`, {
    method: 'PATCH',
    body: { status: 'STOP', comment: `${MARKER} full stop`, downtimeReason: 'OTHER' },
  }));
  if (stopped.data?.id) remember('LineEvent', stopped.data.id, `${MARKER}:stop-event`);
  const assignmentShift = factoryShiftTarget(new Date(assigned.data.startedAt));
  const stopCreditWhere = {
    factoryId: FACTORY_ID,
    userId: ids.user12,
    lineId: ids.line,
    positionId: ids.linePosition,
    shiftDate: factoryShiftDate(assignmentShift),
    shiftType: assignmentShift.shiftType,
  };

  const [closedAssignment, releasedUser, activeCount, creditCount, plannedAfterStop, willBeAfterStop] = await Promise.all([
    db.assignment.findUnique({ where: { id: assigned.data.id } }),
    db.user.findUnique({ where: { id: ids.user12 } }),
    db.assignment.count({ where: { factoryId: FACTORY_ID, lineId: ids.line, endedAt: null } }),
    db.userSkillCredit.count({ where: stopCreditWhere }),
    db.plannedShiftAssignment.findUnique({ where: { id: futurePlan.id } }),
    db.shiftWillBe.findUnique({ where: { id: ids.shiftWillBe } }),
  ]);
  check('STOP atomically closes line assignment', Boolean(closedAssignment?.endedAt), sanitize(closedAssignment));
  check('STOP releases employee state', releasedUser?.employeeState === EmployeeState.AVAILABLE, sanitize(releasedUser));
  check('STOP leaves no active line assignment', activeCount === 0, { activeCount });
  check('STOP keeps exactly one line experience credit per production shift', creditCount === 1, { creditCount });
  check('STOP keeps future planned assignment', plannedAfterStop?.releasedAt === null, sanitize(plannedAfterStop));
  check('STOP keeps will-be declaration', willBeAfterStop?.status === ShiftWillBeStatus.WILL_BE, sanitize(willBeAfterStop));

  const repeated = await expectSuccess('repeated STOP is idempotent', request(`/lines/${ids.line}/status`, {
    method: 'PATCH',
    body: { status: 'STOP', comment: `${MARKER} repeated stop`, downtimeReason: 'OTHER' },
  }));
  check('repeated STOP returns the same open event', repeated.data?.id === stopped.data?.id, { first: stopped.data?.id, repeated: repeated.data?.id });
  const repeatedCreditCount = await db.userSkillCredit.count({ where: stopCreditWhere });
  check('repeated STOP does not duplicate experience', repeatedCreditCount === 1, { repeatedCreditCount });

  await expectSuccess('stopped line returns to work', request(`/lines/${ids.line}/status`, {
    method: 'PATCH',
    body: { status: 'WORK' },
  }));
  const dashboard = await expectSuccess('line dashboard opens after restart', request(`/lines/${ids.line}/dashboard`));
  const dashboardWorkers = (dashboard.data?.assignmentsByPosition ?? []).reduce((sum, group) => sum + group.assignments.length, 0)
    + (dashboard.data?.withoutPosition?.length ?? 0);
  check('line restarts with empty factual assignment board', dashboardWorkers === 0, { dashboardWorkers });

  const oldSchedule = factoryShiftSessionSchedule(new Date(Date.now() - 13 * 60 * 60 * 1000), 12);
  await db.shiftSession.update({
    where: { id: started.data.id },
    data: {
      startedAt: oldSchedule.startedAt,
      shiftType: oldSchedule.shiftType,
      durationHours: 12,
      plannedEndAt: oldSchedule.plannedEndAt,
    },
  });
  const closeResult = await shiftService.autoCloseDueShiftSessions(new Date());
  const closedSession = await db.shiftSession.findUnique({ where: { id: started.data.id } });
  check('12h session does not carry beyond its boundary', closedSession?.status === ShiftSessionStatus.ENDED && closedSession.autoClosed, {
    closeResult,
    session: sanitize(closedSession),
  });
}

async function testTwentyFourHours(shiftService) {
  const started = await expectSuccess('24h worker starts shift', request('/shift/start', {
    method: 'POST',
    userId: ids.user24,
  }));
  if (!started.data?.id) return;
  remember('ShiftSession', started.data.id, `${MARKER}:24h-session`);
  const expected = factoryShiftSessionSchedule(new Date(started.data.startedAt), 24);
  check('24h duration snapshot is stored', started.data.durationHours === 24, sanitize(started.data));
  check('24h planned end uses canonical factory boundary', new Date(started.data.plannedEndAt).getTime() === expected.plannedEndAt.getTime(), sanitize(started.data));
  check('24h session remains active after first 12h production boundary', expected.plannedEndAt > factoryShiftWindow(expected).to, sanitize(expected));

  const assigned = await expectSuccess('24h worker is assigned to line', request('/assignments/line', {
    method: 'POST',
    body: {
      targetUserId: ids.user24,
      lineId: ids.line,
      positionId: ids.linePosition,
      slotIndex: 1,
      staffingTemplateId: ids.template,
      operationId: `${ATTEMPT_ID}-line-assign-24`,
    },
  }));
  if (!assigned.data?.id) return;
  remember('Assignment', assigned.data.id, `${MARKER}:line-assignment-24`);

  await shiftService.autoCloseDueShiftSessions(new Date());
  const stillActive = await db.shiftSession.findUnique({ where: { id: started.data.id } });
  check('24h current session is not closed at the 12h boundary', stillActive?.status === ShiftSessionStatus.ACTIVE, sanitize(stillActive));

  const oldSchedule = factoryShiftSessionSchedule(new Date(Date.now() - 25 * 60 * 60 * 1000), 24);
  await db.$transaction([
    db.shiftSession.update({
      where: { id: started.data.id },
      data: {
        startedAt: oldSchedule.startedAt,
        shiftType: oldSchedule.shiftType,
        durationHours: 24,
        plannedEndAt: oldSchedule.plannedEndAt,
      },
    }),
    db.assignment.update({
      where: { id: assigned.data.id },
      data: { startedAt: oldSchedule.startedAt },
    }),
  ]);
  const closeResult = await shiftService.autoCloseDueShiftSessions(new Date());
  const autoCloseCreditWhere = {
    factoryId: FACTORY_ID,
    userId: ids.user24,
    lineId: ids.line,
    positionId: ids.linePosition,
    shiftDate: factoryShiftDate(oldSchedule),
    shiftType: oldSchedule.shiftType,
  };
  const [closedSession, closedAssignment, creditCount] = await Promise.all([
    db.shiftSession.findUnique({ where: { id: started.data.id } }),
    db.assignment.findUnique({ where: { id: assigned.data.id } }),
    db.userSkillCredit.count({ where: autoCloseCreditWhere }),
  ]);
  check('24h session ends automatically at its 24h boundary', closedSession?.status === ShiftSessionStatus.ENDED
    && closedSession.autoClosed
    && closedSession.endedAt?.getTime() === oldSchedule.plannedEndAt.getTime(), {
    closeResult,
    session: sanitize(closedSession),
  });
  check('24h auto-close releases factual assignment', closedAssignment?.endedAt?.getTime() === oldSchedule.plannedEndAt.getTime(), sanitize(closedAssignment));
  check('24h auto-close credits experience once', creditCount === 1, { creditCount });
  await shiftService.autoCloseDueShiftSessions(new Date());
  const repeatedCreditCount = await db.userSkillCredit.count({ where: autoCloseCreditWhere });
  check('repeated 24h maintenance is idempotent', repeatedCreditCount === 1, { repeatedCreditCount });
}

async function testWorkAreaSlots(futurePlan) {
  const started = await expectSuccess('WorkArea worker starts shift', request('/shift/start', {
    method: 'POST',
    userId: ids.userWorkArea,
  }));
  if (started.data?.id) remember('ShiftSession', started.data.id, `${MARKER}:work-area-session`);

  const assigned = await expectSuccess('stable WorkArea slot #3 accepts assignment', request(`/work-areas/${ids.workArea}/assign`, {
    method: 'POST',
    body: {
      targetUserId: ids.userWorkArea,
      workAreaPositionId: ids.workAreaPosition,
      slotIndex: 3,
      operationId: `${ATTEMPT_ID}-work-area-slot-3`,
    },
  }));
  if (assigned.data?.id) remember('Assignment', assigned.data.id, `${MARKER}:work-area-slot-3`);

  const board = await expectSuccess('WorkArea board opens', request(`/work-areas/${ids.workArea}/board`));
  const slots = board.data?.slots ?? [];
  check('WorkArea exposes stable slots 1..3', slots.length === 3 && slots.map((slot) => slot.slotIndex).join(',') === '1,2,3', sanitize(slots));
  check('slot #3 keeps its exact occupant identity', slots[0]?.assignment === null
    && slots[1]?.assignment === null
    && slots[2]?.assignment?.userId === ids.userWorkArea, sanitize(slots));
  const shortage = board.data?.shortage?.[0];
  check('WorkArea required/assigned/deficit parity', shortage?.plannedCount === 3
    && shortage?.required === 3
    && shortage?.actual === 1
    && shortage?.missing === 2, sanitize(shortage));

  await expectDenied('occupied current slot prevents plan reduction', request(`/work-areas/${ids.workArea}/positions/${ids.workAreaPosition}/planned-count`, {
    method: 'PATCH',
    body: { plannedCount: 2 },
  }));
  await expectSuccess('WorkArea worker is released', request('/assignments/release', {
    method: 'POST',
    body: { targetUserId: ids.userWorkArea },
  }));
  await expectDenied('occupied future slot prevents plan reduction', request(`/work-areas/${ids.workArea}/positions/${ids.workAreaPosition}/planned-count`, {
    method: 'PATCH',
    body: { plannedCount: 1 },
  }));
  await expectSuccess('future WorkArea assignment is released normally', request(`/shift/future-assignments/${futurePlan.id}/release`, {
    method: 'POST',
  }));
  await expectSuccess('plan can be reduced after all affected slots are free', request(`/work-areas/${ids.workArea}/positions/${ids.workAreaPosition}/planned-count`, {
    method: 'PATCH',
    body: { plannedCount: 1 },
  }));
  await expectSuccess('WorkArea plan is restored for the fixture', request(`/work-areas/${ids.workArea}/positions/${ids.workAreaPosition}/planned-count`, {
    method: 'PATCH',
    body: { plannedCount: 3 },
  }));
  if (started.data?.id) {
    await expectSuccess('WorkArea worker ends shift', request('/shift/end', {
      method: 'POST',
      userId: ids.userWorkArea,
    }));
  }

  const foreignFactory = await db.factory.findFirst({
    where: { id: { not: FACTORY_ID }, deletedAt: null },
    select: { id: true },
  });
  if (foreignFactory) {
    await expectDenied('WorkArea board rejects cross-factory context', request(`/work-areas/${ids.workArea}/board`, {
      userId: ADMIN_ID,
      factoryId: foreignFactory.id,
    }));
  } else {
    result.warnings.push({ name: 'cross-factory WorkArea check skipped: no second active factory' });
  }
}

async function verifyFactoryFourMapping() {
  const titles24 = await db.jobTitle.findMany({
    where: {
      factoryId: FACTORY_ID,
      deletedAt: null,
      shiftDurationHours: 24,
      id: { notIn: [ids.title24] },
    },
    select: { code: true },
    orderBy: { code: 'asc' },
  });
  const expectedCodes = ['pilot-pack-cold-specialist-v1', 'pilot-pack-electrician-v1'];
  check('Factory 4 has 24h only on exact shift-specific electric/cold titles', JSON.stringify(titles24.map((title) => title.code)) === JSON.stringify(expectedCodes), {
    actualCodes: titles24.map((title) => title.code),
    expectedCodes,
  });
  const mapped = await db.jobTitle.findMany({
    where: { factoryId: FACTORY_ID, code: { in: expectedCodes } },
    select: { id: true, code: true, shiftDurationHours: true },
  });
  check('Factory 4 24h title mapping is complete', mapped.length === 2 && mapped.every((title) => title.shiftDurationHours === 24), sanitize(mapped));
}

async function verifyUiContracts() {
  const situation = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/screens/SituationScreen.tsx'), 'utf8');
  const shiftPeople = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/screens/ShiftPeopleScreen.tsx'), 'utf8');
  const admin = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/screens/AdminConfigScreen.tsx'), 'utf8');
  check('Lines screen has a separate WorkArea block', situation.includes('data-testid="lines-work-area-summary"') && situation.includes('Не входят в KPI линий'));
  check('Shift and Lines share WorkArea metrics', ['Требуется:', 'Назначено:', 'Свободно:', 'Дефицит:', 'Избыток:'].every((label) => situation.includes(label) && shiftPeople.includes(label)));
  check('admin UI exposes 12/24 per job title', admin.includes('shiftDurationHours') && admin.includes('24 часа / сутки') && admin.includes('12 часов'));
}

async function rememberCreatedHistory() {
  const [events, assignments, sessions, credits, audits] = await Promise.all([
    db.lineEvent.findMany({ where: { lineId: ids.line }, select: { id: true, comment: true } }),
    db.assignment.findMany({ where: { userId: { in: [ids.user12, ids.user24, ids.userWorkArea] } }, select: { id: true } }),
    db.shiftSession.findMany({ where: { userId: { in: [ids.user12, ids.user24, ids.userWorkArea] } }, select: { id: true } }),
    db.userSkillCredit.findMany({ where: { userId: { in: [ids.user12, ids.user24, ids.userWorkArea] } }, select: { id: true } }),
    db.auditLog.findMany({
      where: {
        factoryId: FACTORY_ID,
        OR: [
          { entityId: { in: [ids.line, ids.workArea, ids.workAreaPosition, ids.user12, ids.user24, ids.userWorkArea] } },
          { details: { path: ['targetUserId'], array_contains: [ids.user12] } },
        ],
      },
      select: { id: true, action: true },
    }).catch(() => []),
  ]);
  for (const item of events) remember('LineEvent', item.id, item.comment ?? `${MARKER}:line-event`);
  for (const item of assignments) remember('Assignment', item.id, `${MARKER}:assignment`);
  for (const item of sessions) remember('ShiftSession', item.id, `${MARKER}:shift-session`);
  for (const item of credits) remember('UserSkillCredit', item.id, `${MARKER}:skill-credit`);
  for (const item of audits) remember('AuditLog', item.id, `${MARKER}:${item.action}`);
}

async function main() {
  process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
  await setupFixtures();
  verifyPureSchedules();
  await verifyFactoryFourMapping();
  await verifyUiContracts();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const shiftService = app.get(ShiftService);
    await testLineStopAndTwelveHours(shiftService);
    const futurePlan = await db.plannedShiftAssignment.findFirst({
      where: { userId: ids.user12, workAreaId: ids.workArea, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await testTwentyFourHours(shiftService);
    if (futurePlan) await testWorkAreaSlots(futurePlan);
    else fail('future WorkArea plan is available for slot guard test');
  } finally {
    await app.close();
  }

  await rememberCreatedHistory();
  saveManifest();
}

main()
  .catch((error) => fail('stage2 regression crashed', error instanceof Error ? error.stack : String(error)))
  .finally(async () => {
    await db.$disconnect();
    process.stdout.write(`${JSON.stringify({
      runId: RUN_ID,
      passed: result.passed.length,
      failed: result.failed.length,
      warnings: result.warnings.length,
      results: result,
    }, null, 2)}\n`);
    if (result.failed.length) process.exitCode = 1;
  });
