const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole, AttachmentKind, AttachmentEntityType } = require('@prisma/client');

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
const marker = `Контроль готовой продукции ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|token/i.test(JSON.stringify(value));
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
  return { status: response.status, data: data?.data ?? data };
}

async function download(pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  const response = await fetch(`${API}${pathname}`, { headers });
  const text = response.ok ? '' : await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, contentType: response.headers.get('content-type') };
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
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
}

async function uploadRowPhoto(factoryId, rowId) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage65-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([tinyPngBlob()], { type: 'image/png' }), 'фото-проверка.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data: data?.data ?? data };
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    body,
  });
  if (response.status !== 201) throw new Error(`row create failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function completeRow(factoryId, runId, rowId, body) {
  const response = await request('POST', `/checklists/runs/${runId}/rows/${rowId}/complete`, {
    userId: 'test-management',
    factoryId,
    body,
  });
  if (response.status !== 201) throw new Error(`row complete failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function createClosedRun(factoryId, templateId, lineId, shiftDate, shiftType) {
  const startedAt = `${shiftDate}T08:10:00.000Z`;
  const closedAt = `${shiftDate}T08:20:00.000Z`;
  const runtimeShift = currentFactoryShift();
  const runtimeClosedAt = new Date().toISOString();
  const start = await request('POST', '/checklists/runs/start', {
    userId: 'test-management',
    factoryId,
    body: { templateId, lineId, shiftDate: runtimeShift.shiftDate, shiftType: runtimeShift.shiftType },
  });
  if (start.status !== 201) throw new Error(`run start failed: ${start.status} ${JSON.stringify(start.data)}`);
  const rowsByTitle = new Map(start.data.rows.map((row) => [row.title, row]));
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Проверить маркировку').id, { answerBoolean: true, now: runtimeClosedAt });
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Вес заготовки').id, { answerNumber: 125, now: runtimeClosedAt });
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Комментарий технолога').id, { answerText: 'Отклонений нет', now: runtimeClosedAt });
  const photoRow = rowsByTitle.get('Фото готового изделия');
  const photo = await uploadRowPhoto(factoryId, photoRow.id);
  if (photo.status !== 201) throw new Error(`photo upload failed: ${photo.status} ${JSON.stringify(photo.data)}`);
  await completeRow(factoryId, start.data.id, photoRow.id, { now: runtimeClosedAt });
  const close = await request('POST', `/checklists/runs/${start.data.id}/close`, {
    userId: 'test-management',
    factoryId,
    body: { comment: 'Закрыто для Stage65 проверки UX архива', now: runtimeClosedAt },
  });
  if (close.status !== 201) throw new Error(`run close failed: ${close.status} ${JSON.stringify(close.data)}`);
  await db.checklistRun.update({
    where: { id: start.data.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(closedAt),
      startedAt: new Date(startedAt),
      shiftDate: new Date(`${shiftDate}T00:00:00.000Z`),
      shiftType,
      autoClosedAt: null,
      closeKind: 'MANUAL',
    },
  });
  return { runId: start.data.id, photoAttachmentId: photo.data?.id, photoRowId: photoRow.id };
}

async function main() {
  let backend = null;
  let cleanupFactoryId = null;
  const cleanupTemplateIds = [];
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage65 regression');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found; run seed first');
    cleanupFactoryId = factory.id;
    const managementDepartment = await db.department.findFirst({ where: { factoryId: factory.id, code: 'management', isActive: true } });
    const departmentId = managementDepartment?.id;
    if (!departmentId) throw new Error('management department not found');
    const runtimeShift = currentFactoryShift();
    const line = await db.line.findFirst({
      where: {
        factoryId: factory.id,
        deletedAt: null,
        NOT: [
          { name: { contains: 'Stage', mode: 'insensitive' } },
          { name: { contains: 'regression', mode: 'insensitive' } },
        ],
      },
    });
    if (!line) throw new Error('production line not found');

    const templateResponse = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `${marker}: Контроль пиццы Рондо`,
        description: 'Проверка готовой продукции без технических пометок',
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        shiftType: runtimeShift.shiftType,
        frequencyRule: 'MANUAL',
        isMandatory: true,
      },
    });
    record('real pilot checklist template created', templateResponse.status === 201, templateResponse.data);
    const template = templateResponse.data;
    cleanupTemplateIds.push(template.id);
    await createRow(factory.id, template.id, { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, targetValue: 125, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Фото готового изделия', rowType: 'PHOTO', sortOrder: 40 });
    const { runId, photoAttachmentId, photoRowId } = await createClosedRun(factory.id, template.id, line.id, '2026-06-07', 'DAY');

    const hiddenTemplate = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `Stage65 regression hidden ${Date.now()}`,
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        frequencyRule: 'MANUAL',
      },
    });
    record('Stage/test checklist template fixture created', hiddenTemplate.status === 201, hiddenTemplate.data);
    cleanupTemplateIds.push(hiddenTemplate.data.id);

    const library = await request('GET', '/checklists/templates/library', { userId: 'test-admin', factoryId: factory.id });
    record('Stage/test templates hidden in ordinary library', library.status === 200 && !(library.data ?? []).some((item) => item.id === hiddenTemplate.data.id) && !(library.data ?? []).some((item) => item.id === template.id), library.data?.map?.((item) => item.name).slice(0, 8));

    const diagnosticLibrary = await request('GET', `/checklists/templates/library?includeDiagnostics=true&search=${encodeURIComponent(marker)}`, { userId: 'test-admin', factoryId: factory.id });
    record('diagnostic library retains requested scoped checklist fixture', diagnosticLibrary.status === 200 && (diagnosticLibrary.data ?? []).some((item) => item.id === template.id), diagnosticLibrary.data?.map?.((item) => item.name).slice(0, 8));

    const available = await request('GET', `/checklists/available?shiftDate=${runtimeShift.shiftDate}&shiftType=${runtimeShift.shiftType}`, { userId: 'test-management', factoryId: factory.id });
    record('Stage/test templates hidden in ordinary available list', available.status === 200 && !(available.data ?? []).some((item) => item.id === hiddenTemplate.data.id) && !(available.data ?? []).some((item) => item.id === template.id), available.data?.map?.((item) => item.name).slice(0, 8));

    const diagnosticAvailable = await request('GET', `/checklists/available?shiftDate=${runtimeShift.shiftDate}&shiftType=${runtimeShift.shiftType}&includeDiagnostics=true`, { userId: 'test-management', factoryId: factory.id });
    record('diagnostic available list retains scoped checklist fixture', diagnosticAvailable.status === 200 && (diagnosticAvailable.data ?? []).some((item) => item.id === template.id), diagnosticAvailable.data?.map?.((item) => item.name).slice(0, 8));

    const journal = await request('GET', `/checklists/archive/template/${template.id}/journal?includeDiagnostics=true`, {
      userId: 'test-management',
      factoryId: factory.id,
    });
    record('archive grouping unchanged and typed rows snapshots readable', journal.status === 200 && journal.data?.groups?.length >= 1 && journal.data?.runs?.some((run) => run.runId === runId && run.rows?.some((row) => row.title === 'Вес заготовки' && row.displayValue.includes('125'))), journal.data);
    record('archive response hides secrets', journal.status === 200 && !hasSecret(journal.data));

    const hiddenJournal = await request('GET', `/checklists/archive/template/${hiddenTemplate.data.id}/journal`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    record('Stage/test runtime journal hidden', hiddenJournal.status === 200 && hiddenJournal.data?.groups?.length === 0 && hiddenJournal.data?.runs?.length === 0, hiddenJournal.data);

    const authorizedPhoto = await download(`/attachments/${photoAttachmentId}/file`, {
      userId: 'test-management',
      factoryId: factory.id,
    });
    record('run-row attachment readable for authorized archive viewer', authorizedPhoto.status === 200 && /image\/png/i.test(authorizedPhoto.contentType ?? ''), authorizedPhoto);

    const unauthorizedPhoto = await download(`/attachments/${photoAttachmentId}/file`, {
      userId: 'worker-1',
      factoryId: factory.id,
    });
    record('unauthorized checklist row attachment denied', unauthorizedPhoto.status === 403, unauthorizedPhoto.data);

    const missing = await db.attachment.create({
      data: {
        factoryId: factory.id,
        uploadedById: 'test-management',
        entityType: AttachmentEntityType.CHECKLIST_RUN_ROW,
        entityId: photoRowId,
        kind: AttachmentKind.PHOTO,
        originalName: 'missing-stage65.png',
        mimeType: 'image/png',
        sizeBytes: 128,
        storagePath: `checklist_run_row/missing-stage65-${Date.now()}.png`,
        publicUrl: '/attachments/stage65-missing/file',
      },
    });
    const missingDownload = await download(`/attachments/${missing.id}/file`, {
      userId: 'test-management',
      factoryId: factory.id,
    });
    record('missing file and denied access produce different safe reasons', missingDownload.status === 409 && /отсутств/i.test(JSON.stringify(missingDownload.data)) && unauthorizedPhoto.status === 403, { missing: missingDownload.data, denied: unauthorizedPhoto.data });

    record('no storagePath/secrets/passwordHash/tokens', !hasSecret({ library: library.data, available: available.data, journal: journal.data }));

    if (failures.length) {
      console.error(JSON.stringify({ ok, failures }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
    }
  } finally {
    if (cleanupFactoryId) {
      for (const templateId of cleanupTemplateIds) {
        try {
          await request('POST', `/checklists/templates/${templateId}/archive`, { userId: 'test-admin', factoryId: cleanupFactoryId });
        } catch (error) {
          console.error(`Stage65 cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (backend) stopBackend(backend);
    await db.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
