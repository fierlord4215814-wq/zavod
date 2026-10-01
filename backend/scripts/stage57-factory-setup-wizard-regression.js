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
  let safeDetail = detail;
  if (detail !== undefined) {
    const json = JSON.stringify(detail);
    if (json.length > 3000) {
      safeDetail = {
        truncated: true,
        length: json.length,
        keys: Array.isArray(detail) ? [`array:${detail.length}`] : Object.keys(detail || {}),
      };
    }
  }
  (passed ? ok : failures).push({ name, ...(safeDetail ? { detail: safeDetail } : {}) });
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
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|token|secret/i.test(JSON.stringify(value));
}

function collectIds(items) {
  return new Set((items || []).map((item) => item.id));
}

async function ensureBlockedAdmin(factoryId) {
  await db.user.upsert({
    where: { id: 'stage57-blocked-admin' },
    update: { role: 'ADMIN', factoryId, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage57-blocked-admin', role: 'ADMIN', factoryId, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage57-blocked-admin', factoryId } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'stage57-blocked-admin', factoryId, role: 'ADMIN', isActive: true, isGuest: false },
  });
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
    const previewCode = `stage57-preview-${marker}`;
    const emptyCode = `stage57-empty-${marker}`;
    const copyCode = `stage57-copy-${marker}`;

    const options = await request('GET', '/admin/factories/setup/options', { userId: 'test-admin', factoryId: source.id });
    record('setup options are available for admin', options.status === 200 && Array.isArray(options.data?.categories) && options.data.categories.length >= 6, options.data?.categories?.map((item) => item.key));
    record('setup options explain runtime is not copied', options.status === 200 && JSON.stringify(options.data?.notCopied || []).includes('Смены'), options.data?.notCopied);

    const preview = await request('POST', '/admin/factories/setup/preview', {
      userId: 'test-admin',
      factoryId: source.id,
      body: {
        name: `Stage57 preview ${marker}`,
        code: previewCode,
        mode: 'COPY',
        sourceFactoryId: source.id,
        categories: options.data?.defaults?.categories ?? [],
      },
    });
    const previewFactory = await db.factory.findUnique({ where: { code: previewCode } });
    record('preview returns counts and does not write database', preview.status === 201 && preview.data?.writesDatabase === false && preview.data?.runtimeCopied === false && !previewFactory, preview.data);

    const emptyCreate = await request('POST', '/admin/factories/setup/create', {
      userId: 'test-admin',
      factoryId: source.id,
      body: { name: `Stage57 пустой ${marker}`, code: emptyCode, mode: 'EMPTY', categories: { moduleSettings: true } },
    });
    const emptyFactory = await db.factory.findUnique({ where: { code: emptyCode } });
    record('empty factory created through setup wizard', emptyCreate.status === 201 && emptyFactory?.id === emptyCreate.data?.factory?.id && emptyCreate.data?.runtimeCopied === false, emptyCreate.data);

    const emptyAccess = emptyFactory
      ? await db.userFactoryAccess.findMany({ where: { factoryId: emptyFactory.id }, include: { user: true } })
      : [];
    record('empty factory grants access only to creating admin', emptyAccess.length === 1 && emptyAccess[0]?.userId === 'test-admin' && emptyAccess[0]?.role === 'ADMIN', emptyAccess.map((item) => ({ userId: item.userId, role: item.role })));

    const emptyHealth = emptyFactory
      ? await request('GET', `/admin/factories/${emptyFactory.id}/config-health`, { userId: 'test-admin', factoryId: emptyFactory.id })
      : { status: 0, data: null };
    record('empty factory config health reports blockers', emptyHealth.status === 200 && emptyHealth.data?.status === 'blocker' && emptyHealth.data?.warnings?.some((item) => item.id === 'no-active-lines'), emptyHealth.data);

    const sourceCounts = {
      localDepartments: preview.data?.counts?.localDepartments ?? 0,
      lines: preview.data?.counts?.lines ?? 0,
      linePositions: preview.data?.counts?.linePositions ?? 0,
      templates: preview.data?.counts?.staffingTemplates ?? 0,
      workAreas: preview.data?.counts?.workAreas ?? 0,
      jobTitles: preview.data?.counts?.jobTitles ?? 0,
    };

    const copyCreate = await request('POST', '/admin/factories/setup/create', {
      userId: 'test-admin',
      factoryId: source.id,
      body: {
        name: `Stage57 копия ${marker}`,
        code: copyCode,
        mode: 'COPY',
        sourceFactoryId: source.id,
        categories: options.data?.defaults?.categories ?? [],
      },
    });
    const copyFactory = await db.factory.findUnique({ where: { code: copyCode } });
    record('copy factory created through setup wizard', copyCreate.status === 201 && copyFactory?.id === copyCreate.data?.factory?.id && copyCreate.data?.runtimeCopied === false, copyCreate.data);

    const targetCounts = copyFactory ? {
      localDepartments: await db.department.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      lines: await db.line.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      linePositions: await db.linePosition.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      templates: await db.lineStaffingTemplate.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      workAreas: await db.workArea.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      jobTitles: await db.jobTitle.count({ where: { factoryId: copyFactory.id, deletedAt: null } }),
      settings: await Promise.all(['shiftSettings', 'taskSettings', 'washSettings', 'defrostSettings', 'orderSettings', 'checklistSettings', 'chatSettings', 'announcementSettings'].map((model) => db[model].findUnique({ where: { factoryId: copyFactory.id } }))).then((items) => items.filter(Boolean).length),
    } : {};
    record('copy preserves selected configuration counts for eligible active-line config', Boolean(copyFactory)
      && targetCounts.localDepartments >= Math.min(sourceCounts.localDepartments, 1)
      && targetCounts.lines === sourceCounts.lines
      && targetCounts.linePositions === sourceCounts.linePositions
      && targetCounts.templates === sourceCounts.templates
      && targetCounts.workAreas === sourceCounts.workAreas
      && targetCounts.settings >= 1, { sourceCounts, targetCounts });

    if (copyFactory) {
      const sourceLines = await db.line.findMany({ where: { factoryId: source.id, deletedAt: null }, select: { id: true } });
      const sourcePositions = await db.linePosition.findMany({ where: { factoryId: source.id, deletedAt: null }, select: { id: true } });
      const sourceLineIds = collectIds(sourceLines);
      const sourcePositionIds = collectIds(sourcePositions);
      const copiedLines = await db.line.findMany({
        where: { factoryId: copyFactory.id, deletedAt: null },
        include: { positions: true, staffingTemplates: { include: { items: true } } },
      });
      const copiedLinesPointToTarget = copiedLines.every((line) => line.factoryId === copyFactory.id && line.status === 'STOP' && !sourceLineIds.has(line.id));
      const copiedTemplateItemsPointToTarget = copiedLines.every((line) => line.staffingTemplates.every((template) => template.items.every((item) => !sourcePositionIds.has(item.positionId))));
      record('copied lines/templates use target ids and safe STOP status', copiedLinesPointToTarget && copiedTemplateItemsPointToTarget, { copiedLines: copiedLines.length });
    }

    const copyAccess = copyFactory
      ? await db.userFactoryAccess.findMany({ where: { factoryId: copyFactory.id }, include: { user: true } })
      : [];
    record('source users are not copied automatically', copyAccess.length === 1 && copyAccess[0]?.userId === 'test-admin', copyAccess.map((item) => ({ userId: item.userId, role: item.role })));

    const runtime = copyFactory ? await runtimeCounts(copyFactory.id) : {};
    record('runtime data is not copied', Object.values(runtime).every((count) => count === 0), runtime);

    const copyHealth = copyFactory
      ? await request('GET', `/admin/factories/${copyFactory.id}/config-health`, { userId: 'test-admin', factoryId: copyFactory.id })
      : { status: 0, data: null };
    record('copied factory config health is available', copyHealth.status === 200 && copyHealth.data?.factory?.code === copyCode && Array.isArray(copyHealth.data?.warnings), copyHealth.data);

    const workerOptions = await request('GET', '/admin/factories/setup/options', { userId: 'worker-1', factoryId: source.id });
    record('non-admin cannot access setup options', workerOptions.status === 403, workerOptions.data);

    const blocked = await request('POST', '/admin/factories/setup/preview', {
      userId: 'stage57-blocked-admin',
      factoryId: source.id,
      body: { name: 'Stage57 blocked', code: `stage57-blocked-${marker}`, mode: 'COPY', sourceFactoryId: source.id },
    });
    record('blocked admin is denied', blocked.status === 403, blocked.data);

    const crossFactoryPreview = copyFactory ? await request('POST', '/admin/factories/setup/preview', {
      userId: 'test-admin',
      factoryId: copyFactory.id,
      body: { name: 'Stage57 cross', code: `stage57-cross-${marker}`, mode: 'COPY', sourceFactoryId: 'missing-factory-id' },
    }) : { status: 0, data: null };
    record('missing/cross source factory is denied safely', [403, 409].includes(crossFactoryPreview.status), crossFactoryPreview.data);

    const audits = copyFactory ? await db.auditLog.findMany({
      where: {
        factoryId: copyFactory.id,
        action: { in: ['FACTORY_CREATED', 'FACTORY_CONFIG_CLONED', 'FACTORY_SETUP_COMPLETED', 'FACTORY_CONFIG_HEALTH_VIEWED'] },
      },
      select: { action: true },
    }) : [];
    const auditActions = audits.map((item) => item.action);
    record('factory setup and health audit actions written', ['FACTORY_CREATED', 'FACTORY_CONFIG_CLONED', 'FACTORY_SETUP_COMPLETED', 'FACTORY_CONFIG_HEALTH_VIEWED'].every((action) => auditActions.includes(action)), auditActions);

    record('no secrets in setup responses', !hasSecret({ options: options.data, preview: preview.data, emptyCreate: emptyCreate.data, copyCreate: copyCreate.data, emptyHealth: emptyHealth.data, copyHealth: copyHealth.data }), { checked: true });
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
