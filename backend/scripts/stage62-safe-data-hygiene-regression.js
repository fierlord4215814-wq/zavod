const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const secretText = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(cmd, ['run', 'start:dev:win', '--workspace', 'backend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'ignore',
    shell: true,
  });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function hasSecret(value) {
  return secretText.test(JSON.stringify(value ?? {}));
}

async function ensureFixtures(factoryId) {
  const admin = await db.user.findUnique({ where: { id: 'test-admin' } });
  if (!admin) throw new Error('test-admin not found');
  const now = new Date();
  const recoveryUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.line.upsert({
    where: { id: 'stage62-hygiene-line' },
    update: {
      factoryId,
      name: 'Stage62 hygiene ????? line',
      deletedAt: now,
      deactivatedAt: now,
      deactivatedById: admin.id,
      deactivationReason: 'Stage62 diagnostic fixture',
      recoveryUntil,
    },
    create: {
      id: 'stage62-hygiene-line',
      factoryId,
      name: 'Stage62 hygiene ????? line',
      deletedAt: now,
      deactivatedAt: now,
      deactivatedById: admin.id,
      deactivationReason: 'Stage62 diagnostic fixture',
      recoveryUntil,
    },
  });
  await db.minimumStockItem.upsert({
    where: { id: 'stage62-hygiene-stock' },
    update: {
      factoryId,
      name: 'Stage62 dirty stock',
      unit: 'шт',
      minThreshold: 0.5,
      initialQuantity: 0.5,
      currentQuantity: 0.5,
      referenceQuantity: 0.5,
      isActive: true,
      archivedAt: null,
      updatedById: admin.id,
    },
    create: {
      id: 'stage62-hygiene-stock',
      factoryId,
      name: 'Stage62 dirty stock',
      description: 'Stage62 dirty stock fixture',
      unit: 'шт',
      minThreshold: 0.5,
      initialQuantity: 0.5,
      currentQuantity: 0.5,
      referenceQuantity: 0.5,
      isActive: true,
      createdById: admin.id,
    },
  });
  await db.user.upsert({
    where: { id: 'stage62-blocked-admin-probe' },
    update: { factoryId, role: 'ADMIN', blockedAt: now, deletedAt: null },
    create: { id: 'stage62-blocked-admin-probe', factoryId, role: 'ADMIN', blockedAt: now },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage62-blocked-admin-probe', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage62-blocked-admin-probe', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
  });
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    await ensureFixtures(factory.id);

    const summary = await request('GET', `/admin/data-hygiene/summary?factoryId=${factory.id}`, { userId: 'test-admin', factoryId: factory.id });
    record('admin can read data hygiene summary', summary.status === 200 && summary.data?.total >= 2, summary.data?.groups);
    record('summary has no secrets', summary.status === 200 && !hasSecret(summary.data), null);

    const records = await request('GET', `/admin/data-hygiene/records?factoryId=${factory.id}&pageSize=100`, { userId: 'test-admin', factoryId: factory.id });
    const lineRecords = await request('GET', `/admin/data-hygiene/records?factoryId=${factory.id}&type=line&pageSize=100`, { userId: 'test-admin', factoryId: factory.id });
    const stockRecords = await request('GET', `/admin/data-hygiene/records?factoryId=${factory.id}&type=minimum-stock-item&pageSize=100`, { userId: 'test-admin', factoryId: factory.id });
    const allRecords = records.data?.records ?? [];
    record('diagnostic records include Stage/test or mojibake line records', lineRecords.status === 200 && (lineRecords.data?.records ?? []).some((item) => /Stage|\?{3,}/i.test(item.title)), lineRecords.data?.records?.map?.((item) => item.title));
    record('diagnostic records include dirty stock fixture', stockRecords.status === 200 && (stockRecords.data?.records ?? []).some((item) => item.id === 'stage62-hygiene-stock' && item.group === 'dirty-stock'), stockRecords.data?.records?.filter?.((item) => item.type === 'minimum-stock-item'));
    record('diagnostic records have no secrets', records.status === 200 && !hasSecret(records.data), null);

    const recoveryNormal = await request('GET', `/admin/recovery?factoryId=${factory.id}`, { userId: 'test-admin', factoryId: factory.id });
    const recoveryDiagnostic = await request('GET', `/admin/recovery?factoryId=${factory.id}&diagnostic=true`, { userId: 'test-admin', factoryId: factory.id });
    record('normal recovery excludes Stage/mojibake fixture', recoveryNormal.status === 200 && !(recoveryNormal.data?.items ?? []).some((item) => item.id === 'stage62-hygiene-line'), recoveryNormal.data?.items?.map?.((item) => item.title));
    record('diagnostic recovery includes Stage/mojibake fixture', recoveryDiagnostic.status === 200 && (recoveryDiagnostic.data?.items ?? []).some((item) => item.id === 'stage62-hygiene-line'), recoveryDiagnostic.data?.items?.map?.((item) => item.title));

    const orderItems = await request('GET', '/orders/items', { userId: 'test-store', factoryId: factory.id });
    record('normal runtime stock excludes dirty 0.5 шт fixture', orderItems.status === 200 && !(orderItems.data ?? []).some((item) => item.id === 'stage62-hygiene-stock'), (orderItems.data ?? []).map((item) => item.name).slice(0, 8));

    const workerForbidden = await request('GET', `/admin/data-hygiene/summary?factoryId=${factory.id}`, { userId: 'test-master', factoryId: factory.id });
    record('non-admin cannot read diagnostics', workerForbidden.status === 403, workerForbidden.status);
    const blockedDenied = await request('GET', `/admin/data-hygiene/summary?factoryId=${factory.id}`, { userId: 'stage62-blocked-admin-probe', factoryId: factory.id });
    record('blocked admin probe is denied', blockedDenied.status === 403, blockedDenied.status);

    const dryRun = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', ['scripts/stage62-safe-data-hygiene-dry-run.js'], {
      cwd: backendDir,
      env: process.env,
      encoding: 'utf8',
    });
    let dryRunData = null;
    try { dryRunData = JSON.parse(dryRun.stdout); } catch { dryRunData = null; }
    record('dry-run reports without changing data', dryRun.status === 0 && dryRunData?.changed === false && dryRunData?.counts?.dirtyStockRecords >= 1, dryRun.stdout || dryRun.stderr);

    const audit = await db.auditLog.findFirst({
      where: { factoryId: factory.id, action: 'DATA_HYGIENE_VIEWED' },
      orderBy: { createdAt: 'desc' },
    });
    record('diagnostic summary writes audit action', Boolean(audit), audit?.id);
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(`\nStage62 safe data hygiene regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
