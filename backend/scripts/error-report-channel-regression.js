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
const marker = `error-report-regression-${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
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
  form.append('entityType', 'ERROR_REPORT');
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `error-photo-${Date.now()}`);
  form.append('file', new Blob(['tiny error screenshot'], { type: 'image/png' }), 'error-screenshot.png');
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

async function fileRequest(userId, factoryId, attachmentId) {
  const response = await fetch(`${API}/attachments/${attachmentId}/file`, {
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
  });
  const text = response.ok ? '' : await response.text();
  return { status: response.status, text };
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

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  const since = new Date();
  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;

    const created = await request('POST', '/error-reports', {
      userId: 'pilot-worker-1',
      factoryId,
      body: {
        section: 'Чаты',
        title: `Проверка канала ошибок ${marker}`,
        description: 'Кнопка отправки проверяется с тестовым скриншотом.',
      },
    });
    record('user creates error report', created.status === 201 && created.data?.id && created.data?.message === 'Ошибка отправлена администратору.', created.data);
    const reportId = created.data?.id;

    const uploaded = await upload('pilot-worker-1', factoryId, reportId);
    record('user attaches screenshot to own error report', uploaded.status === 201 && uploaded.data?.id, uploaded.data);
    const attachmentId = uploaded.data?.id;

    const adminList = await request('GET', '/error-reports?includeDiagnostics=true', { userId: 'test-admin', factoryId });
    record('ADMIN sees error report list', adminList.status === 200 && adminList.data?.some?.((item) => item.id === reportId), adminList.data);
    const managementList = await request('GET', '/error-reports', { userId: 'test-management', factoryId });
    record('MANAGEMENT without admin does not see global error list', managementList.status === 403, managementList.data);
    const ownerDetail = await request('GET', `/error-reports/${reportId}`, { userId: 'pilot-worker-1', factoryId });
    record('author can open own error report detail', ownerDetail.status === 200 && ownerDetail.data?.id === reportId, ownerDetail.data);
    const foreignDetail = await request('GET', `/error-reports/${reportId}`, { userId: 'pilot-worker-2', factoryId });
    record('ordinary non-author cannot open another user error report', foreignDetail.status === 403, foreignDetail.data);
    const adminDetail = await request('GET', `/error-reports/${reportId}`, { userId: 'test-admin', factoryId });
    record('ADMIN opens report detail with attachments', adminDetail.status === 200 && adminDetail.data?.attachments?.some?.((item) => item.id === attachmentId), adminDetail.data);

    const ownerFile = await fileRequest('pilot-worker-1', factoryId, attachmentId);
    record('author can view guarded attachment file', ownerFile.status === 200, ownerFile);
    const foreignFile = await fileRequest('pilot-worker-2', factoryId, attachmentId);
    record('non-author cannot view guarded error attachment', foreignFile.status === 403, foreignFile);
    record('error report responses hide storagePath and secrets', !hasSecret({ created: created.data, adminList: adminList.data, adminDetail: adminDetail.data, foreignFile }), { checked: true });

    const inProgress = await request('PATCH', `/error-reports/${reportId}/status`, { userId: 'test-admin', factoryId, body: { status: 'IN_PROGRESS' } });
    record('ADMIN moves report to in work', inProgress.status === 200 && inProgress.data?.status === 'IN_PROGRESS', inProgress.data);
    const closed = await request('PATCH', `/error-reports/${reportId}/status`, { userId: 'test-admin', factoryId, body: { status: 'CLOSED' } });
    record('ADMIN closes test error report', closed.status === 200 && closed.data?.status === 'CLOSED', closed.data);

    const audit = await db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ['ERROR_REPORT_CREATED', 'ERROR_REPORT_STATUS_UPDATED', 'ATTACHMENT_ATTACHED_TO_ERROR_REPORT', 'ATTACHMENT_ACCESS_DENIED'] },
      },
      select: { action: true },
    });
    for (const action of ['ERROR_REPORT_CREATED', 'ERROR_REPORT_STATUS_UPDATED', 'ATTACHMENT_ATTACHED_TO_ERROR_REPORT', 'ATTACHMENT_ACCESS_DENIED']) {
      record(`audit ${action} written`, audit.some((item) => item.action === action), audit);
    }
  } finally {
    stopBackend(backend);
    console.log(JSON.stringify({ ok, failures }, null, 2));
    await db.$disconnect();
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
