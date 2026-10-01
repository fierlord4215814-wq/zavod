import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast4');

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

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function assertSafeBody(page: Page) {
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('MASTER sees compact wash requests and separate immediate start action', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await openScreen(page, 'Мойка');
  await expect(page.getByRole('heading', { name: 'Мойка', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать задание' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать мойку сразу' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доступные задания' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Активные мойки' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать задание' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Новое задание на мойку')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Линия', exact: true })).toBeVisible();
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-wash-request.png`), fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(dialog).toHaveCount(0);
  await noOverflow(page);
});

test('handover action is hidden outside the server window', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await openScreen(page, 'Смена');
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Передать смену', exact: true })).toHaveCount(0);
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-handover-window.png`), fullPage: true });
});

test('TECH_HOLOD uses clickable defrost KPIs and calendar timeline', async ({ page }, testInfo) => {
  await login(page, 'test-tech-holod');
  await openScreen(page, 'Оттайка');
  await expect(page.getByRole('heading', { name: 'Оттайка', exact: true })).toBeVisible();
  const kpi = page.locator('.defrost-kpi-strip');
  await expect(kpi).toBeVisible();
  await expect(kpi.getByRole('button', { name: /Линии/ })).toBeVisible();
  await expect(kpi.getByRole('button', { name: /На оттайке/ })).toBeVisible();
  await expect(kpi.getByRole('button', { name: /Сегодня/ })).toBeVisible();
  await expect(kpi.getByRole('button', { name: /Внимание/ })).toBeVisible();

  await kpi.getByRole('button', { name: /Сегодня/ }).click();
  await expect(kpi.getByRole('button', { name: /Сегодня/ })).toHaveClass(/active/);
  await kpi.getByRole('button', { name: /Линии/ }).click();
  const firstLine = page.locator('.defrost-line-card').first();
  await expect(firstLine).toBeVisible();
  await firstLine.click();
  await expect(page.getByRole('button', { name: 'К списку линий' })).toBeVisible();
  await expect(page.locator('.defrost-detail-card')).toBeVisible();
  await expect(page.getByText(/События:|В этот день событий нет/)).toBeVisible();
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-defrost-calendar.png`), fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(page.getByRole('button', { name: 'К списку линий' })).toHaveCount(0);
  await noOverflow(page);
});

test('390 and 430 layouts keep wash and defrost controls inside viewport', async ({ browser }) => {
  for (const width of [390, 430]) {
    const context = await browser.newContext({ baseURL: frontendUrl, viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, 'pilot-master-1');
    await openScreen(page, 'Мойка');
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-wash.png`), fullPage: true });
    await login(page, 'test-tech-holod');
    await openScreen(page, 'Оттайка');
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-defrost.png`), fullPage: true });
    await context.close();
  }
});
