import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v3-screenshots', 'plast2');
const operatorId = 'test-admin';

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: operatorId }),
  });
  if (!response.ok) throw new Error(`dev-login ${operatorId}: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 недоступен администратору');

  await page.goto(frontendUrl);
  await page.evaluate(({ factoryId, userId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { factoryId: factory.id, userId: operatorId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByText('Онлайн', { exact: false }).first()).toBeVisible();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function openPizzaDetail(page: Page) {
  const lineCard = page.locator('article.current-shift-line-card').filter({
    has: page.getByRole('heading', { name: 'Пицца Цезарь', exact: true }),
  });
  await expect(lineCard).toHaveCount(1);
  await lineCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const detail = page.locator('.compact-line-dashboard');
  await expect(detail).toBeVisible();
  return detail;
}

async function requestMobileBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('compact line detail keeps actions and focused assignment hierarchy', async ({ page }, testInfo) => {
  await login(page);
  const detail = await openPizzaDetail(page);

  await expect(detail.locator('.line-dashboard-kpis')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Позиции', exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Все действия', exact: true })).toBeVisible();
  await expect(detail.locator('#line-candidate-picker')).toHaveCount(0);

  const slots = detail.locator('.compact-slot-row');
  expect(await slots.count()).toBeGreaterThan(0);
  const firstFreeSlot = slots.filter({
    has: page.getByRole('button', { name: 'Назначить', exact: true }),
  }).first();
  await expect(firstFreeSlot).toBeVisible();
  await firstFreeSlot.getByRole('button', { name: 'Назначить', exact: true }).click();

  await expect(detail.locator('#line-candidate-picker')).toBeVisible();
  await expect(detail.locator('.line-candidate-actions')).toBeVisible();
  await expect(detail.locator('.line-dashboard-footer')).toHaveCount(0);
  await requestMobileBack(page);
  await expect(detail.locator('#line-candidate-picker')).toHaveCount(0);
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: 'Все действия', exact: true }).click();
  const actionSheet = page.locator('.line-action-options');
  await expect(actionSheet).toBeVisible();
  await expect(actionSheet.getByText('Срочная заявка', { exact: true })).toBeVisible();
  await expect(
    actionSheet.getByText('Начать мойку', { exact: true })
      .or(actionSheet.getByText('Мойка уже активна', { exact: true })),
  ).toBeVisible();
  await expect(actionSheet.getByText('Завершить смену линии', { exact: true })).toBeVisible();
  await requestMobileBack(page);
  await expect(actionSheet).toHaveCount(0);
  await expect(detail).toBeVisible();

  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-compact-line-detail.png`),
    fullPage: false,
  });
});

test('person-first wizard has four destinations and canonical work-area positions', async ({ page }, testInfo) => {
  await login(page);
  const peopleMetric = page.getByRole('button', { name: /Люди \d+$/ });
  await expect(peopleMetric).toHaveCount(1);
  await peopleMetric.click();

  const peopleDialog = page.getByRole('dialog', { name: 'На смене', exact: true });
  await expect(peopleDialog).toBeVisible();
  const assignableCards = peopleDialog.locator('article').filter({
    has: page.getByRole('button', { name: 'Назначить', exact: true }),
  });
  expect(await assignableCards.count()).toBeGreaterThan(0);
  await assignableCards.first().getByRole('button', { name: 'Назначить', exact: true }).click();

  const targetSheet = page.getByRole('dialog').filter({ hasText: 'Куда назначить?' });
  await expect(targetSheet).toBeVisible();
  for (const label of [
    /^Линия \/ слот линии/,
    /^Мойка/,
    /^Рабочая зона \/ повременщики/,
    /^Отправить домой/,
  ]) {
    await expect(targetSheet.getByRole('button', { name: label })).toBeVisible();
  }
  await expect(targetSheet.getByText('Backend', { exact: false })).toHaveCount(0);

  await targetSheet.getByRole('button', { name: /^Рабочая зона \/ повременщики/ }).click();
  const workArea = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Повременщики', exact: true }),
  });
  await expect(workArea).toBeVisible();
  expect(await workArea.locator('.compact-slot-row').count()).toBeGreaterThanOrEqual(9);
  for (const position of [
    'Оператор-наладчик',
    'Грузчик склада',
    'Грузчик',
    'Водитель погрузчика',
    'Уборщица',
    'Мойка тары',
    'Жарщик',
  ]) {
    await expect(workArea.getByText(new RegExp(`^${position} #\\d+$`)).first()).toBeVisible();
  }

  await requestMobileBack(page);
  await expect(workArea).toHaveCount(0);
  await expect(page.getByRole('dialog').filter({ hasText: 'Куда назначить?' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-assignment-targets.png`),
    fullPage: false,
  });
});

test('390 and 430 widths keep compact line detail inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные размеры проверяются один раз');

  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 } });
    const page = await context.newPage();
    await login(page);
    const detail = await openPizzaDetail(page);
    await expect(detail).toBeVisible();
    await noOverflow(page);
    const box = await detail.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: path.join(screenshotsDir, `mobile-${width}-compact-line-detail.png`),
      fullPage: false,
    });
    await context.close();
  }
});
