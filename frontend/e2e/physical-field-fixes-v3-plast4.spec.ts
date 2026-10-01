import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v3-screenshots', 'plast4');

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'test-admin' }),
  });
  if (!response.ok) throw new Error(`dev-login test-admin: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 недоступен администратору');

  await page.goto(frontendUrl);
  await page.evaluate(({ factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { factoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openMainScreen(page: Page, name: string) {
  const navigation = page.locator('nav[aria-label="Основная навигация"]:visible');
  const direct = navigation.getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).first();
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await page.locator('.mobile-more-button:visible').click();
  await page.locator('.mobile-sheet-item').filter({ hasText: name }).first().click();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function requestMobileBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('requests use one selected list, two card actions and separate archive sheet', async ({ page }, testInfo) => {
  await login(page);
  await openMainScreen(page, 'Заявки');
  await expect(page.getByRole('heading', { name: 'Заявки', exact: true })).toBeVisible();
  await expect(page.locator('.task-kpi-grid .premium-kpi-card')).toHaveCount(4);
  await expect(page.locator('.task-selected-list')).toBeVisible();
  await expect(page.locator('.task-archive-panel')).toHaveCount(0);

  const firstCard = page.locator('.task-selected-list .task-card-v2').first();
  if (await firstCard.count()) {
    await expect(firstCard.locator('.task-card-actions button')).toHaveCount(2);
    const actionButton = firstCard.getByRole('button', { name: 'Действия', exact: true });
    if (await actionButton.isEnabled()) {
      await actionButton.click();
      await expect(page.getByRole('dialog', { name: 'Действия с заявкой' })).toBeVisible();
      await requestMobileBack(page);
      await expect(page.getByRole('dialog', { name: 'Действия с заявкой' })).toHaveCount(0);
    }
  }

  await page.getByRole('button', { name: 'Архив и метрики', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Архив и метрики заявок' });
  await expect(archive).toBeVisible();
  await expect(archive.locator('.task-archive-filters')).toBeVisible();
  await requestMobileBack(page);
  await expect(archive).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-requests.png`), fullPage: false });
});

test('OKK and returns switch between active and archive without duplicate lists', async ({ page }, testInfo) => {
  await login(page);
  await openMainScreen(page, 'ОКК');
  await expect(page.getByRole('heading', { name: 'ОКК', exact: true })).toBeVisible();
  await expect(page.locator('.okk-screen .premium-kpi-card')).toHaveCount(2);
  await expect(page.locator('.okk-screen .section-subhead h3')).toHaveCount(1);
  await page.locator('.okk-screen .premium-kpi-card').filter({ hasText: 'Архив' }).click();
  await expect(page.locator('.okk-screen .section-subhead h3')).toHaveText('Архив');
  await expect(page.locator('.okk-screen .section-subhead h3')).toHaveCount(1);
  await noOverflow(page);

  await openMainScreen(page, 'Возвраты на производство');
  await expect(page.getByRole('heading', { name: 'Возвраты на производство', exact: true })).toBeVisible();
  await expect(page.locator('.returns-screen .premium-kpi-card')).toHaveCount(2);
  await expect(page.locator('.returns-screen .section-subhead h3')).toHaveCount(1);
  await page.locator('.returns-screen .premium-kpi-card').filter({ hasText: 'Архив' }).click();
  await expect(page.locator('.returns-screen .section-subhead h3')).toHaveText('Архив');
  const returnCard = page.locator('.returns-record-card').first();
  if (await returnCard.count()) {
    await expect(returnCard.locator('.okk-table-grid')).toHaveCount(0);
    await expect(returnCard.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-quality-returns.png`), fullPage: false });
});

test('defrost has only working/all modes and one operational list', async ({ page }, testInfo) => {
  await login(page);
  await openMainScreen(page, 'Оттайка');
  await expect(page.getByRole('heading', { name: 'Оттайка', exact: true })).toBeVisible();
  const modes = page.locator('.defrost-kpi-strip .premium-kpi-card');
  await expect(modes).toHaveCount(2);
  await expect(modes.nth(0)).toContainText('Линии в работе');
  await expect(modes.nth(1)).toContainText('Все линии');
  await expect(page.locator('.defrost-kpi-strip')).not.toContainText('Сегодня');
  await modes.nth(1).click();
  await expect(modes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-defrost.png`), fullPage: false });
});

test('390 and 430 widths keep operational lists inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные размеры проверяются один раз');
  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 } });
    const page = await context.newPage();
    await login(page);
    for (const screen of ['Заявки', 'ОКК', 'Возвраты на производство', 'Оттайка']) {
      await openMainScreen(page, screen);
      await noOverflow(page);
    }
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-defrost.png`), fullPage: false });
    await context.close();
  }
});
