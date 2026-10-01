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
  form.append('file', new Blob(['stage14-shift-log'], { type: 'image/png' }), 'stage14.png');
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage14-${entityType}-${entityId}-${Date.now()}`);
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
  const management = await prisma.department.findFirst({ where: { factoryId, code: 'management' } });
  const kipia = await prisma.department.findFirst({ where: { factoryId, code: 'kipia' } });
  if (!masters || !management || !kipia) throw new Error('required departments not found');
  const masterAccess = await prisma.userFactoryAccess.findFirst({
    where: {
      factoryId,
      role: 'MASTER',
      isActive: true,
      isGuest: false,
      user: { blockedAt: null, deletedAt: null },
      department: { isActive: true, deletedAt: null },
      userId: { in: ['pilot-master-1', 'pilot-pack-senior-master', 'pilot-pack-master-source'] },
    },
    select: { userId: true, departmentId: true },
    orderBy: { userId: 'asc' },
  });
  if (!masterAccess?.departmentId) throw new Error('active master access not found');
  const masterUserId = masterAccess.userId;
  const masterDepartmentId = masterAccess.departmentId;

  await expectStatus('missing text rejected', 409, request('/shift-log', {
    userId: masterUserId,
    factoryId,
    method: 'POST',
    body: { text: '', departmentId: masterDepartmentId },
  }));

  const entry = await expectStatus('MASTER creates department entry', 201, request('/shift-log', {
    userId: masterUserId,
    factoryId,
    method: 'POST',
    body: { title: 'Проверка пересменки', text: 'Line handover note', departmentId: masterDepartmentId, logDate: '2026-06-20', shiftLabel: 'День', createdById: 'test-admin' },
  }));
  const entryId = entry.data.id;
  if (entry.data.logDate && entry.data.shiftLabel === 'День' && entry.data.createdById === masterUserId) ok('shift log stores date/shift and ignores spoofed author');
  else fail('shift log stores date/shift and ignores spoofed author', { logDate: entry.data.logDate, shiftLabel: entry.data.shiftLabel, createdById: entry.data.createdById });
  await expectStatus('entry update works', 200, request(`/shift-log/${entryId}`, {
    userId: masterUserId,
    factoryId,
    method: 'PATCH',
    body: { title: 'Проверка пересменки обновлена', text: 'Line handover note updated' },
  }));

  const upload = await expectStatus('attachment upload works', 201, request('/attachments/upload', {
    userId: masterUserId,
    factoryId,
    method: 'POST',
    form: makeFileForm('SHIFT_LOG', entryId),
  }));
  const metadata = await expectStatus('attachment metadata readable', 200, request(`/attachments/${upload.data.id}`, { userId: masterUserId, factoryId }));
  if (!('storagePath' in metadata.data)) ok('attachment metadata hides storagePath');
  else fail('attachment metadata hides storagePath', metadata.data);

  const comment = await expectStatus('comment works', 201, request(`/shift-log/${entryId}/comment`, {
    userId: masterUserId,
    factoryId,
    method: 'POST',
    body: { text: 'Accepted by next shift' },
  }));
  await expectStatus('comment attachment upload works', 201, request('/attachments/upload', {
    userId: masterUserId,
    factoryId,
    method: 'POST',
    form: makeFileForm('SHIFT_LOG_COMMENT', comment.data.id),
  }));

  await expectStatus('read receipt first mark', 201, request(`/shift-log/${entryId}/read`, { userId: masterUserId, factoryId, method: 'POST', body: {} }));
  await expectStatus('read receipt idempotent second mark', 201, request(`/shift-log/${entryId}/read`, { userId: masterUserId, factoryId, method: 'POST', body: {} }));
  const readCount = await prisma.shiftLogRead.count({ where: { logId: entryId, userId: masterUserId } });
  if (readCount === 1) ok('read receipt remains unique');
  else fail('read receipt remains unique', { readCount });
  await expectStatus('reads endpoint works', 200, request(`/shift-log/${entryId}/reads`, { userId: masterUserId, factoryId }));

  const dayList = await expectStatus('shift filter returns day entry', 200, request('/shift-log?shiftLabel=День&dateFrom=2026-06-20&dateTo=2026-06-20', { userId: masterUserId, factoryId }));
  if (dayList.data.some((log) => log.id === entryId)) ok('date and shift filters work');
  else fail('date and shift filters work', dayList.data.map((log) => ({ id: log.id, logDate: log.logDate, shiftLabel: log.shiftLabel })));

  const important = await expectStatus('MANAGEMENT creates important entry', 201, request('/shift-log', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { title: 'Важная проверка пересменки', text: 'Important handover', isImportant: true, departmentId: management.id },
  }));
  await expectStatus('close important works with permission', 201, request(`/shift-log/${important.data.id}/close-important`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { comment: 'resolved' },
  }));

  const kipiaText = `KIPIA note ${Date.now()}`;
  const kipiaEntry = await expectStatus('ADMIN creates other department entry', 201, request('/shift-log', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { title: 'Проверка пересменки КИПиА', text: kipiaText, departmentId: kipia.id },
  }));
  const managementList = await expectStatus('MANAGEMENT reads own department only', 200, request('/shift-log?includeClosed=true', { userId: 'test-management', factoryId }));
  if (!managementList.data.some((log) => log.id === kipiaEntry.data.id)) ok('department A cannot see department B entry');
  else fail('department A cannot see department B entry', managementList.data.map((log) => log.id));
  const adminKipia = await expectStatus('ADMIN sees all with department filter', 200, request(`/shift-log?departmentId=${kipia.id}&includeClosed=true&search=${encodeURIComponent(kipiaText)}`, { userId: 'test-admin', factoryId }));
  if (adminKipia.data.some((log) => log.id === kipiaEntry.data.id)) ok('ADMIN sees other department entry');
  else fail('ADMIN sees other department entry', adminKipia.data.map((log) => log.id));

  await expectStatus('WORKER forbidden by default', 403, request('/shift-log', { userId: 'worker-1', factoryId }));
  await expectStatus('CONTRACTOR forbidden by default', 403, request('/shift-log', { userId: 'contractor-1', factoryId }));

  await prisma.user.upsert({
    where: { id: 'stage14-blocked-master' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage14-blocked-master', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage14-blocked-master', factoryId } },
    update: { role: 'MASTER', departmentId: masterDepartmentId, isActive: true, isGuest: false },
    create: { userId: 'stage14-blocked-master', factoryId, role: 'MASTER', departmentId: masterDepartmentId, isActive: true, isGuest: false },
  });
  await expectStatus('blocked user forbidden', 403, request('/shift-log', { userId: 'stage14-blocked-master', factoryId }));
  await prisma.user.update({ where: { id: 'stage14-blocked-master' }, data: { blockedAt: null } });

  const otherFactory = await prisma.factory.upsert({
    where: { code: 'stage14-shift-log-other' },
    update: { isActive: true },
    create: { code: 'stage14-shift-log-other', name: 'Stage14 other factory' },
  });
  await expectStatus('cross-factory attachment denied', 403, request(`/attachments/${upload.data.id}`, { userId: masterUserId, factoryId: otherFactory.id }));

  const importantList = await expectStatus('important tab query works', 200, request('/shift-log?importantOnly=true', { userId: 'test-management', factoryId }));
  if (!importantList.data.some((log) => log.id === important.data.id)) ok('closed important hidden from active important tab');
  else fail('closed important hidden from active important tab');
  const archive = await expectStatus('archive query works', 200, request('/shift-log/archive?includeClosed=true', { userId: 'test-management', factoryId }));
  if (archive.data.some((log) => log.id === important.data.id)) ok('closed important visible in archive by scope');
  else fail('closed important visible in archive by scope', archive.data.map((log) => log.id));

  await expectStatus('test master entry soft archived', 201, request(`/shift-log/${entryId}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));
  await expectStatus('test kipia entry soft archived', 201, request(`/shift-log/${kipiaEntry.data.id}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));
  await expectStatus('test important entry soft archived', 201, request(`/shift-log/${important.data.id}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));

  for (const action of [
    'SHIFT_LOG_ENTRY_CREATED',
    'SHIFT_LOG_ENTRY_UPDATED',
    'SHIFT_LOG_COMMENT_CREATED',
    'SHIFT_LOG_READ',
    'SHIFT_LOG_IMPORTANT_CREATED',
    'SHIFT_LOG_IMPORTANT_CLOSED',
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
