const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, UserRole } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const marker = `Stage44 checklist ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : options.formData,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function hasSecret(value) {
  return /storagePath|passwordHash|JWT_SECRET|DATABASE_URL|token/i.test(JSON.stringify(value));
}

async function uploadRowPhoto(factoryId, rowId) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `stage44-photo-${Date.now()}`);
  form.append('file', new Blob([Buffer.from('stage44-photo')], { type: 'image/png' }), 'stage44-photo.png');
  return request('POST', '/attachments/upload', { userId: 'test-admin', factoryId, formData: form });
}

async function createTemplate(factoryId, departmentId) {
  const template = await request('POST', '/checklists/templates', {
    userId: 'test-admin',
    factoryId,
    body: {
      name: `${marker}: смешанный шаблон`,
      description: 'Проверка конструктора и guided-run',
      departmentId,
      operationId: `stage44-template-${Date.now()}`,
    },
  });
  if (template.status !== 201) throw new Error(`template create failed: ${template.status} ${JSON.stringify(template.data)}`);
  return template.data;
}

async function createRow(factoryId, templateId, body) {
  const response = await request('POST', `/checklists/templates/${templateId}/rows`, {
    userId: 'test-admin',
    factoryId,
    body: { ...body, operationId: `stage44-row-${Date.now()}-${Math.random().toString(16).slice(2)}` },
  });
  if (response.status !== 201) throw new Error(`row create failed: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function ensureBlockedUser(factoryId, departmentId) {
  await db.user.upsert({
    where: { id: 'stage44-blocked-user' },
    create: { id: 'stage44-blocked-user', factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date() },
    update: { factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date(), deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage44-blocked-user', factoryId } },
    create: { userId: 'stage44-blocked-user', factoryId, role: UserRole.MANAGEMENT, departmentId, isActive: true },
    update: { role: UserRole.MANAGEMENT, departmentId, isActive: true, isGuest: false },
  });
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const management = await db.user.findUnique({ where: { id: 'test-management' } });
  const managementAccess = await db.userFactoryAccess.findFirst({ where: { userId: 'test-management', factoryId: factory.id, isActive: true } });
  const departmentId = management?.departmentId ?? managementAccess?.departmentId;
  if (!departmentId) throw new Error('test-management department not found');

  const template = await createTemplate(factory.id, departmentId);
  const yesRow = await createRow(factory.id, template.id, { title: 'Stage44 Да Нет', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true });
  const numberRow = await createRow(factory.id, template.id, { title: 'Stage44 вес', rowType: 'NUMBER', sortOrder: 20, unit: 'кг', minValue: 1, maxValue: 10, requiredAnswer: true });
  const commentRow = await createRow(factory.id, template.id, { title: 'Stage44 комментарий', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true });
  const photoRow = await createRow(factory.id, template.id, { title: 'Stage44 фото', rowType: 'REQUIRED_PHOTO', sortOrder: 40, requiresPhoto: true });
  const selectRow = await createRow(factory.id, template.id, { title: 'Stage44 выбор', rowType: 'SELECT', sortOrder: 50, optionsText: 'Норма\nТребует внимания', requiredAnswer: true });

  record('create template with mixed row types', Boolean(template.id && yesRow.id && numberRow.id && commentRow.id && photoRow.id && selectRow.id));

  const managementTemplate = await request('POST', '/checklists/templates', {
    userId: 'test-management',
    factoryId: factory.id,
    body: { name: `${marker}: управление`, departmentId, operationId: `stage44-management-${Date.now()}` },
  });
  record('management can create scoped template', managementTemplate.status === 201, { status: managementTemplate.status });

  const workerForbidden = await request('POST', '/checklists/templates', {
    userId: 'worker-1',
    factoryId: factory.id,
    body: { name: `${marker}: worker forbidden`, departmentId },
  });
  record('worker forbidden template edit', workerForbidden.status === 403, { status: workerForbidden.status });

  const run = await request('POST', '/checklists/runs', { userId: 'test-admin', factoryId: factory.id, body: { templateId: template.id } });
  record('start run from typed template', run.status === 201 && run.data?.rows?.length === 5);
  const firstRunRows = run.data.rows;

  await request('PATCH', `/checklists/templates/${template.id}/rows/${yesRow.id}`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { title: 'Stage44 Да Нет updated', rowType: 'YES_NO', requiredAnswer: true },
  });
  const oldRunDetail = await request('GET', `/checklists/runs/${run.data.id}`, { userId: 'test-admin', factoryId: factory.id });
  record('run snapshots typed rows', oldRunDetail.status === 200 && oldRunDetail.data.rows.find((row) => row.id === firstRunRows[0].id)?.title === 'Stage44 Да Нет');

  const yesComplete = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[0].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { answerBoolean: true },
  });
  record('answer yes/no row', yesComplete.status === 201 && yesComplete.data?.answerBoolean === true);

  const numberBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[1].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { answerNumber: 99 },
  });
  record(
    'numeric outside range saved as issue',
    numberBad.status === 201 && numberBad.data?.status === 'ISSUE' && Number(numberBad.data?.answerNumber) === 99,
    { status: numberBad.status, data: numberBad.data },
  );

  const numberGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[1].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { answerNumber: 5 },
  });
  record('answer numeric inside range', numberGood.status === 201 && Number(numberGood.data?.answerNumber) === 5);

  const commentBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[2].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: {},
  });
  record('required comment enforced', commentBad.status === 409);

  const commentGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[2].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { answerText: 'Комментарий Stage44' },
  });
  record('required comment accepted', commentGood.status === 201 && /Комментарий/.test(commentGood.data?.comment ?? ''));

  const photoBad = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[3].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: {},
  });
  record('required photo enforced', photoBad.status === 409);
  const upload = await uploadRowPhoto(factory.id, firstRunRows[3].id);
  record('checklist row attachment guarded upload', upload.status === 201 && !hasSecret(upload.data), { status: upload.status });
  const photoGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[3].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: {},
  });
  record('required photo accepted after upload', photoGood.status === 201);

  const selectGood = await request('POST', `/checklists/runs/${run.data.id}/rows/${firstRunRows[4].id}/complete`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { selectedOption: 'Норма' },
  });
  record('option select works', selectGood.status === 201 && selectGood.data?.selectedOption === 'Норма');

  const incompleteRun = await request('POST', '/checklists/runs', { userId: 'test-admin', factoryId: factory.id, body: { templateId: template.id } });
  const closeMissing = await request('POST', `/checklists/runs/${incompleteRun.data.id}/close`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { comment: 'Нельзя закрыть пустой Stage44 run' },
  });
  record('cannot complete run with missing required rows', closeMissing.status === 409, { status: closeMissing.status, data: closeMissing.data });

  const closeDone = await request('POST', `/checklists/runs/${run.data.id}/close`, {
    userId: 'test-admin',
    factoryId: factory.id,
    body: { comment: 'Stage44 закрыт' },
  });
  record('can complete run after required rows', closeDone.status === 201);

  const archive = await request('GET', `/checklists/archive?templateId=${template.id}&includeDiagnostics=true`, { userId: 'test-admin', factoryId: factory.id });
  const archivedRun = archive.data?.runs?.find((item) => item.id === run.data.id);
  record('archive shows typed answers', archive.status === 200 && archivedRun?.rows?.some((row) => row.answerNumber === 5) && !hasSecret(archive.data), { status: archive.status });

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage44-other-factory' },
    create: { code: 'stage44-other-factory', name: 'Stage44 other factory' },
    update: { isActive: true, deletedAt: null },
  });
  const otherDepartment = await db.department.upsert({
    where: { factoryId_code: { factoryId: otherFactory.id, code: 'stage44-other-dept' } },
    create: { factoryId: otherFactory.id, code: 'stage44-other-dept', name: 'Stage44 other department' },
    update: { isActive: true, deletedAt: null },
  });
  const otherTemplate = await db.checklistTemplate.create({
    data: { factoryId: otherFactory.id, departmentId: otherDepartment.id, name: `${marker}: чужой шаблон`, createdById: 'test-admin' },
  });
  const crossFactory = await request('GET', `/checklists/templates/${otherTemplate.id}`, { userId: 'test-admin', factoryId: factory.id });
  record('cross-factory denied', [403, 409].includes(crossFactory.status), { status: crossFactory.status });

  await ensureBlockedUser(factory.id, departmentId);
  const blocked = await request('GET', '/checklists/templates', { userId: 'stage44-blocked-user', factoryId: factory.id });
  record('blocked user denied', blocked.status === 403, { status: blocked.status });

  const workerAttachment = await request('GET', `/attachments/${upload.data?.id}`, { userId: 'worker-1', factoryId: factory.id });
  record('attachments guarded', workerAttachment.status === 403, { status: workerAttachment.status });

  const auditActions = await db.auditLog.findMany({
    where: {
      factoryId: factory.id,
      action: { in: ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_ROW_CREATED', 'CHECKLIST_TEMPLATE_UPDATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ATTACHMENT_ATTACHED_TO_CHECKLIST', 'ACCESS_DENIED'] },
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    select: { action: true },
  });
  const actions = new Set(auditActions.map((item) => item.action));
  ['CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_ROW_CREATED', 'CHECKLIST_RUN_STARTED', 'CHECKLIST_ROW_COMPLETED', 'CHECKLIST_RUN_CLOSED', 'ATTACHMENT_ATTACHED_TO_CHECKLIST', 'ACCESS_DENIED'].forEach((action) => {
    record(`audit action ${action}`, actions.has(action));
  });

  if (failures.length) {
    console.error(JSON.stringify({ ok, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
