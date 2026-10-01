const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { PrismaClient, UserRole } = require('../../backend/node_modules/@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const frontend = path.resolve(__dirname, '..');
const API = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const guestIds = ['pilot-pack-guest-worker-target', 'pilot-pack-guest-kipia-target'];

async function request(method, pathname, { userId, factoryId, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Connection: 'close' };
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function prepare() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  for (const userId of guestIds) {
    await db.user.update({ where: { id: userId }, data: { role: UserRole.OTHER, blockedAt: null, deletedAt: null } });
    await db.userFactoryAccess.update({
      where: { userId_factoryId: { userId, factoryId: factory.id } },
      data: { role: UserRole.OTHER, departmentId: null, jobTitleId: null, companyId: null, isGuest: true, isActive: true, deactivatedAt: null },
    });
    const pending = await db.assignmentRequest.findMany({ where: { requestedById: userId, factoryId: factory.id, status: 'PENDING' }, select: { id: true, version: true } });
    for (const row of pending) {
      const rejected = await request('POST', `/admin/assignment-requests/${row.id}/reject`, {
        userId: 'test-admin',
        factoryId: factory.id,
        body: { expectedVersion: row.version, reason: 'Подготовка целевой browser-проверки', operationId: `plast2-e2e-prepare-${row.id}` },
      });
      if (rejected.status !== 201) throw new Error(`Cannot prepare assignment request ${row.id}: ${rejected.status}`);
    }
  }
  return factory.id;
}

async function finish(factoryId) {
  for (const userId of guestIds) {
    const pending = await db.assignmentRequest.findMany({ where: { requestedById: userId, factoryId, status: 'PENDING' }, select: { id: true, version: true } });
    for (const row of pending) {
      await request('POST', `/admin/assignment-requests/${row.id}/reject`, {
        userId: 'test-admin',
        factoryId,
        body: { expectedVersion: row.version, reason: 'Завершение целевой browser-проверки', operationId: `plast2-e2e-finish-${row.id}` },
      });
    }
    await db.user.update({ where: { id: userId }, data: { role: UserRole.OTHER, blockedAt: null, deletedAt: null } });
    await db.userFactoryAccess.update({
      where: { userId_factoryId: { userId, factoryId } },
      data: {
        role: UserRole.OTHER,
        departmentId: null,
        jobTitleId: null,
        companyId: null,
        isGuest: true,
        isActive: true,
        deactivatedAt: null,
        deactivationReason: null,
      },
    });
  }
}

async function main() {
  const factoryId = await prepare();
  let status = 1;
  try {
    const cli = require.resolve('@playwright/test/cli');
    const result = spawnSync(process.execPath, [
      cli,
      'test',
      'e2e/pilot-fix-plast2.spec.ts',
      '--project=desktop-edge',
      '--project=mobile-360-edge',
      '--workers=1',
    ], {
      cwd: frontend,
      stdio: 'inherit',
      env: {
        ...process.env,
        STAGE31_SKIP_WEBSERVER: '1',
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
        VITE_API_URL: API,
      },
    });
    if (result.error) console.error(result.error);
    status = result.status ?? 1;
  } finally {
    await finish(factoryId);
    await db.$disconnect();
  }
  process.exitCode = status;
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
