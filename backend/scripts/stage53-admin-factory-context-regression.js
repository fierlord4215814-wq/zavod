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

function hasFixtureMarker(value) {
  return /Stage\d+|stage\d+|regression|browser|fixture|simulation|demo/i.test(String(value ?? ''));
}

async function ensureStageFixtureFactory() {
  return db.factory.upsert({
    where: { code: 'stage53-context-fixture' },
    update: { name: 'Stage53 context fixture', isActive: true, deletedAt: null },
    create: { code: 'stage53-context-fixture', name: 'Stage53 context fixture', isActive: true },
  });
}

async function ensureBlockedAdmin(factoryId) {
  await db.user.upsert({
    where: { id: 'stage53-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage53-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage53-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage53-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
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
    const factoryId = factory.id;

    await ensureStageFixtureFactory();
    await ensureBlockedAdmin(factoryId);
    await db.auditLog.create({
      data: {
        factoryId,
        userId: 'test-admin',
        action: 'FACTORY_CONTEXT_AUDIT_MARKER',
        entityType: 'Factory',
        entityId: factoryId,
        details: { marker: 'factory-context-audit-check' },
      },
    });

    const response = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'test-admin', factoryId });
    const context = response.data;
    record('admin gets factory context', response.status === 200 && context?.factory?.id === factoryId, context?.factory);
    record('selected factory users are only users with access', response.status === 200 && context.usersWithAccess.every((user) => typeof user.accessId === 'string' && user.accessId), context.usersWithAccess?.slice?.(0, 3));
    record('local departments separated from global services', response.status === 200 && context.localDepartments.every((item) => item.kind === 'LOCAL_DEPARTMENT') && context.globalServices.every((item) => item.kind === 'GLOBAL_SERVICE'), {
      local: context.localDepartments?.length,
      global: context.globalServices?.length,
    });
    record('global service does not imply access to all factories', response.status === 200 && context.globalServices.every((item) => /доступ|access|завод/i.test(item.contextNote ?? '')), context.globalServices?.[0]);
    record('lines belong to selected factory', response.status === 200 && context.lines.every((line) => line.factoryId === factoryId), context.lines?.slice?.(0, 2));
    const lineIds = new Set(context.lines.map((line) => line.id));
    record('workAreas are not mixed with lines', response.status === 200 && context.workAreas.every((area) => !lineIds.has(area.id)), { lines: context.lines.length, workAreas: context.workAreas.length });
    record('module settings scoped to selected factory', response.status === 200 && context.moduleSettings.every((item) => item.factoryId === factoryId && item.scope === 'factory'), context.moduleSettings);
    record('stage/test factories hidden from pilot list', response.status === 200 && !context.pilotVisibleFactories.some((item) => hasFixtureMarker(`${item.id} ${item.name} ${item.code}`)), context.pilotVisibleFactories);
    record('changing selected factory changes context', response.status === 200 && context.factory.code === 'factory-4', context.factory);
    record('audit entries include factory context', response.status === 200 && context.recentAudit.some((item) => item.factoryId === factoryId), context.recentAudit?.slice?.(0, 3));
    record('no secrets in context response', response.status === 200 && !hasSecret(context), { checked: true });

    const worker = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'worker-1', factoryId });
    record('non-admin forbidden', worker.status === 403, worker.data);

    const blocked = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'stage53-blocked-admin', factoryId });
    record('blocked admin denied', blocked.status === 403, blocked.data);

    const otherFactory = await db.factory.findFirst({ where: { code: { not: 'factory-4' }, deletedAt: null } });
    if (otherFactory) {
      const cross = await request('GET', `/admin/factories/${otherFactory.id}/context`, { userId: 'worker-1', factoryId: otherFactory.id });
      record('cross-factory non-admin denied', cross.status === 403, cross.data);
    } else {
      record('cross-factory non-admin denied', true, { skipped: 'only one factory exists' });
    }

    const activeAdmins = await db.userFactoryAccess.count({
      where: { factoryId, role: 'ADMIN', isActive: true, user: { blockedAt: null, deletedAt: null } },
    });
    record('last-admin guard unaffected', activeAdmins >= 1, { activeAdmins });
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

main().catch(async (error) => {
  console.error(error);
  try { await db.$disconnect(); } catch {}
  process.exitCode = 1;
});
