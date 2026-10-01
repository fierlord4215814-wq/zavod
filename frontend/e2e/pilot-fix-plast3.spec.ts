import { Browser, expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const contractorLeadId = process.env.PLAST3_CONTRACTOR_LEAD_ID || 'contractor-lead-1';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast3');

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

async function assertStickyNavigation(page: Page) {
  const nav = page.locator('.bottom-nav:visible, .mobile-quick-nav:visible');
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 2);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('MASTER uses canonical current/future assignment workspace', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await openScreen(page, 'Смена');
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Линии текущей смены', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Повременщики и рабочие зоны', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Открыть повременщиков|Открыть рабочую зону/ }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Свободный текст должности');
  await noOverflow(page);
  await assertSafeBody(page);
  await assertStickyNavigation(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-master-workspace.png`), fullPage: true });
});

test('TECH_* sees lines, people and TIME positions without mutations', async ({ page }, testInfo) => {
  await login(page, 'pilot-tech-kipia-1');
  await openScreen(page, 'Смена');
  await expect(page.locator('[data-testid="shift-readonly-lines"]')).toBeVisible();
  await expect(page.locator('[data-testid="shift-readonly-time-areas"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Люди текущей смены' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить / добавить линию в смену' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'На линию', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Открыть повременщиков|Открыть рабочую зону/ })).toHaveCount(0);
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-tech-readonly.png`), fullPage: true });
});

test('STORE People screen contains only free people and TIME positions', async ({ page }, testInfo) => {
  await login(page, 'pilot-store-1');
  await openScreen(page, 'Люди');
  await expect(page.getByRole('heading', { name: 'Люди', exact: true })).toBeVisible();
  await expect(page.getByText('Свободные работники и позиции повременщиков текущего завода.')).toBeVisible();
  await expect(page.locator('[data-testid="store-time-areas"]')).toBeVisible();
  await expect(page.getByText('Все роли', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'На линию', exact: true })).toHaveCount(0);
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-store-free-time.png`), fullPage: true });
});

test('WORKER sees safe line/TIME overview and only own shift controls', async ({ page }, testInfo) => {
  await login(page, 'pilot-worker-1');
  await openScreen(page, 'Смена');
  await expect(page.locator('[data-testid="shift-readonly-lines"]')).toBeVisible();
  await expect(page.locator('[data-testid="shift-readonly-time-areas"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Моя смена' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить / добавить линию в смену' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'На линию', exact: true })).toHaveCount(0);
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-worker-readonly.png`), fullPage: true });
});

test('CONTRACTOR_LEAD has one company-scoped plan/fact workbench', async ({ page }, testInfo) => {
  await login(page, contractorLeadId);
  await openScreen(page, 'Смена');
  const workbench = page.locator('.contractor-lead-workbench');
  await expect(workbench).toBeVisible();
  await expect(workbench.getByText('только ваша фирма', { exact: false })).toBeVisible();
  await expect(workbench.getByRole('heading', { name: 'Текущая смена' })).toBeVisible();
  await expect(workbench.getByRole('heading', { name: 'Следующая смена' })).toBeVisible();
  await expect(workbench.getByText('Факт', { exact: true })).toBeVisible();
  await expect(workbench.getByText('План', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'На линию', exact: true })).toHaveCount(0);
  await noOverflow(page);
  await assertSafeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-contractor-lead.png`), fullPage: true });
});

test('390/430 layouts, common Android Back and sticky navigation stay stable', async ({ browser }) => {
  for (const width of [390, 430]) {
    const context = await browser.newContext({ baseURL: frontendUrl, viewport: { width, height: 860 } });
    const page = await context.newPage();
    await login(page, 'pilot-worker-1');
    await openScreen(page, 'Смена');
    await noOverflow(page);
    await assertStickyNavigation(page);
    const more = page.locator('.mobile-more-button:visible');
    if (await more.count()) {
      await more.click();
      await expect(page.locator('.mobile-nav-sheet')).toBeVisible();
      await page.goBack();
      await expect(page.locator('.mobile-nav-sheet')).toHaveCount(0);
    }
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-worker.png`), fullPage: true });
    await context.close();
  }
});
