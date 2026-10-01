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

async function ensureUsers(factoryId) {
  await db.user.upsert({
    where: { id: 'stage56-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage56-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage56-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage56-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
  });
  await db.user.upsert({
    where: { id: 'stage56-electrician-user' },
    update: { role: 'TECH_ELECTRIC', factoryId, blockedAt: null, deletedAt: null },
    create: { id: 'stage56-electrician-user', role: 'TECH_ELECTRIC', factoryId },
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
    await ensureUsers(factoryId);

    const lineName = `Stage56 линия конфигурации ${Date.now()}`;
    const createLine = await request('POST', '/admin/lines', { userId: 'test-admin', factoryId, body: { factoryId, name: lineName, status: 'STOP' } });
    const line = createLine.data;
    record('admin can create line', createLine.status === 201 && line?.name === lineName, line);

    const updateLine = await request('PATCH', `/admin/lines/${line.id}`, { userId: 'test-admin', factoryId, body: { name: `${lineName} обновлена` } });
    record('admin can update line', updateLine.status === 200 && updateLine.data?.name?.includes('обновлена'), updateLine.data);

    const deactivateLine = await request('PATCH', `/admin/lines/${line.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    const reactivateLine = await request('PATCH', `/admin/lines/${line.id}`, { userId: 'test-admin', factoryId, body: { isActive: true, reason: 'stage56 regression' } });
    record('admin can deactivate/reactivate line', deactivateLine.status === 200 && reactivateLine.status === 200 && !reactivateLine.data?.deletedAt, { deactivate: deactivateLine.status, reactivate: reactivateLine.status });

    const createPosition = await request('POST', `/admin/lines/${line.id}/positions`, { userId: 'test-admin', factoryId, body: { name: 'Stage56 оператор', displayName: 'Оператор', skillCode: 'stage56_operator', sortOrder: 1 } });
    const position = createPosition.data;
    record('admin can create line position', createPosition.status === 201 && position?.skillCode === 'stage56_operator', position);

    const updatePosition = await request('PATCH', `/admin/lines/${line.id}/positions/${position.id}`, { userId: 'test-admin', factoryId, body: { displayName: 'Оператор линии', isExtraSlot: false } });
    const deactivatePosition = await request('PATCH', `/admin/lines/${line.id}/positions/${position.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    const reactivatePosition = await request('PATCH', `/admin/lines/${line.id}/positions/${position.id}`, { userId: 'test-admin', factoryId, body: { isActive: true, reason: 'stage56 regression' } });
    record('admin can update/deactivate/reactivate line position', updatePosition.status === 200 && deactivatePosition.status === 200 && reactivatePosition.status === 200 && reactivatePosition.data?.isActive === true, reactivatePosition.data);

    const createTemplate = await request('POST', `/admin/lines/${line.id}/staffing-templates`, {
      userId: 'test-admin', factoryId,
      body: { name: 'Stage56 стандарт', items: [{ positionId: position.id, requiredCount: 1, minRequired: 1, defaultPlanned: 2, plannedCount: 2, maxRequired: 3 }] },
    });
    const template = createTemplate.data;
    record('admin can create staffing template', createTemplate.status === 201 && template?.items?.[0]?.plannedCount === 2, template);

    const updateTemplate = await request('PATCH', `/admin/lines/${line.id}/staffing-templates/${template.id}`, {
      userId: 'test-admin', factoryId,
      body: { name: 'Stage56 стандарт обновлён', items: [{ positionId: position.id, requiredCount: 1, minRequired: 1, defaultPlanned: 1, plannedCount: 1, maxRequired: 2 }] },
    });
    const deactivateTemplate = await request('PATCH', `/admin/lines/${line.id}/staffing-templates/${template.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    record('admin can update/deactivate staffing template', updateTemplate.status === 200 && updateTemplate.data?.items?.[0]?.plannedCount === 1 && deactivateTemplate.status === 200, { update: updateTemplate.data, deactivate: deactivateTemplate.data });

    const createArea = await request('POST', '/admin/work-areas', { userId: 'test-admin', factoryId, body: { factoryId, name: `Stage56 рабочая зона ${Date.now()}`, description: 'регрессионная проверка' } });
    const area = createArea.data;
    record('admin can create work area', createArea.status === 201 && area?.name, area);

    const updateArea = await request('PATCH', `/admin/work-areas/${area.id}`, { userId: 'test-admin', factoryId, body: { description: 'обновлено stage56' } });
    const deactivateArea = await request('PATCH', `/admin/work-areas/${area.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    const reactivateArea = await request('PATCH', `/admin/work-areas/${area.id}`, { userId: 'test-admin', factoryId, body: { isActive: true, reason: 'stage56 regression' } });
    record('admin can update/deactivate/reactivate work area', updateArea.status === 200 && deactivateArea.status === 200 && reactivateArea.status === 200 && reactivateArea.data?.isActive, reactivateArea.data);

    const createAreaPosition = await request('POST', `/admin/work-areas/${area.id}/positions`, { userId: 'test-admin', factoryId, body: { title: 'Stage56 грузчик', minRequired: 1, defaultPlanned: 2, maxRequired: 4 } });
    const areaPosition = createAreaPosition.data;
    const updateAreaPosition = await request('PATCH', `/admin/work-areas/${area.id}/positions/${areaPosition.id}`, { userId: 'test-admin', factoryId, body: { defaultPlanned: 3 } });
    const deactivateAreaPosition = await request('PATCH', `/admin/work-areas/${area.id}/positions/${areaPosition.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    record('admin can create/update/deactivate work area position', createAreaPosition.status === 201 && updateAreaPosition.status === 200 && updateAreaPosition.data?.defaultPlanned === 3 && deactivateAreaPosition.status === 200, updateAreaPosition.data);

    const createDepartment = await request('POST', '/admin/departments', { userId: 'test-admin', factoryId, body: { factoryId, name: `Stage56 отдел ${Date.now()}`, code: `stage56-dept-${Date.now()}`, scope: 'LOCAL' } });
    const department = createDepartment.data;
    const updateDepartment = await request('PATCH', `/admin/departments/${department.id}`, { userId: 'test-admin', factoryId, body: { name: `${department.name} обновлён` } });
    const deactivateDepartment = await request('PATCH', `/admin/departments/${department.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    record('admin can create/update/deactivate department', createDepartment.status === 201 && updateDepartment.status === 200 && deactivateDepartment.status === 200, updateDepartment.data);

    const createService = await request('POST', '/admin/departments', { userId: 'test-admin', factoryId, body: { name: `Stage56 электрики ${Date.now()}`, code: `stage56-electric-${Date.now()}`, scope: 'GLOBAL' } });
    record('admin can create shared service', createService.status === 201 && createService.data?.scope === 'GLOBAL' && createService.data?.factoryId === null, createService.data);

    const createJobTitle = await request('POST', '/admin/job-titles', { userId: 'test-admin', factoryId, body: { factoryId, name: 'Stage56 электрик', code: `stage56-electrician-${Date.now()}`, baseRole: 'TECH_ELECTRIC', departmentId: createService.data?.id, permissionPreset: 'Электрик' } });
    const jobTitle = createJobTitle.data;
    const updateJobTitle = await request('PATCH', `/admin/job-titles/${jobTitle.id}`, { userId: 'test-admin', factoryId, body: { description: 'foundation обновлён' } });
    const deactivateJobTitle = await request('PATCH', `/admin/job-titles/${jobTitle.id}`, { userId: 'test-admin', factoryId, body: { isActive: false, reason: 'stage56 regression' } });
    record('admin can create/update/deactivate job title foundation', createJobTitle.status === 201 && updateJobTitle.status === 200 && deactivateJobTitle.status === 200, updateJobTitle.data);

    const grantAccess = await request('POST', '/admin/users/stage56-electrician-user/factory-access', { userId: 'test-admin', factoryId, body: { factoryId, role: 'TECH_ELECTRIC', departmentId: createService.data?.id } });
    record('admin can grant user factory access as electrician', grantAccess.status === 201 && grantAccess.data?.role === 'TECH_ELECTRIC', grantAccess.data);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage56-hidden-factory' },
      update: { name: 'Stage56 hidden factory', isActive: true, deletedAt: null },
      create: { code: 'stage56-hidden-factory', name: 'Stage56 hidden factory', isActive: true },
    });
    const hiddenAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'stage56-electrician-user', factoryId: otherFactory.id } } });
    record('electrician is hidden on factory without access', !hiddenAccess, hiddenAccess);

    const context = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'test-admin', factoryId });
    record('permission labels and presets exist in admin context', context.status === 200 && Array.isArray(context.data?.jobTitles), context.data?.jobTitles?.slice?.(0, 3));
    record('no secrets in admin responses', !hasSecret({ context: context.data, line, area, jobTitle }), { checked: true });

    const workerLineCreate = await request('POST', '/admin/lines', { userId: 'worker-1', factoryId, body: { factoryId, name: 'Stage56 worker forbidden' } });
    record('non-admin forbidden', workerLineCreate.status === 403, workerLineCreate.data);

    const blocked = await request('POST', '/admin/lines', { userId: 'stage56-blocked-admin', factoryId, body: { factoryId, name: 'Stage56 blocked forbidden' } });
    record('blocked denied', blocked.status === 403, blocked.data);

    const activeAdmins = await db.userFactoryAccess.count({ where: { factoryId, role: 'ADMIN', isActive: true, user: { blockedAt: null, deletedAt: null } } });
    record('last admin guard still works', activeAdmins >= 1, { activeAdmins });

    const audits = await db.auditLog.findMany({ where: { factoryId, action: { in: ['LINE_CREATED', 'LINE_POSITION_CREATED', 'STAFFING_TEMPLATE_CREATED', 'WORK_AREA_CREATED', 'WORK_AREA_POSITION_CREATED', 'DEPARTMENT_CREATED', 'JOB_TITLE_CREATED', 'FACTORY_ACCESS_GRANTED'] } }, take: 20 });
    record('audit actions written', audits.length >= 6, audits.map((item) => item.action));
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
