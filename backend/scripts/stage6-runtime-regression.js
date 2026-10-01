const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const warnings = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body && !options.form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function ensureAvailable(userId, headers) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  if (user.employeeState !== 'AVAILABLE') {
    await request('POST', '/assignments/release', { ...headers, body: { targetUserId: userId } });
  }
  const moveWindowSafeAt = new Date(Date.now() - 10 * 60 * 1000);
  await db.assignment.updateMany({
    where: { userId, factoryId: headers.factoryId, endedAt: { not: null }, startedAt: { gt: moveWindowSafeAt } },
    data: { startedAt: moveWindowSafeAt },
  });
  const refreshed = await db.user.findUnique({ where: { id: userId } });
  return refreshed?.employeeState === 'AVAILABLE';
}

async function main() {
  const login = await request('POST', '/auth/dev-login', { body: { userId: 'test-master' } });
  const factoryId = login.data?.recommendedFactoryId;
  const master = { userId: 'test-master', factoryId };
  record('dev-login test-master', login.status === 201, { status: login.status });
  record('factory context exists', Boolean(factoryId));

  const me = await request('GET', '/auth/me', master);
  record('GET /auth/me MASTER', me.status === 200 && me.data?.role === 'MASTER' && !me.data?.isGuest, { status: me.status });

  const current = await request('GET', '/shift/current', master);
  let shiftId = current.data?.id;
  if (!shiftId) {
    const started = await request('POST', '/shift/start', master);
    shiftId = started.data?.id;
    record('shift start', started.status === 201 && Boolean(shiftId), { status: started.status });
  } else {
    ok.push({ name: 'active shift exists' });
  }

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  const users = await db.user.count({
    where: { id: { in: ['test-admin', 'test-master', 'test-okk', 'test-store', 'worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5', 'contractor-1', 'contractor-2'] } },
  });
  const badWorkerPerms = await db.rolePermission.count({
    where: {
      role: { in: ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD'] },
      permissionCode: { in: ['lines.manage', 'assignments.manage', 'tasks.manage', 'wash.manage', 'okk.manage', 'stock.manage', 'shift-log.manage', 'audit.read'] },
    },
  });
  record('seed factory-4', Boolean(factory));
  record('seed test users', users >= 11, { count: users });
  record('worker/contractor permissions safe', badWorkerPerms === 0, { count: badWorkerPerms });

  await ensureAvailable('worker-1', master);
  await ensureAvailable('contractor-1', master);

  const people = await request('GET', '/shift/people?includeAll=true', master);
  record('GET /shift/people includeAll', people.status === 200 && Array.isArray(people.data), { status: people.status, count: people.data?.length });

  const lines = await request('GET', '/lines', master);
  const line = (lines.data || []).find((item) => item.positions?.length && item.staffingTemplates?.length && !item.activeWash)
    || (lines.data || []).find((item) => item.positions?.length && item.staffingTemplates?.length);
  record('GET /lines', lines.status === 200 && Array.isArray(lines.data) && lines.data.length > 0, { status: lines.status, count: lines.data?.length });
  record('line with positions/templates', Boolean(line), { line: line?.name });
  if (!line) throw new Error('No line with positions/templates');

  const position = line.positions[0];
  const template = line.staffingTemplates.find((item) => item.items?.some((templateItem) => templateItem.positionId === position.id)) || line.staffingTemplates[0];
  await request('POST', `/lines/${line.id}/activate-for-shift`, { ...master, body: { staffingTemplateId: template.id } });

  const board = await request('GET', `/lines/${line.id}/assignment-board`, master);
  const roles = new Set((board.data?.candidates || []).map((item) => item.role));
  record('assignment board slots', board.status === 200 && board.data?.slots?.length > 0, { status: board.status, slots: board.data?.slots?.length });
  record('candidates only WORKER/CONTRACTOR', [...roles].every((role) => ['WORKER', 'CONTRACTOR'].includes(role)), { roles: [...roles] });
  record('WORKER candidate visible', (board.data?.candidates || []).some((item) => item.userId === 'worker-1'));
  record('CONTRACTOR candidate visible', (board.data?.candidates || []).some((item) => item.userId === 'contractor-1'));

  for (const targetUserId of ['test-master', 'test-okk', 'test-store', 'contractor-lead-1', 'test-admin']) {
    const result = await request('POST', '/assignments/line', { ...master, body: { targetUserId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
    record(`invalid target role rejected ${targetUserId}`, result.status === 409, { status: result.status });
  }

  const workerAssign = await request('POST', '/assignments/line', { ...master, body: { targetUserId: 'worker-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('assign WORKER', workerAssign.status === 201, { status: workerAssign.status });
  const duplicate = await request('POST', '/assignments/line', { ...master, body: { targetUserId: 'worker-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('duplicate assignment conflict', duplicate.status === 409, { status: duplicate.status });
  const workerAfterAssign = await db.user.findUnique({ where: { id: 'worker-1' } });
  record('worker state ASSIGNED', workerAfterAssign?.employeeState === 'ASSIGNED', { state: workerAfterAssign?.employeeState });

  const otherLine = (lines.data || []).find((item) => item.id !== line.id && item.positions?.length);
  if (otherLine) {
    const wrongPosition = await request('POST', '/assignments/line', { ...master, body: { targetUserId: 'contractor-1', lineId: line.id, positionId: otherLine.positions[0].id, staffingTemplateId: template.id } });
    record('position from another line rejected', wrongPosition.status === 409, { status: wrongPosition.status });
  } else {
    warnings.push({ name: 'position from another line not checked' });
  }

  const release = await request('POST', '/assignments/release', { ...master, body: { targetUserId: 'worker-1' } });
  const released = await db.assignment.findFirst({ where: { userId: 'worker-1', factoryId, endedAt: { not: null } }, orderBy: { endedAt: 'desc' } });
  const workerAfterRelease = await db.user.findUnique({ where: { id: 'worker-1' } });
  record('release closes assignment and restores AVAILABLE', release.status === 201 && Boolean(released?.endedAt) && released?.endedById === 'test-master' && workerAfterRelease?.employeeState === 'AVAILABLE', { status: release.status, state: workerAfterRelease?.employeeState });

  const noCommentHome = await request('POST', '/shift/send-home', { ...master, body: { targetUserId: 'worker-1', comment: '' } });
  record('send-home without comment rejected', noCommentHome.status === 409, { status: noCommentHome.status });
  const home = await request('POST', '/shift/send-home', { ...master, body: { targetUserId: 'worker-1', comment: 'stage6 regression' } });
  const workerAfterHome = await db.user.findUnique({ where: { id: 'worker-1' } });
  record('send-home with comment sets OFF_SHIFT', home.status === 201 && workerAfterHome?.employeeState === 'OFF_SHIFT', { status: home.status, state: workerAfterHome?.employeeState });
  const offShiftAssign = await request('POST', '/assignments/line', { ...master, body: { targetUserId: 'worker-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('OFF_SHIFT assignment rejected', offShiftAssign.status === 409, { status: offShiftAssign.status });
  await request('POST', '/assignments/release', { ...master, body: { targetUserId: 'worker-1' } });

  const dashboard = await request('GET', `/lines/${line.id}/dashboard`, master);
  record('line dashboard', dashboard.status === 200 && dashboard.data?.positions?.length > 0, { status: dashboard.status });
  record('dashboard active task/wash shape', dashboard.status === 200 && Array.isArray(dashboard.data?.activeTasks) && Array.isArray(dashboard.data?.activeWash));

  const pauseNoComment = await request('PATCH', `/lines/${line.id}/status`, { ...master, body: { status: 'PAUSE' } });
  const pause = await request('PATCH', `/lines/${line.id}/status`, { ...master, body: { status: 'PAUSE', comment: 'stage6 pause' } });
  const stopNoComment = await request('PATCH', `/lines/${line.id}/status`, { ...master, body: { status: 'STOP' } });
  const stop = await request('PATCH', `/lines/${line.id}/status`, { ...master, body: { status: 'STOP', comment: 'stage6 stop' } });
  const work = await request('PATCH', `/lines/${line.id}/status`, { ...master, body: { status: 'WORK' } });
  record('PAUSE without comment rejected', [400, 409].includes(pauseNoComment.status), { status: pauseNoComment.status });
  record('PAUSE with comment', pause.status === 200, { status: pause.status });
  record('STOP without comment rejected', [400, 409].includes(stopNoComment.status), { status: stopNoComment.status });
  record('STOP with comment', stop.status === 200, { status: stop.status });
  record('return WORK', work.status === 200, { status: work.status });

  const emptyTask = await request('POST', '/tasks', { ...master, body: { lineId: line.id, type: 'URGENT', description: '', operationId: `empty-${Date.now()}` } });
  const task = await request('POST', '/tasks', { ...master, body: { lineId: line.id, type: 'URGENT', description: `stage6 regression ${Date.now()}`, operationId: `task-${Date.now()}` } });
  record('task without description rejected', emptyTask.status === 409, { status: emptyTask.status });
  record('urgent task created', task.status === 201 && task.data?.type === 'URGENT', { status: task.status });

  const uploadForm = new FormData();
  uploadForm.append('entityType', 'TASK');
  uploadForm.append('entityId', task.data?.id || '');
  uploadForm.append('kind', 'FILE');
  uploadForm.append('file', new Blob(['stage6 regression attachment'], { type: 'text/plain' }), 'stage6-regression.txt');
  const upload = await request('POST', '/attachments/upload', { ...master, form: uploadForm });
  record('attachment upload FILE', upload.status === 201, { status: upload.status });
  const attachmentId = upload.data?.id;
  const metadata = await request('GET', `/attachments/${attachmentId}`, master);
  const file = await request('GET', `/attachments/${attachmentId}/file`, master);
  record('attachment metadata access', metadata.status === 200, { status: metadata.status });
  record('attachment file access', file.status === 200, { status: file.status });

  const badMimeForm = new FormData();
  badMimeForm.append('entityType', 'TASK');
  badMimeForm.append('entityId', task.data?.id || '');
  badMimeForm.append('kind', 'PHOTO');
  badMimeForm.append('file', new Blob(['not-image'], { type: 'text/plain' }), 'not-image.txt');
  const badMime = await request('POST', '/attachments/upload', { ...master, form: badMimeForm });
  record('unsupported PHOTO mime rejected', badMime.status === 409, { status: badMime.status });
  const missingFields = await request('POST', '/attachments/upload', { ...master, form: new FormData() });
  record('missing attachment fields rejected', missingFields.status === 409, { status: missingFields.status });
  const tasks = await request('GET', '/tasks', master);
  record('task list includes attachments shape', tasks.status === 200 && tasks.data?.some((item) => item.id === task.data?.id && Array.isArray(item.attachments)), { status: tasks.status });

  await ensureAvailable('contractor-1', master);
  const contractorAssign = await request('POST', '/assignments/line', { ...master, body: { targetUserId: 'contractor-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('assign CONTRACTOR', contractorAssign.status === 201, { status: contractorAssign.status });
  const washStart = await request('POST', '/wash/start', { ...master, body: { lineId: line.id, operationId: `wash-${Date.now()}` } });
  record('wash start from line or active conflict', washStart.status === 201 || washStart.status === 409, { status: washStart.status });
  if (washStart.status === 201) {
    const contractorAfterWash = await db.user.findUnique({ where: { id: 'contractor-1' } });
    const washAssignment = await db.assignment.findFirst({ where: { userId: 'contractor-1', factoryId, kind: 'WASH', endedAt: null } });
    record('wash moves assigned employee to WASHING', contractorAfterWash?.employeeState === 'WASHING' && Boolean(washAssignment), { state: contractorAfterWash?.employeeState });
    const duplicateWash = await request('POST', '/wash/start', { ...master, body: { lineId: line.id, operationId: `wash-dup-${Date.now()}` } });
    record('duplicate wash start rejected', duplicateWash.status === 409, { status: duplicateWash.status });
    const washList = await request('GET', '/wash', master);
    record('wash list attachments shape', washList.status === 200 && washList.data?.some((item) => item.id === washStart.data?.id && Array.isArray(item.attachments)), { status: washList.status });
    const complete = await request('POST', `/wash/${washStart.data.id}/complete`, { ...master, body: { operationId: `wash-complete-${Date.now()}` } });
    record('wash complete when no unresolved issues', complete.status === 201, { status: complete.status });
  } else {
    warnings.push({ name: 'wash transition details skipped', reason: 'active wash conflict on selected line' });
    await request('POST', '/assignments/release', { ...master, body: { targetUserId: 'contractor-1' } });
  }

  const activeShift = await request('GET', '/shift/current', master);
  const missingPercent = await request('POST', '/shift/line-results', { ...master, body: { lineId: line.id, shiftSessionId: activeShift.data?.id } });
  const lowNoComment = await request('POST', '/shift/line-results', { ...master, body: { lineId: line.id, shiftSessionId: activeShift.data?.id, planCompletionPercent: 70 } });
  const highResult = await request('POST', '/shift/line-results', { ...master, body: { lineId: line.id, shiftSessionId: activeShift.data?.id, planCompletionPercent: 110 } });
  const lowResult = await request('POST', '/shift/line-results', { ...master, body: { lineId: line.id, shiftSessionId: activeShift.data?.id, planCompletionPercent: 75, comment: 'stage6 low result' } });
  record('line result requires percent', missingPercent.status === 409, { status: missingPercent.status });
  record('line result below 80 requires comment', lowNoComment.status === 409, { status: lowNoComment.status });
  record('line result >100 allowed', highResult.status === 201, { status: highResult.status });
  record('line result below 80 with comment allowed', lowResult.status === 201, { status: lowResult.status });

  const workerHeaders = { userId: 'worker-1', factoryId };
  const workerChecks = [
    ['PATCH', `/lines/${line.id}/status`, { status: 'PAUSE', comment: 'worker forbidden' }, 'worker cannot manage lines'],
    ['POST', '/assignments/line', { targetUserId: 'contractor-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id }, 'worker cannot manage assignments'],
    ['POST', '/tasks', { lineId: line.id, type: 'URGENT', description: 'worker forbidden', operationId: `worker-task-${Date.now()}` }, 'worker cannot manage tasks'],
    ['POST', '/wash/start', { lineId: line.id, operationId: `worker-wash-${Date.now()}` }, 'worker cannot manage wash'],
    ['GET', '/admin/overview', null, 'worker cannot admin overview'],
  ];
  for (const [method, url, body, name] of workerChecks) {
    const result = await request(method, url, { ...workerHeaders, body });
    record(name, result.status === 403, { status: result.status });
  }
  const workerMe = await request('GET', '/shift/me', workerHeaders);
  record('worker self-card available', workerMe.status === 200, { status: workerMe.status });
  const contractorForbidden = await request('POST', '/assignments/line', { userId: 'contractor-1', factoryId, body: { targetUserId: 'worker-1', lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('contractor cannot manage assignments', contractorForbidden.status === 403, { status: contractorForbidden.status });

  const auditActions = await db.auditLog.groupBy({
    by: ['action'],
    where: { action: { in: ['SHIFT_STARTED', 'ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_RELEASED', 'ASSIGNMENT_REJECTED_FOR_ROLE', 'ASSIGNMENT_REJECTED_FOR_CONFLICT', 'EMPLOYEE_SENT_HOME', 'LINE_STATUS_UPDATED', 'TASK_CREATED', 'WASH_STARTED', 'WASH_COMPLETED', 'LINE_SHIFT_RESULT_CREATED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED'] } },
    _count: { _all: true },
  });
  const audit = Object.fromEntries(auditActions.map((item) => [item.action, item._count._all]));
  for (const action of ['ASSIGNMENT_LINE_CREATED', 'ASSIGNMENT_RELEASED', 'ASSIGNMENT_REJECTED_FOR_ROLE', 'ASSIGNMENT_REJECTED_FOR_CONFLICT', 'EMPLOYEE_SENT_HOME', 'LINE_STATUS_UPDATED', 'TASK_CREATED', 'LINE_SHIFT_RESULT_CREATED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    record(`audit ${action}`, (audit[action] || 0) > 0, { count: audit[action] || 0 });
  }

  const report = { api: API, factoryId, ok, warnings, failures, audit };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
