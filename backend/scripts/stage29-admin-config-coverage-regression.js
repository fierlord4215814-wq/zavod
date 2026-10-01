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

function cleanSettingsPayload(settings) {
  const payload = { ...settings, reason: 'stage29 settings coverage check' };
  for (const key of ['id', 'factoryId', 'createdAt', 'updatedAt']) delete payload[key];
  return payload;
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;

  const adminEndpoints = [
    ['/admin/overview', 'overview'],
    ['/admin/users', 'users'],
    ['/admin/factories', 'factories'],
    ['/admin/departments', 'departments'],
    ['/admin/roles', 'roles'],
    ['/admin/permissions', 'permissions'],
    ['/admin/lines-config', 'lines config'],
    ['/admin/media/overview', 'media overview'],
  ];
  for (const [pathName, label] of adminEndpoints) {
    const response = await expectStatus(`ADMIN reads ${label}`, 200, request('GET', pathName, { userId: 'test-admin', factoryId }));
    if (!hasUnsafeSecret(response.data)) ok(`${label} response hides secrets`);
    else fail(`${label} response hides secrets`, response.data);
  }
  await expectStatus('WORKER cannot read admin overview', 403, request('GET', '/admin/overview', { userId: 'worker-1', factoryId }));

  const settingsEndpoints = [
    { name: 'ShiftSettings', read: '/admin/shift-settings', preview: '/admin/shift-settings/preview', update: '/admin/shift-settings', audit: 'SHIFT_SETTINGS_UPDATED' },
    { name: 'TaskSettings', read: '/admin/task-settings', preview: '/admin/task-settings/preview', update: '/admin/task-settings', audit: 'TASK_SETTINGS_UPDATED' },
    { name: 'WashSettings', read: '/admin/wash-settings', preview: '/admin/wash-settings/preview', update: '/admin/wash-settings', audit: 'WASH_SETTINGS_UPDATED' },
    { name: 'ChecklistSettings', read: '/checklists/settings', preview: '/checklists/settings/preview', update: '/checklists/settings', audit: 'CHECKLIST_SETTINGS_UPDATED' },
    { name: 'OrderSettings', read: '/orders/settings', preview: '/orders/settings/preview', update: '/orders/settings', audit: 'ORDER_SETTINGS_UPDATED' },
    { name: 'DefrostSettings', read: '/admin/defrost-settings', preview: '/admin/defrost-settings/preview', update: '/admin/defrost-settings', audit: 'DEFROST_SETTINGS_UPDATED' },
    { name: 'ChatSettings', read: '/admin/chat-settings', preview: '/admin/chat-settings/preview', update: '/admin/chat-settings', audit: 'CHAT_SETTINGS_UPDATED' },
    { name: 'AnnouncementSettings', read: '/admin/announcement-settings', preview: '/admin/announcement-settings/preview', update: '/admin/announcement-settings', audit: 'ANNOUNCEMENT_SETTINGS_UPDATED' },
  ];

  for (const endpoint of settingsEndpoints) {
    const read = await expectStatus(`ADMIN reads ${endpoint.name}`, 200, request('GET', endpoint.read, { userId: 'test-admin', factoryId }));
    if (!hasUnsafeSecret(read.data)) ok(`${endpoint.name} read hides secrets`); else fail(`${endpoint.name} read hides secrets`, read.data);
    const payload = cleanSettingsPayload(read.data);
    const preview = await expectStatus(`ADMIN previews ${endpoint.name}`, 201, request('POST', endpoint.preview, { userId: 'test-admin', factoryId, body: payload }));
    if (preview.data && Object.prototype.hasOwnProperty.call(preview.data, 'allowed')) ok(`${endpoint.name} preview has allowed flag`);
    else fail(`${endpoint.name} preview has allowed flag`, preview.data);
    await expectStatus(`ADMIN updates ${endpoint.name}`, 200, request('PATCH', endpoint.update, { userId: 'test-admin', factoryId, body: payload }));
    await expectStatus(`WORKER cannot read ${endpoint.name}`, 403, request('GET', endpoint.read, { userId: 'worker-1', factoryId }));
  }

  const activeAdmins = await db.userFactoryAccess.count({
    where: { factoryId, role: 'ADMIN', isActive: true, user: { blockedAt: null, deletedAt: null } },
  });
  if (activeAdmins === 1) {
    const blockLastAdmin = await expectStatus('last ADMIN block still guarded', 409, request('PATCH', '/admin/users/test-admin/block-status', {
      userId: 'test-admin',
      factoryId,
      body: { blocked: true, reason: 'stage29 guard check' },
    }));
    if (!hasUnsafeSecret(blockLastAdmin.data)) ok('last-admin guard response hides secrets');
    else fail('last-admin guard response hides secrets', blockLastAdmin.data);
  } else {
    ok('last ADMIN mutation skipped without sole-admin precondition', { activeAdmins, coveredBy: 'stage60:admin-safety-recovery-regression' });
  }

  const reset = await expectStatus('admin password reset remains safe', 201, request('POST', '/admin/users/worker-1/password-reset', {
    userId: 'test-admin',
    factoryId,
    body: { reason: 'stage29 safety check' },
  }));
  if (!hasUnsafeSecret(reset.data) && !JSON.stringify(reset.data).match(/passwordHash|plainPassword|newPassword|oldPassword|temporaryPassword/i)) ok('password reset response does not expose password/hash');
  else fail('password reset response does not expose password/hash', reset.data);

  const adminSource = fs.readFileSync(path.join(root, 'frontend/src/screens/AdminConfigScreen.tsx'), 'utf8');
  const promptScan = /window\.(prompt|alert|confirm)|\balert\(/.test(adminSource);
  if (!promptScan) ok('AdminConfigScreen has no prompt/alert/confirm');
  else fail('AdminConfigScreen has no prompt/alert/confirm');
  const mojibake = adminSource.match(/�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/g);
  if (!mojibake) ok('AdminConfigScreen mojibake scan clean');
  else fail('AdminConfigScreen mojibake scan clean', [...new Set(mojibake)]);

  for (const endpoint of settingsEndpoints) {
    const count = await auditCount(endpoint.audit, since);
    if (count > 0) ok(`${endpoint.audit} audit written`, { count });
    else fail(`${endpoint.audit} audit written`, { count });
  }
  const resetAudit = await auditCount('ADMIN_PASSWORD_RESET', since);
  if (resetAudit > 0) ok('ADMIN_PASSWORD_RESET audit written', { count: resetAudit });
  else fail('ADMIN_PASSWORD_RESET audit written', { count: resetAudit });

  if (state.failures.length) {
    console.error('Stage 29 admin config coverage regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 29 admin config coverage regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
