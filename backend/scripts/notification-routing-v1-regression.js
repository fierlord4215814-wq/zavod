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

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const management = await prisma.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId: 'test-management', factoryId } },
  });
  if (!management?.departmentId) throw new Error('test-management department missing');

  const unique = Date.now();
  const direct = await prisma.notification.create({
    data: {
      factoryId,
      userId: 'worker-1',
      type: `ROUTING_V1_DIRECT_${unique}`,
      title: 'Routing v1 direct',
      message: 'Direct notification',
      severity: 'INFO',
    },
  });
  const department = await prisma.notification.create({
    data: {
      factoryId,
      departmentId: management.departmentId,
      type: `ROUTING_V1_DEPARTMENT_${unique}`,
      title: 'Routing v1 department',
      message: 'Department notification',
      severity: 'WARNING',
    },
  });
  const factoryWide = await prisma.notification.create({
    data: {
      factoryId,
      type: `ROUTING_V1_FACTORY_${unique}`,
      title: 'Routing v1 factory',
      message: 'Factory notification',
      severity: 'INFO',
    },
  });

  const worker = await request('/notifications', { userId: 'worker-1', factoryId });
  const workerIds = new Set((worker.data ?? []).map((item) => item.id));
  if (worker.status === 200 && workerIds.has(direct.id) && workerIds.has(factoryWide.id) && !workerIds.has(department.id)) {
    ok('worker sees direct and factory notifications only');
  } else {
    fail('worker sees direct and factory notifications only', worker.data);
  }

  const manager = await request('/notifications', { userId: 'test-management', factoryId });
  const managerIds = new Set((manager.data ?? []).map((item) => item.id));
  if (manager.status === 200 && managerIds.has(department.id) && managerIds.has(factoryWide.id) && !managerIds.has(direct.id)) {
    ok('management sees department and factory notifications only');
  } else {
    fail('management sees department and factory notifications only', manager.data);
  }

  const readForeign = await request(`/notifications/${department.id}/read`, {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: {},
  });
  if (readForeign.status === 403) ok('direct API cannot mark hidden department notification');
  else fail('direct API cannot mark hidden department notification', readForeign);

  const raw = JSON.stringify([worker.data, manager.data]);
  if (/passwordHash|storagePath|DATABASE_URL|token|secret/i.test(raw)) fail('notification list leaks secret-like values');
  else ok('notification list does not leak secret-like values');

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
