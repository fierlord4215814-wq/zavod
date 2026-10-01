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

function hasStageNoise(value) {
  return /Stage\d+|stage\d+|regression|fixture|simulation|browser/i.test(String(value ?? ''));
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
      where: { id: 'pilot-stock-percent-check' },
      update: {
        factoryId,
        name: 'Пилотный ремень проверки',
        minThreshold: 10,
        initialQuantity: 5,
        currentQuantity: 5,
        referenceQuantity: 100,
        unit: 'шт',
        isActive: true,
        archivedAt: null,
        createdById: 'test-store',
      },
      create: {
        id: 'pilot-stock-percent-check',
        factoryId,
        name: 'Пилотный ремень проверки',
        minThreshold: 10,
        initialQuantity: 5,
        currentQuantity: 5,
        referenceQuantity: 100,
        unit: 'шт',
        createdById: 'test-store',
      },
    });
    await db.minimumStockItem.upsert({
      where: { id: 'stage55-stock-noise' },
      update: {
        factoryId,
        name: 'Stage55 stock noise',
        minThreshold: 1,
        initialQuantity: 1,
        currentQuantity: 1,
        referenceQuantity: 1,
        unit: 'шт',
        isActive: true,
        archivedAt: null,
        createdById: 'test-store',
      },
      create: {
        id: 'stage55-stock-noise',
        factoryId,
        name: 'Stage55 stock noise',
        minThreshold: 1,
        initialQuantity: 1,
        currentQuantity: 1,
        referenceQuantity: 1,
        unit: 'шт',
        createdById: 'test-store',
      },
    });

    const timeline = await request('GET', '/shift/timeline', { userId: 'test-master', factoryId });
    record('shift timeline exposes current/next/future/past modes', timeline.status === 200
      && timeline.data?.current && timeline.data?.next
      && Array.isArray(timeline.data?.future)
      && Array.isArray(timeline.data?.past), timeline.data);

    const people = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
    record('shift people list keeps pilot names and hides blocked Stage users', people.status === 200
      && JSON.stringify(people.data).includes('Тестовый работник')
      && !JSON.stringify(people.data).includes('stage17-blocked-worker'), people.data?.slice?.(0, 5));

    const lines = await request('GET', '/lines', { userId: 'test-master', factoryId });
    const productionLine = (lines.data ?? []).find((line) => !hasStageNoise(`${line.id} ${line.name}`));
    record('production lines list has no Stage/test noise', lines.status === 200
      && Array.isArray(lines.data)
      && productionLine
      && !(lines.data ?? []).some((line) => hasStageNoise(`${line.id} ${line.name}`)), lines.data?.slice?.(0, 5));

    if (productionLine) {
      const board = await request('GET', `/lines/${productionLine.id}/assignment-board`, { userId: 'test-master', factoryId });
      record('line assignment board candidates are only assignable workers/contractors', board.status === 200
        && (board.data?.candidates ?? []).every((candidate) => ['WORKER', 'CONTRACTOR'].includes(candidate.role)), board.data?.candidates?.slice?.(0, 5));
      const dashboard = await request('GET', `/lines/${productionLine.id}/dashboard`, { userId: 'test-master', factoryId });
      record('line dashboard exposes runtime stats without secrets', dashboard.status === 200 && !hasSecret(dashboard.data), dashboard.data?.line);
    }

    const items = await request('GET', '/orders/items', { userId: 'test-store', factoryId });
    const percentItem = (items.data ?? []).find((item) => item.id === 'pilot-stock-percent-check');
    record('stock runtime list hides Stage/test stock noise', items.status === 200
      && !(items.data ?? []).some((item) => item.id === 'stage55-stock-noise' || hasStageNoise(item.name)), items.data?.map?.((item) => item.name).slice(0, 5));
    record('stock percent is calculated from minimum threshold and capped', Boolean(percentItem) && Math.round(percentItem.percent) === 50, percentItem);

    const take = await request('POST', '/orders/items/pilot-stock-percent-check/take', { userId: 'test-store', factoryId, body: { quantity: 1 } });
    record('stock take works without mandatory comment', take.status === 201 || take.status === 200, take.data);

    const chats = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    record('chat list is pilot-clean and scoped', chats.status === 200
      && !hasSecret(chats.data)
      && !(chats.data ?? []).some((chat) => hasStageNoise(`${chat.displayTitle ?? chat.title ?? ''} ${chat.latestMessage?.text ?? ''}`)), chats.data?.slice?.(0, 3));

    const adminPermissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId });
    record('admin permissions endpoint available without secrets', adminPermissions.status === 200 && !hasSecret(adminPermissions.data), { count: adminPermissions.data?.length });

    const workerAdmin = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'pilot-worker-1', factoryId });
    record('worker denied admin context', workerAdmin.status === 403, workerAdmin.data);

    const blockedUser = await db.user.upsert({
      where: { id: 'stage55-blocked-worker' },
      update: { blockedAt: new Date(), deletedAt: null, factoryId },
      create: { id: 'stage55-blocked-worker', role: 'WORKER', factoryId, blockedAt: new Date() },
      select: { id: true },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: blockedUser.id, factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: blockedUser.id, factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blocked = await request('GET', '/shift/timeline', { userId: blockedUser.id, factoryId });
    record('blocked user denied runtime data', blocked.status === 403, blocked.data);

    record('audited Stage55 responses hide secrets/storagePath', !hasSecret({
      timeline: timeline.data,
      people: people.data,
      lines: lines.data,
      items: items.data,
      chats: chats.data,
      adminPermissions: adminPermissions.data,
    }), { checked: true });
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try { await db.$disconnect(); } catch {}
  process.exit(1);
});
