const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole } = require('@prisma/client');

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
const marker = `Пилот чек-лист ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|token/i.test(JSON.stringify(value));
}

function hasHumanError(response, fragments) {
  const text = JSON.stringify(response.data ?? '');
  return response.status === 409 && fragments.every((fragment) => text.includes(fragment));
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

async function uploadRowPhoto(factoryId, rowId, name = 'stage63-photo.png') {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage63-photo-${Date.now()}`);
  form.append('file', new Blob([Buffer.from('stage63-photo')], { type: 'image/png' }), name);
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-admin', 'x-factory-id': factoryId },
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

function currentShiftTarget() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour >= 8 && hour < 20) return { shiftDate: currentDate, shiftType: 'DAY' };
  if (hour >= 20) return { shiftDate: currentDate, shiftType: 'NIGHT' };
  const previous = new Date(`${currentDate}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    shiftDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(previous),
    shiftType: 'NIGHT',
  };
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    body: { ...body, operationId: `stage63-row-${Date.now()}-${Math.random().toString(16).slice(2)}` },
  });
  if (response.status !== 201) throw new Error(`row create failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function ensureBlockedUser(factoryId, departmentId) {
  await db.user.upsert({
    where: { id: 'stage63-blocked-user' },
    update: { factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage63-blocked-user', factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage63-blocked-user', factoryId } },
    update: { role: UserRole.MANAGEMENT, departmentId, isActive: true, isGuest: false },
    create: { userId: 'stage63-blocked-user', factoryId, role: UserRole.MANAGEMENT, departmentId, isActive: true },
  });
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage63 regression');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found; run seed first');
    const managementDepartment = await db.department.findFirst({ where: { factoryId: factory.id, code: 'management', isActive: true } });
    const departmentId = managementDepartment?.id;
    if (!departmentId) throw new Error('management department not found');
    const line = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null, name: { contains: 'Рондо', mode: 'insensitive' } } })
      ?? await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null } });
    if (!line) throw new Error('production line not found');
    const shiftTarget = currentShiftTarget();

    const templateResponse = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `${marker}: Контроль мобильного прохождения`,
        description: 'Пилотная проверка: один пункт на экране, понятные ошибки, фото и архив',
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        shiftType: shiftTarget.shiftType,
        frequencyRule: 'MANUAL',
        isMandatory: true,
        operationId: `stage63-template-${Date.now()}`,
      },
    });
    record('template for checklist UX hardening created', templateResponse.status === 201, { status: templateResponse.status });
    const template = templateResponse.data;

    const yesRow = await createRow(factory.id, template.id, { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true });
    const numberRow = await createRow(factory.id, template.id, { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, targetValue: 125, requiredAnswer: true });
    const commentRow = await createRow(factory.id, template.id, { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });
    const photoRow = await createRow(factory.id, template.id, { title: 'Фото готового изделия', rowType: 'REQUIRED_PHOTO', sortOrder: 40, requiresPhoto: true });
    const selectRow = await createRow(factory.id, template.id, { title: 'Решение по пункту', rowType: 'SELECT', sortOrder: 50, optionsText: 'Норма\nТребует внимания', requiredAnswer: true });
    record('mixed typed rows created', [yesRow, numberRow, commentRow, photoRow, selectRow].every((row) => row.id));

    const available = await request('GET', `/checklists/available?lineId=${line.id}&shiftDate=${shiftTarget.shiftDate}&shiftType=${shiftTarget.shiftType}`, {
      userId: 'test-management',
      factoryId: factory.id,
    });
    record('available list exposes scoped checklist without Stage/test noise', available.status === 200 && available.data.some((item) => item.id === template.id) && !/Stage\d+ browser|regression/i.test(JSON.stringify(available.data)), { status: available.status });

    const run = await request('POST', '/checklists/runs/start', {
      userId: 'test-management',
      factoryId: factory.id,
      body: { templateId: template.id, lineId: line.id, shiftDate: shiftTarget.shiftDate, shiftType: shiftTarget.shiftType },
    });
    record('take in work creates mobile guided run', run.status === 201 && run.data?.rows?.length === 5, { status: run.status });
    const rows = run.data.rows;
    const byTemplateRow = new Map(rows.map((row) => [row.templateRowId, row]));

    const missingYes = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(yesRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: {},
    });
    record('yes/no required error is human-readable', hasHumanError(missingYes, ['Выберите', 'Да', 'Нет', 'Проверить маркировку']), { status: missingYes.status, data: missingYes.data });

    const numberBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(numberRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerNumber: 140 },
    });
    record(
      'numeric range deviation is saved as issue',
      numberBad.status === 201 && numberBad.data?.status === 'ISSUE' && Number(numberBad.data?.answerNumber) === 140,
      { status: numberBad.status, data: numberBad.data },
    );

    const photoBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(photoRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: {},
    });
    record('required photo error names row', hasHumanError(photoBad, ['Добавьте фото', 'Фото готового изделия']), { status: photoBad.status, data: photoBad.data });

    const yesGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(yesRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerBoolean: true },
    });
    const numberGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(numberRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerNumber: 125 },
    });
    const commentGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(commentRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerText: 'Отклонений нет' },
    });
    const upload = await uploadRowPhoto(factory.id, byTemplateRow.get(photoRow.id).id);
    const photoGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(photoRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: {},
    });
    const selectGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${byTemplateRow.get(selectRow.id).id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { selectedOption: 'Норма' },
    });
    record('typed row answers and guarded photo save', [yesGood, numberGood, commentGood, upload, photoGood, selectGood].every((item) => [200, 201].includes(item.status)) && !hasSecret(upload.data), {
      statuses: [yesGood.status, numberGood.status, commentGood.status, upload.status, photoGood.status, selectGood.status],
    });

    const close = await request('POST', `/checklists/runs/${run.data.id}/close`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { comment: 'Пилотный чек-лист закрыт после обязательных пунктов' },
    });
    record('run closes after all required rows', close.status === 201, { status: close.status });

    const archive = await request('GET', `/checklists/archive/by-template/${template.id}`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    const archiveRow = archive.data?.rows?.find((item) => item.id === run.data.id);
    record('archive table returns row values and human user name', archive.status === 200
      && archive.data?.columns?.some((column) => column.title === 'Вес заготовки')
      && JSON.stringify(archiveRow?.values ?? {}).includes('125 г')
      && typeof archiveRow?.userName === 'string'
      && !archiveRow.userName.includes('test-management'), { status: archive.status, userName: archiveRow?.userName });
    record('archive and attachments hide secrets', archive.status === 200 && !hasSecret({ archive: archive.data, upload: upload.data }));

    const workerForbidden = await request('POST', '/checklists/templates', {
      userId: 'worker-1',
      factoryId: factory.id,
      body: { name: `${marker}: worker forbidden`, departmentId },
    });
    record('worker cannot manage checklist templates', workerForbidden.status === 403, { status: workerForbidden.status });

    await ensureBlockedUser(factory.id, departmentId);
    const blocked = await request('GET', '/checklists/available', { userId: 'stage63-blocked-user', factoryId: factory.id });
    record('blocked user denied', blocked.status === 403, { status: blocked.status });

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage63-other-factory' },
      create: { code: 'stage63-other-factory', name: 'Stage63 other factory' },
      update: { isActive: true, deletedAt: null },
    });
    const otherDepartment = await db.department.upsert({
      where: { factoryId_code: { factoryId: otherFactory.id, code: 'stage63-checklists' } },
      create: { factoryId: otherFactory.id, code: 'stage63-checklists', name: 'Stage63 checklists' },
      update: { isActive: true, deletedAt: null },
    });
    const otherTemplate = await db.checklistTemplate.create({
      data: { factoryId: otherFactory.id, departmentId: otherDepartment.id, name: `${marker}: чужой завод`, createdById: 'test-admin' },
    });
    const cross = await request('GET', `/checklists/templates/${otherTemplate.id}`, { userId: 'test-admin', factoryId: factory.id });
    record('cross-factory checklist access denied', [403, 409].includes(cross.status), { status: cross.status });

    const audits = await db.auditLog.findMany({
      where: {
        factoryId: factory.id,
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        action: { in: ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_ROW_CREATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ATTACHMENT_ATTACHED_TO_CHECKLIST', 'ACCESS_DENIED'] },
      },
      select: { action: true },
    });
    const actions = new Set(audits.map((item) => item.action));
    ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_ROW_CREATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ACCESS_DENIED'].forEach((action) => {
      record(`audit action ${action}`, actions.has(action));
    });

    if (failures.length) {
      console.error(JSON.stringify({ ok, failures }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
    }
  } finally {
    if (backend) stopBackend(backend);
    await db.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
