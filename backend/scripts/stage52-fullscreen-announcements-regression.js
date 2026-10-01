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
const marker = `Пилотное объявление ${Date.now()}`;

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

async function upload(userId, factoryId, entityId) {
  const form = new FormData();
  form.append('entityType', 'ANNOUNCEMENT');
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `announcement-photo-${Date.now()}`);
  form.append('file', new Blob(['announcement tiny image'], { type: 'image/png' }), 'announcement-photo.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
    body: form,
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

function runPilotScenario() {
  const result = spawnSync(process.execPath, ['scripts/stage47-pilot-scenario.js'], { cwd: backendDir, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'stage47 pilot scenario failed');
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  const since = new Date();
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    const masters = await db.department.findFirst({ where: { factoryId, code: 'masters' } });
    const kipia = await db.department.findFirst({ where: { factoryId, code: 'kipia' } });
    if (!masters || !kipia) throw new Error('required departments not found');
    const departmentRecipientAccess = await db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: 'pilot-master-1', factoryId } },
      select: { userId: true, departmentId: true },
    });
    const departmentRecipientUserId = departmentRecipientAccess?.userId ?? 'pilot-master-1';
    const departmentRecipientId = departmentRecipientAccess?.departmentId ?? masters.id;

    const created = await request('POST', '/announcements', {
      userId: 'test-admin',
      factoryId,
      body: {
        title: marker,
        text: 'Прочитайте объявление и подтвердите ознакомление.',
        priority: 'IMPORTANT',
        visibleUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    });
    record('admin can create announcement', created.status === 201 && created.data?.id, created.data);
    const announcementId = created.data.id;

    const departmentAnnouncement = await request('POST', '/announcements', {
      userId: 'test-admin',
      factoryId,
      body: {
        title: `${marker} department`,
        text: 'Проверка отделового ознакомления.',
        priority: 'NORMAL',
        departmentId: departmentRecipientId,
        visibleUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    });
    record('admin can create department announcement', departmentAnnouncement.status === 201 && departmentAnnouncement.data?.id, departmentAnnouncement.data);
    await db.user.upsert({
      where: { id: 'stage52-kipia-non-recipient' },
      update: { factoryId, role: 'WORKER', blockedAt: null, deletedAt: null },
      create: { id: 'stage52-kipia-non-recipient', factoryId, role: 'WORKER' },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: 'stage52-kipia-non-recipient', factoryId } },
      update: { role: 'WORKER', departmentId: kipia.id, isActive: true, isGuest: false },
      create: { userId: 'stage52-kipia-non-recipient', factoryId, role: 'WORKER', departmentId: kipia.id, isActive: true, isGuest: false },
    });
    const departmentRecipientAck = await request('POST', `/announcements/${departmentAnnouncement.data.id}/ack`, { userId: departmentRecipientUserId, factoryId, body: {} });
    record('department recipient can acknowledge visible announcement', departmentRecipientAck.status === 201, departmentRecipientAck.data);
    const departmentNonRecipientAck = await request('POST', `/announcements/${departmentAnnouncement.data.id}/ack`, { userId: 'stage52-kipia-non-recipient', factoryId, body: {} });
    record('non-recipient cannot acknowledge department announcement', departmentNonRecipientAck.status === 403 && /получател/i.test(JSON.stringify(departmentNonRecipientAck.data)), departmentNonRecipientAck.data);

    const workerCreate = await request('POST', '/announcements', {
      userId: 'worker-1',
      factoryId,
      body: { title: `${marker} worker`, text: 'forbidden' },
    });
    record('worker cannot create announcement', workerCreate.status === 403, workerCreate.data);

    const technologCreate = await request('POST', '/announcements', {
      userId: 'pilot-technolog-1',
      factoryId,
      body: { title: `${marker} technolog`, text: 'forbidden' },
    });
    record('technologist can create under current publisher role policy', technologCreate.status === 201 && technologCreate.data?.id, technologCreate.data);

    const workerUnread = await request('GET', '/announcements/unread', { userId: 'worker-1', factoryId });
    const worker2Unread = await request('GET', '/announcements/unread', { userId: 'worker-2', factoryId });
    record('announcement visible to targeted worker', workerUnread.status === 200 && workerUnread.data.some((item) => item.id === announcementId), workerUnread.data);
    record('announcement visible to another worker before ack', worker2Unread.status === 200 && worker2Unread.data.some((item) => item.id === announcementId), worker2Unread.data);
    record('Stage/test announcements hidden in fullscreen runtime', workerUnread.status === 200 && !workerUnread.data.some((item) => /Stage\d+|regression|browser/i.test(`${item.title} ${item.text}`)), workerUnread.data);

    const ackOne = await request('POST', `/announcements/${announcementId}/ack`, { userId: 'worker-1', factoryId, method: 'POST', body: {} });
    const ackTwo = await request('POST', `/announcements/${announcementId}/ack`, { userId: 'worker-1', factoryId, method: 'POST', body: {} });
    record('ack creates per-user read status', ackOne.status === 201 && ackOne.data?.announcementId === announcementId, ackOne.data);
    record('repeated ack is idempotent', ackTwo.status === 201 && ackTwo.data?.id === ackOne.data?.id, { ackOne: ackOne.data, ackTwo: ackTwo.data });

    const workerAfterAck = await request('GET', '/announcements/unread', { userId: 'worker-1', factoryId });
    const worker2AfterAck = await request('GET', '/announcements/unread', { userId: 'worker-2', factoryId });
    record('unread queue decreases for acking user', workerAfterAck.status === 200 && !workerAfterAck.data.some((item) => item.id === announcementId), workerAfterAck.data);
    record('ack by one user does not hide from another user', worker2AfterAck.status === 200 && worker2AfterAck.data.some((item) => item.id === announcementId), worker2AfterAck.data);

    const archive = await request('GET', '/announcements/archive', { userId: 'worker-1', factoryId });
    record('employee archive shows acknowledged announcement', archive.status === 200 && archive.data.some((item) => item.id === announcementId && item.acknowledgedAt), archive.data);

    const report = await request('GET', `/announcements/${announcementId}/ack-report`, { userId: 'test-admin', factoryId });
    record('manager can view ack report', report.status === 200 && report.data?.totals?.all >= 2, report.data);
    record('ack report contains display names', report.status === 200 && report.data.acknowledged.some((row) => /Работник|Сотрудник/.test(row.displayName)), report.data);

    const workerReport = await request('GET', `/announcements/${announcementId}/ack-report`, { userId: 'worker-1', factoryId });
    record('ordinary worker cannot view ack report', workerReport.status === 403, workerReport.data);

    const attachment = await upload('test-admin', factoryId, announcementId);
    record('announcement attachment upload allowed for admin', attachment.status === 201, attachment.data);
    const detail = await request('GET', `/announcements/${announcementId}`, { userId: 'worker-1', factoryId });
    record('attachments guarded and visible through announcement detail', detail.status === 200 && detail.data.attachments?.some((item) => item.id === attachment.data.id), detail.data);
    record('storagePath hidden in announcement responses', detail.status === 200 && !hasSecret(detail.data), detail.data);

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage52-announcements-other' },
      update: { isActive: true, deletedAt: null },
      create: { code: 'stage52-announcements-other', name: 'Stage52 announcements other' },
    });
    const cross = await request('GET', `/announcements/${announcementId}`, { userId: 'worker-1', factoryId: otherFactory.id });
    record('cross-factory denied', cross.status === 403, cross.data);

    await db.user.upsert({
      where: { id: 'stage52-blocked-announcement-user' },
      update: { blockedAt: new Date(), deletedAt: null, role: 'WORKER', factoryId },
      create: { id: 'stage52-blocked-announcement-user', factoryId, role: 'WORKER', blockedAt: new Date() },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: 'stage52-blocked-announcement-user', factoryId } },
      update: { role: 'WORKER', isActive: true, isGuest: false },
      create: { userId: 'stage52-blocked-announcement-user', factoryId, role: 'WORKER', isActive: true, isGuest: false },
    });
    const blocked = await request('GET', '/announcements/unread', { userId: 'stage52-blocked-announcement-user', factoryId });
    record('blocked user denied', blocked.status === 403, blocked.data);

    const audits = await db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        entityType: 'Announcement',
        OR: [{ entityId: announcementId }, { userId: { in: ['worker-1', 'stage52-blocked-announcement-user'] } }],
      },
      select: { action: true },
    });
    for (const action of ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_ACKNOWLEDGED', 'ANNOUNCEMENT_READ', 'ANNOUNCEMENT_REPORT_VIEWED', 'ACCESS_DENIED']) {
      record(`audit ${action} written`, audits.some((item) => item.action === action), audits);
    }

    record('no secrets in regression responses', !hasSecret({ created: created.data, report: report.data, detail: detail.data }), { checked: true });
    const archiveMain = await request('POST', `/announcements/${announcementId}/archive`, { userId: 'test-admin', factoryId, body: {} });
    record('test announcement archived through UI API', archiveMain.status === 201, archiveMain.data);
    const archiveDepartment = await request('POST', `/announcements/${departmentAnnouncement.data.id}/archive`, { userId: 'test-admin', factoryId, body: {} });
    record('test department announcement archived through UI API', archiveDepartment.status === 201, archiveDepartment.data);
    if (technologCreate.status === 201 && technologCreate.data?.id) {
      const archiveTechnolog = await request('POST', `/announcements/${technologCreate.data.id}/archive`, { userId: 'test-admin', factoryId, body: {} });
      record('technologist test announcement archived through UI API', archiveTechnolog.status === 201, archiveTechnolog.data);
    }
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
