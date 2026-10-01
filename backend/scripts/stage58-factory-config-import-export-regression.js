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
  return /passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|authToken|apiKey|clientSecret/i.test(JSON.stringify(value));
}

async function runtimeCounts(factoryId) {
  return {
    shiftSessions: await db.shiftSession.count({ where: { factoryId } }),
    assignments: await db.assignment.count({ where: { factoryId } }),
    plannedLineAssignments: await db.plannedLineAssignment.count({ where: { factoryId } }),
    shiftWillBe: await db.shiftWillBe.count({ where: { factoryId } }),
    lineShiftWorkPlans: await db.lineShiftWorkPlan.count({ where: { factoryId } }),
    lineEvents: await db.lineEvent.count({ where: { factoryId } }),
    tasks: await db.task.count({ where: { factoryId } }),
    washSessions: await db.washSession.count({ where: { factoryId } }),
    okkRecords: await db.okkRecord.count({ where: { factoryId } }),
    stockDefects: await db.stockDefect.count({ where: { factoryId } }),
    returnRecords: await db.returnRecord.count({ where: { factoryId } }),
    orderRequests: await db.orderRequest.count({ where: { factoryId } }),
    chatMessages: await db.chatMessage.count({ where: { chat: { factoryId } } }),
    attachments: await db.attachment.count({ where: { factoryId } }),
    announcementReads: await db.announcementRead.count({ where: { announcement: { factoryId } } }),
    notifications: await db.notification.count({ where: { factoryId } }),
  };
}

async function ensureBlockedAdmin(factoryId) {
  await db.user.upsert({
    where: { id: 'stage58-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage58-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage58-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage58-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
  });
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  try {
    const source = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!source) throw new Error('factory-4 not found');
    await ensureBlockedAdmin(source.id);

    const marker = Date.now().toString(36);
    const targetCode = `stage58-import-${marker}`;

    const exported = await request('GET', `/admin/factories/${source.id}/config-export`, { userId: 'test-admin', factoryId: source.id });
    record('admin can export factory config', exported.status === 200 && exported.data?.schemaVersion === 'factory-config-v1', exported.data?.counts);
    record('export contains local keys and no database id links', exported.status === 200
      && JSON.stringify(exported.data).includes('localKey')
      && !/\b(userId|factoryId|departmentId|lineId|positionId|passwordHash)\b/.test(JSON.stringify(exported.data?.config ?? {})), null);
    record('export has no secrets', exported.status === 200 && !hasSecret(exported.data), null);
    record('export explains runtime is not copied', exported.status === 200 && exported.data?.runtimeCopied === false && Array.isArray(exported.data?.notExported), exported.data?.notExported);

    const preview = await request('POST', '/admin/factories/config-import/preview', {
      userId: 'test-admin',
      factoryId: source.id,
      body: { config: exported.data, target: { name: `Stage58 импорт ${marker}`, code: targetCode } },
    });
    const previewFactory = await db.factory.findUnique({ where: { code: targetCode } });
    record('import preview validates without database write', preview.status === 201 && preview.data?.writesDatabase === false && preview.data?.errors?.length === 0 && !previewFactory, preview.data);

    const invalid = await request('POST', '/admin/factories/config-import/preview', {
      userId: 'test-admin',
      factoryId: source.id,
      body: {
        config: {
          schemaVersion: 'factory-config-v1',
          config: { tasks: [{ id: 'bad-task' }], localDepartments: [] },
        },
        target: { name: `Stage58 invalid ${marker}`, code: `stage58-invalid-${marker}` },
      },
    });
    record('preview rejects runtime sections and ids', invalid.status === 201 && invalid.data?.errors?.some((item) => /runtime|секрет/i.test(item)), invalid.data);

    const created = await request('POST', '/admin/factories/config-import/create', {
      userId: 'test-admin',
      factoryId: source.id,
      body: { config: exported.data, target: { name: `Stage58 импорт ${marker}`, code: targetCode, isActive: true } },
    });
    const target = await db.factory.findUnique({ where: { code: targetCode } });
    record('import create makes new factory only', created.status === 201 && target?.id === created.data?.factory?.id && created.data?.runtimeCopied === false, created.data?.factory);

    const targetAccess = target ? await db.userFactoryAccess.findMany({ where: { factoryId: target.id } }) : [];
    record('import grants access only to importing admin', targetAccess.length === 1 && targetAccess[0]?.userId === 'test-admin' && targetAccess[0]?.role === 'ADMIN', targetAccess);

    const sourceCounts = exported.data?.counts ?? {};
    const targetCounts = target ? {
      localDepartments: await db.department.count({ where: { factoryId: target.id, deletedAt: null } }),
      lines: await db.line.count({ where: { factoryId: target.id, deletedAt: null } }),
      linePositions: await db.linePosition.count({ where: { factoryId: target.id, deletedAt: null } }),
      staffingTemplates: await db.lineStaffingTemplate.count({ where: { factoryId: target.id, deletedAt: null } }),
      workAreas: await db.workArea.count({ where: { factoryId: target.id, deletedAt: null } }),
      settings: await Promise.all(['shiftSettings', 'taskSettings', 'washSettings', 'defrostSettings', 'orderSettings', 'checklistSettings', 'chatSettings', 'announcementSettings'].map((model) => db[model].findUnique({ where: { factoryId: target.id } }))).then((items) => items.filter(Boolean).length),
    } : {};
    record('imported config counts match export for core config', Boolean(target)
      && targetCounts.lines === sourceCounts.lines
      && targetCounts.linePositions === sourceCounts.linePositions
      && targetCounts.staffingTemplates === sourceCounts.staffingTemplates
      && targetCounts.workAreas === sourceCounts.workAreas
      && targetCounts.settings === sourceCounts.moduleSettings, { sourceCounts, targetCounts });

    const runtime = target ? await runtimeCounts(target.id) : {};
    record('import does not create runtime/history records', Object.values(runtime).every((count) => count === 0), runtime);

    const health = target
      ? await request('GET', `/admin/factories/${target.id}/config-health`, { userId: 'test-admin', factoryId: target.id })
      : { status: 0, data: null };
    record('imported factory health is available', health.status === 200 && ['ready', 'warning', 'blocker'].includes(health.data?.status), health.data?.summary);

    const workerPreview = await request('POST', '/admin/factories/config-import/preview', {
      userId: 'test-worker-1',
      factoryId: source.id,
      body: { config: exported.data, target: { name: `Stage58 worker ${marker}`, code: `stage58-worker-${marker}` } },
    });
    record('worker cannot preview import', workerPreview.status === 403, workerPreview.data);

    const blockedExport = await request('GET', `/admin/factories/${source.id}/config-export`, { userId: 'stage58-blocked-admin', factoryId: source.id });
    record('blocked admin denied export', blockedExport.status === 403, blockedExport.data);

    const audit = target ? await db.auditLog.findMany({ where: { factoryId: target.id, action: { in: ['FACTORY_CONFIG_IMPORTED', 'FACTORY_CREATED_FROM_IMPORT'] } } }) : [];
    record('import audit actions written', audit.length >= 2, audit.map((item) => item.action));
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  for (const item of ok) console.log(`OK ${item.name}`);
  for (const item of failures) console.error(`FAIL ${item.name}`, item.detail ? JSON.stringify(item.detail).slice(0, 1000) : '');
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
