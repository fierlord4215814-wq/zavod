import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v2-screenshots', 'stage01');

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

async function login(page: Page, userId: string, clearSession = true) {
  const factoryId = await factory4Id(userId);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(({ nextUserId, nextFactoryId, shouldClearSession }) => {
    localStorage.removeItem('zavod.authToken');
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    if (shouldClearSession) sessionStorage.clear();
  }, { nextUserId: userId, nextFactoryId: factoryId, shouldClearSession: clearSession });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function back(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('Guest role-home, draft recovery and keyboard-first Back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, 'pilot-pack-guest');
  await expect(page.getByTestId('guest-home-screen')).toBeVisible();
  await expect(page.locator('.mobile-quick-button')).toHaveCount(2);
  await expect(page.locator('.mobile-more-button')).toHaveCount(0);

  await page.locator('.mobile-quick-button').filter({ hasText: 'Сообщить об ошибке' }).click();
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();
  await page.getByLabel('Тема').fill('Черновик мобильной проверки');
  await page.getByLabel('Описание').fill('Черновик должен сохраниться внутри текущей сессии.');
  await page.getByLabel('Описание').focus();
  await back(page);
  await expect(page.getByLabel('Описание')).not.toBeFocused();
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();
  await back(page);
  await expect(page.getByTestId('guest-home-screen')).toBeVisible();

  await page.locator('.mobile-quick-button').filter({ hasText: 'Сообщить об ошибке' }).click();
  await expect(page.getByLabel('Тема')).toHaveValue('Черновик мобильной проверки');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();
  await expect(page.getByLabel('Тема')).toHaveValue('Черновик мобильной проверки');
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, 'guest-mobile-360.png'), fullPage: true });

  await login(page, 'pilot-master-1', false);
  await expect(page.getByRole('heading', { name: 'Смена' }).first()).toBeVisible();
  await expect(page.getByTestId('guest-home-screen')).toHaveCount(0);
});

test('MASTER same-session route, sheet Back and configurable quick slots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'pilot-master-1');
  await expect(page.getByRole('heading', { name: 'Смена' }).first()).toBeVisible();

  await page.locator('.mobile-quick-button').filter({ hasText: 'Заявки' }).click();
  await expect(page.getByRole('heading', { name: 'Заявки' }).first()).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Заявки' }).first()).toBeVisible();
  await back(page);
  await expect(page.getByRole('heading', { name: 'Смена' }).first()).toBeVisible();

  await page.locator('.mobile-more-button').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).last().click();
  await expect(page.locator('.mobile-nav-sheet').getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await back(page);
  await expect(page.locator('.mobile-nav-sheet').getByRole('heading', { name: 'Ещё' })).toBeVisible();
  await back(page);
  await expect(page.locator('.mobile-nav-sheet')).toHaveCount(0);

  await page.locator('.mobile-more-button').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).last().click();
  const checklistRow = page.locator('.settings-check-row').filter({ hasText: 'Чек-листы' });
  if (await checklistRow.locator('input').isChecked()) await checklistRow.locator('input').uncheck();
  const chatRow = page.locator('.settings-check-row').filter({ hasText: 'Чаты' });
  await chatRow.locator('input').check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.mobile-quick-button').filter({ hasText: 'Чаты' })).toBeVisible();

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await expectNoOverflow(page);
  }
  await page.screenshot({ path: path.join(screenshotsDir, 'master-mobile-390.png'), fullPage: true });
});
