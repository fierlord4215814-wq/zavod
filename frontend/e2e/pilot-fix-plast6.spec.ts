import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast6');

async function factory4Id(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`dev-login ${userId}: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 unavailable for ${userId}`);
  return factory.id as string;
}

async function login(page: Page, userId: string) {
  const factoryId = await factory4Id(userId);
  await page.goto(frontendUrl);
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openScreen(page: Page, label: string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await page.locator('.mobile-more-button:visible').click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectSafeRussianUi(page: Page) {
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/);
  await expect(page.locator('.ops-analytics')).not.toContainText(/Просроченн\w* LONG|STOP|PAUSE|WORK/);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('management analytics is compact, Russian and explicit about preliminary data', async ({ page }, testInfo) => {
  await login(page, 'test-management');
  await openScreen(page, 'Статистика');
  await expect(page.getByRole('heading', { name: 'Статистика / Аудит' })).toBeVisible();
  await expect(page.getByText('Потеряно времени:', { exact: false })).toBeVisible();
  await expect(page.getByText('Остановки', { exact: true })).toBeVisible();
  await expect(page.getByText('Паузы', { exact: true })).toBeVisible();
  await expect(page.getByText('Возвраты в работу', { exact: true })).toBeVisible();
  await expect(page.getByText('Заявки из простоя', { exact: true })).toBeVisible();
  await expect(page.locator('.ops-advanced-filters')).toBeVisible();
  await page.locator('.ops-advanced-filters summary').click();
  await expect(page.getByLabel('Какие заявки учитывать')).toBeVisible();
  await expectNoOverflow(page);
  await expectSafeRussianUi(page);
  if ((testInfo.project.use.viewport as { width?: number } | undefined)?.width === 360) {
    const columns = await page.locator('.ops-analytics .premium-kpi-strip').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
  }
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-analytics.png`), fullPage: true });
});

test('admin permission search and menu preview share canonical role visibility', async ({ page }, testInfo) => {
  await login(page, 'test-admin');
  await openScreen(page, 'Админка');
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  await page.locator('.admin-section-nav button').filter({ hasText: 'Роли и права' }).first().click();
  await expect(page.getByRole('heading', { name: 'Роли и права' })).toBeVisible();
  await expect(page.getByLabel('Предпросмотр меню роли')).toBeVisible();
  await page.getByLabel('Поиск права').fill('заявки');
  await expect(page.locator('.permission-group').first()).toBeVisible();
  await expect(page.locator('.permission-grid')).toContainText('Заявки');
  await page.getByRole('button', { name: 'Выбрать показанные' }).click();
  await expect(page.getByLabel('Предпросмотр меню роли')).toContainText('Заявки');
  await page.getByRole('button', { name: 'Очистить показанные' }).click();
  await expectNoOverflow(page);
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-admin-permissions.png`), fullPage: true });
});

test('analytics remains readable at 390 and 430 pixels', async ({ browser }) => {
  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, 'test-management');
    await openScreen(page, 'Статистика');
    await expect(page.getByRole('heading', { name: 'Статистика / Аудит' })).toBeVisible();
    await expectNoOverflow(page);
    const columns = await page.locator('.ops-analytics .premium-kpi-strip').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-analytics.png`), fullPage: true });
    await context.close();
  }
});
