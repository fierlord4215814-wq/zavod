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
  return /storagePath|passwordHash|JWT_SECRET|DATABASE_URL|token/i.test(JSON.stringify(value));
}

function currentShiftTarget() {
  const now = new Date();
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentDate = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  if (hour >= 8 && hour < 20) return { shiftDate: currentDate, shiftType: 'DAY' };
  if (hour >= 20) return { shiftDate: currentDate, shiftType: 'NIGHT' };
  const previous = new Date(`${currentDate}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(previous);
  return { shiftDate: previousDate, shiftType: 'NIGHT' };
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    body: { ...body, operationId: `stage50-row-${Date.now()}-${Math.random().toString(16).slice(2)}` },
  });
  if (response.status !== 201) throw new Error(`row create failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const management = await db.user.findUnique({ where: { id: 'test-management' } });
    const managementAccess = await db.userFactoryAccess.findFirst({ where: { userId: 'test-management', factoryId: factory.id, isActive: true } });
    const departmentId = management?.departmentId ?? managementAccess?.departmentId;
    if (!departmentId) throw new Error('test-management department not found');
    const otherDepartment = await db.department.findFirst({ where: { factoryId: factory.id, isActive: true, deletedAt: null, id: { not: departmentId } } });
    const line = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null, name: { contains: 'Рондо', mode: 'insensitive' } } })
      ?? await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null } });
    if (!line) throw new Error('production line not found');
    const target = currentShiftTarget();

    const templateResponse = await request('POST', '/checklists/templates', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: {
        name: `${marker}: Контроль пиццы Рондо`,
        description: 'Пилотная проверка библиотеки, назначения и архива',
        departmentId,
        lineId: line.id,
        assignmentRoles: [UserRole.MANAGEMENT],
        shiftType: target.shiftType,
        frequencyRule: 'ONCE_PER_SHIFT',
        isMandatory: true,
        operationId: `stage50-template-${Date.now()}`,
      },
    });
    record('template with assignment scope created', templateResponse.status === 201, { status: templateResponse.status });
    const template = templateResponse.data;

    const numberRow = await createRow(factory.id, template.id, { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 10, unit: 'г', minValue: 120, maxValue: 130, requiredAnswer: true });
    const yesRow = await createRow(factory.id, template.id, { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 20, requiredAnswer: true });
    await createRow(factory.id, template.id, { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });

    const outsideDepartment = otherDepartment ? await request('POST', '/checklists/templates', {
      userId: 'test-management',
      factoryId: factory.id,
      body: { name: `${marker}: чужой отдел`, departmentId: otherDepartment.id },
    }) : { status: 403 };
    record('department manager cannot assign outside scope', outsideDepartment.status === 403, { status: outsideDepartment.status });

    const adminBroad = await request('PATCH', `/checklists/templates/${template.id}`, {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { assignmentRoles: [UserRole.MANAGEMENT, UserRole.TECHNOLOG], reason: 'Пилотное расширение назначения' },
    });
    record('ADMIN can assign broad scope', adminBroad.status === 200, { status: adminBroad.status });

    const available = await request('GET', `/checklists/available?lineId=${line.id}&shiftDate=${target.shiftDate}&shiftType=${target.shiftType}`, {
      userId: 'test-management',
      factoryId: factory.id,
    });
    record('available checklists filtered by department/role/line/shift', available.status === 200 && available.data.some((item) => item.id === template.id), { status: available.status });

    const run = await request('POST', '/checklists/runs/start', {
      userId: 'test-management',
      factoryId: factory.id,
      body: { templateId: template.id, lineId: line.id, shiftDate: target.shiftDate, shiftType: target.shiftType },
    });
    record('take in work creates run', run.status === 201 && run.data?.lineId === line.id && run.data?.shiftType === target.shiftType, { status: run.status });

    const duplicate = await request('POST', '/checklists/runs/start', {
      userId: 'test-management',
      factoryId: factory.id,
      body: { templateId: template.id, lineId: line.id, shiftDate: target.shiftDate, shiftType: target.shiftType },
    });
    record('repeat take is idempotent for once-per-shift', duplicate.status === 201 && duplicate.data?.id === run.data?.id, { status: duplicate.status });

    const runRows = run.data.rows;
    const numeric = runRows.find((row) => row.templateRowId === numberRow.id);
    const yes = runRows.find((row) => row.templateRowId === yesRow.id);
    const comment = runRows.find((row) => row.rowType === 'REQUIRED_COMMENT');
    const numberBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${numeric.id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerNumber: 140 },
    });
    record(
      'required numeric range deviation saved as issue',
      numberBad.status === 201 && numberBad.data?.status === 'ISSUE' && Number(numberBad.data?.answerNumber) === 140,
      { status: numberBad.status, data: numberBad.data },
    );
    const numberGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${numeric.id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerNumber: 125 },
    });
    const yesGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${yes.id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerBoolean: true },
    });
    const commentGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${comment.id}/complete`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { answerText: 'Норма' },
    });
    record('typed row answers saved', numberGood.status === 201 && yesGood.status === 201 && commentGood.status === 201, { statuses: [numberGood.status, yesGood.status, commentGood.status] });

    const close = await request('POST', `/checklists/runs/${run.data.id}/close`, {
      userId: 'test-management',
      factoryId: factory.id,
      body: { comment: 'Пилотный чек-лист закрыт' },
    });
    record('run can be completed after required rows', close.status === 201, { status: close.status });

    const archive = await request('GET', `/checklists/archive/by-template/${template.id}`, {
      userId: 'test-admin',
      factoryId: factory.id,
    });
    const archiveRow = archive.data?.rows?.find((item) => item.id === run.data.id);
    record('archive by template returns table-like rows', archive.status === 200 && archive.data?.columns?.some((column) => column.title === 'Вес заготовки') && archiveRow, { status: archive.status });
    record('numeric values become columns', archiveRow && JSON.stringify(archiveRow.values).includes('125'), { values: archiveRow?.values });
    record('archive has no secrets', archive.status === 200 && !hasSecret(archive.data));

    const legacy = await db.checklistTemplate.create({
      data: { factoryId: factory.id, departmentId, name: `${marker}: legacy`, createdById: 'test-admin' },
    });
    await db.checklistTemplateRow.create({ data: { templateId: legacy.id, title: `${marker}: legacy row`, sortOrder: 10 } });
    const legacyRead = await request('GET', `/checklists/templates/${legacy.id}`, { userId: 'test-admin', factoryId: factory.id });
    record('legacy template still readable', legacyRead.status === 200 && legacyRead.data.rows?.[0]?.rowType === 'LEGACY', { status: legacyRead.status });

    const blocked = await request('GET', '/checklists/available', { userId: 'stage17-blocked-worker', factoryId: factory.id });
    record('blocked user denied', blocked.status === 403, { status: blocked.status });
    const otherFactory = await db.factory.upsert({
      where: { code: 'stage50-other-factory' },
      create: { code: 'stage50-other-factory', name: 'Stage50 other factory' },
      update: { isActive: true, deletedAt: null },
    });
    const otherDepartmentForTemplate = await db.department.upsert({
      where: { factoryId_code: { factoryId: otherFactory.id, code: 'stage50-checklists' } },
      create: { factoryId: otherFactory.id, code: 'stage50-checklists', name: 'Stage50 checklists' },
      update: { isActive: true, deletedAt: null },
    });
    const otherTemplate = await db.checklistTemplate.create({
      data: { factoryId: otherFactory.id, departmentId: otherDepartmentForTemplate.id, name: `${marker}: чужой завод`, createdById: 'test-admin' },
    });
    const cross = await request('GET', `/checklists/templates/${otherTemplate.id}`, { userId: 'test-admin', factoryId: factory.id });
    record('cross-factory denied', [403, 409].includes(cross.status), { status: cross.status });

    const audits = await db.auditLog.findMany({
      where: { factoryId: factory.id, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, action: { in: ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_UPDATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ACCESS_DENIED'] } },
      select: { action: true },
    });
    const actions = new Set(audits.map((item) => item.action));
    ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_UPDATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ACCESS_DENIED'].forEach((action) => {
      record(`audit action ${action}`, actions.has(action));
    });
    record('no storagePath/secrets in responses', !hasSecret({ template, available: available.data, run: run.data, archive: archive.data }));

    const exitCode = failures.length ? 1 : 0;
    if (failures.length) {
      console.error(JSON.stringify({ ok, failures }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
    }
    process.exitCode = exitCode;
  } finally {
    stopBackend(backend);
    await db.$disconnect();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
