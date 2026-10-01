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
  form.append('file', new Blob(['stage13-photo'], { type: 'image/png' }), 'stage13.png');
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage13-${entityType}-${entityId}-${Date.now()}`);
  return form;
}

async function auditCount(action, since) {
  return prisma.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const startedAt = new Date();
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const masters = await prisma.department.findFirst({ where: { factoryId, code: 'masters' } });
  const kipia = await prisma.department.findFirst({ where: { factoryId, code: 'kipia' } });
  const management = await prisma.department.findFirst({ where: { factoryId, code: 'management' } });
  if (!masters || !kipia || !management) throw new Error('required departments not found');
  const masterDepartmentId = masters.id;

  for (const userId of ['stage13-master-1', 'stage13-master-2']) {
    await prisma.user.upsert({
      where: { id: userId },
      update: { factoryId, role: 'MASTER', blockedAt: null, deletedAt: null },
      create: { id: userId, factoryId, role: 'MASTER' },
    });
    await prisma.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId, factoryId } },
      update: { role: 'MASTER', departmentId: masterDepartmentId, isActive: true, isGuest: false },
      create: { userId, factoryId, role: 'MASTER', departmentId: masterDepartmentId, isActive: true, isGuest: false },
    });
  }

  await expectStatus('ADMIN reads checklist settings', 200, request('/checklists/settings', { userId: 'test-admin', factoryId }));
  await expectStatus('settings preview', 201, request('/checklists/settings/preview', { userId: 'test-admin', factoryId, method: 'POST', body: { requirePauseComment: true } }));
  await expectStatus('settings patch', 200, request('/checklists/settings', { userId: 'test-admin', factoryId, method: 'PATCH', body: { requirePauseComment: true, reason: 'stage13 regression' } }));

  await expectStatus('WORKER templates forbidden', 403, request('/checklists/templates', { userId: 'worker-1', factoryId }));

  const createdTemplate = await expectStatus('ADMIN creates masters template', 201, request('/checklists/templates', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { name: `Проверка отдела мастеров ${Date.now()}`, description: 'Проверочный шаблон отдела мастеров', departmentId: masterDepartmentId },
  }));
  const templateId = createdTemplate.data.id;

  const commentRow = await expectStatus('create row requiring comment', 201, request(`/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { title: 'Comment row', requiresComment: true, sortOrder: 10 },
  }));
  const photoRow = await expectStatus('create row requiring photo', 201, request(`/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { title: 'Photo row', requiresPhoto: true, sortOrder: 20 },
  }));
  await expectStatus('update row by ADMIN', 200, request(`/checklists/templates/${templateId}/rows/${commentRow.data.id}`, {
    userId: 'test-admin',
    factoryId,
    method: 'PATCH',
    body: { description: 'Updated row', requiresComment: true },
  }));

  const kipiaTemplate = await expectStatus('ADMIN creates KIPIA template', 201, request('/checklists/templates', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { name: `Проверка КИПиА ${Date.now()}`, departmentId: kipia.id },
  }));
  await expectStatus('MANAGEMENT cannot archive another department template', 403, request(`/checklists/templates/${kipiaTemplate.data.id}/archive`, { userId: 'test-management', factoryId, method: 'POST', body: {} }));

  const masterTemplates = await expectStatus('MASTER sees own department diagnostic template', 200, request('/checklists/templates?includeDiagnostics=true', { userId: 'stage13-master-1', factoryId }));
  if (masterTemplates.data.some((item) => item.id === templateId) && !masterTemplates.data.some((item) => item.id === kipiaTemplate.data.id)) ok('department scope hides other department templates');
  else fail('department scope hides other department templates', { ids: masterTemplates.data.map((item) => item.id) });

  const runOne = await expectStatus('user starts self-selected run', 201, request('/checklists/runs', { userId: 'stage13-master-1', factoryId, method: 'POST', body: { templateId } }));
  const runTwo = await expectStatus('second user starts same template independently', 201, request('/checklists/runs', { userId: 'stage13-master-2', factoryId, method: 'POST', body: { templateId } }));

  const runDetail = await expectStatus('run detail', 200, request(`/checklists/runs/${runOne.data.id}`, { userId: 'stage13-master-1', factoryId }));
  const commentRunRow = runDetail.data.rows.find((row) => row.templateRowId === commentRow.data.id);
  const photoRunRow = runDetail.data.rows.find((row) => row.templateRowId === photoRow.data.id);
  if (!commentRunRow || !photoRunRow) throw new Error('run rows were not snapshotted');

  await expectStatus('missing required comment rejected', 409, request(`/checklists/runs/${runOne.data.id}/rows/${commentRunRow.id}/complete`, {
    userId: 'stage13-master-1',
    factoryId,
    method: 'POST',
    body: { status: 'OK' },
  }));
  await expectStatus('row with comment completed', 201, request(`/checklists/runs/${runOne.data.id}/rows/${commentRunRow.id}/complete`, {
    userId: 'stage13-master-1',
    factoryId,
    method: 'POST',
    body: { status: 'OK', comment: 'done' },
  }));
  await expectStatus('missing required photo rejected', 409, request(`/checklists/runs/${runOne.data.id}/rows/${photoRunRow.id}/complete`, {
    userId: 'stage13-master-1',
    factoryId,
    method: 'POST',
    body: { status: 'OK' },
  }));
  const upload = await expectStatus('checklist row attachment uploaded', 201, request('/attachments/upload', {
    userId: 'stage13-master-1',
    factoryId,
    method: 'POST',
    form: makeFileForm('CHECKLIST_RUN_ROW', photoRunRow.id),
  }));
  const metadata = await expectStatus('attachment metadata readable', 200, request(`/attachments/${upload.data.id}`, { userId: 'stage13-master-1', factoryId }));
  if (!('storagePath' in metadata.data)) ok('attachment metadata hides storagePath');
  else fail('attachment metadata hides storagePath', metadata.data);
  await expectStatus('row with photo completed', 201, request(`/checklists/runs/${runOne.data.id}/rows/${photoRunRow.id}/complete`, {
    userId: 'stage13-master-1',
    factoryId,
    method: 'POST',
    body: { status: 'ISSUE', comment: 'photo attached' },
  }));

  await expectStatus('pause without comment rejected', 409, request(`/checklists/runs/${runOne.data.id}/pause`, { userId: 'stage13-master-1', factoryId, method: 'POST', body: {} }));
  await expectStatus('pause with comment', 201, request(`/checklists/runs/${runOne.data.id}/pause`, { userId: 'stage13-master-1', factoryId, method: 'POST', body: { reason: 'waiting' } }));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const resumed = await expectStatus('resume calculates duration', 201, request(`/checklists/runs/${runOne.data.id}/resume`, { userId: 'stage13-master-1', factoryId, method: 'POST', body: {} }));
  const pauseEvent = await prisma.checklistPauseEvent.findFirst({ where: { runId: runOne.data.id }, orderBy: { pausedAt: 'desc' } });
  if (pauseEvent?.durationSeconds !== null && pauseEvent?.durationSeconds !== undefined) ok('pause duration stored', { durationSeconds: pauseEvent.durationSeconds });
  else fail('pause duration stored');
  await expectStatus('close run', 201, request(`/checklists/runs/${runOne.data.id}/close`, { userId: 'stage13-master-1', factoryId, method: 'POST', body: { comment: 'closed' } }));

  await expectStatus('pause second run before auto-close', 201, request(`/checklists/runs/${runTwo.data.id}/pause`, { userId: 'stage13-master-2', factoryId, method: 'POST', body: { reason: 'forgotten pause' } }));
  await expectStatus('auto-close paused run', 201, request('/checklists/runs/auto-close', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { departmentId: masterDepartmentId, runId: runTwo.data.id, comment: 'shift boundary', force: true },
  }));

  await expectStatus('archive visible by management scope', 200, request('/checklists/archive', { userId: 'test-management', factoryId }));
  await expectStatus('archive template', 201, request(`/checklists/templates/${templateId}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));
  await expectStatus('restore template', 201, request(`/checklists/templates/${templateId}/restore`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));

  await prisma.user.update({ where: { id: 'stage13-master-2' }, data: { blockedAt: new Date() } });
  await expectStatus('blocked user forbidden', 403, request('/checklists/runs/my', { userId: 'stage13-master-2', factoryId }));
  await prisma.user.update({ where: { id: 'stage13-master-2' }, data: { blockedAt: null } });

  const forbiddenFactory = await prisma.factory.upsert({
    where: { code: 'stage13-checklists-other' },
    update: { isActive: true },
    create: { code: 'stage13-checklists-other', name: 'Stage13 checklist other factory' },
  });
  await expectStatus('cross-factory attachment denied', 403, request(`/attachments/${upload.data.id}`, { userId: 'stage13-master-1', factoryId: forbiddenFactory.id }));

  for (const action of [
    'CHECKLIST_SETTINGS_UPDATED',
    'CHECKLIST_TEMPLATE_CREATED',
    'CHECKLIST_TEMPLATE_UPDATED',
    'CHECKLIST_TEMPLATE_ARCHIVED',
    'CHECKLIST_TEMPLATE_RESTORED',
    'CHECKLIST_RUN_STARTED',
    'CHECKLIST_ROW_COMPLETED',
    'CHECKLIST_RUN_PAUSED',
    'CHECKLIST_RUN_RESUMED',
    'CHECKLIST_RUN_CLOSED',
    'CHECKLIST_RUN_AUTO_CLOSED',
    'ATTACHMENT_UPLOADED',
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
