const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const root = path.resolve(__dirname, '..', '..');
let passed = 0;
const failed = [];

function check(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed.push(name);
    console.error(`FAIL ${name}`);
  }
}

async function request(pathname, { userId, factoryId }) {
  const response = await fetch(`${API}${pathname}`, {
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function context(userId) {
  const response = await fetch(`${API}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const body = await response.json();
  const factory = body.availableFactories?.find((item) => item.code === 'factory-4') ?? body.availableFactories?.[0];
  if (!factory?.id) throw new Error(`Завод не найден для ${userId}`);
  return { userId, factoryId: factory.id };
}

function targetQuery(target) {
  return new URLSearchParams({ targetShiftDate: target.shiftDate, shiftType: target.shiftType }).toString();
}

async function main() {
  const screen = fs.readFileSync(path.join(root, 'frontend/src/screens/ShiftPeopleScreen.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(root, 'frontend/src/navigation/permissions.ts'), 'utf8');
  const shiftService = fs.readFileSync(path.join(root, 'backend/src/modules/shift/shift.service.ts'), 'utf8');
  const lineService = fs.readFileSync(path.join(root, 'backend/src/modules/line/line.service.ts'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'frontend/src/styles.css'), 'utf8');
  const stage03Start = styles.indexOf('Physical field fixes v2 / Stage03');
  const stage03End = styles.indexOf('Pilot lines/wash/defrost mobile polish', stage03Start);
  const stage03Css = styles.slice(stage03Start, stage03End);

  check(/plannedSlots[\s\S]*confirmedUnassigned[\s\S]*assignedUnconfirmed[\s\S]*deficit[\s\S]*surplus/.test(screen), 'Future UI exposes complete planning metrics');
  check(/Место ещё не определено/.test(screen) && /ownAssignment/.test(screen), 'WORKER sees own planned place or explicit empty state');
  check(/ShiftHistory/.test(navigation) && /label: 'История смен'/.test(navigation), 'Personal shift history is a dedicated canonical menu route');
  check(/screenCode === 'archive' && role === 'WORKER'/.test(navigation), 'Common Archive is hidden from WORKER');
  check(/shift-history-calendar-grid/.test(screen) && /has-day/.test(screen) && /has-night/.test(screen), 'Personal history reuses one day/night calendar presentation');
  check(/scope: canSeeFactory \? 'FACTORY' : 'SELF'/.test(shiftService), 'Past detail declares factory or self scope explicitly');
  check(/selfOnly \? Promise\.resolve\(\[\]\) : this\.prisma\.db\.lineEvent/.test(shiftService), 'Self history does not query factory downtime feed');
  check(/canManagePlan[\s\S]*candidates = canManagePlan[\s\S]*: \[\]/.test(lineService), 'Read-only planning board does not expose candidate pool');
  check(!/#(?:[0-9a-f]{3}){1,2}\b/i.test(stage03Css) && !/rgba?\(/i.test(stage03Css), 'Stage03 CSS uses canonical Industrial Premium tokens');
  check(!/toISOString\(\)\.slice\(0,\s*10\)/.test(shiftService), 'Shift read-model does not derive shiftDate from UTC calendar');

  const master = await context('pilot-master-1');
  const worker = await context('pilot-worker-1');
  const readonlySpecialist = await context('pilot-tech-kipia-1');
  const removedWorker = await context('worker-2');
  const [masterTimeline, workerTimeline] = await Promise.all([
    request('/shift/timeline', master),
    request('/shift/timeline', worker),
  ]);
  check(masterTimeline.status === 200 && masterTimeline.data?.next && masterTimeline.data?.future?.length >= 2, 'Timeline returns next and two future shifts');
  check(workerTimeline.status === 200 && workerTimeline.data?.next, 'WORKER receives server/factory timeline');

  const target = masterTimeline.data.next;
  const query = targetQuery(target);
  const [masterFuture, workerFuture] = await Promise.all([
    request(`/shift/future?${query}`, master),
    request(`/shift/future?${query}`, worker),
  ]);
  const metricKeys = ['plannedLines', 'plannedSlots', 'willBe', 'plannedAssignments', 'confirmedUnassigned', 'assignedUnconfirmed', 'deficit', 'surplus'];
  check(masterFuture.status === 200 && metricKeys.every((key) => Number.isInteger(masterFuture.data?.counts?.[key]) && masterFuture.data.counts[key] >= 0), 'MASTER receives all eight future planning metrics');
  check(workerFuture.status === 200 && Array.isArray(workerFuture.data?.plannedLines), 'WORKER receives safe planned-line occupancy');
  check((masterFuture.data?.willBe ?? []).every((item) => item.status === 'WILL_BE' && !/stage\d+|regression|fixture/i.test(item.comment ?? '')), 'Future workbench contains active runtime confirmations only');
  check((workerFuture.data?.willBe ?? []).every((item) => item.userId === worker.userId), 'WORKER future response contains no foreign will-be identities');
  check((workerFuture.data?.plannedNonLineAssignments ?? []).every((item) => item.userId === worker.userId), 'WORKER future response contains only own non-line assignment');
  check((workerFuture.data?.contractorSubmissions ?? []).length === 0, 'WORKER future response hides contractor identity list');
  check(!workerFuture.data?.ownAssignment || typeof workerFuture.data.ownAssignment.targetLabel === 'string', 'Own future assignment is a safe explicit read-model');

  const plannedLine = masterFuture.data?.plannedLines?.[0];
  if (plannedLine) {
    const boardQuery = new URLSearchParams({ shiftDate: target.shiftDate, shiftType: target.shiftType }).toString();
    const [workerBoard, readonlyBoard] = await Promise.all([
      request(`/lines/${plannedLine.lineId}/planning-board?${boardQuery}`, worker),
      request(`/lines/${plannedLine.lineId}/planning-board?${boardQuery}`, readonlySpecialist),
    ]);
    const occupied = readonlyBoard.data?.slots?.map((slot) => slot.assignment).filter(Boolean) ?? [];
    check(workerBoard.status === 403, 'WORKER cannot open a foreign planned-line roster directly');
    check(readonlyBoard.status === 200 && readonlyBoard.data?.canManage === false, 'Read-only specialist opens safe planned line detail');
    check(Array.isArray(readonlyBoard.data?.candidates) && readonlyBoard.data.candidates.length === 0, 'Read-only planned line detail has no candidates');
    check(occupied.every((assignment) => !assignment.userId && !assignment.id && !assignment.profilePhoto), 'Read-only slots do not expose foreign ids or profile photos');
  } else {
    console.log('WARN No visible planned line in the selected future shift; read-only board is covered by source and Plast3 tests');
  }

  const pastTarget = workerTimeline.data?.past?.[0];
  if (!pastTarget) throw new Error('Прошлая смена не рассчитана');
  const key = `${pastTarget.shiftDate}_${pastTarget.shiftType}`;
  const [workerPast, spoofPast, workerDetail, masterDetail] = await Promise.all([
    request('/shift/past', worker),
    request('/shift/past?userId=pilot-worker-2', worker),
    request(`/shift/past/${key}`, worker),
    request(`/shift/past/${key}`, master),
  ]);
  check(workerPast.status === 200 && (workerPast.data?.shifts ?? []).every((shift) => shift.peopleCount > 0), 'WORKER calendar colors actual attendance only');
  check((spoofPast.data?.sessions ?? []).every((session) => session.userId === worker.userId), 'WORKER userId spoof cannot read another history');
  check(workerDetail.status === 200 && workerDetail.data?.scope === 'SELF', 'WORKER past detail is explicitly self-scoped');
  check((workerDetail.data?.tabs ?? []).every((tab) => ['Обзор', 'Люди'].includes(tab)), 'WORKER past detail exposes only personal tabs');
  check(['downtime', 'tasks', 'washes', 'shiftLogs'].every((keyName) => Array.isArray(workerDetail.data?.[keyName]) && workerDetail.data[keyName].length === 0), 'WORKER past detail contains no factory operational feeds');
  check((workerDetail.data?.people ?? []).every((item) => item.userId === worker.userId), 'WORKER past assignments belong only to self');
  check(masterDetail.status === 200 && masterDetail.data?.scope === 'FACTORY' && masterDetail.data?.tabs?.includes('Простои'), 'MASTER keeps full factory shift archive');

  const removedNotifications = await request('/notifications', removedWorker);
  check(removedNotifications.status === 200 && (removedNotifications.data ?? []).some((item) => item.type === 'SHIFT_WILL_BE_REMOVED_BY_MASTER'), 'Not-needed worker receives the existing scoped notification');

  const serialized = JSON.stringify({ masterFuture: masterFuture.data, workerFuture: workerFuture.data, workerPast: workerPast.data, workerDetail: workerDetail.data });
  check(!/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(serialized), 'Stage03 payloads do not expose technical secrets');

  console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', passed, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
