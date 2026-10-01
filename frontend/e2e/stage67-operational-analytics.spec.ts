import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage67-operational-analytics-screenshots');
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|storagePath|passwordHash|token)\b/i;
const mojibakePattern = /Р В Р’В Р РЋ|Р В Р Р‹|Р вЂњРЎвЂ™|Р вЂњРІР‚В|Ð|Ñ|вЂ/;

type ApiOptions = { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] };

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?stage67User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage67Dialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage67Dialogs?: string[] }).__stage67Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error|storagePath/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

async function screenshot(page: Page, name: string, locator?: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  if (locator) {
    await page.locator(locator).first().screenshot({ path: path.join(screenshotDir, name) });
    return;
  }
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('Stage67 owner operational analytics is readable and mobile-safe', async ({ page }) => {
  await loginAs(page, 'test-management');
  await openMenuItem(page, /Статистика \/ Аудит/);
  await expect(page.getByRole('button', { name: 'Потери' })).toBeVisible();
  await page.getByRole('button', { name: 'Потери' }).click();
  await expect(page.locator('.ops-owner-hero')).toContainText(/Потеряно времени/);
  await expect(page.locator('.ops-owner-hero')).toContainText(/Простоев|Открытых/);
  await expect(page.locator('.ops-analytics-section').filter({ hasText: 'Линии с потерями' })).toBeVisible();
  await expect(page.locator('.ops-analytics-section').filter({ hasText: 'Реакция отделов' })).toBeVisible();
  await expect(page.locator('.ops-analytics-section').filter({ hasText: 'Крупные простои' })).toBeVisible();
  await expect(page.locator('.ops-analytics-section').filter({ hasText: 'Заявки, влияющие на потери' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Качество данных', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Линии и простои', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Качество', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Дисциплина чек-листов', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мойка', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Выводы руководителю', exact: true })).toBeVisible();
  await expect(page.locator('.ops-insight-card').first()).toContainText(/Недостаточно данных|потер|заяв|качество|мойка/i);
  await expect(page.locator('.ops-metric-grid').filter({ hasText: 'Средняя реакция' })).toContainText('p90');
  await expect(page.locator('.ops-filter-card select')).toHaveCount(8);
  await expect(page.locator('.ops-filter-card')).toContainText('Быстрый период');
  await expect(page.locator('.ops-filter-card')).toContainText('Линия');
  await expect(page.locator('.ops-filter-card')).toContainText('Отдел');
  await expect(page.locator('.ops-filter-card')).toContainText('Тип заявки');
  await expect(page.locator('.ops-filter-card')).toContainText('Статус заявки');
  await expect(page.locator('.ops-filter-card')).toContainText('Какие заявки учитывать');
  await expect(page.locator('.ops-filter-card')).toContainText('Модуль событий');
  await expect(page.locator('.ops-filter-card')).toContainText('Только отказы доступа');

  await screenshot(page, '01-owner-control-center-desktop.png', '.ops-owner-hero');
  await screenshot(page, '02-lines-loss-ranking-desktop.png', '.ops-analytics-section:has-text("Линии с потерями")');
  await screenshot(page, '03-department-response-desktop.png', '.ops-analytics-section:has-text("Реакция отделов")');
  await screenshot(page, '04-downtime-drilldown-desktop.png', '.ops-analytics-section:has-text("Крупные простои")');
  await screenshot(page, '05-repeated-problems-desktop.png', '.ops-analytics-section:has-text("Повторяющиеся проблемы")');
  await screenshot(page, '06-data-quality-desktop.png', '.ops-analytics-section:has(h3:has-text("Качество данных"))');
  await expectStableRussianPage(page);

  await page.setViewportSize({ width: 360, height: 760 });
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '07-owner-control-center-mobile.png', '.ops-owner-hero');
  await screenshot(page, '08-mobile-filters.png', '.ops-filter-card');
  await screenshot(page, '09-mobile-line-drilldown.png', '.ops-analytics-section:has-text("Линии с потерями")');
  await screenshot(page, '10-mobile-task-drilldown.png', '.ops-analytics-section:has-text("Заявки, влияющие на потери")');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
