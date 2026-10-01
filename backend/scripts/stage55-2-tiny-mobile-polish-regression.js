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

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
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
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

function hasRuntimeNoise(value) {
  return /Stage\d+|stage\d+|regression|fixture|simulation|browser|demo|апра|50\s*22|минимум\s*20\s*22/i.test(String(value ?? ''));
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
    const factoryId = factory.id;

    await db.minimumStockItem.upsert({
      where: { id: 'stage55-2-dirty-stock' },
      update: {
        factoryId,
        name: 'апра',
        description: 'Stage55.2 dirty stock runtime noise',
        minThreshold: 20,
        initialQuantity: 50,
        currentQuantity: 50,
        referenceQuantity: 50,
        unit: '22',
        isActive: true,
        archivedAt: null,
        createdById: 'test-store',
      },
      create: {
        id: 'stage55-2-dirty-stock',
        factoryId,
        name: 'апра',
        description: 'Stage55.2 dirty stock runtime noise',
        minThreshold: 20,
        initialQuantity: 50,
        currentQuantity: 50,
        referenceQuantity: 50,
        unit: '22',
        createdById: 'test-store',
      },
    });

    const items = await request('GET', '/orders/items', { userId: 'test-store', factoryId });
    record('orders runtime list hides dirty demo stock records', items.status === 200
      && !(items.data ?? []).some((item) => item.id === 'stage55-2-dirty-stock' || hasRuntimeNoise(`${item.name} ${item.currentQuantity} ${item.unit} ${item.minThreshold}`)), items.data?.slice?.(0, 5));

    const summary = await request('GET', '/orders/summary', { userId: 'test-store', factoryId });
    record('orders summary excludes dirty demo stock records', summary.status === 200 && !hasSecret(summary.data), summary.data);

    const permissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId });
    record('admin permissions still load for Russian label mapping', permissions.status === 200 && Array.isArray(permissions.data) && permissions.data.length > 10, { count: permissions.data?.length });

    const announcements = await request('GET', '/announcements/current', { userId: 'pilot-worker-1', factoryId });
    record('announcements fullscreen endpoint available without secrets', announcements.status === 200 && !hasSecret(announcements.data), { count: announcements.data?.length ?? 0 });

    const checklists = await request('GET', '/checklists/available', { userId: 'pilot-technolog-1', factoryId });
    record('checklist available endpoint returns mobile card data without secrets', checklists.status === 200 && !hasSecret(checklists.data), { count: checklists.data?.length ?? 0 });

    const blocked = await db.user.upsert({
      where: { id: 'stage55-2-blocked-worker' },
      update: { blockedAt: new Date(), deletedAt: null, factoryId },
      create: { id: 'stage55-2-blocked-worker', role: 'WORKER', factoryId, blockedAt: new Date() },
      select: { id: true },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: blocked.id, factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: blocked.id, factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blockedOrders = await request('GET', '/orders/items', { userId: blocked.id, factoryId });
    record('blocked user denied runtime stock data', blockedOrders.status === 403, blockedOrders.data);

    record('Stage55.2 runtime responses hide secrets/storagePath', !hasSecret({
      items: items.data,
      summary: summary.data,
      permissions: permissions.data,
      announcements: announcements.data,
      checklists: checklists.data,
    }), { checked: true });
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
