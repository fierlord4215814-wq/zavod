const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [], warnings: [] };
const stamp = Date.now();
const prefix = `stage21-sim-${stamp}`;

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function warn(name, detail) {
  state.warnings.push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
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

async function expect(name, expected, promise) {
  const response = await promise;
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (expectedList.includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function expectForbidden(name, promise) {
  const response = await promise;
  if ([403, 409].includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: '403 or domain 409', status: response.status, data: response.data });
  return response;
}

function actor(userId, factoryId) {
  return { userId, factoryId };
}

async function upload(user, entityType, entityId, label) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `${prefix}-upload-${entityType}-${Math.random().toString(36).slice(2)}`);
  form.append('file', new Blob([`Stage21 ${label}`], { type: 'text/plain' }), `${label}.txt`);
  return request('POST', '/attachments/upload', { ...user, form });
}

async function auditCount(actions, since) {
  const rows = await db.auditLog.groupBy({
    by: ['action'],
    where: { action: { in: actions }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.action, row._count._all]));
}

async function notificationVisible(user, type, entityId) {
  const list = await request('GET', '/notifications', user);
  return list.status === 200 && Array.isArray(list.data) && list.data.some((item) => item.type === type && item.entityId === entityId);
}

async function prepareLine(factoryId) {
  const line = await db.line.create({
    data: { factoryId, name: `Stage21 simulation line ${stamp}`, status: 'WORK' },
  });
  const operator = await db.linePosition.create({
    data: { factoryId, lineId: line.id, name: 'Stage21 operator', sortOrder: 10 },
  });
  const packer = await db.linePosition.create({
    data: { factoryId, lineId: line.id, name: 'Stage21 contractor slot', sortOrder: 20 },
  });
  const template = await db.lineStaffingTemplate.create({
    data: { factoryId, lineId: line.id, name: `Stage21 staffing ${stamp}` },
  });
  await db.lineStaffingTemplateItem.createMany({
    data: [
      { templateId: template.id, positionId: operator.id, requiredCount: 1, sortOrder: 10 },
      { templateId: template.id, positionId: packer.id, requiredCount: 1, sortOrder: 20 },
    ],
  });
  return { line, operator, packer, template };
}

async function ensureAvailable(factoryId, ids) {
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: ids }, endedAt: null },
    data: { endedAt: new Date() },
  });
  await db.user.updateMany({
    where: { id: { in: ids } },
    data: { employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
  });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;

  const departments = await db.department.findMany({ where: { factoryId } });
  const byCode = Object.fromEntries(departments.map((item) => [item.code, item]));
  const mastersDept = byCode.masters;
  const kipiaDept = byCode.kipia;
  const managementDept = byCode.management;
  const storeDept = byCode.store;
  if (!mastersDept || !kipiaDept || !managementDept || !storeDept) {
    throw new Error('required seeded departments not found');
  }

  const admin = actor('test-admin', factoryId);
  const management = actor('test-management', factoryId);
  const master = actor('test-master', factoryId);
  const worker = actor('worker-1', factoryId);
  const workerTwo = actor('worker-2', factoryId);
  const contractor = actor('contractor-1', factoryId);
  const contractorTwo = actor('contractor-2', factoryId);
  const lead = actor('contractor-lead-1', factoryId);
  const okk = actor('test-okk', factoryId);
  const store = actor('test-store', factoryId);
  const tech = actor('test-tech-kipia', factoryId);
  const holod = actor('test-tech-holod', factoryId);
  const assignmentWorkerId = `stage21-worker-${stamp}`;
  const assignmentContractorId = `stage21-contractor-${stamp}`;

  await db.user.create({
    data: { id: assignmentWorkerId, factoryId, role: 'WORKER', employeeState: 'AVAILABLE' },
  });
  await db.userFactoryAccess.create({
    data: { userId: assignmentWorkerId, factoryId, role: 'WORKER', departmentId: mastersDept.id, isActive: true, isGuest: false },
  });
  await db.user.create({
    data: { id: assignmentContractorId, factoryId, role: 'CONTRACTOR', employeeState: 'AVAILABLE' },
  });
  await db.userFactoryAccess.create({
    data: { userId: assignmentContractorId, factoryId, role: 'CONTRACTOR', departmentId: mastersDept.id, isActive: true, isGuest: false },
  });

  await ensureAvailable(factoryId, [
    'worker-1',
    'worker-2',
    'contractor-1',
    'contractor-2',
    'test-master',
    'test-okk',
    'test-store',
    'test-tech-kipia',
    'test-tech-holod',
    'test-management',
    'contractor-lead-1',
  ]);

  await expect('ADMIN dev context works', 201, request('POST', '/auth/dev-login', { body: { userId: 'test-admin' } }));
  await expect('WORKER self context works', 200, request('GET', '/shift/me', worker));
  await db.user.update({ where: { id: 'worker-2' }, data: { blockedAt: new Date() } });
  await expect('blocked user forbidden in shift self-view', 403, request('GET', '/shift/me', workerTwo));
  await db.user.update({ where: { id: 'worker-2' }, data: { blockedAt: null } });

  const targetDate = new Date(Date.now() + (60 + Math.floor(Math.random() * 2000)) * 24 * 60 * 60 * 1000).toISOString();
  const willBe = await expect('WORKER marks will-be', 201, request('POST', '/shift/will-be', {
    ...worker,
    body: { targetShiftDate: targetDate, shiftType: 'DAY', comment: 'Stage21 will be' },
  }));
  await expect('WORKER self-view includes own context', 200, request('GET', '/shift/me', worker));
  await expect('CONTRACTOR_LEAD submits contractors', 201, request('POST', '/shift/contractor-submissions', {
    ...lead,
    body: {
      targetShiftDate: targetDate,
      shiftType: 'DAY',
      contractorUserIds: ['contractor-1', 'contractor-2'],
      comment: 'Stage21 contractor lead submission',
    },
  }));
  await expect('MASTER future view works', 200, request('GET', '/shift/future', master));

  const masterShiftStart = await request('POST', '/shift/start', master);
  if ([200, 201].includes(masterShiftStart.status)) ok('MASTER starts/current shift', { status: masterShiftStart.status });
  else if (masterShiftStart.status === 409 && masterShiftStart.data?.message === 'shift already active') ok('MASTER already has active shift', { status: masterShiftStart.status });
  else fail('MASTER starts/current shift', { expected: '200, 201 or active-shift 409', status: masterShiftStart.status, data: masterShiftStart.data });
  const masterShift = await db.shiftSession.findFirst({
    where: { userId: 'test-master', factoryId, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (!masterShift) fail('active master shift session exists after start');
  await expect('MASTER current shift view works', 200, request('GET', '/shift/current', master));

  const { line, operator, packer, template } = await prepareLine(factoryId);
  await expect('MASTER activates line for shift', 201, request('POST', `/lines/${line.id}/activate-for-shift`, {
    ...master,
    body: { staffingTemplateId: template.id },
  }));
  const dashboard = await expect('line dashboard loads', 200, request('GET', `/lines/${line.id}/dashboard`, master));
  if (dashboard.data?.line?.id === line.id) ok('line dashboard references Stage21 line');
  else fail('line dashboard references Stage21 line', dashboard.data);

  const board = await expect('assignment board loads', 200, request('GET', `/lines/${line.id}/assignment-board`, master));
  const candidateRoles = (board.data?.candidates ?? []).map((item) => item.role);
  if (candidateRoles.length && candidateRoles.every((role) => ['WORKER', 'CONTRACTOR'].includes(role))) ok('assignment candidates are only WORKER/CONTRACTOR', { roles: candidateRoles });
  else fail('assignment candidates are only WORKER/CONTRACTOR', { roles: candidateRoles, candidates: board.data?.candidates });

  await expect('MASTER assigns WORKER to line', 201, request('POST', '/assignments/line', {
    ...master,
    body: { targetUserId: assignmentWorkerId, lineId: line.id, positionId: operator.id, staffingTemplateId: template.id },
  }));
  await expect('MASTER assigns CONTRACTOR to line', 201, request('POST', '/assignments/line', {
    ...master,
    body: { targetUserId: assignmentContractorId, lineId: line.id, positionId: packer.id, staffingTemplateId: template.id },
  }));
  for (const targetUserId of ['test-master', 'test-okk', 'test-store', 'test-admin']) {
    await expectForbidden(`line assignment rejects ${targetUserId}`, request('POST', '/assignments/line', {
      ...master,
      body: { targetUserId, lineId: line.id, positionId: operator.id, staffingTemplateId: template.id },
    }));
  }

  await expect('MASTER records line result', 201, request('POST', '/shift/line-results', {
    ...master,
    body: { shiftSessionId: masterShift?.id, lineId: line.id, planCompletionPercent: 87, comment: 'Stage21 line result' },
  }));

  await expectForbidden('WORKER task board forbidden', request('GET', '/tasks/board', worker));
  const urgent = await expect('MASTER creates URGENT task from line', 201, request('POST', '/tasks', {
    ...master,
    body: {
      description: `Stage21 urgent task from line ${line.name}`,
      type: 'URGENT',
      lineId: line.id,
      departmentRecipientIds: [kipiaDept.id],
      operationId: `${prefix}-urgent-task`,
    },
  }));
  const long = await expect('MASTER creates overdue LONG task', 201, request('POST', '/tasks', {
    ...master,
    body: {
      description: `Stage21 LONG task for TECH ${stamp}`,
      type: 'LONG',
      deadlineAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      departmentRecipientIds: [kipiaDept.id],
      assigneeUserIds: ['test-tech-kipia'],
      operationId: `${prefix}-long-task`,
    },
  }));
  await expect('TECH takes LONG task', 201, request('POST', `/tasks/${long.data.id}/take`, {
    ...tech,
    body: { operationId: `${prefix}-long-take` },
  }));
  await expect('TECH comments LONG task', 201, request('POST', `/tasks/${long.data.id}/comment`, {
    ...tech,
    body: { message: 'Stage21 tech comment', operationId: `${prefix}-long-comment` },
  }));
  const taskUpload = await expect('TECH attaches file to task', 201, upload(tech, 'TASK', long.data.id, 'stage21-task'));
  const taskMetadata = await expect('task attachment metadata readable', 200, request('GET', `/attachments/${taskUpload.data?.id}`, tech));
  if (!('storagePath' in (taskMetadata.data ?? {}))) ok('attachment metadata hides storagePath');
  else fail('attachment metadata hides storagePath', taskMetadata.data);
  await expect('TECH completes LONG task', 201, request('POST', `/tasks/${long.data.id}/complete`, {
    ...tech,
    body: { comment: 'Stage21 done', operationId: `${prefix}-long-complete` },
  }));
  await expect('LONG escalation check runs', 201, request('POST', '/tasks/escalation/check', { ...management, body: {} }));

  const okkRecord = await expect('OKK creates OKK record with user master', 201, request('POST', '/okk', {
    ...okk,
    body: { lineId: line.id, assignedMasterId: 'test-master', description: 'Stage21 OKK record' },
  }));
  await expectForbidden('WORKER cannot create OKK record', request('POST', '/okk', {
    ...worker,
    body: { lineId: line.id, description: 'forbidden Stage21 OKK' },
  }));

  const stock = await expect('STORE creates stock defect', 201, request('POST', '/stock', {
    ...store,
    body: { productName: `Stage21 некондиция ${stamp}`, quantity: 1 },
  }));
  await expectForbidden('WORKER cannot create stock defect', request('POST', '/stock', {
    ...worker,
    body: { productName: 'forbidden Stage21 stock', quantity: 1 },
  }));

  const wash = await expect('MASTER starts wash', 201, request('POST', '/wash/start', {
    ...master,
    body: { lineId: line.id, operationId: `${prefix}-wash-start` },
  }));
  const washMessage = await expect('MASTER adds wash message', 201, request('POST', `/wash/${wash.data.id}/message`, {
    ...master,
    body: { message: 'Stage21 wash message', operationId: `${prefix}-wash-message` },
  }));
  const washIssue = await expect('MASTER creates wash issue', 201, request('POST', `/wash/${wash.data.id}/issues`, {
    ...master,
    body: { title: 'Stage21 wash issue', description: 'Stage21 issue details' },
  }));
  await expect('MASTER resolves wash issue', 200, request('PATCH', `/wash/issues/${washIssue.data.id}/status`, {
    ...master,
    body: { status: 'RESOLVED', comment: 'Stage21 issue resolved' },
  }));
  const control = await expect('MASTER creates wash control mini task', 201, request('POST', `/wash/${wash.data.id}/control-items`, {
    ...master,
    body: { title: 'Stage21 control item', type: 'MINI_TASK', requiresPhoto: false },
  }));
  await expect('MASTER completes wash control mini task', 200, request('PATCH', `/wash/control-items/${control.data.id}`, {
    ...master,
    body: { status: 'DONE', comment: 'Stage21 control done' },
  }));
  await expect('OKK creates wash review', 201, request('POST', `/wash/${wash.data.id}/okk-review`, {
    ...okk,
    body: { status: 'APPROVED', comment: 'Stage21 OKK review approved', rating: 5 },
  }));
  await expect('MASTER completes wash', 201, request('POST', `/wash/${wash.data.id}/complete`, {
    ...master,
    body: { operationId: `${prefix}-wash-complete` },
  }));

  await ensureAvailable(factoryId, ['worker-1', 'contractor-1']);
  await expect('MASTER sends worker home with comment', 201, request('POST', '/shift/send-home', {
    ...master,
    body: { targetUserId: 'worker-1', comment: 'Stage21 send home' },
  }));
  await expect('WORKER creates return request', 201, request('POST', '/shift/return-request', {
    ...worker,
    body: { reason: 'Stage21 return request' },
  }));
  const returns = await expect('MASTER reads return requests', 200, request('GET', '/shift/return-requests', master));
  const pendingReturn = (returns.data ?? []).find((item) => item.userId === 'worker-1' && item.reason?.includes('Stage21'));
  if (pendingReturn) {
    await expect('MASTER approves return request', 200, request('PATCH', `/shift/return-requests/${pendingReturn.id}`, {
      ...master,
      body: { status: 'APPROVED', decisionComment: 'Stage21 approved' },
    }));
  } else {
    fail('MASTER sees Stage21 return request', returns.data);
  }

  const checklistTemplate = await expect('ADMIN creates Stage21 checklist template', 201, request('POST', '/checklists/templates', {
    ...admin,
    body: { name: `Stage21 checklist ${stamp}`, description: 'Stage21 self-selected template', departmentId: mastersDept.id },
  }));
  const checklistRow = await expect('ADMIN creates required comment checklist row', 201, request('POST', `/checklists/templates/${checklistTemplate.data.id}/rows`, {
    ...admin,
    body: { title: 'Stage21 required comment row', requiresComment: true, sortOrder: 10 },
  }));
  const checklistPhotoRow = await expect('ADMIN creates required photo checklist row', 201, request('POST', `/checklists/templates/${checklistTemplate.data.id}/rows`, {
    ...admin,
    body: { title: 'Stage21 required photo row', requiresPhoto: true, sortOrder: 20 },
  }));
  const run = await expect('MASTER starts own department checklist run', 201, request('POST', '/checklists/runs', {
    ...master,
    body: { templateId: checklistTemplate.data.id },
  }));
  const runDetail = await expect('MASTER reads checklist run detail', 200, request('GET', `/checklists/runs/${run.data.id}`, master));
  const runCommentRow = runDetail.data.rows.find((row) => row.templateRowId === checklistRow.data.id);
  const runPhotoRow = runDetail.data.rows.find((row) => row.templateRowId === checklistPhotoRow.data.id);
  await expect('required checklist comment missing rejected', 409, request('POST', `/checklists/runs/${run.data.id}/rows/${runCommentRow.id}/complete`, {
    ...master,
    body: { status: 'OK' },
  }));
  await expect('MASTER completes checklist row with comment', 201, request('POST', `/checklists/runs/${run.data.id}/rows/${runCommentRow.id}/complete`, {
    ...master,
    body: { status: 'OK', comment: 'Stage21 row comment' },
  }));
  await expect('required checklist photo missing rejected', 409, request('POST', `/checklists/runs/${run.data.id}/rows/${runPhotoRow.id}/complete`, {
    ...master,
    body: { status: 'OK' },
  }));
  await expect('MASTER uploads checklist row photo/file', 201, upload(master, 'CHECKLIST_RUN_ROW', runPhotoRow.id, 'stage21-checklist-row'));
  await expect('MASTER completes checklist photo row', 201, request('POST', `/checklists/runs/${run.data.id}/rows/${runPhotoRow.id}/complete`, {
    ...master,
    body: { status: 'OK', comment: 'Stage21 photo attached' },
  }));
  await expect('MASTER pauses checklist with reason', 201, request('POST', `/checklists/runs/${run.data.id}/pause`, {
    ...master,
    body: { reason: 'Stage21 pause reason' },
  }));
  await expect('MASTER resumes checklist', 201, request('POST', `/checklists/runs/${run.data.id}/resume`, master));
  await expect('MASTER closes checklist', 201, request('POST', `/checklists/runs/${run.data.id}/close`, {
    ...master,
    body: { comment: 'Stage21 checklist closed' },
  }));

  const item = await expect('MANAGEMENT creates minimum stock item', 201, request('POST', '/orders/items', {
    ...management,
    body: {
      name: `Stage21 critical item ${stamp}`,
      description: 'Stage21 minimum stock simulation',
      minThreshold: 3,
      initialQuantity: 4,
      departmentId: managementDept.id,
    },
  }));
  await expect('MASTER takes stock item with comment', 201, request('POST', `/orders/items/${item.data.id}/take`, {
    ...master,
    body: { quantity: 2, comment: 'Stage21 took into work' },
  }));
  await expect('MASTER creates order request from stock item', 201, request('POST', `/orders/items/${item.data.id}/order`, {
    ...master,
    body: { requestedQuantity: 5, reasonComment: 'Stage21 below threshold order' },
  }));
  const orderRequests = await expect('MANAGEMENT sees active order requests', 200, request('GET', '/orders/requests', management));
  const orderRequest = (orderRequests.data ?? []).find((itemRow) => itemRow.title?.includes('Stage21 critical item') || itemRow.reasonComment?.includes('Stage21'));
  if (orderRequest) {
    await expect('MANAGEMENT closes Stage21 order request', 201, request('POST', `/orders/requests/${orderRequest.id}/close`, {
      ...management,
      body: { closeStatus: 'ORDERED', comment: 'Stage21 ordered' },
    }));
  } else {
    fail('MANAGEMENT sees Stage21 order request', orderRequests.data);
  }

  const shiftLog = await expect('MANAGEMENT creates important shift log', 201, request('POST', '/shift-log', {
    ...management,
    body: {
      departmentId: managementDept.id,
      title: `Stage21 important handover ${stamp}`,
      text: 'Stage21 important handover text',
      isImportant: true,
    },
  }));
  await expect('MANAGEMENT reads shift log entry', 200, request('GET', `/shift-log/${shiftLog.data.id}`, management));
  await expect('MANAGEMENT marks shift log read', 201, request('POST', `/shift-log/${shiftLog.data.id}/read`, management));

  const defrostLine = await db.line.create({ data: { factoryId, name: `Stage21 defrost line ${stamp}`, status: 'WORK' } });
  const defrost = await expect('TECH_HOLOD starts defrost', 201, request('POST', '/defrost/start', {
    ...holod,
    body: { lineId: defrostLine.id, comment: 'Stage21 defrost start' },
  }));
  const defrostDashboard = await expect('line dashboard shows active defrost', 200, request('GET', `/lines/${defrostLine.id}/dashboard`, master));
  if (defrostDashboard.data?.activeDefrost?.id === defrost.data.id) ok('active defrost indicator is present on line dashboard');
  else fail('active defrost indicator is present on line dashboard', defrostDashboard.data?.activeDefrost);
  await expect('TECH_HOLOD ends defrost', 201, request('POST', `/defrost/${defrost.data.id}/end`, {
    ...holod,
    body: { comment: 'Stage21 defrost completed' },
  }));

  await expect('ADMIN reads ops overview', 200, request('GET', '/ops/overview', admin));
  const audit = await expect('ADMIN reads ops audit', 200, request('GET', '/ops/audit?limit=120', admin));
  if (Array.isArray(audit.data) && audit.data.some((item) => item.action === 'ACCESS_DENIED')) ok('audit contains ACCESS_DENIED');
  else fail('audit contains ACCESS_DENIED', audit.data);

  const unread = await expect('MANAGEMENT unread notification count works', 200, request('GET', '/notifications/unread-count', management));
  if (typeof unread.data?.count === 'number') ok('unread notification count is numeric', unread.data);
  else fail('unread notification count is numeric', unread.data);
  if (await notificationVisible(management, 'ORDER_STOCK_BELOW_THRESHOLD', item.data.id)) ok('low stock notification visible to MANAGEMENT');
  else fail('low stock notification visible to MANAGEMENT', { type: 'ORDER_STOCK_BELOW_THRESHOLD', entityId: item.data.id });
  if (await notificationVisible(management, 'SHIFT_LOG_IMPORTANT_CREATED', shiftLog.data.id)) ok('important shift log notification visible to MANAGEMENT');
  else fail('important shift log notification visible to MANAGEMENT', { type: 'SHIFT_LOG_IMPORTANT_CREATED', entityId: shiftLog.data.id });
  await expect('MANAGEMENT read-all notifications works', 201, request('POST', '/notifications/read-all', management));

  await expectForbidden('WORKER cannot read ops overview', request('GET', '/ops/overview', worker));
  await expectForbidden('CONTRACTOR_LEAD cannot use assignment board as manager', request('GET', `/lines/${line.id}/assignment-board`, lead));
  await expectForbidden('CONTRACTOR cannot read wash list', request('GET', '/wash', contractor));
  await expectForbidden('STORE cannot manage defrost', request('POST', '/defrost/start', {
    ...store,
    body: { lineId: defrostLine.id, comment: 'forbidden Stage21 defrost' },
  }));

  const foreignFactory = await db.factory.upsert({
    where: { code: 'stage21-sim-foreign' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage21-sim-foreign', name: 'Stage21 foreign factory' },
  });
  await expectForbidden('cross-factory line dashboard denied', request('GET', `/lines/${line.id}/dashboard`, {
    userId: 'test-master',
    factoryId: foreignFactory.id,
  }));
  await expectForbidden('cross-factory attachment denied', request('GET', `/attachments/${taskUpload.data?.id}`, {
    userId: 'test-tech-kipia',
    factoryId: foreignFactory.id,
  }));

  const requiredAudit = [
    'SHIFT_WILL_BE_MARKED',
    'CONTRACTOR_SUBMISSION_CREATED',
    'LINE_ACTIVATED_IN_SHIFT',
    'TASK_CREATED',
    'TASK_TAKEN',
    'TASK_DONE',
    'WASH_STARTED',
    'WASH_ISSUE_CREATED',
    'WASH_OKK_REVIEW_CREATED',
    'WASH_COMPLETED',
    'CHECKLIST_RUN_STARTED',
    'CHECKLIST_ROW_COMPLETED',
    'ORDER_ITEM_TAKEN',
    'ORDER_REQUEST_CREATED',
    'SHIFT_LOG_IMPORTANT_CREATED',
    'DEFROST_STARTED',
    'DEFROST_COMPLETED',
    'ATTACHMENT_UPLOADED',
    'ACCESS_DENIED',
  ];
  const counts = await auditCount(requiredAudit, since);
  for (const action of requiredAudit) {
    if ((counts[action] || 0) > 0) ok(`audit ${action}`, { count: counts[action] });
    else fail(`audit ${action}`, { count: 0 });
  }

  console.log(JSON.stringify({
    api: API,
    factoryId,
    stage21Prefix: prefix,
    willBeId: willBe.data?.id,
    urgentTaskId: urgent.data?.id,
    okkRecordId: okkRecord.data?.id,
    stockDefectId: stock.data?.id,
    washSessionId: wash.data?.id,
    checklistRunId: run.data?.id,
    orderItemId: item.data?.id,
    shiftLogId: shiftLog.data?.id,
    defrostEventId: defrost.data?.id,
    ok: state.ok,
    warnings: state.warnings,
    failures: state.failures,
  }, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.user.updateMany({
      where: { id: { in: ['worker-1', 'worker-2', 'contractor-1', 'contractor-2'] } },
      data: { blockedAt: null },
    }).catch(() => {});
    await db.$disconnect();
  });
