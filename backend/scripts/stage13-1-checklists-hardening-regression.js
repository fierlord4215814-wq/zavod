const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://127.0.0.1:3000';

const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(path, { userId = 'test-admin', factoryId, method = 'GET', body, form } = {}) {
  const headers = { 'x-user-id': userId };
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (!form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

function makeFileForm(entityType, entityId) {
  const form = new FormData();
  form.append('file', new Blob(['stage131-photo'], { type: 'image/png' }), 'stage131.png');
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage131-${entityType}-${entityId}-${Date.now()}`);
  return form;
}

async function auditCount(action, since) {
  return prisma.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function createTemplate(factoryId, departmentId, name) {
  const response = await expectStatus(`create template ${name}`, 201, request('/checklists/templates', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { name, departmentId },
  }));
  return response.data;
}

async function createRow(factoryId, templateId, title, body = {}) {
  const response = await expectStatus(`create row ${title}`, 201, request(`/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { title, sortOrder: body.sortOrder ?? 10, ...body },
  }));
  return response.data;
}

async function startRun(factoryId, userId, templateId, name) {
  const response = await expectStatus(name, 201, request('/checklists/runs', {
    userId,
    factoryId,
    method: 'POST',
    body: { templateId },
  }));
  return response.data;
}

async function main() {
  const startedAt = new Date();
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const masters = await prisma.department.findFirst({ where: { factoryId, code: 'masters' } });
  const management = await prisma.department.findFirst({ where: { factoryId, code: 'management' } });
  const kipia = await prisma.department.findFirst({ where: { factoryId, code: 'kipia' } });
  if (!masters || !management || !kipia) throw new Error('required departments not found');

  await expectStatus('enable post-close edit window', 200, request('/checklists/settings', {
    userId: 'test-admin',
    factoryId,
    method: 'PATCH',
    body: { allowEditAfterCloseHours: 24, autoCloseAtDayShiftEnd: true, reason: 'stage13.1 regression' },
  }));

  const template = await createTemplate(factoryId, management.id, `Stage13.1 template ${Date.now()}`);
  const rowA = await createRow(factoryId, template.id, 'Stable row A', { sortOrder: 10 });
  const oldRun = await startRun(factoryId, 'test-admin', template.id, 'old run starts before row changes');
  const rowB = await createRow(factoryId, template.id, 'New row B', { sortOrder: 20 });
  const newRun = await startRun(factoryId, 'test-admin', template.id, 'new run sees row changes');
  const oldDetail = await expectStatus('old run detail', 200, request(`/checklists/runs/${oldRun.id}`, { userId: 'test-admin', factoryId }));
  const newDetail = await expectStatus('new run detail', 200, request(`/checklists/runs/${newRun.id}`, { userId: 'test-admin', factoryId }));
  if (oldDetail.data.rows.length === 1 && newDetail.data.rows.length === 2) ok('template changes affect only new runs');
  else fail('template changes affect only new runs', { oldRows: oldDetail.data.rows.length, newRows: newDetail.data.rows.length });

  await expectStatus('template row update works', 200, request(`/checklists/templates/${template.id}/rows/${rowB.id}`, {
    userId: 'test-admin',
    factoryId,
    method: 'PATCH',
    body: { title: 'Updated row B', requiresComment: true, sortOrder: 30 },
  }));
  await expectStatus('template row archive works', 200, request(`/checklists/templates/${template.id}/rows/${rowB.id}`, {
    userId: 'test-admin',
    factoryId,
    method: 'PATCH',
    body: { isActive: false },
  }));

  const activeRun = await startRun(factoryId, 'test-admin', template.id, 'active run for scheduler');
  await prisma.checklistRun.update({
    where: { id: activeRun.id },
    data: { shiftEndsAt: new Date(Date.now() - 60_000) },
  });
  await expectStatus('scheduler auto-closes active run', 201, request('/checklists/runs/auto-close', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { departmentId: management.id, comment: 'stage13.1 active auto-close' },
  }));
  const activeClosed = await prisma.checklistRun.findUnique({ where: { id: activeRun.id } });
  if (activeClosed?.status === 'AUTO_CLOSED') ok('active run status AUTO_CLOSED');
  else fail('active run status AUTO_CLOSED', activeClosed);

  const pausedRun = await startRun(factoryId, 'test-admin', template.id, 'paused run for scheduler');
  await expectStatus('pause run before scheduler', 201, request(`/checklists/runs/${pausedRun.id}/pause`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { reason: 'stage13.1 paused run' },
  }));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await prisma.checklistRun.update({
    where: { id: pausedRun.id },
    data: { shiftEndsAt: new Date(Date.now() - 60_000) },
  });
  await expectStatus('scheduler auto-closes paused run', 201, request('/checklists/runs/auto-close', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { departmentId: management.id, comment: 'stage13.1 paused auto-close' },
  }));
  const pause = await prisma.checklistPauseEvent.findFirst({ where: { runId: pausedRun.id }, orderBy: { pausedAt: 'desc' } });
  if (pause?.durationSeconds !== null && pause?.durationSeconds !== undefined) ok('paused auto-close keeps pause duration', { durationSeconds: pause.durationSeconds });
  else fail('paused auto-close keeps pause duration');

  const editableRun = await startRun(factoryId, 'test-admin', template.id, 'run for post-close edit');
  const editableDetail = await expectStatus('editable run detail', 200, request(`/checklists/runs/${editableRun.id}`, { userId: 'test-admin', factoryId }));
  const editableRow = editableDetail.data.rows[0];
  await expectStatus('close editable run', 201, request(`/checklists/runs/${editableRun.id}/close`, { userId: 'test-admin', factoryId, method: 'POST', body: { comment: 'closed for correction' } }));
  await expectStatus('post-close edit within window allowed', 201, request(`/checklists/runs/${editableRun.id}/rows/${editableRow.id}/complete`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { status: 'OK', comment: 'corrected after close' },
  }));
  await prisma.checklistRun.update({ where: { id: editableRun.id }, data: { closedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });
  await expectStatus('post-close edit after window rejected', 409, request(`/checklists/runs/${editableRun.id}/rows/${editableRow.id}/complete`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { status: 'NA', comment: 'late correction' },
  }));

  const requiredTemplate = await createTemplate(factoryId, management.id, `Stage13.1 required ${Date.now()}`);
  await createRow(factoryId, requiredTemplate.id, 'Required comment row', { requiresComment: true });
  const requiredRun = await startRun(factoryId, 'test-admin', requiredTemplate.id, 'run for required comment');
  const requiredDetail = await expectStatus('required run detail', 200, request(`/checklists/runs/${requiredRun.id}`, { userId: 'test-admin', factoryId }));
  await expectStatus('required comment still enforced', 409, request(`/checklists/runs/${requiredRun.id}/rows/${requiredDetail.data.rows[0].id}/complete`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { status: 'OK' },
  }));

  const archiveByTemplate = await expectStatus('archive filter by template/status', 200, request(`/checklists/archive?templateId=${template.id}&status=AUTO_CLOSED&dateFrom=${startedAt.toISOString()}&includeDiagnostics=true`, { userId: 'test-admin', factoryId }));
  if (archiveByTemplate.data.runs.some((run) => run.id === activeRun.id || run.id === pausedRun.id)) ok('archive filters return auto-closed template runs');
  else fail('archive filters return auto-closed template runs', archiveByTemplate.data.runs.map((run) => run.id));

  const kipiaTemplate = await createTemplate(factoryId, kipia.id, `Stage13.1 KIPIA ${Date.now()}`);
  await createRow(factoryId, kipiaTemplate.id, 'KIPIA archive row', { sortOrder: 10 });
  const kipiaRun = await startRun(factoryId, 'test-admin', kipiaTemplate.id, 'admin starts KIPIA run');
  await expectStatus('admin closes KIPIA run', 201, request(`/checklists/runs/${kipiaRun.id}/close`, { userId: 'test-admin', factoryId, method: 'POST', body: { comment: 'kipia closed' } }));
  const managementArchive = await expectStatus('management archive own department only', 200, request('/checklists/archive', { userId: 'test-management', factoryId }));
  if (!managementArchive.data.runs.some((run) => run.id === kipiaRun.id)) ok('MANAGEMENT cannot see other department archive');
  else fail('MANAGEMENT cannot see other department archive', managementArchive.data.runs.map((run) => run.id));
  const adminKipiaArchive = await expectStatus('admin archive department filter', 200, request(`/checklists/archive?departmentId=${kipia.id}&includeDiagnostics=true`, { userId: 'test-admin', factoryId }));
  if (adminKipiaArchive.data.runs.some((run) => run.id === kipiaRun.id)) ok('ADMIN can see department archive by filter');
  else fail('ADMIN can see department archive by filter', adminKipiaArchive.data.runs.map((run) => run.id));

  const upload = await expectStatus('checklist attachment for cross-factory check', 201, request('/attachments/upload', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    form: makeFileForm('CHECKLIST_RUN_ROW', editableRow.id),
  }));
  const otherFactory = await prisma.factory.upsert({
    where: { code: 'stage131-checklists-other' },
    update: { isActive: true },
    create: { code: 'stage131-checklists-other', name: 'Stage13.1 other factory' },
  });
  await expectStatus('cross-factory attachment forbidden', 403, request(`/attachments/${upload.data.id}`, { userId: 'test-master', factoryId: otherFactory.id }));

  await prisma.user.update({ where: { id: 'stage13-master-2' }, data: { blockedAt: new Date() } }).catch(() => null);
  await expectStatus('blocked user forbidden', 403, request('/checklists/runs/my', { userId: 'stage13-master-2', factoryId }));
  await prisma.user.update({ where: { id: 'stage13-master-2' }, data: { blockedAt: null } }).catch(() => null);

  for (const action of [
    'CHECKLIST_TEMPLATE_ROW_CREATED',
    'CHECKLIST_TEMPLATE_ROW_UPDATED',
    'CHECKLIST_TEMPLATE_ROW_ARCHIVED',
    'CHECKLIST_RUN_AUTO_CLOSED',
    'CHECKLIST_SCHEDULER_AUTO_CLOSE_RUNS',
    'CHECKLIST_ROW_EDITED_AFTER_CLOSE',
    'ACCESS_DENIED',
  ]) {
    const count = await auditCount(action, startedAt);
    if (count > 0) ok(`audit ${action}`, { count });
    else fail(`audit ${action}`, { count });
  }

  if (state.failures.length) {
    console.log(JSON.stringify(state, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
