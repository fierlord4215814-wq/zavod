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

async function request(method, pathname, { userId, factoryId } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function factoryFor(userId) {
  const login = await fetch(`${API}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const body = await login.json();
  const factory = body.availableFactories?.find((item) => item.code === 'factory-4') ?? body.availableFactories?.[0];
  return { status: login.status, factoryId: factory?.id ?? null };
}

async function main() {
  const screen = fs.readFileSync(path.join(root, 'frontend/src/screens/ShiftPeopleScreen.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'frontend/src/styles.css'), 'utf8');
  const stage02Css = styles.slice(styles.indexOf('Physical field fixes v2 / Stage02'));

  check(/shift-selector-compact/.test(screen) && /shift-picker-sheet/.test(screen), 'Compact shift selector uses one bottom sheet');
  check(['Линии', 'Люди', 'Простой', 'Заявки'].every((label) => screen.includes(`<div className="metric-label">${label}</div>`)), 'Four current-shift squares are working entries');
  check(/currentOperationalView === 'lines'/.test(screen) && /currentOperationalView === 'downtime'/.test(screen) && /currentOperationalView === 'requests'/.test(screen), 'Squares switch operational content');
  check(!screen.includes('<h3>Остановленные линии</h3>'), 'Stopped lines are absent from the main Shift picture');
  check(/\.\.\.activeDowntimeLines, \.\.\.workingLines/.test(screen), 'Current line order starts with active downtime and working lines');
  check(/Простой<\/button>/.test(screen) && /Остановить<\/button>/.test(screen) && /Подробнее<\/button>/.test(screen) && /План<\/button>/.test(screen), 'Compact line card preserves all line actions and Plan');
  check(/Люди \{line\.activeWorkersCount/.test(screen) && /linePlannedPeople/.test(screen), 'Line card shows People actual/planned');
  check(/sourceKind === 'DOWNTIME'/.test(screen) && /lineStatusEventId/.test(screen), 'Downtime request display and creation use explicit relation');
  check(/Выбрать из неотмеченных/.test(screen) && /PeopleSearchPanel/.test(screen), 'Current assignment uses existing server search');
  check(/WorkAreaPosition/.test(screen) && /chooseAssignmentTarget\('time'\)/.test(screen) && /chooseAssignmentTarget\('workArea'\)/.test(screen), 'Timeworkers and work areas reuse canonical dictionaries');
  check(/operationId: body\.operationId \?\? crypto\.randomUUID\(\)/.test(screen), 'Current assignment commands preserve operationId');
  check(/Действия<\/button>/.test(screen) && /currentSlotAction/.test(screen), 'Occupied slots use one action sheet instead of permanent button sets');
  check(/useMobileBackLayer/.test(screen) && /shiftPickerTouchStartY/.test(screen), 'Back and swipe-down close current-shift sheets');
  check(/current-shift-person-row/.test(screen) && /<h3>На смене<\/h3>/.test(screen), 'Current people use compact On shift rows');
  check(!/#(?:[0-9a-f]{3}){1,2}\b/i.test(stage02Css) && !/rgba?\(/i.test(stage02Css), 'Stage02 styles use canonical Industrial Premium tokens without a local palette');

  const master = await factoryFor('pilot-master-1');
  check(master.status === 201 && Boolean(master.factoryId), 'Pilot MASTER login context is available');
  if (!master.factoryId) throw new Error('Factory for pilot MASTER was not found');

  const [timeline, people, lines, workAreas] = await Promise.all([
    request('GET', '/shift/timeline', { userId: 'pilot-master-1', factoryId: master.factoryId }),
    request('GET', '/shift/people?includeAll=false', { userId: 'pilot-master-1', factoryId: master.factoryId }),
    request('GET', '/lines', { userId: 'pilot-master-1', factoryId: master.factoryId }),
    request('GET', '/work-areas', { userId: 'pilot-master-1', factoryId: master.factoryId }),
  ]);
  check(timeline.status === 200 && timeline.data?.current && timeline.data?.next, 'Current/next shift timeline is scoped and available');
  check(people.status === 200 && Array.isArray(people.data), 'MASTER receives current-shift people');
  check(lines.status === 200 && Array.isArray(lines.data), 'MASTER receives factory-scoped lines');
  check(workAreas.status === 200 && Array.isArray(workAreas.data), 'MASTER receives canonical work areas');

  const activeLine = lines.data?.find((line) => line.isActiveForShift && line.status !== 'STOP');
  if (activeLine) {
    const [dashboard, board] = await Promise.all([
      request('GET', `/lines/${activeLine.id}/dashboard`, { userId: 'pilot-master-1', factoryId: master.factoryId }),
      request('GET', `/lines/${activeLine.id}/assignment-board`, { userId: 'pilot-master-1', factoryId: master.factoryId }),
    ]);
    check(dashboard.status === 200 && dashboard.data?.line?.id === activeLine.id, 'MASTER can open canonical line dashboard');
    check(board.status === 200 && Array.isArray(board.data?.slots), 'MASTER can open canonical assignment slots');

    const worker = await factoryFor('pilot-worker-1');
    const [workerDetail, deniedBoard] = worker.factoryId
      ? await Promise.all([
          request('GET', `/lines/${activeLine.id}/current-shift-detail`, { userId: 'pilot-worker-1', factoryId: worker.factoryId }),
          request('GET', `/lines/${activeLine.id}/assignment-board`, { userId: 'pilot-worker-1', factoryId: worker.factoryId }),
        ])
      : [{ status: 0 }, { status: 0 }];
    check(workerDetail.status === 200 && Array.isArray(workerDetail.data?.assignmentsByPosition), 'WORKER can open scoped read-only current-shift detail');
    check(Array.isArray(workerDetail.data?.activeTasks) && workerDetail.data.activeTasks.length === 0, 'Read-only detail does not expose task activity outside task permissions');
    check(deniedBoard.status === 403, 'WORKER cannot open assignment board through direct API');
  } else {
    console.log('WARN No active runtime line; dashboard API checks are covered by existing assignment regressions');
  }

  const serialized = JSON.stringify({ timeline: timeline.data, people: people.data, lines: lines.data, workAreas: workAreas.data });
  check(!/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(serialized), 'Operational payload does not expose technical secrets');

  console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', passed, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
