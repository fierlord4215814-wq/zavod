import { expect, Page, test } from '@playwright/test';

const backendUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';

async function loginAs(page: Page, userId: string) {
  const response = await fetch(`${backendUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  expect(response.ok).toBeTruthy();
  const login = await response.json() as { recommendedFactoryId?: string | null; availableFactories?: Array<{ id: string }> };
  const factoryId = login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
  expect(factoryId).toBeTruthy();

  await page.goto('/');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Завод' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ещё' })).toBeVisible();
}

async function openMobileSection(page: Page, label: string) {
  const direct = page.getByRole('button', { name: label, exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }

  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const sheetItem = page.getByRole('button', { name: label, exact: true });
  await expect(sheetItem).toBeVisible();
  await sheetItem.click();
}

test.describe('v1 mobile navigation visual audit', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Достаточно Chromium-проверки для visual smoke.');

  test('mobile 360: вход и выбор завода без технических подписей и raw-ролей', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Проверка относится к mobile viewport.');

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('zavod.devUserId');
      localStorage.removeItem('zavod.selectedFactoryId');
      localStorage.removeItem('zavod.authToken');
    });
    await page.reload();

    await expect(page.getByText('Тестовый пользователь')).toBeVisible();
    await expect(page.getByText('Локальный вход только для автопроверок и диагностики.')).toBeVisible();
    await expect(page.getByText('Dev-пользователь')).toHaveCount(0);
    await expect(page.getByText('regression')).toHaveCount(0);

    await page.locator('#dev-user-id').fill('test-admin');
    const devForm = page.locator('form').filter({ has: page.locator('#dev-user-id') });
    await devForm.getByRole('button', { name: 'Войти' }).click();
    const factoryButtons = page.getByRole('button', { name: 'Выбрать завод' });
    await expect(factoryButtons).toHaveCount(1);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\b(ADMIN|MASTER|MANAGEMENT|WORKER|CONTRACTOR)\b/);
    expect(bodyText).not.toMatch(/Quality cross|cross factory|stage\d+/i);
    expect(bodyText).toContain('Администратор');

    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(8);
  });

  test('mobile 360: Ещё не перекрывает нижний контент и работает после объявлений', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Проверка относится к mobile viewport.');

    await page.setViewportSize({ width: 360, height: 740 });
    await loginAs(page, 'test-admin');

    const moreBox = await page.getByRole('button', { name: 'Ещё', exact: true }).boundingBox();
    expect(moreBox).not.toBeNull();
    expect(moreBox!.y).toBeLessThan(320);
    expect(moreBox!.y + moreBox!.height).toBeLessThan(330);

    let overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(8);

    await openMobileSection(page, 'Объявления');
    await expect(page.getByRole('heading', { name: 'Объявления' })).toBeVisible();

    await openMobileSection(page, 'Чаты');
    await expect(page.getByRole('heading', { name: 'Чаты' })).toBeVisible();

    await openMobileSection(page, 'Сообщить об ошибке');
    await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();

    overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(8);
  });
});
