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
const marker = `Пилот department-first ${Date.now()}`;
const createdTemplates = [];
const createdRuns = [];
const createdItems = [];
const createdRequests = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)) return '[hidden]';
    return inner;
  }));
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined && !options.form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
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

function currentShiftTarget() {
  const now = new Date();
  const shiftDate = new Date(now);
  if (now.getHours() < 8) shiftDate.setDate(shiftDate.getDate() - 1);
  shiftDate.setHours(0, 0, 0, 0);
  const yyyy = shiftDate.getFullYear();
  const mm = String(shiftDate.getMonth() + 1).padStart(2, '0');
  const dd = String(shiftDate.getDate()).padStart(2, '0');
  return { shiftDate: `${yyyy}-${mm}-${dd}`, shiftType: now.getHours() >= 8 && now.getHours() < 20 ? 'DAY' : 'NIGHT' };
}

function isDiagnosticName(value) {
  return /stage|test|regression|fixture|simulation|diagnostic|pilot/i.test(String(value ?? ''));
}

async function userAccess(userId, factoryId) {
  return db.userFactoryAccess.findFirst({ where: { userId, factoryId, isActive: true }, include: { department: true } });
}

async function createTemplate(factoryId, body) {
  const response = await request('POST', '/checklists/templates', { userId: 'test-admin', factoryId, body: { ...body, operationId: `department-first-template-${Date.now()}-${Math.random().toString(16).slice(2)}` } });
  if (response.status !== 201) throw new Error(`template create failed: ${response.status} ${JSON.stringify(sanitize(response.data))}`);
  createdTemplates.push(response.data.id);
  return response.data;
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, { userId: 'test-admin', factoryId, body });
  if (response.status !== 201) throw new Error(`row create failed: ${response.status} ${JSON.stringify(sanitize(response.data))}`);
  return response.data;
}

async function startRun(factoryId, userId, templateId, body = {}) {
  const response = await request('POST', '/checklists/runs/start', { userId, factoryId, body: { templateId, ...body } });
  if (response.status === 201 && response.data?.id && !createdRuns.includes(response.data.id)) createdRuns.push(response.data.id);
  return response;
}

async function closeRun(factoryId, userId, runId) {
  if (!runId) return;
  await request('POST', `/checklists/runs/${runId}/close`, {
    userId,
    factoryId,
    body: { reason: 'Завершение безопасной regression-проверки' },
  });
}

async function archiveTemplate(factoryId, templateId) {
  if (!templateId) return;
  await request('POST', `/checklists/templates/${templateId}/archive`, { userId: 'test-admin', factoryId });
}

async function archiveItem(factoryId, itemId) {
  if (!itemId) return;
  await request('POST', `/orders/items/${itemId}/archive`, { userId: 'test-admin', factoryId, body: { comment: 'Архив безопасной regression-позиции' } });
}

async function closeRequest(factoryId, requestId) {
  if (!requestId) return;
  await request('POST', `/orders/requests/${requestId}/close`, { userId: 'test-admin', factoryId, body: { closeStatus: 'NOT_NEEDED', comment: 'Закрыто после regression-проверки' } });
}

async function uploadRowPhoto(factoryId, userId, rowId) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `department-first-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob(['department-first-photo'], { type: 'image/png' }), 'checklist-photo.png');
  return request('POST', '/attachments/upload', { userId, factoryId, form });
}

async function createStockItem(factoryId, departmentId, name) {
  const response = await request('POST', '/orders/items', {
    userId: 'test-admin',
    factoryId,
    body: {
      name,
      category: 'Проверка отделов',
      storageLocation: 'Пилотная зона',
      description: 'Временная позиция для проверки видимости по отделам',
      minThreshold: 1,
      initialQuantity: 5,
      unit: 'шт',
      departmentId,
    },
  });
  if (response.status !== 201) throw new Error(`stock item create failed: ${response.status} ${JSON.stringify(sanitize(response.data))}`);
  createdItems.push(response.data.id);
  return response.data;
}

async function cleanup(factoryId) {
  for (const requestId of createdRequests.reverse()) await closeRequest(factoryId, requestId);
  for (const runId of createdRuns.reverse()) await closeRun(factoryId, 'pilot-technolog-1', runId);
  for (const templateId of createdTemplates.reverse()) await archiveTemplate(factoryId, templateId);
  for (const itemId of createdItems.reverse()) await archiveItem(factoryId, itemId);
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  let factoryId = null;
  try {
    runPilotScenario();
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    factoryId = factory.id;
    const target = currentShiftTarget();

    const technologAccess = await userAccess('pilot-technolog-1', factory.id);
    const kipiaAccess = await userAccess('test-tech-kipia', factory.id);
    const electricAccess = await userAccess('pilot-tech-electric-1', factory.id);
    if (!technologAccess?.departmentId || !kipiaAccess?.departmentId || !electricAccess?.departmentId) throw new Error('required department access is missing');
    const lines = await db.line.findMany({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null }, orderBy: { name: 'asc' } });
    const line = lines.find((item) => !isDiagnosticName(item.id) && !isDiagnosticName(item.name)) ?? lines[0];
    if (!line) throw new Error('active production line not found');

    const pizza = await createTemplate(factory.id, {
      name: `${marker}: Вес пиццы по этапам`,
      description: 'Проверка веса изделия на ключевых этапах',
      departmentId: technologAccess.departmentId,
      lineId: line.id,
      assignmentRoles: [UserRole.TECHNOLOG],
      shiftType: target.shiftType,
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 1,
      isMandatory: true,
    });
    const freeze = await createTemplate(factory.id, {
      name: `${marker}: Внешний вид после заморозки`,
      description: 'Фотофиксация и внешний вид после камеры',
      departmentId: technologAccess.departmentId,
      assignmentRoles: [UserRole.TECHNOLOG],
      shiftType: target.shiftType,
      frequencyRule: 'MANUAL',
    });
    await createRow(factory.id, pizza.id, { title: 'Вес перед упаковкой', rowType: 'NUMBER', sortOrder: 10, unit: 'г', minValue: 120, maxValue: 160, requiredAnswer: true });
    await createRow(factory.id, pizza.id, { title: 'Комментарий при отклонении', rowType: 'TEXT', sortOrder: 20, requiredAnswer: false });
    await createRow(factory.id, freeze.id, { title: 'Фото внешнего вида', rowType: 'PHOTO', sortOrder: 10, requiresPhoto: true, requiredAnswer: true, exampleText: 'Пример: ровная глазурь, без повреждений упаковки' });

    const extraTemplates = [];
    for (let index = 1; index <= 5; index += 1) {
      const template = await createTemplate(factory.id, {
        name: `${marker}: Дополнительная проверка ${index}`,
        departmentId: technologAccess.departmentId,
        assignmentRoles: [UserRole.TECHNOLOG],
        shiftType: target.shiftType,
        frequencyRule: 'MANUAL',
      });
      await createRow(factory.id, template.id, { title: `Пункт проверки ${index}`, rowType: 'YES_NO_NA', sortOrder: 10, requiredAnswer: true });
      extraTemplates.push(template);
    }

    const availableTech = await request('GET', `/checklists/available?lineId=${line.id}&shiftDate=${target.shiftDate}&shiftType=${target.shiftType}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('technolog sees own department templates', availableTech.status === 200 && availableTech.data.some((item) => item.id === pizza.id) && availableTech.data.some((item) => item.departmentLabel), { status: availableTech.status });
    const availableKipia = await request('GET', `/checklists/available?lineId=${line.id}&shiftDate=${target.shiftDate}&shiftType=${target.shiftType}`, { userId: 'test-tech-kipia', factoryId: factory.id });
    record('role without checklist permission cannot read department templates', availableKipia.status === 403, { status: availableKipia.status });

    const starts = [];
    for (const template of [pizza, freeze, ...extraTemplates]) {
      starts.push(await startRun(factory.id, 'pilot-technolog-1', template.id, { lineId: template.lineId ?? null, shiftDate: target.shiftDate, shiftType: target.shiftType }));
    }
    record('user can take several own department checklists', starts.length === 7 && starts.every((response) => response.status === 201), starts.map((response) => response.status));
    record('run cards expose department and line labels', starts[0].data?.departmentLabel && starts[0].data?.lineLabel && !hasSecret(starts[0].data), sanitize(starts[0].data));

    const duplicate = await startRun(factory.id, 'pilot-technolog-1', pizza.id, { lineId: line.id, shiftDate: target.shiftDate, shiftType: target.shiftType });
    record('periodic duplicate active run returns existing run', duplicate.status === 201 && duplicate.data?.id === starts[0].data?.id, { status: duplicate.status, id: duplicate.data?.id });

    const pizzaRows = starts[0].data.rows;
    const weightRow = pizzaRows.find((row) => row.rowType === 'NUMBER');
    const commentRow = pizzaRows.find((row) => row.rowType === 'TEXT');
    const weightDone = await request('POST', `/checklists/runs/${starts[0].data.id}/rows/${weightRow.id}/complete`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { answerNumber: 140, status: 'OK' } });
    const commentDone = await request('POST', `/checklists/runs/${starts[0].data.id}/rows/${commentRow.id}/complete`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { answerText: 'Норма', status: 'OK' } });
    const filledPeriodic = await request('GET', `/checklists/runs/${starts[0].data.id}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    const completedPeriodic = await request('POST', `/checklists/runs/${starts[0].data.id}/checks/current/complete`, {
      userId: 'pilot-technolog-1',
      factoryId: factory.id,
      body: {
        checkId: filledPeriodic.data?.currentCheck?.id,
        operationId: `department-first-occurrence-${Date.now()}`,
      },
    });
    const afterPeriodic = await request('GET', `/checklists/runs/${starts[0].data.id}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('periodic check completion keeps run active and opens next round', weightDone.status === 201 && commentDone.status === 201 && [200, 201].includes(completedPeriodic.status) && afterPeriodic.data?.status === 'ACTIVE' && (afterPeriodic.data?.checks?.length ?? 0) >= 2, sanitize(afterPeriodic.data));

    const freezeRun = starts[1].data;
    const photoRow = freezeRun.rows.find((row) => row.rowType === 'PHOTO');
    const missingPhoto = await request('POST', `/checklists/runs/${freezeRun.id}/rows/${photoRow.id}/complete`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { status: 'OK' } });
    record('photo-required row cannot be completed without photo', missingPhoto.status === 409, { status: missingPhoto.status });
    const photoUpload = await uploadRowPhoto(factory.id, 'pilot-technolog-1', photoRow.id);
    const photoDone = await request('POST', `/checklists/runs/${freezeRun.id}/rows/${photoRow.id}/complete`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { status: 'OK', comment: 'Фото приложено' } });
    record('photo attachment completes row and hides storage path', photoUpload.status === 201 && photoDone.status === 201 && !hasSecret(photoUpload.data) && !hasSecret(photoDone.data), sanitize(photoUpload.data));

    const kipiaTemplate = await createTemplate(factory.id, {
      name: `${marker}: КИПиА проверка`,
      departmentId: kipiaAccess.departmentId,
      assignmentRoles: [UserRole.TECH_KIPIA],
      shiftType: target.shiftType,
      frequencyRule: 'MANUAL',
    });
    await createRow(factory.id, kipiaTemplate.id, { title: 'Проверить датчик', rowType: 'YES_NO_NA', sortOrder: 10, requiredAnswer: true });
    const techStartKipia = await startRun(factory.id, 'pilot-technolog-1', kipiaTemplate.id, { shiftDate: target.shiftDate, shiftType: target.shiftType });
    record('direct API cannot start checklist of another department', techStartKipia.status === 403 || techStartKipia.status === 409, { status: techStartKipia.status });

    const techItem = await createStockItem(factory.id, technologAccess.departmentId, `${marker}: Расходник технологов`);
    const electricItem = await createStockItem(factory.id, electricAccess.departmentId, `${marker}: Расходник электриков`);
    const sharedItem = await createStockItem(factory.id, null, `${marker}: Общий расходник`);
    const technologItems = await request('GET', '/orders/items', { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('department user sees own stock only', technologItems.status === 200
      && technologItems.data.some((item) => item.id === techItem.id)
      && !technologItems.data.some((item) => item.id === sharedItem.id)
      && !technologItems.data.some((item) => item.id === electricItem.id), sanitize(technologItems.data));
    const electricDirect = await request('GET', `/orders/items/${electricItem.id}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('direct API hides stock item of another department', [403, 404, 409].includes(electricDirect.status), { status: electricDirect.status });
    const storeItems = await request('GET', '/orders/items', { userId: 'test-store', factoryId: factory.id });
    record('STORE reads actual balances without StockDefect access', storeItems.status === 200 && !hasSecret(storeItems.data), sanitize(storeItems.data));
    const filteredElectric = await request('GET', `/orders/items?departmentId=${electricAccess.departmentId}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('department filter spoof is denied for ordinary user', filteredElectric.status === 403, sanitize(filteredElectric.data));
    const orderFromOther = await request('POST', `/orders/items/${electricItem.id}/order`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { requestedQuantity: 1, reasonComment: 'Попытка чужого заказа', operationId: `department-first-foreign-${Date.now()}` } });
    record('ordinary user cannot create request from hidden stock item', [403, 404, 409].includes(orderFromOther.status), { status: orderFromOther.status });
    const orderOwn = await request('POST', `/orders/items/${techItem.id}/order`, { userId: 'pilot-technolog-1', factoryId: factory.id, body: { requestedQuantity: 1, reasonComment: 'Нужно для отдела', operationId: `department-first-own-${Date.now()}` } });
    if (orderOwn.status === 201 && orderOwn.data?.id) createdRequests.push(orderOwn.data.id);
    record('own department order keeps department label', orderOwn.status === 201 && orderOwn.data?.departmentLabel && !hasSecret(orderOwn.data), sanitize(orderOwn.data));
    const requestListElectric = await request('GET', `/orders/requests?departmentId=${electricAccess.departmentId}`, { userId: 'pilot-technolog-1', factoryId: factory.id });
    record('order request department filter spoof is denied', requestListElectric.status === 403, sanitize(requestListElectric.data));
  } finally {
    if (factoryId) await cleanup(factoryId);
    await db.$disconnect();
    stopBackend(backend);
  }

  for (const item of ok) console.log(`ok - ${item.name}`);
  for (const item of failures) console.error(`fail - ${item.name}`, item.detail ? JSON.stringify(sanitize(item.detail)) : '');
  if (failures.length) process.exit(1);
  console.log(`checklist department-first v1 regression passed: ${ok.length} checks`);
}

main().catch(async (error) => {
  console.error(error);
  try { await db.$disconnect(); } catch {}
  process.exit(1);
});
