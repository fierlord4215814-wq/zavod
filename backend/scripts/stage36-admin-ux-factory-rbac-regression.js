const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

function hasUnsafeSecret(value) {
  const text = JSON.stringify(value);
  return /passwordHash|tokenHash|JWT_SECRET|DATABASE_URL|storagePath|secret/i.test(text);
}

async function auditCount(action, since, entityId) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since }, ...(entityId ? { entityId } : {}) } });
}

async function main() {
  const since = new Date();
  const sourceFactory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!sourceFactory) throw new Error('factory-4 not found');
  const sourceFactoryId = sourceFactory.id;
  const marker = `stage36-${Date.now()}`;
  const factoryName = `Stage36 завод ${marker}`;

  const createPayload = {
    name: factoryName,
    code: marker,
    description: 'Stage36 regression factory builder',
    template: 'BASIC_SERVICES',
  };

  await expectStatus('WORKER cannot create factory', 403, request('POST', '/admin/factories', {
    userId: 'worker-1',
    factoryId: sourceFactoryId,
    body: createPayload,
  }));

  const created = await expectStatus('ADMIN creates Stage36 factory', 201, request('POST', '/admin/factories', {
    userId: 'test-admin',
    factoryId: sourceFactoryId,
    body: createPayload,
  }));
  const createdFactory = created.data;
  if (createdFactory?.id && createdFactory.code === marker) ok('created factory has expected marker');
  else fail('created factory has expected marker', createdFactory);
  if (!hasUnsafeSecret(createdFactory)) ok('factory create response hides secrets');
  else fail('factory create response hides secrets', createdFactory);

  await expectStatus('duplicate factory code rejected', 409, request('POST', '/admin/factories', {
    userId: 'test-admin',
    factoryId: sourceFactoryId,
    body: createPayload,
  }));

  const factories = await expectStatus('created factory visible to admin', 200, request('GET', '/admin/factories', {
    userId: 'test-admin',
    factoryId: sourceFactoryId,
  }));
  if ((factories.data ?? []).some((factory) => factory.id === createdFactory.id)) ok('admin factory list contains Stage36 factory');
  else fail('admin factory list contains Stage36 factory', factories.data);

  const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'test-admin', factoryId: createdFactory.id } } });
  if (access?.role === 'ADMIN' && access.isActive) ok('admin access granted to new factory');
  else fail('admin access granted to new factory', access);

  const sharedServices = await db.department.findMany({
    where: { factoryId: null, scope: 'GLOBAL', code: { in: ['mechanics', 'kipia', 'holod', 'electric', 'santechnik', 'technolog', 'service-other'] }, deletedAt: null },
  });
  if (sharedServices.length >= 6) ok('shared service departments exist', { count: sharedServices.length });
  else fail('shared service departments exist', sharedServices);

  const departments = await expectStatus('admin reads departments for new factory', 200, request('GET', `/admin/departments?factoryId=${createdFactory.id}`, {
    userId: 'test-admin',
    factoryId: createdFactory.id,
  }));
  if ((departments.data ?? []).some((department) => department.scope === 'GLOBAL')) ok('shared departments visible for selected factory');
  else fail('shared departments visible for selected factory', departments.data);

  const rolePreview = await expectStatus('admin previews dangerous worker rights safely', 201, request('POST', '/admin/roles/WORKER/permissions/preview', {
    userId: 'test-admin',
    factoryId: sourceFactoryId,
    body: { permissionCodes: ['admin.overview.read'] },
  }));
  if (rolePreview.data?.allowed === false) ok('worker admin-like permissions are blocked');
  else fail('worker admin-like permissions are blocked', rolePreview.data);

  const lines = await expectStatus('admin reads line config by factoryId', 200, request('GET', `/admin/lines-config?factoryId=${createdFactory.id}`, {
    userId: 'test-admin',
    factoryId: createdFactory.id,
  }));
  if (Array.isArray(lines.data)) ok('line config by factoryId returns list', { count: lines.data.length });
  else fail('line config by factoryId returns list', lines.data);
  if (!hasUnsafeSecret(lines.data)) ok('line config response hides secrets');
  else fail('line config response hides secrets', lines.data);

  await expectStatus('factory deactivation is soft and allowed for Stage36 factory', 200, request('PATCH', `/admin/factories/${createdFactory.id}/status`, {
    userId: 'test-admin',
    factoryId: createdFactory.id,
    body: { isActive: false, reason: 'stage36 cleanup soft deactivate' },
  }));
  const deactivated = await db.factory.findUnique({ where: { id: createdFactory.id } });
  if (deactivated && deactivated.deletedAt === null && deactivated.isActive === false) ok('Stage36 factory soft-deactivated without physical delete');
  else fail('Stage36 factory soft-deactivated without physical delete', deactivated);

  for (const [action, label] of [
    ['FACTORY_CREATED', 'FACTORY_CREATED audit written'],
    ['FACTORY_DEACTIVATED', 'FACTORY_DEACTIVATED audit written'],
  ]) {
    const count = await auditCount(action, since, createdFactory.id);
    if (count > 0) ok(label, { count });
    else fail(label, { count });
  }

  const adminSource = fs.readFileSync(path.join(root, 'frontend/src/screens/AdminConfigScreen.tsx'), 'utf8');
  const promptScan = /window\.(prompt|alert|confirm)|\balert\(/.test(adminSource);
  if (!promptScan) ok('AdminConfigScreen has no prompt/alert/confirm');
  else fail('AdminConfigScreen has no prompt/alert/confirm');
  const mojibake = adminSource.match(/�|����|Ð|Рџ|Рђ|Р’|РЎ|Рќ|Р—|Рћ|Рљ|Р›|РЁ/g);
  if (!mojibake) ok('AdminConfigScreen mojibake scan clean');
  else fail('AdminConfigScreen mojibake scan clean', [...new Set(mojibake)].slice(0, 8));

  if (state.failures.length) {
    console.error('Stage 36 admin UX / factory / RBAC regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 36 admin UX / factory / RBAC regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
