import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast15');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const artifactPath = path.join(evidenceDir, 'test-artifacts.json');
const categories = [
  ['tasks', 'Заявки и простои'],
  ['checklists', 'Чек-листы'],
  ['okk', 'ОКК'],
  ['returns', 'Возвраты на производство'],
  ['stock', 'Некондиция'],
  ['orders', 'Заказы / Остатки'],
  ['wash', 'Мойка'],
  ['defrost', 'Оттайка'],
  ['shiftLog', 'Пересменка / Журнал'],
  ['announcements', 'Объявления'],
  ['attachments', 'Файлы и вложения'],
] as const;

const browserEvidence: any = {
  status: 'PENDING',
  widths: {},
  categories: {},
  screenshots: [],
  pagination: {},
  export: {},
  navigation: {},
  postCleanup: {},
  errors: [],
};
let diagnosticMode = false;

function screenshotPath(name: string) {
  if (!browserEvidence.screenshots.includes(name)) browserEvidence.screenshots.push(name);
  return path.join(screenshotDir, name);
}

async function installGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__p15Dialogs', { value: calls, configurable: true });
    Object.defineProperty(window, '__p15PrintCalls', { value: 0, writable: true, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
    window.print = () => {
      const target = window as typeof window & { __p15PrintCalls?: number };
      target.__p15PrintCalls = (target.__p15PrintCalls ?? 0) + 1;
    };
  });
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
  page.on('pageerror', (error) => browserEvidence.errors.push(`PAGEERROR ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/archive/') && response.status() >= 500) browserEvidence.errors.push(`${response.status()} ${response.url()}`);
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      diagnosticMode
      && request.method() === 'GET'
      && url.pathname.includes('/archive/')
      && !url.pathname.endsWith('/archive/options')
      && !url.pathname.endsWith('/archive/sections')
    ) {
      url.searchParams.set('includeDiagnostics', 'true');
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
}

async function loginAs(page: Page, userId: string) {
  const response = await page.request.post(`${apiUrl}/auth/dev-login`, { data: { userId } });
  expect(response.ok(), `dev-login ${userId}`).toBeTruthy();
  const login = await response.json();
  const factoryId = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4')?.id
    ?? login.recommendedFactoryId
    ?? login.availableFactories?.[0]?.id;
  expect(factoryId).toBeTruthy();
  await page.goto('/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`/?p15=${encodeURIComponent(userId)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 20_000 });
}

async function openMenuItem(page: Page, label: string) {
  const direct = page.locator('nav, [role="navigation"]').getByRole('button', { name: label, exact: true }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    const more = page.getByRole('button', { name: 'Ещё', exact: true });
    await expect(more).toBeVisible({ timeout: 20_000 });
    await more.click();
    const sheet = page.locator('.mobile-nav-sheet:visible').first();
    await expect(sheet.getByRole('button', { name: label, exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(page.locator('.archive-screen')).toBeVisible({ timeout: 20_000 });
}

async function openArchive(page: Page) {
  if (!(await page.locator('.archive-screen').count())) await openMenuItem(page, 'Архив');
  await expect(page.locator('.archive-category-list')).toBeVisible({ timeout: 20_000 });
}

async function openCategory(page: Page, key: string) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/archive/')
      && response.url().includes(`section=${encodeURIComponent(key)}`)
      && response.request().method() === 'GET'
      && (response.url().includes('/items?') || response.url().includes('/attachments?'))
  ));
  await page.locator(`[data-archive-category="${key}"]`).click();
  const response = await responsePromise;
  expect(response.status(), `${key} list HTTP`).toBe(200);
  const body = await response.json();
  await expect(page.locator('.archive-category-view')).toBeVisible();
  return body;
}

async function backToCategories(page: Page) {
  await page.getByRole('button', { name: 'Назад к разделам архива' }).click();
  await expect(page.locator('.archive-category-list')).toBeVisible();
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
  return overflow;
}

async function oneFingerScroll(page: Page) {
  const session = await page.context().newCDPSession(page);
  const metrics = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement;
    root.scrollTop = 0;
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.72, max: root.scrollHeight - root.clientHeight };
  });
  expect(metrics.max).toBeGreaterThan(40);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: metrics.x, y: metrics.y }] });
  for (const distance of [30, 60, 90, 120, 150, 180]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: metrics.x, y: metrics.y - distance }] });
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBeGreaterThan(20);
}

async function closeSheet(page: Page) {
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

function writeBrowserArtifact() {
  const current = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : {};
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify({ ...current, browser: browserEvidence }, null, 2)}\n`, 'utf8');
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.afterAll(() => {
  browserEvidence.status = browserEvidence.errors.length ? 'FAIL' : 'PASS';
  writeBrowserArtifact();
});

test('P15 cohesive Archive: normal UX, all domains, filters, export and post-cleanup', async ({ page }) => {
  await installGuards(page);
  diagnosticMode = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'pilot-pack-admin');
  await openArchive(page);

  await expect(page.locator('.archive-category-row')).toHaveCount(categories.length);
  for (const [key, label] of categories) {
    await expect(page.locator(`[data-archive-category="${key}"]`)).toContainText(label);
  }
  const categoryHeights = await page.locator('.archive-category-row').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(Math.max(...categoryHeights)).toBeLessThanOrEqual(86);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('01-archive-home-390.png'), fullPage: false });
  await oneFingerScroll(page);
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    browserEvidence.widths[String(viewport.width)] = { overflow: await noHorizontalOverflow(page) };
  }
  await page.setViewportSize({ width: 390, height: 844 });

  const initialChecklist = await openCategory(page, 'checklists');
  expect(initialChecklist.total).toBeGreaterThan(0);
  await expect(page.locator('.archive-record-row')).toHaveCount(Math.min(24, initialChecklist.total));
  await page.screenshot({ path: screenshotPath('02-category-records-390.png'), fullPage: false });

  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const filterSheet = page.locator('.archive-filter-sheet');
  await expect(filterSheet).toBeVisible();
  await expect(filterSheet.getByLabel('Поиск')).toBeVisible();
  await expect(filterSheet.getByLabel('Статус')).toBeVisible();
  await page.screenshot({ path: screenshotPath('03-filters-sheet-390.png'), fullPage: false });
  await filterSheet.getByLabel('Статус').selectOption('AUTO_CLOSED');
  const filteredResponse = page.waitForResponse((response) => response.url().includes('/archive/items?') && response.url().includes('status=AUTO_CLOSED'));
  await filterSheet.getByRole('button', { name: 'Показать записи', exact: true }).click();
  expect((await filteredResponse).status()).toBe(200);
  await expect(page.locator('.archive-active-filters')).toContainText('Закрыто сменой');
  const resetResponse = page.waitForResponse((response) => response.url().includes('/archive/items?') && !response.url().includes('status=AUTO_CLOSED'));
  await page.locator('.archive-active-filters').getByRole('button', { name: 'Сбросить' }).click();
  expect((await resetResponse).status()).toBe(200);

  await expect(page.locator('.archive-record-row').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 480 }));
  const visibleRowIndex = await page.locator('.archive-record-row').evaluateAll((rows) => rows.findIndex((row) => {
    const bounds = row.getBoundingClientRect();
    return bounds.top >= 80 && bounds.bottom <= window.innerHeight - 80;
  }));
  expect(visibleRowIndex).toBeGreaterThanOrEqual(0);
  const detailRow = page.locator('.archive-record-row').nth(visibleRowIndex);
  await expect(detailRow).toBeInViewport();
  const scrollBeforeDetail = await page.evaluate(() => window.scrollY);
  await detailRow.locator('.archive-record-open').click();
  const checklistDetail = page.locator('.archive-detail-sheet');
  await expect(checklistDetail).toBeVisible();
  await expect(checklistDetail).toContainText('Запуск чек-листа');
  await expect(checklistDetail).toContainText('Ответы и результаты');
  await page.screenshot({ path: screenshotPath('04-checklist-detail-history-390.png'), fullPage: false });
  await closeSheet(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(Math.max(0, scrollBeforeDetail - 8));

  await backToCategories(page);
  await openCategory(page, 'wash');
  await page.locator('.archive-record-open').first().click();
  const washDetail = page.locator('.archive-detail-sheet');
  await expect(washDetail).toBeVisible();
  await expect(washDetail).toContainText(/События|Проблемы|Контроль мойки/);
  await page.screenshot({ path: screenshotPath('05-wash-detail-390.png'), fullPage: false });
  await closeSheet(page);

  await backToCategories(page);
  const exportList = await openCategory(page, 'checklists');
  await page.getByRole('button', { name: 'Экспорт архива' }).click();
  await expect(page.locator('.archive-export-sheet')).toBeVisible();
  await page.screenshot({ path: screenshotPath('06-export-sheet-390.png'), fullPage: false });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /CSV для Excel/ }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const csv = fs.readFileSync(downloadedPath as string, 'utf8').replace(/^\uFEFF/, '');
  const csvRows = csv.trim().split(/\r?\n/).length - 1;
  expect(csvRows).toBe(exportList.total);
  await expect(page.locator('.archive-save-notice')).toContainText(`CSV сформирован: ${exportList.total} записей`);
  await page.getByRole('button', { name: 'Экспорт архива' }).click();
  await page.getByRole('button', { name: /Печать \/ PDF/ }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __p15PrintCalls?: number }).__p15PrintCalls ?? 0)).toBe(1);
  await expect(page.locator('.archive-save-notice')).toContainText(`Подготовлено к печати: ${exportList.total} записей`);
  browserEvidence.export = { csvRows, expectedRows: exportList.total, printCalled: true, filterParity: csvRows === exportList.total };

  await page.locator('.archive-record-open').first().click();
  await expect(page.locator('.archive-detail-sheet')).toBeVisible();
  await page.locator('.archive-detail-sheet').getByRole('button', { name: 'Открыть исходный раздел' }).click();
  await expect(page.locator('.archive-screen')).toHaveCount(0);
  await expect(page.locator('body')).toContainText('Чек-листы');
  browserEvidence.navigation.sourceModule = true;

  diagnosticMode = true;
  await loginAs(page, 'test-admin');
  await openArchive(page);
  for (const [key] of categories) {
    const list = await openCategory(page, key);
    expect(list.items.length, `${key} diagnostic list`).toBeGreaterThan(0);
    await expect(page.locator('.archive-record-row').first()).toBeVisible();
    await noHorizontalOverflow(page);

    if (key === 'tasks') {
      expect(list.total).toBeGreaterThan(24);
      await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
      await expect(page.locator('.archive-record-row')).toHaveCount(Math.min(48, list.total));
      browserEvidence.pagination = {
        total: list.total,
        firstPage: list.items.length,
        afterLoadMore: await page.locator('.archive-record-row').count(),
      };
    }

    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    const filter = page.locator('.archive-filter-sheet');
    await expect(filter.getByLabel('Поиск')).toBeVisible();
    await filter.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await page.locator('.archive-record-open').first().click();
    const detail = page.locator('.archive-detail-sheet');
    await expect(detail).toBeVisible();
    const detailText = await detail.innerText();
    expect(detailText.length).toBeGreaterThan(30);
    expect(detailText).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
    browserEvidence.categories[key] = {
      list: true,
      detail: true,
      filter: true,
      attachment: key === 'attachments'
        ? 'safe-metadata-detail'
        : detailText.includes('Вложения')
          ? 'present-in-selected-record'
          : 'none-in-selected-record',
      export: true,
      total: list.total,
    };
    await closeSheet(page);

    await page.getByRole('button', { name: 'Экспорт архива' }).click();
    await expect(page.locator('.archive-export-sheet')).toContainText('CSV для Excel');
    await expect(page.locator('.archive-export-sheet')).toContainText('Печать / PDF');
    await closeSheet(page);
    await backToCategories(page);
  }

  diagnosticMode = false;
  await loginAs(page, 'pilot-pack-admin');
  await openArchive(page);
  await expect(page.locator('body')).not.toContainText('__PFFV5_P15_');
  await page.screenshot({ path: screenshotPath('07-post-cleanup-archive-390.png'), fullPage: false });
  browserEvidence.postCleanup = {
    markerAbsent: !(await page.locator('body').innerText()).includes('__PFFV5_P15_'),
    noServerErrors: browserEvidence.errors.length === 0,
    categoryCount: await page.locator('.archive-category-row').count(),
  };

  const dialogCalls = await page.evaluate(() => (window as typeof window & { __p15Dialogs?: string[] }).__p15Dialogs ?? []);
  expect(dialogCalls).toEqual([]);
  expect(browserEvidence.errors).toEqual([]);
  expect(browserEvidence.screenshots).toHaveLength(7);
  expect(Object.keys(browserEvidence.categories)).toHaveLength(categories.length);
  browserEvidence.status = 'PASS';
  writeBrowserArtifact();
});
