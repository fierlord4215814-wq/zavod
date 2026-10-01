import { expect, Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast15e');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const checklistWorkbookPath = path.join(evidenceDir, 'checklists-one-template.xlsx');
const requestsWorkbookPath = path.join(evidenceDir, 'requests-filtered.xlsx');
const forbiddenText = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|bearer\s+[A-Za-z0-9._-]+|[A-Za-z]:\\[^\r\n]+/i;
const uuidText = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function headers(sheet: ExcelJS.Worksheet) {
  return Array.from(sheet.getRow(1).values, (value) => String(value ?? ''));
}

function workbookText(workbook: ExcelJS.Workbook) {
  const values: string[] = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    const value = cell.value;
    if (value && typeof value === 'object' && 'text' in value) values.push(String(value.text));
    else if (value !== null && value !== undefined) values.push(String(value));
  })));
  return values.join('\n');
}

function hasFormula(workbook: ExcelJS.Workbook) {
  let found = false;
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.value && typeof cell.value === 'object' && ('formula' in cell.value || 'sharedFormula' in cell.value)) found = true;
  })));
  return found;
}

async function openWorkbook(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  expect(workbook.worksheets.at(-1)?.name).toBe('Параметры');
  expect(hasFormula(workbook)).toBeFalsy();
  const text = workbookText(workbook);
  expect(text).not.toMatch(forbiddenText);
  expect(text).not.toMatch(uuidText);
  return workbook;
}

async function loginAsAdmin(page: Page) {
  const response = await page.request.post(`${apiUrl}/auth/dev-login`, { data: { userId: 'pilot-pack-admin' } });
  expect(response.ok(), 'dev-login pilot-pack-admin').toBeTruthy();
  const login = await response.json();
  const factoryId = login.availableFactories?.find((factory: { code?: string }) => factory.code === 'factory-4')?.id
    ?? login.recommendedFactoryId
    ?? login.availableFactories?.[0]?.id;
  expect(factoryId).toBeTruthy();
  await page.goto('/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'pilot-pack-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`/?p15e=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 20_000 });
}

async function openArchive(page: Page) {
  const direct = page.locator('nav, [role="navigation"]').getByRole('button', { name: 'Архив', exact: true }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    const sheet = page.locator('.mobile-nav-sheet:visible').first();
    await expect(sheet.getByRole('button', { name: 'Архив', exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Архив', exact: true }).click();
  }
  await expect(page.locator('.archive-category-list')).toBeVisible({ timeout: 20_000 });
}

async function openCategory(page: Page, key: string) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'GET'
      && response.url().includes('/archive/')
      && response.url().includes(`section=${key}`)
      && (response.url().includes('/items?') || response.url().includes('/attachments?'))
  ));
  await page.locator(`[data-archive-category="${key}"]`).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.locator('.archive-category-view')).toBeVisible();
  return response.json();
}

async function exportExcel(page: Page, expectedSection: string, saveTo: string, screenshotPath?: string) {
  await page.getByRole('button', { name: 'Экспорт архива' }).click();
  const sheet = page.locator('.archive-export-sheet:visible');
  await expect(sheet.getByText('Экспорт выборки')).toBeVisible();
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false });
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'GET'
      && response.url().includes('/archive/export/xlsx?')
      && response.url().includes(`section=${expectedSection}`)
  ));
  const downloadPromise = page.waitForEvent('download');
  await sheet.getByRole('button', { name: /Excel \(\.xlsx\)/ }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(response.headers()['content-disposition']).toContain("filename*=UTF-8''");
  expect(Number(response.headers()['x-archive-primary-count'])).toBeGreaterThanOrEqual(0);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
  expect(download.suggestedFilename()).not.toMatch(uuidText);
  await download.saveAs(saveTo);
  await expect(page.locator('.archive-save-notice')).toContainText('Excel сформирован');
  return { response, filename: download.suggestedFilename(), count: Number(response.headers()['x-archive-primary-count']) };
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(4);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  for (const filePath of [checklistWorkbookPath, requestsWorkbookPath]) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }
});

test('P15E downloads and opens one-template checklist workbook on mobile 360', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/archive/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await loginAsAdmin(page);
  await openArchive(page);
  await openCategory(page, 'checklists');

  await page.getByRole('button', { name: /^Фильтры/ }).click();
  const filterSheet = page.locator('.archive-filter-sheet:visible');
  const templateSelect = filterSheet.getByLabel('Чек-лист');
  const options = await templateSelect.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
    value: (node as HTMLOptionElement).value,
    label: node.textContent?.trim() ?? '',
  })));
  const template = options.find((option) => option.value && /Пицца мясная/i.test(option.label))
    ?? options.find((option) => option.value);
  expect(template, 'historical checklist template option').toBeTruthy();
  const filteredResponse = page.waitForResponse((response) => response.url().includes('/archive/items?') && response.url().includes(`templateId=${encodeURIComponent(template!.value)}`));
  await templateSelect.selectOption(template!.value);
  await filterSheet.getByRole('button', { name: 'Показать записи', exact: true }).click();
  const filtered = await filteredResponse;
  expect(filtered.status()).toBe(200);
  const filteredBody = await filtered.json();
  expect(filteredBody.total).toBeGreaterThan(0);
  await expect(page.locator('.archive-active-filters')).toContainText(template!.label);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, '01-checklist-template-filter-360.png'), fullPage: false });

  const exported = await exportExcel(
    page,
    'checklists',
    checklistWorkbookPath,
    path.join(screenshotDir, '03-export-excel-sheet-360.png'),
  );
  expect(exported.response.url()).toContain(`templateId=${encodeURIComponent(template!.value)}`);
  expect(exported.count).toBeGreaterThanOrEqual(3);
  const workbook = await openWorkbook(checklistWorkbookPath);
  const first = workbook.worksheets[0];
  const firstHeaders = headers(first);
  expect(first.name).not.toBe('Сводка');
  expect(first.name.toLocaleLowerCase('ru')).toContain(template!.label.slice(0, Math.min(18, template!.label.length)).toLocaleLowerCase('ru'));
  expect(first.rowCount - 1).toBe(exported.count);
  expect(first.rowCount - 1).toBeGreaterThanOrEqual(3);
  expect(firstHeaders).toContain('Версия / редакция');
  expect(firstHeaders.length).toBeGreaterThan(16);
  expect(first.autoFilter).toBeTruthy();
  expect(first.views.some((view) => Number(view.ySplit) === 1)).toBeTruthy();
  const dateColumn = firstHeaders.indexOf('Дата');
  expect(first.getCell(2, dateColumn).value).toBeInstanceOf(Date);
  const numericQuestionColumns = firstHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /температура|вес|количество/i.test(header));
  expect(numericQuestionColumns.length).toBeGreaterThan(0);
  expect(numericQuestionColumns.some(({ index }) => {
    for (let row = 2; row <= first.rowCount; row += 1) if (typeof first.getCell(row, index).value === 'number') return true;
    return false;
  })).toBeTruthy();
  expect(errors).toEqual([]);
});

test('P15E downloads filtered requests workbook on desktop and keeps filter parity', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/archive/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsAdmin(page);
  await openArchive(page);
  const initial = await openCategory(page, 'tasks');
  expect(initial.total).toBeGreaterThan(0);
  const firstTitle = String(initial.items[0]?.title ?? '').trim();
  expect(firstTitle).not.toBe('');
  const search = firstTitle.slice(0, Math.min(12, firstTitle.length));
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/archive/items') && url.searchParams.get('search') === search;
  });
  await page.getByLabel('Поиск в архиве').fill(search);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  const filtered = await searchResponse;
  expect(filtered.status()).toBe(200);
  const filteredBody = await filtered.json();
  expect(filteredBody.total).toBeGreaterThan(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, '02-requests-filtered-desktop.png'), fullPage: false });

  const exported = await exportExcel(page, 'tasks', requestsWorkbookPath);
  expect(new URL(exported.response.url()).searchParams.get('search')).toBe(search);
  expect(exported.count).toBe(filteredBody.total);
  const workbook = await openWorkbook(requestsWorkbookPath);
  const first = workbook.worksheets[0];
  expect(first.name).toBe('Заявки');
  expect(first.rowCount - 1).toBe(filteredBody.total);
  expect(headers(first)).toEqual(expect.arrayContaining(['Создана', 'Причина / тема', 'Описание', 'Время реакции', 'Общее время', 'Статус']));
  expect(first.autoFilter).toBeTruthy();
  expect(first.views.some((view) => Number(view.ySplit) === 1)).toBeTruthy();
  expect(errors).toEqual([]);
});
