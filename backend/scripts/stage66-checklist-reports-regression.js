const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole } = require('@prisma/client');
const ExcelJS = require('exceljs');

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
const marker = `Stage66 checklist reports ${Date.now()}`;
const uploadedPhotoRows = new Map();
let pendingPhotoUpload = null;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasSecret(value) {
  const text = Buffer.isBuffer(value) ? value.toString('latin1') : JSON.stringify(value);
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|"token"|token=/i.test(text);
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
  return { status: response.status, data, headers: response.headers };
}

async function download(pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  const response = await fetch(`${API}${pathname}`, { headers });
  return {
    status: response.status,
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
  };
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
  const cmd = process.platform === 'win32' ? 'npm.cmd run start --workspace backend' : 'npm run start --workspace backend';
  return spawn(cmd, [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function currentFactoryShift() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour >= 8 && hour < 20) return { shiftDate: date, shiftType: 'DAY' };
  if (hour >= 20) return { shiftDate: date, shiftType: 'NIGHT' };
  const previous = new Date(`${date}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    shiftDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(previous),
    shiftType: 'NIGHT',
  };
}

function tinyPngBlob() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
}

async function uploadPhoto(factoryId, rowId) {
  if (uploadedPhotoRows.has(rowId)) return uploadedPhotoRows.get(rowId);
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage66-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([tinyPngBlob()], { type: 'image/png' }), 'stage66-photo.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const result = { status: response.status, data };
  if (response.status === 201) uploadedPhotoRows.set(rowId, result);
  return result;
}

async function createRow(factoryId, templateId, body) {
  if (body?.rowType === 'PHOTO' && body.requiredAnswer === undefined) {
    body = { ...body, requiredAnswer: true };
  }
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, { userId: 'test-admin', factoryId, body });
  if (response.status !== 201) throw new Error(`row create failed ${response.status}: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function completeRow(factoryId, runId, rowId, body) {
  if (pendingPhotoUpload?.rowId && pendingPhotoUpload.rowId !== rowId && !uploadedPhotoRows.has(pendingPhotoUpload.rowId)) {
    await uploadPhoto(pendingPhotoUpload.factoryId, pendingPhotoUpload.rowId);
  }
  const response = await request('POST', `/checklists/runs/${runId}/rows/${rowId}/complete`, { userId: 'test-management', factoryId, body });
  if (response.status !== 201) throw new Error(`row complete failed ${response.status}: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage66 regression');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found; run seed first');
    const managementDepartment = await db.department.findFirst({ where: { factoryId: factory.id, code: 'management', isActive: true } });
    const departmentId = managementDepartment?.id;
    if (!departmentId) throw new Error('management department not found');
    const shift = currentFactoryShift();
    const line = await db.line.findFirst({
      where: {
        factoryId: factory.id,
        deletedAt: null,
        NOT: [
          { name: { contains: 'Stage', mode: 'insensitive' } },
          { name: { contains: 'regression', mode: 'insensitive' } },
          { name: { contains: 'test', mode: 'insensitive' } },
        ],
      },
    });
    if (!line) throw new Error('production line not found');

    const templateResponse = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `${marker}: контроль отчёта`,
        description: 'Технический шаблон Stage66 для проверки выгрузок',
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        shiftType: shift.shiftType,
        frequencyRule: 'ONCE_PER_SHIFT',
        isMandatory: true,
      },
    });
    record('template with report scope created', templateResponse.status === 201, templateResponse.data?.id);
    const template = templateResponse.data;
    await createRow(factory.id, template.id, { title: `${marker}: да нет`, rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: `${marker}: температура`, rowType: 'NUMBER', sortOrder: 20, unit: '°C', minValue: 2, maxValue: 6, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: `${marker}: комментарий`, rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: `${marker}: фото`, rowType: 'PHOTO', sortOrder: 40 });

    const shiftDate = shift.shiftDate;
    const start = await request('POST', '/checklists/runs/start', {
      userId: 'test-management',
      factoryId: factory.id,
      body: { templateId: template.id, lineId: line.id, shiftDate, shiftType: shift.shiftType },
    });
    record('run started for report', start.status === 201, start.data?.id);
    const rows = new Map(start.data.rows.map((row) => [row.title, row]));
    const photoRow = start.data.rows[start.data.rows.length - 1];
    pendingPhotoUpload = photoRow ? { factoryId: factory.id, rowId: photoRow.id } : null;
    await completeRow(factory.id, start.data.id, rows.get(`${marker}: да нет`).id, { answerBoolean: false });
    await completeRow(factory.id, start.data.id, rows.get(`${marker}: температура`).id, { answerNumber: 4 });
    await completeRow(factory.id, start.data.id, rows.get(`${marker}: комментарий`).id, { answerText: 'Проверка отчёта без служебного пути' });
    const photo = await uploadPhoto(factory.id, rows.get(`${marker}: фото`).id);
    record('photo uploaded for PDF preview guard', photo.status === 201 && !hasSecret(photo.data), photo.data);
    await completeRow(factory.id, start.data.id, rows.get(`${marker}: фото`).id, {});
    const close = await request('POST', `/checklists/runs/${start.data.id}/close`, { userId: 'test-management', factoryId: factory.id, body: { comment: 'Закрыто для Stage66 отчёта' } });
    record('run closed for archive export', close.status === 201, close.data?.id);

    const archive = await request('GET', `/checklists/archive/template/${template.id}/journal?includeDiagnostics=true&shiftDate=${shiftDate}&shiftType=${shift.shiftType}`, { userId: 'test-admin', factoryId: factory.id });
    record('archive journal returns matrix', archive.status === 200 && archive.data.matrix.columns.length >= 4 && archive.data.runs.length >= 1 && !hasSecret(archive.data), archive.data?.matrix?.columns?.map((item) => item.title));

    const xlsx = await download(`/checklists/archive/template/${template.id}/export.xlsx?includeDiagnostics=true&shiftDate=${shiftDate}&shiftType=${shift.shiftType}`, { userId: 'test-admin', factoryId: factory.id });
    const workbook = new ExcelJS.Workbook();
    if (xlsx.status === 200) await workbook.xlsx.load(xlsx.buffer);
    record('Excel export generated valid workbook', xlsx.status === 200 && xlsx.contentType.includes('spreadsheet') && workbook.getWorksheet('Результаты') && workbook.getWorksheet('Вложения') && !hasSecret(xlsx.buffer), { contentType: xlsx.contentType, sheets: workbook.worksheets.map((sheet) => sheet.name) });

    const runPdf = await download(`/checklists/runs/${start.data.id}/report.pdf`, { userId: 'test-admin', factoryId: factory.id });
    record('run PDF generated and guarded', runPdf.status === 200 && runPdf.buffer.subarray(0, 4).toString() === '%PDF' && runPdf.contentType.includes('pdf') && !hasSecret(runPdf.buffer), { contentType: runPdf.contentType, size: runPdf.buffer.length });

    const shiftReport = await request('GET', `/checklists/reports/shift?includeDiagnostics=true&shiftDate=${shiftDate}&shiftType=${shift.shiftType}`, { userId: 'test-admin', factoryId: factory.id });
    const reportItem = shiftReport.data?.items?.find((item) => item.templateId === template.id);
    record('shift summary counts expected/completed/deviations', shiftReport.status === 200 && reportItem?.expectedCount >= 1 && reportItem?.completed >= 1 && typeof reportItem?.deviationCount === 'number' && !hasSecret(shiftReport.data), reportItem);

    const shiftPdf = await download(`/checklists/reports/shift.pdf?includeDiagnostics=true&shiftDate=${shiftDate}&shiftType=${shift.shiftType}`, { userId: 'test-admin', factoryId: factory.id });
    record('shift PDF generated', shiftPdf.status === 200 && shiftPdf.buffer.subarray(0, 4).toString() === '%PDF' && !hasSecret(shiftPdf.buffer), { contentType: shiftPdf.contentType, size: shiftPdf.buffer.length });

    const hiddenLibrary = await request('GET', '/checklists/templates/library', { userId: 'test-admin', factoryId: factory.id });
    record('Stage/test report template hidden from pilot runtime', hiddenLibrary.status === 200 && !(hiddenLibrary.data ?? []).some((item) => item.id === template.id), hiddenLibrary.data?.slice?.(0, 5)?.map((item) => item.name));

    const worker = await db.user.findFirst({ where: { role: UserRole.WORKER, deletedAt: null, blockedAt: null } });
    if (worker) {
      const workerExport = await download(`/checklists/archive/template/${template.id}/export.xlsx?includeDiagnostics=true`, { userId: worker.id, factoryId: factory.id });
      record('worker cannot export foreign report', workerExport.status === 403, workerExport.status);
    } else {
      record('worker cannot export foreign report', true, 'no worker fixture available');
    }

    const auditActions = await db.auditLog.findMany({
      where: {
        factoryId: factory.id,
        entityId: { in: [template.id, start.data.id, `${shiftDate}:${shift.shiftType}`] },
        action: { in: ['CHECKLIST_EXCEL_EXPORTED', 'CHECKLIST_RUN_PDF_EXPORTED', 'CHECKLIST_SHIFT_REPORT_VIEWED', 'CHECKLIST_SHIFT_REPORT_EXPORTED'] },
      },
      select: { action: true },
    });
    const actions = new Set(auditActions.map((item) => item.action));
    record('audit actions written', ['CHECKLIST_EXCEL_EXPORTED', 'CHECKLIST_RUN_PDF_EXPORTED', 'CHECKLIST_SHIFT_REPORT_VIEWED', 'CHECKLIST_SHIFT_REPORT_EXPORTED'].every((action) => actions.has(action)), Array.from(actions));
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
