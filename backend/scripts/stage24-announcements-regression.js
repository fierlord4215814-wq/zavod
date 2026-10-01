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
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(pathname, { userId = 'test-admin', factoryId, method = 'GET', body, formData } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : formData,
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

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function upload(userId, factoryId, entityType, entityId) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `stage24-announcement-attachment-${Date.now()}`);
  form.append('file', new Blob(['stage24 announcement attachment'], { type: 'text/plain' }), 'stage24-announcement.txt');
  return request('/attachments/upload', { userId, factoryId, method: 'POST', formData: form });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  const managementAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-management', factoryId } } });
  if (!managementAccess?.departmentId) throw new Error('management department missing');

  const settings = await expectStatus('admin reads announcement settings', 200, request('/admin/announcement-settings', { userId: 'test-admin', factoryId }));
  if (settings.data?.defaultVisibleDays === 7 && settings.data?.guestCanRead === false) ok('announcement settings keep guest access disabled');
  else fail('announcement settings defaults exist', settings.data);

  const factoryAnnouncement = await expectStatus('admin creates factory announcement', 201, request('/announcements', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: {
      title: `Проверка объявления завода ${Date.now()}`,
      text: 'Активное объявление для всего завода в служебной проверке.',
      priority: 'IMPORTANT',
    },
  }));
  const visibleUntil = new Date(factoryAnnouncement.data.visibleUntil).getTime();
  const createdAt = new Date(factoryAnnouncement.data.visibleFrom).getTime();
  const days = Math.round((visibleUntil - createdAt) / 86_400_000);
  if (days === 7) ok('default visibility is seven days');
  else fail('default visibility is seven days', { days, visibleUntil: factoryAnnouncement.data.visibleUntil });
  if (factoryAnnouncement.data.priority === 'IMPORTANT') ok('important announcement keeps priority');
  else fail('important announcement keeps priority', factoryAnnouncement.data);

  await expectStatus('guest cannot read active announcements', 403, request('/announcements', { userId: null, factoryId }));

  const workerList = await expectStatus('worker reads active announcements', 200, request('/announcements', { userId: 'worker-1', factoryId }));
  if (workerList.data.some((item) => item.id === factoryAnnouncement.data.id)) ok('worker sees active announcement');
  else fail('worker sees active announcement', workerList.data);
  await expectStatus('worker cannot create announcement', 403, request('/announcements', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { title: 'worker forbidden', text: 'forbidden' },
  }));

  const managementAnnouncement = await expectStatus('management creates scoped announcement', 201, request('/announcements', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: {
      title: `Проверка объявления отдела ${Date.now()}`,
      text: 'Объявление для отдела руководства в служебной проверке.',
      departmentId: managementAccess.departmentId,
      priority: 'NORMAL',
    },
  }));
  const scopedDepartmentIds = Array.isArray(managementAnnouncement.data.departmentIds)
    ? managementAnnouncement.data.departmentIds
    : [];
  if (
    managementAnnouncement.data.audienceType === 'SELECTED'
    && scopedDepartmentIds.length === 1
    && scopedDepartmentIds[0] === managementAccess.departmentId
  ) ok('management announcement scoped to own department');
  else fail('management announcement scoped to own department', managementAnnouncement.data);

  const readOne = await expectStatus('read marker first is idempotent', 201, request(`/announcements/${factoryAnnouncement.data.id}/read`, { userId: 'worker-1', factoryId, method: 'POST', body: {} }));
  const readTwo = await expectStatus('read marker second is idempotent', 201, request(`/announcements/${factoryAnnouncement.data.id}/read`, { userId: 'worker-1', factoryId, method: 'POST', body: {} }));
  if (readOne.data.announcementId === readTwo.data.announcementId) ok('read marker returns same announcement');
  else fail('read marker returns same announcement', { readOne: readOne.data, readTwo: readTwo.data });

  const attachment = await expectStatus('announcement attachment upload', 201, upload('test-admin', factoryId, 'ANNOUNCEMENT', factoryAnnouncement.data.id));
  const metadata = await expectStatus('announcement attachment metadata read', 200, request(`/attachments/${attachment.data.id}`, { userId: 'worker-1', factoryId }));
  if (metadata.data.storagePath === undefined) ok('announcement attachment metadata hides storagePath');
  else fail('announcement attachment metadata hides storagePath', metadata.data);

  await expectStatus('management archives scoped announcement', 201, request(`/announcements/${managementAnnouncement.data.id}/archive`, { userId: 'test-management', factoryId, method: 'POST', body: {} }));
  const activeAfterArchive = await expectStatus('archive hidden from active list', 200, request('/announcements', { userId: 'test-management', factoryId }));
  if (!activeAfterArchive.data.some((item) => item.id === managementAnnouncement.data.id)) ok('archived announcement hidden from active list');
  else fail('archived announcement hidden from active list', activeAfterArchive.data);
  const archiveList = await expectStatus('archive visible by permission', 200, request('/announcements?includeArchive=true', { userId: 'test-management', factoryId }));
  if (archiveList.data.some((item) => item.id === managementAnnouncement.data.id)) ok('archived announcement visible in archive');
  else fail('archived announcement visible in archive', archiveList.data);
  await expectStatus('admin archives factory announcement cleanup', 201, request(`/announcements/${factoryAnnouncement.data.id}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage24-announcements-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage24-announcements-other', name: 'Stage24 announcements other' },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: otherFactory.id } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'test-admin', factoryId: otherFactory.id, role: 'ADMIN', isActive: true, isGuest: false },
  });
  const foreign = await db.announcement.create({
    data: {
      factoryId: otherFactory.id,
      authorId: 'test-admin',
      title: `Stage24 foreign ${Date.now()}`,
      text: 'Stage24 foreign announcement',
      visibleUntil: new Date(Date.now() + 86_400_000),
    },
  });
  await expectStatus('cross-factory announcement forbidden', 403, request(`/announcements/${foreign.id}`, { userId: 'test-master', factoryId }));

  await db.user.upsert({
    where: { id: 'stage24-blocked-announcement-user' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage24-blocked-announcement-user', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage24-blocked-announcement-user', factoryId } },
    update: { role: 'WORKER', departmentId: managementAccess.departmentId, isActive: true, isGuest: false },
    create: { userId: 'stage24-blocked-announcement-user', factoryId, role: 'WORKER', departmentId: managementAccess.departmentId, isActive: true, isGuest: false },
  });
  await expectStatus('blocked user forbidden', 403, request('/announcements', { userId: 'stage24-blocked-announcement-user', factoryId }));
  await db.user.update({ where: { id: 'stage24-blocked-announcement-user' }, data: { blockedAt: null } });

  const auditActions = await db.auditLog.findMany({
    where: {
      createdAt: { gte: since },
      action: { in: ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_IMPORTANT_CREATED', 'ANNOUNCEMENT_ARCHIVED', 'ANNOUNCEMENT_READ', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED'] },
    },
    select: { action: true },
  });
  for (const action of ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_IMPORTANT_CREATED', 'ANNOUNCEMENT_ARCHIVED', 'ANNOUNCEMENT_READ', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    if (auditActions.some((item) => item.action === action)) ok(`audit ${action} written`);
    else fail(`audit ${action} written`, auditActions);
  }

  const visibleFiles = [
    path.resolve(__dirname, '../../frontend/src/screens/AnnouncementsScreen.tsx'),
    path.resolve(__dirname, '../../frontend/src/navigation/permissions.ts'),
    path.resolve(__dirname, '../../frontend/src/App.tsx'),
  ];
  const badPatterns = [/�/, /����/, /Ð/, /Рџ/, /Network unavailable/, /Admin configuration/, /\bLoading\b/, /\bForbidden\b/, /Access denied/, /No data/];
  const badHits = [];
  for (const file of visibleFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of badPatterns) {
      if (pattern.test(text)) badHits.push({ file, pattern: String(pattern) });
    }
  }
  if (!badHits.length) ok('Stage24 Russian UI scan is clean for new announcement files');
  else fail('Stage24 Russian UI scan is clean for new announcement files', badHits);

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
