const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const marker = `STAGE04_REGRESSION_${Date.now()}`;
const createdTemplateIds = [];
const passed = [];
const failed = [];

function check(name, condition, detail = '') {
  (condition ? passed : failed).push({ name, detail });
}

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = { 'x-user-id': userId };
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function row(title, rowType = 'YES_NO', sortOrder = 10) {
  return {
    title,
    rowType,
    sortOrder,
    requiredAnswer: rowType !== 'INFO',
    isRequired: rowType !== 'INFO',
    isActive: true,
    ...(rowType === 'SELECT' ? { optionsText: 'Да\nНет' } : {}),
  };
}

function containsForbidden(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

async function archive(factoryId, templateId) {
  if (!templateId) return;
  await request('POST', `/checklists/templates/${templateId}/archive`, { factoryId }).catch(() => null);
}

async function main() {
  let factoryId = '';
  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`backend health ${health.status}`);

    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('Завод 4 не найден');
    factoryId = factory.id;
    const managerAccess = await db.userFactoryAccess.findFirst({
      where: { userId: 'test-management', factoryId, isActive: true },
    });
    if (!managerAccess?.departmentId) throw new Error('Отдел руководителя не найден');
    const otherDepartment = await db.department.findFirst({
      where: { id: { not: managerAccess.departmentId }, isActive: true, deletedAt: null, OR: [{ factoryId }, { scope: 'GLOBAL' }] },
    });
    const line = await db.line.findFirst({ where: { factoryId, deletedAt: null, deactivatedAt: null }, orderBy: { name: 'asc' } });
    if (!line) throw new Error('Активная линия Завода 4 не найдена');

    const create = await request('POST', '/checklists/templates', {
      factoryId,
      body: {
        name: `${marker}: атомарный шаблон`,
        departmentId: managerAccess.departmentId,
        lineId: line.id,
        frequencyRule: 'EVERY_N_HOURS',
        frequencyIntervalUnit: 'MINUTES',
        frequencyIntervalValue: 30,
        rows: [row('Температура', 'NUMBER', 10), row('Внешний вид', 'YES_NO', 20), row('Решение', 'SELECT', 30)],
      },
    });
    if (create.status === 201) createdTemplateIds.push(create.data.id);
    check('create template with items is atomic', create.status === 201 && create.data?.isActive === true && create.data?.rows?.length === 3, String(create.status));
    check('template response has no technical secrets', !containsForbidden(create.data));
    const currentLibrary = await request('GET', '/checklists/templates/library?includeDiagnostics=true', { factoryId });
    check('active template is present in the limited library response', currentLibrary.status === 200 && currentLibrary.data?.some((template) => template.id === create.data?.id), String(currentLibrary.status));

    const empty = await request('POST', '/checklists/templates', {
      factoryId,
      body: { name: `${marker}: пустой`, departmentId: managerAccess.departmentId, rows: [] },
    });
    check('active empty template is rejected', empty.status === 409, String(empty.status));

    const legacyDraft = await request('POST', '/checklists/templates', {
      factoryId,
      body: { name: `${marker}: черновик`, departmentId: managerAccess.departmentId },
    });
    if (legacyDraft.status === 201) createdTemplateIds.push(legacyDraft.data.id);
    check('legacy metadata-first create is an inactive draft', legacyDraft.status === 201 && legacyDraft.data?.isActive === false, String(legacyDraft.status));
    const legacyRow = legacyDraft.status === 201
      ? await request('POST', `/checklists/templates/${legacyDraft.data.id}/rows`, { factoryId, body: row('Первый пункт') })
      : { status: 0 };
    const activatedDraft = legacyDraft.status === 201 ? await db.checklistTemplate.findUnique({ where: { id: legacyDraft.data.id } }) : null;
    check('first active row enables compatible draft', legacyRow.status === 201 && activatedDraft?.isActive === true, String(legacyRow.status));

    const duplicate = create.status === 201
      ? await request('POST', `/checklists/templates/${create.data.id}/duplicate`, {
        factoryId,
        body: {
          name: `${marker}: копия`,
          departmentId: managerAccess.departmentId,
          lineId: line.id,
          rows: [row('Скопированный пункт', 'YES_NO', 10), row('Фото', 'REQUIRED_PHOTO', 20)],
        },
      })
      : { status: 0, data: null };
    if (duplicate.status === 201) createdTemplateIds.push(duplicate.data.id);
    check('duplicate uses the same item contract', duplicate.status === 201 && duplicate.data?.rows?.length === 2 && duplicate.data.rows[0].title === 'Скопированный пункт', String(duplicate.status));

    const beforeRows = duplicate.status === 201
      ? await db.checklistTemplateRow.findMany({ where: { templateId: duplicate.data.id }, orderBy: { sortOrder: 'asc' } })
      : [];
    const update = duplicate.status === 201
      ? await request('PATCH', `/checklists/templates/${duplicate.data.id}`, {
        factoryId,
        body: {
          name: `${marker}: копия изменена`,
          departmentId: managerAccess.departmentId,
          lineId: line.id,
          isActive: true,
          rows: [
            { ...row('Фото обновлено', 'REQUIRED_PHOTO', 10), id: beforeRows[1]?.id },
            row('Новый пункт', 'TEXT', 20),
          ],
          reason: 'Проверка общего конструктора',
        },
      })
      : { status: 0, data: null };
    const oldOmittedRow = beforeRows[0] ? await db.checklistTemplateRow.findUnique({ where: { id: beforeRows[0].id } }) : null;
    check('edit reorders and adds items without physical delete', update.status === 200 && update.data?.rows?.filter((item) => item.isActive).length === 2 && oldOmittedRow?.isActive === false, String(update.status));

    const leadCreate = await request('POST', '/checklists/templates', {
      userId: 'test-management',
      factoryId,
      body: { name: `${marker}: свой отдел`, departmentId: managerAccess.departmentId, rows: [row('Свой пункт')] },
    });
    if (leadCreate.status === 201) createdTemplateIds.push(leadCreate.data.id);
    check('department manager can manage own department', leadCreate.status === 201, String(leadCreate.status));

    if (otherDepartment) {
      const foreignDepartment = await request('POST', '/checklists/templates', {
        userId: 'test-management',
        factoryId,
        body: { name: `${marker}: чужой отдел`, departmentId: otherDepartment.id, rows: [row('Чужой пункт')] },
      });
      check('department manager direct API cannot manage another department', foreignDepartment.status === 403, String(foreignDepartment.status));
    }

    const workerDenied = await request('POST', '/checklists/templates', {
      userId: 'pilot-worker-1',
      factoryId,
      body: { name: `${marker}: worker`, departmentId: managerAccess.departmentId, rows: [row('Запрещено')] },
    });
    check('worker direct API cannot manage templates', workerDenied.status === 403, String(workerDenied.status));

    const foreignLine = await db.line.findFirst({ where: { factoryId: { not: factoryId }, deletedAt: null } });
    if (foreignLine) {
      const crossFactory = await request('POST', '/checklists/templates', {
        factoryId,
        body: { name: `${marker}: чужая линия`, departmentId: managerAccess.departmentId, lineId: foreignLine.id, rows: [row('Пункт')] },
      });
      check('cross-factory line is rejected', crossFactory.status === 409, String(crossFactory.status));
    }

    const screenSource = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'screens', 'ChecklistsScreen.tsx'), 'utf8');
    const editorSource = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'ChecklistItemEditor.tsx'), 'utf8');
    check('home has four clickable canonical sections', ['В работе', 'Доступные', 'Просрочено', 'Архив'].every((label) => screenSource.includes(`label: '${label}'`)) && !screenSource.includes("label: 'Скоро'"));
    check('one shared item editor is connected', screenSource.includes('<ChecklistItemEditor') && editorSource.includes('export function ChecklistItemEditor'));
    check('old duplicate top tabs are disconnected', !screenSource.includes('<div className="segmented-control">\n        <button className={tab'));

    console.log(`physical-field-fixes-v2-stage04: ${passed.length} passed, ${failed.length} failed`);
    for (const item of failed) console.error(`FAIL ${item.name}: ${item.detail}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    for (const templateId of [...createdTemplateIds].reverse()) await archive(factoryId, templateId);
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
