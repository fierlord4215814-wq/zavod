import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v2-screenshots', 'stage03');

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

async function navigate(page: Page, screen: string) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
}

async function openNextShift(page: Page) {
  await page.locator('.shift-selector-compact').click();
  const sheet = page.locator('.shift-picker-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByText('Следующая смена', { exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('MASTER sees a complete future-shift planning summary', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await openNextShift(page);

  const metrics = page.locator('.future-plan-metrics .metric-card');
  await expect(metrics).toHaveCount(8);
  for (const label of ['Линий в плане', 'Нужно по слотам', 'Подтвердили «Я буду»', 'Распределено', 'Подтвердили без места', 'Назначены без ответа', 'Дефицит', 'Избыток']) {
    await expect(metrics.filter({ hasText: label })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Следующая смена' }).first()).toBeVisible();
  await expectNoOverflow(page);

  if (testInfo.project.name.includes('mobile')) {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      await expectNoOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, `master-future-${width}.png`), fullPage: true });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'master-future-desktop.png'), fullPage: true });
  }
});

test('WORKER receives safe future details and a personal calendar archive', async ({ page }, testInfo) => {
  await login(page, 'pilot-worker-1');
  await openNextShift(page);

  await expect(page.getByText(/Моё место|Место ещё не определено/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Не вызывать' })).toHaveCount(0);
  await expect(page.locator('.assignment-board')).toHaveCount(0);
  await expectNoOverflow(page);

  await navigate(page, 'ShiftHistory');
  const history = page.getByTestId('worker-shift-history');
  await expect(history).toBeVisible();
  await expect(history.getByRole('heading', { name: 'История смен' })).toBeVisible();
  await expect(history.locator('.shift-history-calendar-grid')).toBeVisible();
  await expect.poll(() => history.locator('.shift-history-day').count()).toBeGreaterThan(20);
  await expect.poll(() => history.locator('.shift-history-day:not(:disabled)').count()).toBeGreaterThan(0);
  await expect(history.getByText('День', { exact: true })).toBeVisible();
  await expect(history.getByText('Ночь', { exact: true })).toBeVisible();
  await expectNoOverflow(page);

  const activeDay = history.locator('.shift-history-day:not(:disabled)').first();
  if (await activeDay.count()) {
    await activeDay.click();
    const shiftChoice = history.locator('.shift-history-choice-actions button').first();
    if (await shiftChoice.count()) await shiftChoice.click();
    const detail = history.locator('[data-history-scope="SELF"]');
    if (await detail.count()) {
      await expect(detail).toBeVisible();
      await expect(detail).not.toContainText('Простои');
      await expect(detail).not.toContainText('Заявки');
    }
  }
  await expectNoOverflow(page);

  if (testInfo.project.name.includes('mobile')) {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      await expectNoOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, `worker-history-${width}.png`), fullPage: true });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'worker-history-desktop.png'), fullPage: true });
  }
});
