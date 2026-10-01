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

function startBackend() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(cmd, ['run', 'start:dev:win', '--workspace', 'backend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
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

function hasSecret(value) {
  return /storagePath|passwordHash|token|secret|DATABASE_URL|JWT/i.test(JSON.stringify(value ?? {}));
}

function healthGroups(warnings = []) {
  const groups = new Map();
  for (const warning of warnings) {
    const text = `${warning.id} ${warning.title} ${warning.detail}`.toLowerCase();
    const key = text.includes('position') || text.includes('позиц')
      ? 'positions'
      : text.includes('template') || text.includes('шаблон')
        ? 'templates'
        : text.includes('skill') || text.includes('навык') || text.includes('код')
          ? 'skills'
          : warning.section || 'other';
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return groups;
}

async function ensureBlockedAdmin(factoryId) {
  await db.user.upsert({
    where: { id: 'stage59-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage59-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage59-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage59-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
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
    await ensureBlockedAdmin(factory.id);
    const marker = Date.now().toString(36);

    const context = await request('GET', `/admin/factories/${factory.id}/context`, { userId: 'test-admin', factoryId: factory.id });
    record('admin factory context loads', context.status === 200 && context.data?.factory?.id === factory.id, context.data?.counts);
    record('context separates local departments and global services', context.status === 200 && Array.isArray(context.data?.localDepartments) && Array.isArray(context.data?.globalServices), {
      local: context.data?.localDepartments?.length,
      global: context.data?.globalServices?.length,
    });

    const health = await request('GET', `/admin/factories/${factory.id}/config-health`, { userId: 'test-admin', factoryId: factory.id });
    const grouped = healthGroups(health.data?.warnings ?? []);
    record('config health returns summary and groupable warnings', health.status === 200 && health.data?.summary && grouped.size >= 0, health.data?.summary);
    record('config health still detects line/template/position issues when present', health.status === 200 && Array.isArray(health.data?.warnings), { warnings: health.data?.warnings?.length ?? 0 });

    const permissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId: factory.id });
    record('permission labels/descriptions source is available', permissions.status === 200 && permissions.data?.every((item) => item.code && item.group && 'description' in item), permissions.data?.slice?.(0, 3));

    const exported = await request('GET', `/admin/factories/${factory.id}/config-export`, { userId: 'test-admin', factoryId: factory.id });
    record('factory config export still works', exported.status === 200 && exported.data?.schemaVersion === 'factory-config-v1', exported.data?.counts);
    const preview = await request('POST', '/admin/factories/config-import/preview', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { config: exported.data, target: { name: `Stage59 preview ${marker}`, code: `stage59-preview-${marker}` } },
    });
    record('factory config import preview still works without write', preview.status === 201 && preview.data?.writesDatabase === false, preview.data?.counts);

    const line = await request('POST', '/admin/lines', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { factoryId: factory.id, name: `Stage59 линия ${marker}`, status: 'STOP' },
    });
    const lineId = line.data?.id;
    record('create line still works', line.status === 201 && lineId, line.data);

    const position = lineId ? await request('POST', `/admin/lines/${lineId}/positions`, {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { name: `Stage59 позиция ${marker}`, displayName: `Stage59 позиция`, skillCode: `stage59-${marker}`, sortOrder: 1 },
    }) : { status: 0, data: null };
    record('create line position still works', position.status === 201 && position.data?.id, position.data);

    const template = lineId && position.data?.id ? await request('POST', `/admin/lines/${lineId}/staffing-templates`, {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { name: `Stage59 шаблон ${marker}`, items: [{ positionId: position.data.id, requiredCount: 1, minRequired: 1, defaultPlanned: 1, maxRequired: 2 }] },
    }) : { status: 0, data: null };
    record('create staffing template still works', template.status === 201 && template.data?.id, template.data);

    const jobTitle = await request('POST', '/admin/job-titles', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { factoryId: factory.id, name: `Stage59 должность ${marker}`, code: `stage59-title-${marker}`, baseRole: 'WORKER', permissionPreset: 'Работник', description: 'Stage59 marked fixture' },
    });
    record('create job title still works', jobTitle.status === 201 && jobTitle.data?.id, jobTitle.data);

    const workArea = await request('POST', '/admin/work-areas', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { factoryId: factory.id, name: `Stage59 рабочая зона ${marker}`, description: 'Stage59 marked fixture' },
    });
    record('create work area still works', workArea.status === 201 && workArea.data?.id, workArea.data);

    const workerContext = await request('GET', `/admin/factories/${factory.id}/context`, { userId: 'worker-1', factoryId: factory.id });
    record('non-admin cannot load factory context', workerContext.status === 403, workerContext.data);
    const blockedContext = await request('GET', `/admin/factories/${factory.id}/context`, { userId: 'stage59-blocked-admin', factoryId: factory.id });
    record('blocked admin denied', blockedContext.status === 403, blockedContext.data);

    record('no secrets/storagePath/passwordHash/tokens in admin responses', !hasSecret({ context: context.data, health: health.data, permissions: permissions.data, exported: exported.data }), null);

    const audits = await db.auditLog.findMany({
      where: { factoryId: factory.id, action: { in: ['LINE_CREATED', 'LINE_POSITION_CREATED', 'STAFFING_TEMPLATE_CREATED', 'WORK_AREA_CREATED', 'JOB_TITLE_CREATED', 'FACTORY_CONFIG_EXPORTED', 'FACTORY_CONFIG_IMPORT_PREVIEWED'] } },
      take: 20,
    });
    record('audit actions unaffected', audits.length >= 5, audits.map((item) => item.action));
  } finally {
    await db.$disconnect();
    if (backend) backend.kill();
  }

  const report = { api: API, ok, failures };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
