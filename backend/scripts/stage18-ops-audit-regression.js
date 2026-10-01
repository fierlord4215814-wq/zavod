const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(path, { userId = 'test-admin', factoryId, method = 'GET', body } = {}) {
  const headers = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

function hasNoUnsafeFields(value) {
  const text = JSON.stringify(value).toLowerCase();
  return !text.includes('database_url') && !text.includes('passwordhash') && !text.includes('storagepath') && !text.includes('jwt_secret') && !text.includes('secret-token');
}

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const managementAccess = await prisma.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-management', factoryId } } });
  if (!managementAccess?.departmentId) throw new Error('test-management department missing');

  await prisma.auditLog.create({
    data: {
      factoryId,
      userId: 'test-admin',
      action: 'ACCESS_DENIED',
      entityType: 'Stage18SecretProbe',
      entityId: 'stage18-secret-probe',
      details: { storagePath: 'C:/secret/file.png', token: 'secret-token', nested: { passwordHash: 'hash' } },
    },
  });
  await prisma.notification.create({
    data: { factoryId, userId: 'test-management', type: 'STAGE18_UNREAD', title: 'Stage18 unread', message: 'Unread', severity: 'INFO' },
  });

  const overview = await expectStatus('ADMIN reads ops overview', 200, request('/ops/overview', { userId: 'test-admin', factoryId }));
  for (const key of ['activeTasksCount', 'overdueLongTasksCount', 'activeWashCount', 'lowStockItemsCount', 'unreadNotificationsCount', 'recentAccessDeniedCount']) {
    if (typeof overview.data[key] === 'number') ok(`overview includes ${key}`, { value: overview.data[key] });
    else fail(`overview includes ${key}`, overview.data);
  }

  const managementOverview = await expectStatus('MANAGEMENT reads own ops overview', 200, request('/ops/overview', { userId: 'test-management', factoryId }));
  if (typeof managementOverview.data.unreadNotificationsCount === 'number') ok('management scoped overview includes notifications');
  else fail('management scoped overview includes notifications', managementOverview.data);

  await expectStatus('WORKER ops overview forbidden', 403, request('/ops/overview', { userId: 'worker-1', factoryId }));
  await expectStatus('CONTRACTOR ops overview forbidden', 403, request('/ops/overview', { userId: 'contractor-1', factoryId }));
  await prisma.user.update({ where: { id: 'worker-2' }, data: { blockedAt: new Date() } });
  await expectStatus('blocked user ops overview forbidden', 403, request('/ops/overview', { userId: 'worker-2', factoryId }));
  await prisma.user.update({ where: { id: 'worker-2' }, data: { blockedAt: null } });

  const events = await expectStatus('timeline returns mixed events', 200, request('/ops/events?limit=80', { userId: 'test-admin', factoryId }));
  const sources = new Set(events.data.map((item) => item.source));
  if (sources.size >= 2) ok('timeline has mixed sources', { sources: [...sources] });
  else fail('timeline has mixed sources', events.data);

  const audit = await expectStatus('audit browser works', 200, request('/ops/audit?limit=80', { userId: 'test-admin', factoryId }));
  if (audit.data.some((item) => item.action === 'ACCESS_DENIED')) ok('audit includes access denied');
  else fail('audit includes access denied', audit.data.map((item) => item.action));
  if (hasNoUnsafeFields(audit.data)) ok('audit response masks secrets/storage paths');
  else fail('audit response masks secrets/storage paths', audit.data);

  const accessDenied = await expectStatus('ACCESS_DENIED filter works', 200, request('/ops/audit?accessDeniedOnly=true&limit=20', { userId: 'test-admin', factoryId }));
  if (accessDenied.data.every((item) => item.action === 'ACCESS_DENIED')) ok('ACCESS_DENIED filter returns only access denied');
  else fail('ACCESS_DENIED filter returns only access denied', accessDenied.data.map((item) => item.action));

  const moduleSummary = await expectStatus('module summary works', 200, request('/ops/module-summary', { userId: 'test-admin', factoryId }));
  const moduleNames = moduleSummary.data.map((item) => item.module);
  for (const moduleName of ['Tasks', 'Wash', 'Checklists', 'Orders', 'Notifications', 'Auth/access']) {
    if (moduleNames.includes(moduleName)) ok(`module summary includes ${moduleName}`);
    else fail(`module summary includes ${moduleName}`, moduleNames);
  }

  const managementEvents = await expectStatus('MANAGEMENT reads scoped events', 200, request('/ops/events?limit=20', { userId: 'test-management', factoryId }));
  if (Array.isArray(managementEvents.data)) ok('management events response is list');
  else fail('management events response is list', managementEvents.data);

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
