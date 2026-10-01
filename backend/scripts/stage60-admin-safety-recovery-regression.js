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
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value ?? {}));
}

async function ensureBlockedAdmin(factoryId) {
  await db.user.upsert({
    where: { id: 'stage60-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage60-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage60-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage60-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
  });
}

async function ensureLastAdminFactory(marker) {
  const factory = await db.factory.upsert({
    where: { code: `stage60-last-admin-${marker}` },
    update: { name: `Stage60 last admin ${marker}`, isActive: true, deletedAt: null },
    create: { code: `stage60-last-admin-${marker}`, name: `Stage60 last admin ${marker}`, isActive: true },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: factory.id } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'test-admin', factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false },
  });
  return factory;
}

async function expectRecoverable({ type, id, factoryId, titlePart }) {
  const recovery = await request('GET', `/admin/recovery?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'test-admin', factoryId });
  const item = recovery.data?.items?.find((entry) => entry.type === type && entry.id === id);
  record(`${type} appears in recovery center`, recovery.status === 200 && item && String(item.title).includes(titlePart), item);
  record(`${type} recovery metadata is human-readable`, item && item.reason && item.deactivatedByName && item.recoveryUntil, item);
  record(`${type} recovery response has no secrets`, !hasSecret(recovery.data), null);
  return item;
}

async function restore(type, id, factoryId) {
  const restored = await request('POST', `/admin/recovery/${type}/${id}/restore`, {
    userId: 'test-admin',
    factoryId,
    body: { reason: 'Stage60 regression restore' },
  });
  record(`${type} restores from recovery center`, restored.status === 201 || restored.status === 200, restored.data);
  return restored;
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
    const marker = Date.now().toString(36);
    await ensureBlockedAdmin(factoryId);

    const line = await request('POST', '/admin/lines', {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, name: `Проверка восстановления линия ${marker}`, status: 'STOP', reason: 'Stage60 regression create line' },
    });
    const lineId = line.data?.id;
    record('stage60 line fixture created', line.status === 201 && lineId, line.data);

    const noReasonLine = await request('PATCH', `/admin/lines/${lineId}`, {
      userId: 'test-admin',
      factoryId,
      body: { isActive: false },
    });
    record('line deactivation requires reason', noReasonLine.status === 409 || noReasonLine.status === 400, noReasonLine.data);

    const disabledLine = await request('PATCH', `/admin/lines/${lineId}`, {
      userId: 'test-admin',
      factoryId,
      body: { isActive: false, reason: 'Stage60 отключение линии для проверки восстановления' },
    });
    record('line deactivated with reason', disabledLine.status === 200 && disabledLine.data?.deletedAt, disabledLine.data);
    await expectRecoverable({ type: 'line', id: lineId, factoryId, titlePart: 'Проверка восстановления' });
    await restore('line', lineId, factoryId);
    const restoredLine = await db.line.findUnique({ where: { id: lineId } });
    record('line restored without physical delete', restoredLine && !restoredLine.deletedAt && !restoredLine.deactivatedAt, restoredLine);

    const department = await request('POST', '/admin/departments', {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, scope: 'LOCAL', name: `Проверка восстановления отдел ${marker}`, code: `recovery-dept-${marker}`, reason: 'Stage60 regression create department' },
    });
    const departmentId = department.data?.id;
    const noReasonDepartment = await request('PATCH', `/admin/departments/${departmentId}/status`, { userId: 'test-admin', factoryId, body: { isActive: false } });
    record('department deactivation requires reason', noReasonDepartment.status === 409 || noReasonDepartment.status === 400, noReasonDepartment.data);
    await request('PATCH', `/admin/departments/${departmentId}/status`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'Stage60 отключение отдела' } });
    await expectRecoverable({ type: 'department', id: departmentId, factoryId, titlePart: 'Проверка восстановления' });
    await restore('department', departmentId, factoryId);

    const jobTitle = await request('POST', '/admin/job-titles', {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, departmentId, name: `Проверка восстановления должность ${marker}`, code: `recovery-title-${marker}`, baseRole: 'WORKER', permissionPreset: 'Работник', reason: 'Stage60 create title' },
    });
    const jobTitleId = jobTitle.data?.id;
    await request('PATCH', `/admin/job-titles/${jobTitleId}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'Stage60 отключение должности' } });
    await expectRecoverable({ type: 'job-title', id: jobTitleId, factoryId, titlePart: 'Проверка восстановления' });
    await restore('job-title', jobTitleId, factoryId);

    const workArea = await request('POST', '/admin/work-areas', {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, name: `Проверка восстановления зона ${marker}`, reason: 'Stage60 create work area' },
    });
    const workAreaId = workArea.data?.id;
    const workAreaPosition = await request('POST', `/admin/work-areas/${workAreaId}/positions`, {
      userId: 'test-admin',
      factoryId,
      body: { title: `Проверка восстановления слот ${marker}`, minRequired: 1, defaultPlanned: 1, maxRequired: 1, reason: 'Stage60 create work area position' },
    });
    await request('PATCH', `/admin/work-areas/${workAreaId}/positions/${workAreaPosition.data?.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'Stage60 отключение слота зоны' } });
    await expectRecoverable({ type: 'work-area-position', id: workAreaPosition.data?.id, factoryId, titlePart: 'Проверка восстановления' });
    await restore('work-area-position', workAreaPosition.data?.id, factoryId);
    await request('PATCH', `/admin/work-areas/${workAreaId}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'Stage60 отключение рабочей зоны' } });
    await expectRecoverable({ type: 'work-area', id: workAreaId, factoryId, titlePart: 'Проверка восстановления' });
    await restore('work-area', workAreaId, factoryId);

    await db.user.upsert({
      where: { id: `recovery-worker-${marker}` },
      update: { role: 'WORKER', factoryId, blockedAt: null, deletedAt: null },
      create: { id: `recovery-worker-${marker}`, role: 'WORKER', factoryId },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: `recovery-worker-${marker}`, factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: `recovery-worker-${marker}`, factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const accessOff = await request('PATCH', `/admin/users/recovery-worker-${marker}/factory-access`, {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, isActive: false, reason: 'Stage60 отключение доступа к заводу' },
    });
    record('factory access deactivated with reason', accessOff.status === 200 && accessOff.data?.isActive === false, accessOff.data);
    const accessItem = await expectRecoverable({ type: 'factory-access', id: accessOff.data?.id, factoryId, titlePart: 'recovery-worker' });
    await restore('factory-access', accessItem?.id, factoryId);

    const tempFactory = await ensureLastAdminFactory(marker);
    const lastAdmin = await request('PATCH', '/admin/users/test-admin/factory-access', {
      userId: 'test-admin',
      factoryId: tempFactory.id,
      body: { factoryId: tempFactory.id, isActive: false, reason: 'Stage60 last admin guard check' },
    });
    record('last active admin cannot be removed', lastAdmin.status === 409, lastAdmin.data);

    const workerRecovery = await request('GET', `/admin/recovery?factoryId=${factoryId}`, { userId: 'worker-1', factoryId });
    record('worker cannot open recovery center', workerRecovery.status === 403, workerRecovery.data);
    const blockedRecovery = await request('GET', `/admin/recovery?factoryId=${factoryId}`, { userId: 'stage60-blocked-admin', factoryId });
    record('blocked admin denied recovery center', blockedRecovery.status === 403, blockedRecovery.data);

    const audits = await db.auditLog.findMany({
      where: {
        OR: [
          { action: { in: ['LINE_RESTORED', 'DEPARTMENT_RESTORED', 'JOB_TITLE_RESTORED', 'WORK_AREA_RESTORED', 'WORK_AREA_POSITION_RESTORED', 'USER_FACTORY_ACCESS_RESTORED', 'LAST_ADMIN_GUARD_BLOCKED'] } },
          { details: { path: ['recoveryCenter'], equals: true } },
        ],
      },
      take: 50,
    });
    record('audit actions written for recovery and last-admin guard', audits.some((item) => item.action === 'LAST_ADMIN_GUARD_BLOCKED') && audits.some((item) => String(item.action).includes('RESTORED')), audits.map((item) => item.action));

    const finalRecovery = await request('GET', `/admin/recovery?factoryId=${factoryId}`, { userId: 'test-admin', factoryId });
    record('final recovery response has no secrets', finalRecovery.status === 200 && !hasSecret(finalRecovery.data), finalRecovery.data?.items?.slice?.(0, 2));
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ api: API, ok, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

main().catch(async (error) => {
  console.error(error);
  try { await db.$disconnect(); } catch {}
  process.exitCode = 1;
});
