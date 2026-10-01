import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v2-screenshots', 'stage02');

async function factory4Id(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const body = await response.json();
  const factory = body.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? body.availableFactories?.[0];
  if (!factory?.id) throw new Error(`Завод 4 недоступен для ${userId}`);
  return factory.id as string;
}

async function login(page: Page, userId: string) {
  const factoryId = await factory4Id(userId);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.removeItem('zavod.authToken');
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    sessionStorage.clear();
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Смена' }).first()).toBeVisible();
}

async function back(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('MASTER current shift uses compact working entries and sheets', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');

  const squares = page.locator('.premium-kpi-strip .shift-metric-button');
  await expect(squares).toHaveCount(4);
  for (const label of ['Линии', 'Люди', 'Простой', 'Заявки']) {
    await expect(squares.filter({ hasText: label })).toBeVisible();
  }

  const selector = page.locator('.shift-selector-compact');
  await expect(selector).toBeVisible();
  await selector.click();
  const shiftSheet = page.locator('.shift-picker-sheet');
  await expect(shiftSheet).toBeVisible();
  await expect(shiftSheet.getByText('Текущая смена', { exact: true })).toBeVisible();
  await expect(shiftSheet.getByText('Следующая смена', { exact: true })).toBeVisible();
  await expect(shiftSheet.getByText('Прошлая смена', { exact: true })).toBeVisible();
  expect(await shiftSheet.locator('.shift-picker-option').count()).toBeGreaterThanOrEqual(3);
  await back(page);
  await expect(shiftSheet).toHaveCount(0);

  await squares.filter({ hasText: 'Люди' }).click();
  const peopleSheet = page.locator('.current-people-sheet');
  await expect(peopleSheet).toBeVisible();
  await expect(peopleSheet.getByRole('heading', { name: 'На смене' })).toBeVisible();
  await expect(peopleSheet.getByRole('button', { name: 'Выбрать из неотмеченных' })).toBeVisible();
  await back(page);
  await expect(peopleSheet).toHaveCount(0);

  await squares.filter({ hasText: 'Простой' }).click();
  await expect(page.getByRole('heading', { name: 'Активные простои' })).toBeVisible();
  await squares.filter({ hasText: 'Заявки' }).click();
  await expect(page.getByRole('heading', { name: 'Заявки, требующие внимания' })).toBeVisible();
  await squares.filter({ hasText: 'Линии' }).click();
  await expect(page.getByRole('heading', { name: 'Линии текущей смены' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Остановленные линии' })).toHaveCount(0);

  const firstLine = page.locator('.current-shift-line-card').first();
  if (await firstLine.count()) {
    await expect(firstLine.getByRole('button', { name: 'Простой' })).toBeVisible();
    await expect(firstLine.getByRole('button', { name: 'Остановить' })).toBeVisible();
    await expect(firstLine.getByRole('button', { name: 'Подробнее' })).toBeVisible();
    await expect(firstLine.getByRole('button', { name: 'План' })).toBeVisible();
    await expect(firstLine.locator('.line-people-count')).toContainText('Люди');
  }

  if (testInfo.project.name.includes('mobile')) {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      await expectNoOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, `master-current-shift-${width}.png`), fullPage: true });
    }
  } else {
    await expectNoOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, 'master-current-shift-desktop.png'), fullPage: true });
  }
});

test('WORKER gets compact read-only line cards without assignment controls', async ({ page }) => {
  await login(page, 'pilot-worker-1');
  await expect(page.locator('.shift-metric-button')).toHaveCount(0);
  const readonly = page.getByTestId('shift-readonly-lines');
  await expect(readonly).toBeVisible();
  await expect(readonly.getByRole('heading', { name: 'Остановленные линии' })).toHaveCount(0);

  const line = readonly.locator('.current-shift-line-card').first();
  if (await line.count()) {
    await expect(line.getByRole('button', { name: 'Подробнее' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Остановить' })).toHaveCount(0);
    await line.getByRole('button', { name: 'Подробнее' }).click();
    await expect(page.locator('.line-dashboard-card')).toBeVisible();
    await expect(page.locator('.line-dashboard-card #active-template')).toHaveCount(0);
    await expect(page.locator('.line-dashboard-card .assignment-board')).toHaveCount(0);
    await back(page);
    await expect(page.locator('.line-dashboard-card')).toHaveCount(0);
  }
  await expectNoOverflow(page);
});
