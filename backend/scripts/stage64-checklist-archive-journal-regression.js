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
const marker = `Пилот архив чек-листов ${Date.now()}`;

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

async function uploadRowPhoto(factoryId, rowId) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `journal-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([Buffer.from('stage64-photo')], { type: 'image/png' }), 'фото-журнал.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    body: { ...body, operationId: `stage64-row-${Date.now()}-${Math.random().toString(16).slice(2)}` },
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

async function createClosedRun(factoryId, templateId, lineId, shiftDate, shiftType, answers) {
  const runtimeShift = currentFactoryShift();
  const runtimeClosedAt = new Date().toISOString();
  const start = await request('POST', '/checklists/runs/start', {
    userId: 'test-management',
    factoryId,
    body: { templateId, lineId, shiftDate: runtimeShift.shiftDate, shiftType: runtimeShift.shiftType },
  });
  if (start.status !== 201) throw new Error(`run start failed: ${start.status} ${JSON.stringify(start.data)}`);
  const rowsByTitle = new Map(start.data.rows.map((row) => [row.title, row]));
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Проверить маркировку').id, { answerBoolean: answers.markingOk, now: runtimeClosedAt });
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Вес заготовки').id, { answerNumber: answers.weight, now: runtimeClosedAt });
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Комментарий технолога').id, { answerText: answers.comment, now: runtimeClosedAt });
  if (answers.withPhoto) {
    const photo = await uploadRowPhoto(factoryId, rowsByTitle.get('Фото готового изделия').id);
    if (photo.status !== 201) throw new Error(`photo upload failed: ${photo.status} ${JSON.stringify(photo.data)}`);
  }
  await completeRow(factoryId, start.data.id, rowsByTitle.get('Фото готового изделия').id, { now: runtimeClosedAt });
  const close = await request('POST', `/checklists/runs/${start.data.id}/close`, {
    userId: 'test-management',
    factoryId,
    body: { comment: answers.closeComment ?? 'Запуск закрыт для журнала архива', now: runtimeClosedAt },
  });
  if (close.status !== 201) throw new Error(`run close failed: ${close.status} ${JSON.stringify(close.data)}`);
  await db.checklistRun.update({
    where: { id: start.data.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(answers.closedAt),
      startedAt: new Date(answers.startedAt),
      shiftDate: new Date(`${shiftDate}T00:00:00.000Z`),
      shiftType,
      autoClosedAt: null,
      closeKind: 'MANUAL',
    },
  });
  return start.data.id;
}

async function ensureBlockedUser(factoryId, departmentId) {
  await db.user.upsert({
    where: { id: 'stage64-blocked-user' },
    update: { factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage64-blocked-user', factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage64-blocked-user', factoryId } },
    update: { role: UserRole.MANAGEMENT, departmentId, isActive: true, isGuest: false },
    create: { userId: 'stage64-blocked-user', factoryId, role: UserRole.MANAGEMENT, departmentId, isActive: true },
  });
}

async function main() {
  let backend = null;
  const createdTemplateIds = [];
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage64 regression');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found; run seed first');
    const managementDepartment = await db.department.findFirst({ where: { factoryId: factory.id, code: 'management', isActive: true } });
    const departmentId = managementDepartment?.id;
    if (!departmentId) throw new Error('management department not found');
    const runtimeShift = currentFactoryShift();
    const line = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null, name: { contains: 'Рондо', mode: 'insensitive' } } })
      ?? await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null } });
    if (!line) throw new Error('production line not found');
    const shiftDate = '2026-06-07';

    const templateResponse = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `${marker}: Контроль архива`,
        description: 'Пилотная проверка журнала архива по датам и сменам',
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        shiftType: runtimeShift.shiftType,
        frequencyRule: 'MANUAL',
        isMandatory: true,
      },
    });
    record('template for archive journal created', templateResponse.status === 201, { status: templateResponse.status });
    const template = templateResponse.data;
    if (template?.id) createdTemplateIds.push(template.id);
    await createRow(factory.id, template.id, { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, targetValue: 125, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Фото готового изделия', rowType: 'PHOTO', sortOrder: 40 });

    const firstRunId = await createClosedRun(factory.id, template.id, line.id, shiftDate, 'DAY', {
      markingOk: true,
      weight: 125,
      comment: 'Отклонений нет',
      withPhoto: true,
      startedAt: '2026-06-07T08:05:00.000Z',
      closedAt: '2026-06-07T08:15:00.000Z',
    });
    const secondRunId = await createClosedRun(factory.id, template.id, line.id, shiftDate, 'DAY', {
      markingOk: false,
      weight: 126,
      comment: 'Маркировку поправили',
      withPhoto: false,
      startedAt: '2026-06-07T11:10:00.000Z',
      closedAt: '2026-06-07T11:20:00.000Z',
    });
    record('multiple runs in one shift created', Boolean(firstRunId && secondRunId));

    const journal = await request('GET', `/checklists/archive/template/${template.id}/journal`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    const group = journal.data?.groups?.find((item) => item.date === shiftDate && item.shiftType === 'DAY');
    const detail = journal.data?.runs?.find((item) => item.runId === secondRunId);
    record('journal groups by date and shift', journal.status === 200 && group?.runs?.length >= 2 && /07\.06\.2026/.test(group.title) && group.title.includes('День'), { status: journal.status, title: group?.title });
    record('journal row has time user line status and counters', Boolean(group?.runs?.some((run) => run.runId === firstRunId && run.time && run.userName && run.lineName && run.statusLabel && run.photoCount === 1)), group?.runs);
    record('run detail returns ordered rows', Array.isArray(detail?.rows) && detail.rows.map((row) => row.title).join('|').startsWith('Проверить маркировку|Вес заготовки'), detail?.rows?.map((row) => row.title));
    record('numeric display includes value unit norm and status', Boolean(detail?.rows?.some((row) => row.title === 'Вес заготовки' && row.displayValue.includes('126 г') && row.normText?.includes('120') && row.status === 'ok')), detail?.rows);
    record('deviation count detects issue answers', Boolean(detail?.deviationCount >= 1 && detail.rows.some((row) => row.status === 'warning')));
    record('photo summary and attachments hide storagePath', journal.status === 200 && JSON.stringify(journal.data).includes('фото-журнал') && !hasSecret(journal.data));
    record('matrix view payload exists', Boolean(journal.data?.matrix?.columns?.length >= 4 && journal.data?.matrix?.rows?.some((row) => row.id?.startsWith(`${firstRunId}:`))));

    const onlyDeviations = await request('GET', `/checklists/archive/template/${template.id}/journal?onlyDeviations=true`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    record('only deviations filter returns deviation runs only', onlyDeviations.status === 200 && onlyDeviations.data.runs.length >= 1 && onlyDeviations.data.runs.every((run) => run.deviationCount > 0));
    const lineFilter = await request('GET', `/checklists/archive/template/${template.id}/journal?lineId=${line.id}&shiftType=DAY&userId=test-management&dateFrom=2026-06-01`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    record('period shift line and user filters work', lineFilter.status === 200 && lineFilter.data.runs.length >= 2 && lineFilter.data.runs.every((run) => run.lineName));

    const hiddenTemplate = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `Stage64 regression hidden ${Date.now()}`,
        departmentId,
        assignmentRoles: [UserRole.MANAGEMENT],
        frequencyRule: 'MANUAL',
      },
    });
    if (hiddenTemplate.data?.id) createdTemplateIds.push(hiddenTemplate.data.id);
    const hidden = await request('GET', `/checklists/archive/template/${hiddenTemplate.data.id}/journal`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    record('Stage/test checklist archive journal hidden from pilot runtime', hidden.status === 200 && hidden.data.groups.length === 0 && hidden.data.runs.length === 0);

    const workerDenied = await request('GET', `/checklists/archive/template/${template.id}/journal`, {
      userId: 'worker-1',
      factoryId: factory.id,
    });
    record('worker denied foreign checklist archive', workerDenied.status === 403, { status: workerDenied.status });
    await ensureBlockedUser(factory.id, departmentId);
    const blocked = await request('GET', `/checklists/archive/template/${template.id}/journal`, {
      userId: 'stage64-blocked-user',
      factoryId: factory.id,
    });
    record('blocked user denied', blocked.status === 403, { status: blocked.status });

    const otherFactory = await db.factory.upsert({
      where: { code: 'stage64-other-factory' },
      create: { code: 'stage64-other-factory', name: 'Stage64 other factory' },
      update: { isActive: true, deletedAt: null },
    });
    const otherDepartment = await db.department.upsert({
      where: { factoryId_code: { factoryId: otherFactory.id, code: 'stage64-checklists' } },
      create: { factoryId: otherFactory.id, code: 'stage64-checklists', name: 'Stage64 checklists' },
      update: { isActive: true, deletedAt: null },
    });
    const otherTemplate = await db.checklistTemplate.create({
      data: { factoryId: otherFactory.id, departmentId: otherDepartment.id, name: `${marker}: чужой завод`, createdById: 'test-admin' },
    });
    createdTemplateIds.push(otherTemplate.id);
    const cross = await request('GET', `/checklists/archive/template/${otherTemplate.id}/journal`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    record('cross-factory checklist archive denied', [403, 409].includes(cross.status), { status: cross.status });

    if (failures.length) {
      console.error(JSON.stringify({ ok, failures }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
    }
  } finally {
    if (createdTemplateIds.length) {
      await db.checklistTemplate.updateMany({
        where: { id: { in: createdTemplateIds } },
        data: { isActive: false, archivedAt: new Date() },
      });
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
