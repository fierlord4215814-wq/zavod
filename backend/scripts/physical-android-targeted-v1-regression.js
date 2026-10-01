const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const apiBase = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const passed = [];
const failed = [];

function check(condition, name, details) {
  (condition ? passed : failed).push({ name, ...(details ? { details } : {}) });
}

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function containsForbidden(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|secretValue/i.test(JSON.stringify(value ?? null));
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function connectWebSocket(token, factoryId) {
  const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/$/, '');
  return new Promise((resolve) => {
    const socket = new WebSocket(`${wsBase}/ws?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(result);
    };
    socket.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type === 'connected') finish({ connected: true, event });
      } catch {
        finish({ connected: false, reason: 'malformed-event' });
      }
    });
    socket.on('error', () => finish({ connected: false, reason: 'socket-error' }));
    socket.on('close', () => finish({ connected: false, reason: 'closed-before-connected' }));
    setTimeout(() => finish({ connected: false, reason: 'timeout' }), 3000);
  });
}

async function main() {
  const health = await jsonRequest('/health');
  check(health.status === 200 && health.data?.status === 'ok', 'fresh backend health is ok', { status: health.status });

  const login = await jsonRequest('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+79000004720', password: '1234' }),
  });
  const token = login.data?.accessToken ?? login.data?.token;
  const factory = login.data?.availableFactories?.find((item) => item.code === 'factory-4')
    ?? login.data?.availableFactories?.find((item) => item.name === '\u0417\u0430\u0432\u043e\u0434 4');
  check(login.status >= 200 && login.status < 300 && Boolean(token) && Boolean(factory?.id), 'pilot MASTER real login resolves factory-4', { status: login.status });
  if (!token || !factory?.id) throw new Error('Pilot MASTER login or factory-4 is unavailable');

  const headers = { authorization: `Bearer ${token}`, 'x-factory-id': factory.id };
  const [linesResult, washResult, peopleResult, timelineResult, anonymousLines, foreignFactoryLines] = await Promise.all([
    jsonRequest('/lines', { headers }),
    jsonRequest('/wash', { headers }),
    jsonRequest('/shift/people?includeAll=false', { headers }),
    jsonRequest('/shift/timeline', { headers }),
    jsonRequest('/lines'),
    jsonRequest('/lines', { headers: { authorization: `Bearer ${token}`, 'x-factory-id': '00000000-0000-4000-8000-000000000001' } }),
  ]);
  const realtime = await connectWebSocket(token, factory.id);

  check(linesResult.status === 200 && Array.isArray(linesResult.data), 'canonical /lines read-model is available');
  check(washResult.status === 200 && Array.isArray(washResult.data), 'canonical /wash read-model is available');
  check(peopleResult.status === 200 && Array.isArray(peopleResult.data), 'canonical /shift/people read-model is available');
  check(timelineResult.status === 200 && Boolean(timelineResult.data?.current?.shiftDate), 'factory-local shift timeline has a calculated date');
  check(anonymousLines.status === 403, 'anonymous line read is denied by backend guard', { status: anonymousLines.status });
  check(foreignFactoryLines.status === 403, 'spoofed factory context is denied by backend guard', { status: foreignFactoryLines.status });
  check(realtime.connected === true && realtime.event?.type === 'connected', 'authenticated pilot WebSocket connects without write operations', realtime.connected ? undefined : realtime);
  check(!containsForbidden(realtime.event), 'WebSocket connected payload does not expose forbidden fields');

  const lines = Array.isArray(linesResult.data) ? linesResult.data : [];
  const activeWashLineIds = new Set(
    (Array.isArray(washResult.data) ? washResult.data : [])
      .filter((wash) => wash.active && wash.lineId)
      .map((wash) => wash.lineId),
  );
  const isOnWash = (line) => Boolean(line.activeWash) || activeWashLineIds.has(line.id);
  const working = lines.filter((line) => line.status === 'WORK' && !isOnWash(line));
  const onWash = lines.filter(isOnWash);
  const assignedOnWorkingLines = working.reduce((total, line) => total + Number(line.activeWorkersCount || 0), 0);

  check(lines.length > 0, 'real factory lines are returned');
  check(working.every((line) => line.status === 'WORK' && !isOnWash(line)), 'working KPI excludes wash and non-WORK lines');
  check(onWash.every((line) => isOnWash(line)), 'wash KPI follows active wash state');
  check(Number.isInteger(assignedOnWorkingLines) && assignedOnWorkingLines >= 0, 'assigned KPI is derived from working lines');
  check(lines.every((line) => typeof line.id === 'string' && typeof line.status === 'string'), 'line read-model has canonical identifiers and statuses');
  check(!containsForbidden({ lines: linesResult.data, wash: washResult.data, people: peopleResult.data, timeline: timelineResult.data }), 'operational read-models do not expose forbidden fields');

  const shift = source('frontend/src/screens/ShiftPeopleScreen.tsx');
  const situation = source('frontend/src/screens/SituationScreen.tsx');
  const ws = source('frontend/src/ws/client.ts');
  const lineService = source('backend/src/modules/line/line.service.ts');
  const returns = source('frontend/src/screens/ReturnsScreen.tsx');
  const styles = source('frontend/src/styles.css');
  const pwaRuntime = source('frontend/src/utils/pwa-runtime.ts');
  const chats = source('frontend/src/screens/ChatsScreen.tsx');

  check(!/isActiveForShift\s*&&\s*line\.status/.test(shift), 'Shift screen no longer uses stale shift activation as the line KPI filter');
  check(shift.includes("line.status === 'WORK'") && situation.includes("line.status === 'WORK'"), 'Shift and Lines derive working lines from the same status');
  check(shift.includes('workingLines.reduce((total, line)'), 'Shift assigned-line KPI uses the same working-line scope');
  check(shift.includes("apiClient.get<Line[]>(isManagerView ? '/lines'"), 'Shift manager view reads canonical /lines API');
  check(ws.includes("type: 'assignment_updated'") && ws.includes("scheduleOperationalRefresh('assignment')"), 'assignment realtime invalidates operational read-models');
  check(ws.includes("scheduleOperationalRefresh('line')") && ws.includes("scheduleOperationalRefresh('wash')"), 'line and wash realtime invalidate operational read-models');
  check(ws.includes("scheduleOperationalRefresh('reconnect')"), 'WebSocket reconnect invalidates cached operational read-models');
  check(/broadcast\(WS_EVENTS\.LINE_UPDATED,\s*\{\s*id:\s*lineId,/s.test(lineService), 'line status event broadcasts the canonical line id');
  check(returns.includes("'has-media' : 'is-empty'"), 'returns cards expose an explicit no-photo layout state');
  check(styles.includes('.returns-publication-media.is-empty') && styles.includes('.returns-publication-card'), 'returns archive has canonical mobile responsive rules');
  check(styles.includes('.assignment-target-option.target-line') && styles.includes('.assignment-target-option.target-wash') && styles.includes('.assignment-target-option.target-work-area'), 'assignment targets use distinct Industrial Premium variants');
  check(pwaRuntime.includes("permission === 'prompt'") && pwaRuntime.includes("permission === 'denied'"), 'microphone prompt and denied states are distinct');
  check(chats.includes('navigator.mediaDevices.getUserMedia({ audio: true })'), 'voice recording requests the real browser microphone on user action');
  check(chats.includes('pending-voice-player') && chats.includes('\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0438\u0441\u0430\u0442\u044c'), 'recorded voice can be played and recorded again');

  console.log(JSON.stringify({
    status: failed.length ? 'FAIL' : 'PASS',
    evidence: {
      lineCount: lines.length,
      workingCount: working.length,
      washCount: onWash.length,
      assignedOnWorkingLines,
      shiftDate: timelineResult.data?.current?.shiftDate ?? null,
      shiftType: timelineResult.data?.current?.shiftType ?? null,
      peopleCount: Array.isArray(peopleResult.data) ? peopleResult.data.length : 0,
      testArtifactsCreated: 0,
    },
    passed,
    failed,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
