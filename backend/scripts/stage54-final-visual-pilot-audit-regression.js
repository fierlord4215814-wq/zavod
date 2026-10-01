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

function hasRuntimeFixtureNoise(value) {
  return /Stage\d+|stage\d+|regression|fixture|simulation|browser/i.test(String(value ?? ''));
}

function hasUuidPrimary(value) {
  return /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(String(value ?? ''));
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

    const pilotUsers = await db.user.findMany({
      where: {
        id: {
          in: [
            'pilot-worker-1',
            'pilot-worker-2',
            'pilot-worker-3',
            'pilot-contractor-1',
            'pilot-contractor-2',
            'test-master',
            'test-admin',
            'test-management',
          ],
        },
      },
      select: { id: true, role: true },
    });
    record('Stage47 pilot users available', pilotUsers.length >= 7, pilotUsers);

    const health = await request('GET', '/health', { userId: null });
    record('backend health ok', health.status === 200, health.data);

    const timeline = await request('GET', '/shift/timeline', { userId: 'test-master', factoryId });
    record('current/next/future/past shift semantics available', timeline.status === 200
      && timeline.data?.current
      && timeline.data?.next
      && Array.isArray(timeline.data?.future)
      && Array.isArray(timeline.data?.past), timeline.data);

    const people = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
    record('runtime people list has human pilot names', people.status === 200
      && JSON.stringify(people.data).includes('Тестовый работник')
      && !JSON.stringify(people.data).includes('stage17-blocked-worker'), people.data?.slice?.(0, 5));

    const checklists = await request('GET', '/checklists/available', { userId: 'test-management', factoryId });
    record('checklist available list responds without secrets', checklists.status === 200 && !hasSecret(checklists.data), { count: checklists.data?.length });

    const chats = await request('GET', '/chats', { userId: 'pilot-worker-1', factoryId });
    record('messenger chat list is scoped and clean', chats.status === 200
      && !hasSecret(chats.data)
      && !(chats.data ?? []).some((chat) => hasRuntimeFixtureNoise(`${chat.displayTitle ?? chat.title ?? ''} ${chat.latestMessage?.text ?? ''}`)), chats.data?.slice?.(0, 3));

    const announcements = await request('GET', '/announcements/current', { userId: 'pilot-worker-1', factoryId });
    record('fullscreen announcements current queue available', announcements.status === 200 && !hasSecret(announcements.data), { count: announcements.data?.length });

    const archiveSections = await request('GET', '/archive/sections', { userId: 'test-management', factoryId });
    record('archive sections available', archiveSections.status === 200 && Array.isArray(archiveSections.data), { count: archiveSections.data?.length });

    const adminContext = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'test-admin', factoryId });
    record('admin factory context visible', adminContext.status === 200 && adminContext.data?.factory?.code === 'factory-4', adminContext.data?.factory);
    record('admin context separates local/global and hides secrets', adminContext.status === 200
      && adminContext.data?.localDepartments?.every((item) => item.kind === 'LOCAL_DEPARTMENT')
      && adminContext.data?.globalServices?.every((item) => item.kind === 'GLOBAL_SERVICE')
      && !hasSecret(adminContext.data), {
      local: adminContext.data?.localDepartments?.length,
      global: adminContext.data?.globalServices?.length,
    });
    record('admin pilot factory list hides Stage/test factories', adminContext.status === 200
      && !adminContext.data?.pilotVisibleFactories?.some((item) => hasRuntimeFixtureNoise(`${item.name} ${item.code}`)), adminContext.data?.pilotVisibleFactories);

    const forbiddenContext = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'worker-1', factoryId });
    record('worker denied admin factory context', forbiddenContext.status === 403, forbiddenContext.data);

  const blockedUser = await db.user.upsert({
    where: { id: 'stage54-blocked-worker' },
    update: { blockedAt: new Date(), deletedAt: null, factoryId },
    create: { id: 'stage54-blocked-worker', role: 'WORKER', factoryId, blockedAt: new Date() },
    select: { id: true },
  });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: blockedUser.id, factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: blockedUser.id, factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blockedShift = await request('GET', '/shift/timeline', { userId: blockedUser.id, factoryId });
    record('blocked user denied runtime data', blockedShift.status === 403, blockedShift.data);

    const serialized = JSON.stringify({
      timeline: timeline.data,
      checklists: checklists.data,
      chats: chats.data,
      announcements: announcements.data,
      archiveSections: archiveSections.data,
      adminContext: adminContext.data,
    });
    record('no storagePath/secrets in audited responses', !hasSecret(serialized), { checked: true });
    record('no raw UUID as display name in audited summaries', ![
      ...(adminContext.data?.usersWithAccess ?? []).map((item) => item.displayName),
      ...(adminContext.data?.localDepartments ?? []).map((item) => item.name),
      ...(adminContext.data?.globalServices ?? []).map((item) => item.name),
    ].some(hasUuidPrimary), { checked: true });
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
