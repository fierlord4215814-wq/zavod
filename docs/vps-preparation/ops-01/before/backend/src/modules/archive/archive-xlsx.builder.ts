import ExcelJS from 'exceljs';

export type ArchiveXlsxCellValue = string | number | boolean | Date | null | undefined;

export type ArchiveXlsxColumn = {
  key: string;
  header: string;
  width?: number;
  kind?: 'text' | 'number' | 'date' | 'date-only' | 'time' | 'duration' | 'boolean';
};

export type ArchiveXlsxTable = {
  name: string;
  columns: ArchiveXlsxColumn[];
  rows: Array<Record<string, ArchiveXlsxCellValue>>;
  primary?: boolean;
};

export type ArchiveWorkbookPlan = {
  title: string;
  subject: string;
  generatedAt: Date;
  primaryCount: number;
  tables: ArchiveXlsxTable[];
  parameters: Array<{ label: string; value: ArchiveXlsxCellValue; kind?: ArchiveXlsxColumn['kind'] }>;
};

export type ArchiveWorkbookResult = {
  buffer: Buffer;
  sheetNames: string[];
  primaryCount: number;
  splitSheets: string[];
};

const EXCEL_MAX_DATA_ROWS = 1_048_575;
const INVALID_SHEET_NAME = /[\\/?*[\]:]/g;
const HEADER_FILL = 'FFF2C94C';
const HEADER_TEXT = 'FF171B22';
const BORDER_COLOR = 'FF9EA7B3';
const ALT_FILL = 'FFF7F8FA';

function limitedSheetBase(value: string) {
  const normalized = String(value ?? '')
    .replace(INVALID_SHEET_NAME, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '');
  return (normalized || 'Данные').slice(0, 31);
}

export function safeWorksheetName(value: string, used: Set<string>) {
  const base = limitedSheetBase(value);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase('ru-RU'))) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, Math.max(1, 31 - marker.length))}${marker}`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase('ru-RU'));
  return candidate;
}

export function splitArchiveRows<T>(rows: T[], maxDataRows = EXCEL_MAX_DATA_ROWS) {
  if (!Number.isFinite(maxDataRows) || maxDataRows < 1) throw new Error('Лимит строк Excel должен быть положительным.');
  if (!rows.length) return [[]] as T[][];
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += maxDataRows) {
    chunks.push(rows.slice(offset, offset + maxDataRows));
  }
  return chunks;
}

export function factoryWallClockDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return new Date(Date.UTC(
    byType.get('year') ?? value.getUTCFullYear(),
    (byType.get('month') ?? value.getUTCMonth() + 1) - 1,
    byType.get('day') ?? value.getUTCDate(),
    byType.get('hour') ?? value.getUTCHours(),
    byType.get('minute') ?? value.getUTCMinutes(),
    byType.get('second') ?? value.getUTCSeconds(),
  ));
}

function excelValue(value: ArchiveXlsxCellValue, kind: ArchiveXlsxColumn['kind']) {
  if (value === null || value === undefined) return null;
  if (kind === 'boolean') return Boolean(value) ? 'Да' : 'Нет';
  if (kind === 'date' || kind === 'date-only' || kind === 'time') {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : factoryWallClockDate(date);
  }
  if (kind === 'duration') {
    const minutes = Number(value);
    return Number.isFinite(minutes) ? minutes / 1_440 : null;
  }
  if (kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (value instanceof Date) return factoryWallClockDate(value);
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return value;
  // ExcelJS stores primitive strings as shared strings, not as formulas. This also protects =, +, - and @ prefixes.
  return String(value);
}

function numberFormat(kind: ArchiveXlsxColumn['kind']) {
  if (kind === 'date') return 'dd.mm.yyyy hh:mm';
  if (kind === 'date-only') return 'dd.mm.yyyy';
  if (kind === 'time') return 'hh:mm';
  if (kind === 'duration') return '[h]:mm';
  return undefined;
}

function styleTableSheet(worksheet: ExcelJS.Worksheet, columns: ArchiveXlsxColumn[], rowCount: number) {
  worksheet.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rowCount + 1), column: Math.max(1, columns.length) },
  };
  worksheet.properties.defaultRowHeight = 18;

  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

  columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    excelColumn.width = Math.min(60, Math.max(10, column.width ?? Math.min(36, Math.max(12, column.header.length + 3))));
    const format = numberFormat(column.kind);
    if (format) excelColumn.numFmt = format;
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
    }
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (rowNumber > 1) {
        const format = numberFormat(columns[columnNumber - 1]?.kind);
        if (format) cell.numFmt = format;
      }
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      };
    });
  });
}

function addTable(
  workbook: ExcelJS.Workbook,
  table: ArchiveXlsxTable,
  usedNames: Set<string>,
  maxDataRows: number,
) {
  const chunks = splitArchiveRows(table.rows, maxDataRows);
  const created: string[] = [];
  chunks.forEach((rows, index) => {
    const requestedName = chunks.length > 1 ? `${table.name} ${index + 1}` : table.name;
    const name = safeWorksheetName(requestedName, usedNames);
    created.push(name);
    const worksheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: HEADER_FILL } } });
    worksheet.columns = table.columns.map((column) => ({ header: column.header, key: column.key }));
    for (const sourceRow of rows) {
      const row: Record<string, unknown> = {};
      for (const column of table.columns) row[column.key] = excelValue(sourceRow[column.key], column.kind);
      worksheet.addRow(row);
    }
    styleTableSheet(worksheet, table.columns, rows.length);
  });
  return created;
}

function addParameters(
  workbook: ExcelJS.Workbook,
  plan: ArchiveWorkbookPlan,
  usedNames: Set<string>,
  splitSheets: string[],
) {
  const name = safeWorksheetName('Параметры', usedNames);
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = [
    { header: 'Параметр', key: 'label', width: 34 },
    { header: 'Значение', key: 'value', width: 72 },
  ];
  const values = [
    ...plan.parameters,
    { label: 'Количество основных записей', value: plan.primaryCount, kind: 'number' as const },
    ...(splitSheets.length ? [{ label: 'Разбиение больших таблиц', value: splitSheets.join(', '), kind: 'text' as const }] : []),
  ];
  for (const item of values) {
    const row = worksheet.addRow({ label: item.label, value: excelValue(item.value, item.kind) });
    const format = numberFormat(item.kind);
    if (format) row.getCell(2).numFmt = format;
  }
  styleTableSheet(worksheet, [
    { key: 'label', header: 'Параметр', width: 34 },
    { key: 'value', header: 'Значение', width: 72 },
  ], values.length);
  return name;
}

export async function buildArchiveWorkbook(
  plan: ArchiveWorkbookPlan,
  options: { maxDataRows?: number } = {},
): Promise<ArchiveWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Завод';
  workbook.lastModifiedBy = 'Завод';
  workbook.created = plan.generatedAt;
  workbook.modified = plan.generatedAt;
  workbook.title = plan.title;
  workbook.subject = plan.subject;
  workbook.company = 'Завод';
  workbook.calcProperties.fullCalcOnLoad = false;

  const usedNames = new Set<string>();
  const sheetNames: string[] = [];
  const splitSheets: string[] = [];
  const maxDataRows = options.maxDataRows ?? EXCEL_MAX_DATA_ROWS;
  for (const table of plan.tables) {
    const created = addTable(workbook, table, usedNames, maxDataRows);
    sheetNames.push(...created);
    if (created.length > 1) splitSheets.push(...created);
  }
  sheetNames.push(addParameters(workbook, plan, usedNames, splitSheets));

  const output = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return { buffer: Buffer.from(output), sheetNames, primaryCount: plan.primaryCount, splitSheets };
}
