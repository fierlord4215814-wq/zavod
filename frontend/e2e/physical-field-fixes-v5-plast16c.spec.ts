import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type ControlledState = {
  marker: string;
  factoryId: string;
  adminUserId: string;
  dateFrom: string;
  dateTo: string;
  lineAId: string;
  lineNames: string[];
};

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5176';
const rootDir = path.resolve(process.cwd(), '..');
const statePath = process.env.P16C_STATE_FILE || path.join(rootDir, '.codex-runtime', 'p16c-controlled-state.json');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast16c');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as ControlledState;
const forbiddenText = /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const mojibakePattern = /Р[РЎ]|Ð|Ñ|â€|ï¿½/;

function screenshotPath(fileName: string) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, fileName);
}

async function installGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__p16cDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname.includes('/ops/')) {
      url.searchParams.set('includeDiagnostics', 'true');
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function loginUi(page: Page) {
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
    localStorage.removeItem('zavod.authToken');
  }, { userId: state.adminUserId, factoryId: state.factoryId });
  await page.goto(`${frontendUrl}/?p16c=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
}

async function openMain(page: Page, label: string | RegExp) {
  const direct = page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('button', { name: label, exact: false }).filter({ visible: true }).first();
  if (await direct.count()) {
    await direct.click();
  } else {
    const more = page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first();
    await expect(more).toBeVisible();
    await more.click();
    const sheet = page.locator('.mobile-nav-sheet:visible');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: label, exact: false }).first().click();
  }
  await expect(page.getByRole('heading', { name: label, exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 25_000 });
}

async function applyPeriod(page: Page, lineId = '') {
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры статистики' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('С', { exact: true }).fill(state.dateFrom);
  await dialog.getByLabel('По', { exact: true }).fill(state.dateTo);
  await dialog.locator('select').first().selectOption({ value: lineId });
  const response = page.waitForResponse((item) => item.request().method() === 'GET'
    && item.url().includes('/ops/operations/overview?')
    && item.url().includes('includeDiagnostics=true'));
  await dialog.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
  await response;
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ops-owner-hero')).toBeVisible();
}

async function expectSafeRussianUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(forbiddenText);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(/TypeError|ReferenceError|Internal Server Error|Failed to fetch/i);
  const calls = await page.evaluate(() => (window as unknown as { __p16cDialogs?: string[] }).__p16cDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(4);
}

function metric(page: Page, label: string) {
  return page.locator('.metric-card').filter({ hasText: label }).first();
}

test.beforeEach(async ({ page }) => {
  await installGuards(page);
});

test('P16C desktop: controlled formulas, filters, modules and human audit detail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Desktop proof runs once in the desktop project.');
  await page.setViewportSize({ width: 1440, height: 960 });
  await loginUi(page);
  await openMain(page, /Статистика \/ Аудит/);
  await applyPeriod(page);

  const hero = page.locator('.ops-owner-hero');
  await expect(hero).toContainText('Потеряно времени: 1 ч 10 мин');
  await expect(hero).toContainText('Простоев: 4');
  await expect(hero).toContainText('Открытых простоев: 1');
  await expect(hero).toContainText('Открытых заявок: 2');
  await expect(hero).toContainText('Просроченных долгих: 1');
  await expect(metric(page, 'Самая проблемная линия')).toContainText('Линия Альфа');
  await expect(metric(page, 'Средний простой')).toContainText('18 мин');
  await expect(metric(page, 'Средний простой')).toContainText('Медиана: 10 мин · p90: 30 мин');
  await expect(metric(page, 'Средняя реакция')).toContainText('5 мин');
  await expect(metric(page, 'Среднее исполнение')).toContainText('20 мин');
  await expect(metric(page, 'Среднее решение')).toContainText('25 мин');
  await expect(metric(page, 'Эффект 10 минут')).toContainText('10 мин');
  await page.screenshot({ path: screenshotPath('01-control-center-desktop.png'), fullPage: false });

  await applyPeriod(page, state.lineAId);
  await expect(hero).toContainText('Потеряно времени: 1 ч');
  await expect(hero).toContainText('Простоев: 3');
  await expect(page.locator('.ops-filter-summary')).toContainText('Линия Альфа');
  await applyPeriod(page);

  const reasons = page.locator('.ops-analytics-section').filter({ hasText: 'Причины простоев' });
  await expect(reasons).toContainText('Не хватает людей');
  await expect(reasons).toContainText('Контроль качества');
  await expect(reasons).toContainText('Техническая неисправность');
  await expect(reasons).toContainText('Другое');
  await reasons.scrollIntoViewIfNeeded();
  await reasons.screenshot({ path: screenshotPath('04-downtime-reasons-desktop.png') });

  await page.getByRole('button', { name: 'Модули', exact: true }).click();
  const modules = page.locator('.ops-module-grid');
  await expect(modules).toContainText('Заявки');
  await expect(modules).toContainText('3');
  await expect(modules).toContainText('Мойка');
  await expect(modules).toContainText('Чек-листы');
  await expect(modules).toContainText('ОКК');

  await page.getByRole('button', { name: 'Аудит', exact: true }).click();
  const quantityCard = page.locator('.ops-audit-card').filter({ hasText: /Количество.*20.*15/s }).first();
  await expect(quantityCard).toBeVisible({ timeout: 20_000 });
  await quantityCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /измен|обнов|некондиц/i });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Кто');
  await expect(detail).toContainText('Когда');
  await expect(detail).toContainText('Количество');
  await expect(detail).toContainText('20 → 15');
  const detailText = await detail.innerText();
  expect(detailText).not.toMatch(uuidPattern);
  expect(detailText).not.toMatch(forbiddenText);
  await detail.screenshot({ path: screenshotPath('06-audit-detail-desktop.png') });
  await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expectSafeRussianUi(page);
  await expectNoHorizontalOverflow(page);
});

test('P16C mobile 360/390/430: sheets, tabs, safe area and compact UI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360-edge', 'Mobile proof runs once in the touch project.');
  await page.setViewportSize({ width: 390, height: 844 });
  await loginUi(page);
  await openMain(page, /Статистика \/ Аудит/);

  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const filterDialog = page.getByRole('dialog', { name: 'Фильтры статистики' });
  await expect(filterDialog).toBeVisible();
  await filterDialog.screenshot({ path: screenshotPath('03-filters-mobile-390.png') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(filterDialog).toBeHidden();
  await applyPeriod(page);
  await expect(page.locator('.ops-owner-hero')).toContainText('Потеряно времени: 1 ч 10 мин');
  await page.screenshot({ path: screenshotPath('02-control-center-mobile-390.png'), fullPage: false });
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole('button', { name: 'Модули', exact: true }).click();
  await expect(page.locator('.ops-module-grid')).toBeVisible();
  await expect(page.locator('.ops-module-grid')).toContainText('Заявки');
  await page.screenshot({ path: screenshotPath('05-modules-mobile-360.png'), fullPage: false });
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByRole('button', { name: 'События', exact: true }).click();
  await expect(page.locator('.section-stack .card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.section-stack')).toContainText(/Информация|Внимание|Критично/);
  await page.screenshot({ path: screenshotPath('07-events-mobile-430.png'), fullPage: false });
  await expectNoHorizontalOverflow(page);
  await expectSafeRussianUi(page);

  const nav = page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first();
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBeLessThanOrEqual(902);
});
