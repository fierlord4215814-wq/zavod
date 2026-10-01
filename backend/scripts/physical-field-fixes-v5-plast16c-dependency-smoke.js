const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { ArchiveService } = require('../dist/modules/archive/archive.service.js');
const { ArchiveXlsxService } = require('../dist/modules/archive/archive-xlsx.service.js');
const { factoryDateKey } = require('../dist/common/shift-time.js');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const archive = new ArchiveService({ db });
const xlsx = new ArchiveXlsxService(archive, { db });
const passed = [];
const failed = [];
const forbidden = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|__PFFV5_P16C_/i;
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function check(name, condition, evidence) {
  (condition ? passed : failed).push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function context(userId, factoryId, departmentId) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role: 'ADMIN',
    departmentId,
    companyId: null,
    permissions: [],
    isAdmin: true,
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId },
  };
}

async function snapshot() {
  const [tasks, runs, audits, factories, accesses] = await Promise.all([
    db.task.count(), db.checklistRun.count(), db.auditLog.count(), db.factory.count(), db.userFactoryAccess.count(),
  ]);
  return { tasks, runs, audits, factories, accesses };
}

async function openWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function workbookText(workbook) {
  const values = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    const value = cell.value;
    if (value && typeof value === 'object' && 'text' in value) values.push(String(value.text));
    else if (value !== null && value !== undefined) values.push(String(value));
  })));
  return values.join('\n');
}

function archiveDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return factoryDateKey(Number.isNaN(date.getTime()) ? new Date() : date);
}

async function main() {
  const before = await snapshot();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } });
  if (!factory) throw new Error('Завод 4 не найден');
  const access = await db.userFactoryAccess.findFirst({
    where: {
      factoryId: factory.id,
      role: 'ADMIN',
      isActive: true,
      isGuest: false,
      userId: { not: 'test-admin' },
      user: { blockedAt: null, deletedAt: null },
    },
    select: { userId: true, departmentId: true },
  });
  if (!access) throw new Error('Активный ADMIN Завода 4 не найден');
  const admin = context(access.userId, factory.id, access.departmentId);

  const taskList = await archive.items(admin, { section: 'tasks', page: 1, pageSize: 100 });
  check('request archive list opens', Array.isArray(taskList.items));
  const task = taskList.items.find((item) => item?.id && item?.sourceType);
  if (task) {
    const detail = await archive.detail(admin, 'tasks', task.sourceType, task.id);
    check('one request detail opens', Boolean(detail?.title && Array.isArray(detail.sections)), detail?.title);
    check('request detail is human and safe', !forbidden.test(JSON.stringify(detail)) && !uuid.test(JSON.stringify(detail)), detail?.title);
  } else {
    check('one request detail opens', true, 'Архив заявок пуст; пустое состояние допустимо');
    check('request detail is human and safe', true, 'Нет записи для детализации');
  }

  const checklistList = await archive.items(admin, { section: 'checklists', page: 1, pageSize: 100 });
  check('checklist archive list opens', Array.isArray(checklistList.items));
  const checklist = checklistList.items.find((item) => item?.id && item?.sourceType);
  if (checklist) {
    const detail = await archive.detail(admin, 'checklists', checklist.sourceType, checklist.id);
    check('one checklist detail opens', Boolean(detail?.title && Array.isArray(detail.sections)), detail?.title);
    check('checklist detail is human and safe', !forbidden.test(JSON.stringify(detail)) && !uuid.test(JSON.stringify(detail)), detail?.title);
  } else {
    check('one checklist detail opens', true, 'Архив чек-листов пуст; пустое состояние допустимо');
    check('checklist detail is human and safe', true, 'Нет записи для детализации');
  }

  const uniqueTask = taskList.items.find((item, index, rows) => rows.findIndex((candidate) => candidate.title === item.title) === index
    && rows.filter((candidate) => candidate.title === item.title).length === 1) ?? task;
  const query = uniqueTask
    ? { section: 'tasks', search: uniqueTask.title, dateFrom: archiveDateKey(uniqueTask.date), dateTo: archiveDateKey(uniqueTask.date) }
    : { section: 'tasks', dateFrom: factoryDateKey(), dateTo: factoryDateKey() };
  const selection = await archive.exportSelection(admin, query);
  const result = await xlsx.create(admin, query);
  const workbook = await openWorkbook(result.buffer);
  const dataSheet = workbook.worksheets.find((sheet) => sheet.name !== 'Параметры');
  const headers = dataSheet ? Array.from(dataSheet.getRow(1).values).map((value) => String(value ?? '')) : [];
  const text = workbookText(workbook);
  check('small request workbook opens', Boolean(dataSheet && workbook.worksheets.at(-1)?.name === 'Параметры'));
  check('workbook has human headers', headers.includes('Создана') && headers.includes('Статус'), headers);
  check('workbook row count equals canonical filtered selection', result.primaryCount === selection.items.length, { workbook: result.primaryCount, selection: selection.items.length });
  check('workbook is intentionally small', selection.items.length <= 100, selection.items.length);
  check('workbook contains no secrets, marker or UUID', !forbidden.test(text) && !uuid.test(text));

  const options = await archive.options(admin);
  check('normal archive options exclude physical diagnostic markers', !JSON.stringify(options).includes('__PFFV5_P16C_'));

  const after = await snapshot();
  check('read-only archive/XLSX smoke changes no DB rows', JSON.stringify(after) === JSON.stringify(before), { before, after });

  console.log(`P16C_ARCHIVE_XLSX_COMPACT_SMOKE: ${failed.length ? 'FAIL' : 'PASS'}`);
  console.log(`passed=${passed.length} failed=${failed.length}`);
  for (const item of failed) console.error(`FAIL ${item.name}: ${JSON.stringify(item.evidence ?? null)}`);
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(`P16C_ARCHIVE_XLSX_COMPACT_SMOKE: FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
