const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');
const marker = `error-report-export-${Date.now()}`;
const exportRoot = path.join(backendDir, '.tmp', marker);
const ok = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

function hasForbiddenLeak(value) {
  return /postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|DATABASE_URL\s*=|passwordHash|storagePath\s*[:=]|accessToken|refreshToken|authToken|Bearer\s+[A-Za-z0-9._~-]+/i.test(String(value ?? ''));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

async function waitForBackend(api, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function request(api, method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${api}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function upload(api, userId, factoryId, entityId) {
  const form = new FormData();
  form.append('entityType', 'ERROR_REPORT');
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `${marker}-photo`);
  form.append('file', new Blob(['tiny export screenshot'], { type: 'image/png' }), 'export-screenshot.png');
  const response = await fetch(`${api}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function main() {
  loadEnv();
  const db = new PrismaClient();
  let backend = null;
  try {
    await fsp.mkdir(exportRoot, { recursive: true });
    const port = await freePort();
    const api = `http://127.0.0.1:${port}`;
    backend = spawn('npm.cmd run start --workspace backend', [], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        ERROR_REPORTS_EXPORT_PATH: exportRoot,
      },
      shell: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    if (!(await waitForBackend(api))) throw new Error('fresh backend did not start for export regression');

    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;

    const created = await request(api, 'POST', '/error-reports', {
      userId: 'pilot-worker-1',
      factoryId,
      body: {
        section: 'Сообщить об ошибке',
        title: `Проверка файловой копии ${marker}`,
        description: `Проверка export package. ${['DATABASE_', 'URL=postgresql://user:', 'secret@localhost/db'].join('')} ${['to', 'ken=secret'].join('')} ${['storage', 'Path=secret'].join('')}`,
        operationId: marker,
      },
    });
    record('error report is created through API', created.status === 201 && created.data?.id, created.data);
    const reportId = created.data?.id;

    const uploaded = await upload(api, 'pilot-worker-1', factoryId, reportId);
    record('error report attachment upload succeeds', uploaded.status === 201 && uploaded.data?.id, uploaded.data);

    const dirs = (await fsp.readdir(exportRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    record('one export package folder is created', dirs.length === 1, dirs.map((entry) => entry.name));
    const packageDir = dirs[0] ? path.join(exportRoot, dirs[0].name) : null;
    const manifestPath = packageDir ? path.join(packageDir, 'manifest.json') : null;
    const htmlPath = packageDir ? path.join(packageDir, 'report.html') : null;
    const txtPath = packageDir ? path.join(packageDir, 'report.txt') : null;

    const manifest = manifestPath && fs.existsSync(manifestPath) ? JSON.parse(await fsp.readFile(manifestPath, 'utf8')) : null;
    const html = htmlPath && fs.existsSync(htmlPath) ? await fsp.readFile(htmlPath, 'utf8') : '';
    const txt = txtPath && fs.existsSync(txtPath) ? await fsp.readFile(txtPath, 'utf8') : '';
    const attachmentsDir = packageDir ? path.join(packageDir, 'attachments') : null;
    const attachmentFiles = attachmentsDir && fs.existsSync(attachmentsDir) ? await fsp.readdir(attachmentsDir) : [];

    record('export package has report.html, report.txt and manifest.json', Boolean(manifest && html && txt), { manifest: Boolean(manifest), html: Boolean(html), txt: Boolean(txt) });
    record('export package copies uploaded attachment', attachmentFiles.length === 1 && manifest?.files?.attachments?.some?.((item) => item.copied), { attachmentFiles, manifestAttachments: manifest?.files?.attachments });
    record('manifest uses html+txt fallback without docx dependency', manifest?.format === 'html+txt', manifest?.format);
    record('export package does not expose forbidden secret-like values', !hasForbiddenLeak(`${JSON.stringify(manifest)}\n${html}\n${txt}`), 'checked manifest/html/txt');

    const adminDetail = await request(api, 'GET', `/error-reports/${reportId}`, { userId: 'test-admin', factoryId });
    record('ADMIN still sees in-app report with attachment', adminDetail.status === 200 && adminDetail.data?.attachments?.length === 1, adminDetail.data);
    record('public API does not expose export server path', !String(JSON.stringify(adminDetail.data)).includes(exportRoot) && !hasForbiddenLeak(JSON.stringify(adminDetail.data)), adminDetail.data);

    const repeat = await request(api, 'POST', '/error-reports', {
      userId: 'pilot-worker-1',
      factoryId,
      body: {
        section: 'Сообщить об ошибке',
        title: `Повтор ${marker}`,
        description: 'Повтор operationId не должен создавать дубль.',
        operationId: marker,
      },
    });
    const dirsAfterRepeat = (await fsp.readdir(exportRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    record('same operationId does not duplicate report export folder', repeat.data?.id === reportId && dirsAfterRepeat.length === 1, { id: repeat.data?.id, dirs: dirsAfterRepeat.map((entry) => entry.name) });

    await request(api, 'PATCH', `/error-reports/${reportId}/status`, { userId: 'test-admin', factoryId, body: { status: 'CLOSED' } });
  } finally {
    stopBackend(backend);
    await db.$disconnect();
  }

  console.log(`\nError report export regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
