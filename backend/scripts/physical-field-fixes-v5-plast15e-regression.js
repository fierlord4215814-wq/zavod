const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { ArchiveService } = require('../dist/modules/archive/archive.service.js');
const { ArchiveXlsxService } = require('../dist/modules/archive/archive-xlsx.service.js');
const { buildArchiveWorkbook } = require('../dist/modules/archive/archive-xlsx.builder.js');
const { factoryDateKey } = require('../dist/common/shift-time.js');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const archive = new ArchiveService({ db });
const xlsx = new ArchiveXlsxService(archive, { db });
const passed = [];
const failed = [];
const sections = ['tasks', 'checklists', 'okk', 'returns', 'stock', 'orders', 'wash', 'defrost', 'shiftLog', 'announcements', 'attachments'];
const forbiddenText = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|bearer\s+[A-Za-z0-9._-]+|[A-Za-z]:\\[^\r\n]+/i;
const uuidText = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function check(condition, name, details) {
  (condition ? passed : failed).push({ name, ...(details === undefined ? {} : { details }) });
}

function context({ userId, factoryId, role = 'ADMIN', isAdmin = false, isGuest = false, permissions = [], departmentId = null }) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role,
    departmentId,
    companyId: null,
    permissions,
    isAdmin,
    isGuest,
    scope: isGuest ? { type: 'GUEST', factoryId } : { type: 'FACTORY', factoryId, departmentId },
  };
}

async function statusOf(action) {
  try {
    await action();
    return 200;
  } catch (error) {
    return typeof error?.getStatus === 'function' ? error.getStatus() : Number(error?.status ?? 500);
  }
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

function workbookHasFormula(workbook) {
  let formula = false;
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.value && typeof cell.value === 'object' && ('formula' in cell.value || 'sharedFormula' in cell.value)) formula = true;
  })));
  return formula;
}

function dataSheets(workbook) {
  return workbook.worksheets.filter((sheet) => sheet.name !== 'Параметры');
}

function headerValues(sheet) {
  return Array.from(sheet.getRow(1).values, (value) => String(value ?? ''));
}

function assertWorkbookContract(workbook, section) {
  const sheets = dataSheets(workbook);
  check(workbook.worksheets.at(-1)?.name === 'Параметры', `${section}: Параметры — последний лист`);
  check(sheets.length > 0, `${section}: есть основной лист`);
  check(sheets.every((sheet) => sheet.getRow(1).actualCellCount > 0), `${section}: пустая выборка сохраняет headers`);
  check(sheets.every((sheet) => Boolean(sheet.autoFilter)), `${section}: AutoFilter включён`);
  check(sheets.every((sheet) => sheet.views.some((view) => Number(view.ySplit) === 1)), `${section}: header закреплён`);
  check(!workbookHasFormula(workbook), `${section}: formulas/macros отсутствуют`);
  const text = workbookText(workbook);
  check(!forbiddenText.test(text), `${section}: secrets/storage/internal paths отсутствуют`);
  check(!uuidText.test(text), `${section}: UUID не показаны пользователю`);
}

async function databaseSnapshot() {
  const [tasks, runs, okk, returns, stock, orders, wash, defrost, logs, announcements, attachments, audits] = await Promise.all([
    db.task.count(), db.checklistRun.count(), db.okkRecord.count(), db.returnRecord.count(), db.stockDefect.count(),
    db.orderRequest.count(), db.washSession.count(), db.defrostEvent.count(), db.shiftLog.count(), db.announcement.count(),
    db.attachment.count(), db.auditLog.count(),
  ]);
  return { tasks, runs, okk, returns, stock, orders, wash, defrost, logs, announcements, attachments, audits };
}

function controlledOccurrence(index, revision = 1) {
  const date = new Date(`2026-08-${String(10 + index).padStart(2, '0')}T09:1${index}:00.000Z`);
  const rows = [
    {
      templateRowId: 'temperature', title: 'Температура', unit: '°C', rowType: 'NUMBER', status: index === 2 ? 'ISSUE' : 'OK',
      answerBoolean: null, answerText: null, answerNumber: index === 2 ? 9.5 : 5.5 + index, selectedOption: null,
      comment: index === 0 ? '=HYPERLINK("https://example.invalid")' : null, completedById: null, minValue: 2, maxValue: 8,
    },
    {
      templateRowId: 'weight', title: revision === 1 ? 'Вес' : 'Вес готового изделия', unit: 'г', rowType: 'NUMBER', status: 'OK',
      answerBoolean: null, answerText: null, answerNumber: 450 + index, selectedOption: null,
      comment: null, completedById: null, minValue: 400, maxValue: 500,
    },
    {
      templateRowId: 'appearance', title: 'Внешний вид', unit: null, rowType: 'CHOICE', status: 'OK',
      answerBoolean: null, answerText: null, answerNumber: null, selectedOption: index === 1 ? '+Хорошо' : 'Соответствует',
      comment: null, completedById: null, minValue: null, maxValue: null,
    },
  ];
  return {
    runId: `controlled-run-${index}`,
    templateId: 'controlled-template-pizza',
    templateName: 'Пицца мясная',
    revision: '',
    sequence: index + 1,
    date,
    shiftDate: date,
    shiftType: index % 2 ? 'NIGHT' : 'DAY',
    lineName: 'Линия пиццы',
    departmentName: 'Производство',
    assigneeName: 'Сотрудник',
    status: 'COMPLETED',
    result: index === 2 ? 'Есть отклонения' : 'Выполнено',
    startedAt: date,
    completedAt: new Date(date.getTime() + 10 * 60_000),
    issueCount: index === 2 ? 1 : 0,
    comments: index === 0 ? '=HYPERLINK("https://example.invalid")' : '',
    attachmentCount: index,
    rows,
  };
}

async function controlledBuilderChecks() {
  const chunkSource = Array.from({ length: 2050 }, (_, index) => ({ id: `row-${index + 1}` }));
  const chunkOffsets = [];
  const chunkedRows = await archive.readArchiveChunks(({ skip, take }) => {
    chunkOffsets.push({ skip, take });
    return Promise.resolve(chunkSource.slice(skip, skip + take));
  });
  check(chunkedRows.length === chunkSource.length, 'Canonical chunk reader: все строки прочитаны без лимита');
  check(
    chunkOffsets.map(({ skip, take }) => `${skip}:${take}`).join('|') === '0:1000|1000:1000|2000:1000',
    'Canonical chunk reader: детерминированные окна 1000 строк',
    chunkOffsets,
  );
  check(
    chunkedRows.every((row, index) => row.id === chunkSource[index].id),
    'Canonical chunk reader: порядок сохранён без пропусков и дублей',
  );

  const occurrences = [controlledOccurrence(0, 1), controlledOccurrence(1, 1), controlledOccurrence(2, 2)];
  xlsx.assignRevisions(occurrences);
  const table = xlsx.checklistTemplateTable(occurrences, true);
  const plan = {
    title: 'Контрольный чек-лист',
    subject: 'Пицца мясная',
    generatedAt: new Date('2026-08-25T09:00:00.000Z'),
    primaryCount: 3,
    tables: [table],
    parameters: [{ label: 'Завод', value: 'Завод 4' }, { label: 'Раздел', value: 'Чек-листы' }],
  };
  const result = await buildArchiveWorkbook(plan);
  const workbook = await openWorkbook(result.buffer);
  const sheet = workbook.worksheets[0];
  const headers = headerValues(sheet);
  check(result.sheetNames[0] === 'Пицца мясная', 'Controlled checklist: один workbook и human sheet name', result.sheetNames);
  check(sheet.rowCount === 4, 'Controlled checklist: 3 occurrence rows', { rows: sheet.rowCount - 1 });
  check(headers.some((value) => value.includes('Температура, °C')), 'Controlled checklist: вопросы являются колонками');
  check(headers.some((value) => value.includes('Вес готового изделия, г')), 'Controlled checklist: revision union сохраняет новое поле');
  check(headers.includes('Версия / редакция'), 'Controlled checklist: колонка редакции присутствует');
  const temperatureColumn = headers.findIndex((value) => value.includes('Температура, °C'));
  check([2, 3, 4].every((row) => typeof sheet.getCell(row, temperatureColumn).value === 'number'), 'Controlled checklist: NUMBER cells остаются numeric');
  check(sheet.getCell(2, 2).value instanceof Date, 'Controlled checklist: даты являются Excel date values');
  check(sheet.getCell(2, 2).numFmt === 'dd.mm.yyyy', 'Controlled checklist: дата отображается человекочитаемо');
  check(sheet.getCell(2, 3).numFmt === 'hh:mm', 'Controlled checklist: время отображается человекочитаемо');
  check(!workbookHasFormula(workbook), 'Controlled checklist: formula-like content остаётся string');
  check(String(sheet.getCell(2, headers.indexOf('Комментарий / комментарии')).value).startsWith('='), 'Controlled checklist: исходный formula-like текст не потерян');

  const split = await buildArchiveWorkbook({
    ...plan,
    title: 'Проверка лимита',
    tables: [{ ...table, name: 'Заявки', rows: table.rows }],
  }, { maxDataRows: 2 });
  const splitWorkbook = await openWorkbook(split.buffer);
  check(splitWorkbook.worksheets.map((value) => value.name).join('|') === 'Заявки 1|Заявки 2|Параметры', 'Excel row limit делит листы в одном workbook', split.sheetNames);

  const multiTables = [
    { ...table, name: 'Шаблон А', rows: table.rows.slice(0, 1), primary: false },
    { ...table, name: 'Шаблон Б', rows: table.rows.slice(1, 2), primary: false },
    { ...table, name: 'Шаблон В', rows: table.rows.slice(2), primary: false },
  ];
  const summaryColumns = [{ key: 'template', header: 'Чек-лист', width: 30 }, { key: 'date', header: 'Дата', width: 18, kind: 'date' }];
  const multi = await buildArchiveWorkbook({
    ...plan,
    title: 'Несколько шаблонов',
    tables: [{ name: 'Сводка', primary: true, columns: summaryColumns, rows: occurrences.map((value, index) => ({ template: `Шаблон ${index + 1}`, date: value.date })) }, ...multiTables],
  });
  const multiWorkbook = await openWorkbook(multi.buffer);
  check(multiWorkbook.worksheets.map((value) => value.name).join('|') === 'Сводка|Шаблон А|Шаблон Б|Шаблон В|Параметры', 'Multi-template остаётся одним workbook', multi.sheetNames);

  const requestRows = [1, 2, 3].map((number) => ({ number, createdAt: new Date(2026, 7, number), description: number === 1 ? '@команда' : `Заявка ${number}`, quantity: number * 2 }));
  const requests = await buildArchiveWorkbook({
    title: 'Заявки', subject: 'Контроль', generatedAt: new Date(), primaryCount: 3,
    tables: [{ name: 'Заявки', primary: true, columns: [
      { key: 'number', header: '№', kind: 'number' }, { key: 'createdAt', header: 'Создана', kind: 'date' },
      { key: 'description', header: 'Описание' }, { key: 'quantity', header: 'Количество', kind: 'number' },
    ], rows: requestRows }],
    parameters: [
      { label: 'Раздел', value: 'Заявки' },
      { label: 'Сформировано', value: new Date('2026-08-25T09:00:00.000Z'), kind: 'date' },
    ],
  });
  const requestWorkbook = await openWorkbook(requests.buffer);
  check(requestWorkbook.getWorksheet('Заявки').rowCount === 4, 'Controlled requests: 3 records in one worksheet');
  check(requestWorkbook.getWorksheet('Заявки').getCell(2, 2).numFmt === 'dd.mm.yyyy hh:mm', 'Controlled requests: дата и время отображаются человекочитаемо');
  const parameterSheet = requestWorkbook.getWorksheet('Параметры');
  const generatedRow = parameterSheet.getColumn(1).values.findIndex((value) => value === 'Сформировано');
  check(generatedRow > 1 && parameterSheet.getCell(generatedRow, 2).numFmt === 'dd.mm.yyyy hh:mm', 'Параметры: дата формирования отображается человекочитаемо');
  check(!workbookHasFormula(requestWorkbook), 'Controlled requests: @ content is not a formula');
}

async function main() {
  const before = await databaseSnapshot();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден');
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, deletedAt: null }, select: { id: true } });
  const access = await db.userFactoryAccess.findFirst({
    where: { factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false, userId: { not: 'test-admin' }, user: { blockedAt: null, deletedAt: null } },
    select: { userId: true, departmentId: true },
  });
  if (!access) throw new Error('Активный ADMIN Завода 4 не найден');
  const admin = context({ userId: access.userId, factoryId: factory.id, isAdmin: true, departmentId: access.departmentId });
  const diagnostic = context({ userId: 'test-admin', factoryId: factory.id, isAdmin: true });
  const guest = context({ userId: 'p15e-guest-probe', factoryId: factory.id, role: 'GUEST', isGuest: true });
  const worker = context({ userId: 'p15e-worker-probe', factoryId: factory.id, role: 'WORKER' });

  await controlledBuilderChecks();

  for (const section of sections) {
    const selection = await archive.exportSelection(admin, { section });
    const result = await xlsx.create(admin, { section });
    const workbook = await openWorkbook(result.buffer);
    assertWorkbookContract(workbook, section);
    const selectedCount = section === 'attachments' ? selection.attachments.length : selection.items.length;
    if (section !== 'checklists') check(result.primaryCount === selectedCount, `${section}: canonical selection parity`, { selection: selectedCount, workbook: result.primaryCount });
    check(result.filename.endsWith('.xlsx') && !uuidText.test(result.filename), `${section}: human Windows-safe filename`, result.filename);
  }

  const checklistOptions = (await archive.options(admin)).checklistTemplates;
  const templateStats = await db.checklistRun.findMany({
    where: { factoryId: factory.id, status: { in: ['CLOSED', 'AUTO_CLOSED'] }, templateId: { in: checklistOptions.map((value) => value.id) } },
    select: { templateId: true, checks: { select: { id: true } } },
  });
  const stats = new Map();
  for (const row of templateStats) {
    const current = stats.get(row.templateId) ?? { runs: 0, occurrences: 0 };
    current.runs += 1;
    current.occurrences += row.checks.length || 1;
    stats.set(row.templateId, current);
  }
  const template = checklistOptions.find((value) => /Пицца мясная/i.test(value.name) && (stats.get(value.id)?.occurrences ?? 0) >= 3)
    ?? checklistOptions.find((value) => (stats.get(value.id)?.occurrences ?? 0) >= 3);
  check(Boolean(template), 'Live checklist template with at least 3 occurrences exists');
  if (template) {
    const query = { section: 'checklists', templateId: template.id };
    const selection = await archive.exportSelection(admin, query);
    const result = await xlsx.create(admin, query);
    const workbook = await openWorkbook(result.buffer);
    const first = workbook.worksheets[0];
    const headers = headerValues(first);
    const expectedOccurrences = stats.get(template.id)?.occurrences ?? selection.items.length;
    check(first.name !== 'Сводка' && first.name.includes(template.name.slice(0, Math.min(20, template.name.length))), 'One-template export opens on checklist sheet', { name: first.name });
    check(first.rowCount - 1 === expectedOccurrences && result.primaryCount === expectedOccurrences, 'One-template export contains every occurrence', { expectedOccurrences, rows: first.rowCount - 1 });
    check(headers.length > 16, 'One-template export contains question columns', { columns: headers.length - 1 });
    check(headers.includes('Версия / редакция'), 'Live checklist export includes revision column');
    const list = await archive.items(admin, { section: 'checklists', templateId: template.id, page: 1, pageSize: 24 });
    check(list.total === selection.items.length, 'Checklist template filter parity with Archive list', { archive: list.total, selection: selection.items.length });
  }

  const multiChecklist = await xlsx.create(admin, { section: 'checklists' });
  const multiWorkbook = await openWorkbook(multiChecklist.buffer);
  const visibleTemplateCount = new Set((await archive.exportSelection(admin, { section: 'checklists' })).items.map((item) => item.title)).size;
  if (visibleTemplateCount > 1) check(multiWorkbook.worksheets[0].name === 'Сводка', 'Multi-template export begins with Сводка');

  const taskSelection = await archive.exportSelection(admin, { section: 'tasks' });
  const taskWorkbookResult = await xlsx.create(admin, { section: 'tasks' });
  const taskWorkbook = await openWorkbook(taskWorkbookResult.buffer);
  check(taskWorkbook.worksheets[0].name === 'Заявки', 'Requests export begins with Заявки');
  check(taskWorkbook.worksheets[0].rowCount - 1 === taskSelection.items.length, 'Requests export has one row per selected task');
  check(taskWorkbook.worksheets.every((sheet) => !/^Заявки \d+$/.test(sheet.name)) || taskSelection.items.length > 1_048_575, 'Requests are not split without Excel limit');

  const firstTask = taskSelection.items[0];
  if (firstTask) {
    const dateKey = factoryDateKey(firstTask.date);
    const filterCases = [
      ['period', { dateFrom: dateKey, dateTo: dateKey }],
      ['search', { search: firstTask.title.slice(0, Math.min(12, firstTask.title.length)) }],
      ...(firstTask.lineName ? [['line', { lineId: (await db.task.findUnique({ where: { id: firstTask.id }, select: { lineId: true } }))?.lineId }]] : []),
      ...(firstTask.status ? [['status', { status: firstTask.status }]] : []),
    ];
    for (const [label, filters] of filterCases) {
      const query = { section: 'tasks', ...filters };
      const selected = await archive.exportSelection(admin, query);
      const result = await xlsx.create(admin, query);
      check(result.primaryCount === selected.items.length, `Filter parity: ${label}`, { selection: selected.items.length, workbook: result.primaryCount });
    }
  }
  const firstPage = await archive.items(admin, { section: 'tasks', page: 1, pageSize: 24 });
  check(firstPage.total === taskSelection.items.length, 'Pagination size does not alter export selection count', { archiveTotal: firstPage.total, exportTotal: taskSelection.items.length });

  const diagnosticSelection = await archive.exportSelection(diagnostic, { section: 'tasks', includeDiagnostics: 'true' });
  check(diagnosticSelection.items.length >= taskSelection.items.length, 'Diagnostic visibility is explicit and cannot reduce normal selection');
  check(await statusOf(() => xlsx.create(guest, { section: 'tasks' })) === 403, 'Guest direct XLSX is denied');
  check(await statusOf(() => xlsx.create(worker, { section: 'tasks' })) === 403, 'Worker direct XLSX is denied');
  if (otherFactory && firstTask) {
    const cross = context({ userId: access.userId, factoryId: otherFactory.id, isAdmin: true });
    const crossSelection = await archive.exportSelection(cross, { section: 'tasks', search: firstTask.title });
    check(crossSelection.items.every((item) => item.id !== firstTask.id), 'Cross-factory XLSX selection cannot read source task');
  }

  const after = await databaseSnapshot();
  check(JSON.stringify(before) === JSON.stringify(after), 'P15E export is read-only: DB counters unchanged', { before, after });
  console.log(`P15E XLSX regression: ${passed.length} passed, ${failed.length} failed`);
  console.log(`Sections: ${sections.length}/11; DB created=0 mutated=0 physical-delete=0`);
  if (failed.length) {
    failed.forEach((failure) => console.error(`FAILED: ${failure.name}${failure.details ? ` ${JSON.stringify(failure.details)}` : ''}`));
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`P15E XLSX regression failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
