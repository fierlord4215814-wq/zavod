import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v3-screenshots', 'plast3');

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
  await expect(page.getByText('Онлайн', { exact: false }).first()).toBeVisible();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
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

async function requestMobileBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('people and delegation use compact cards and searchable sheets', async ({ page }, testInfo) => {
  await login(page);
  await openMainScreen(page, 'Люди');
  await expect(page.getByRole('heading', { name: 'Люди', exact: true })).toBeVisible();

  const peopleRows = page.locator('.people-compact-row');
  await expect(peopleRows.first()).toBeVisible();
  expect(await peopleRows.count()).toBeGreaterThan(0);
  const worker = peopleRows.filter({ hasText: 'Работник 1' }).first();
  await expect(worker).toBeVisible();
  await expect(worker.locator('.people-compact-row-copy')).toContainText('Работник');
  await worker.click();

  const profile = page.getByRole('dialog').filter({ hasText: 'Карточка сотрудника' });
  await expect(profile).toBeVisible();
  await expect(profile.locator('.profile-title-panel-with-photo')).toBeVisible();
  await expect(profile.getByText('Завод', { exact: true })).toBeVisible();
  await expect(profile.getByText('Текущее назначение', { exact: true })).toBeVisible();
  const skills = profile.getByRole('button', { name: /Навыки по линиям/ });
  await expect(skills).toHaveAttribute('aria-expanded', 'false');
  await skills.click();
  await expect(skills).toHaveAttribute('aria-expanded', 'true');
  await expect(profile.locator('.profile-collapsible-body')).toBeVisible();
  await requestMobileBack(page);
  await expect(profile).toHaveCount(0);

  await openMainScreen(page, 'Админка');
  await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
  const triggers = page.locator('.delegation-person-trigger');
  await expect(triggers).toHaveCount(2);
  await triggers.first().click();

  const sourceDialog = page.getByRole('dialog').filter({ hasText: 'Выбрать сотрудника-образец' });
  await expect(sourceDialog).toBeVisible();
  const sourceSearch = sourceDialog.getByPlaceholder('Минимум 2 буквы или 4 цифры');
  await sourceSearch.fill('4730');
  await expect(sourceDialog.locator('.compact-person-choice').first()).toBeVisible();
  const sourceText = await sourceDialog.textContent();
  expect(sourceText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(sourceText).not.toMatch(/\bstage[-_]/i);
  await requestMobileBack(page);
  await requestMobileBack(page);
  await expect(sourceDialog).toHaveCount(0);

  await triggers.nth(1).click();
  const targetDialog = page.getByRole('dialog').filter({ hasText: 'Кому выдать права' });
  await expect(targetDialog).toBeVisible();
  await targetDialog.getByPlaceholder('Минимум 2 буквы или 4 цифры').fill('го');
  await expect(targetDialog.locator('.compact-person-choice').first()).toBeVisible();
  await requestMobileBack(page);
  await requestMobileBack(page);
  await expect(targetDialog).toHaveCount(0);

  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-people-admin.png`),
    fullPage: false,
  });
});

test('chat creation keeps direct search and group draft on Back', async ({ page }, testInfo) => {
  await login(page);
  await openMainScreen(page, 'Чаты');
  await expect(page.locator('.chats-screen')).toBeVisible();

  await page.getByRole('button', { name: 'Личный чат', exact: true }).click();
  const directDialog = page.getByRole('dialog').filter({ hasText: 'Личный чат' });
  await expect(directDialog).toBeVisible();
  const directSearch = directDialog.getByPlaceholder('Минимум 2 буквы или 4 цифры');
  await directSearch.fill('4730');
  await expect(directDialog.locator('.compact-person-choice').first()).toBeVisible();
  await directDialog.locator('.compact-person-choice').first().getByRole('button', { name: 'Выбрать', exact: true }).click();
  await expect(directDialog.getByRole('button', { name: 'Открыть чат', exact: true })).toBeEnabled();
  await directDialog.getByRole('button', { name: 'Отмена', exact: true }).click();

  await page.getByRole('button', { name: 'Создать чат', exact: true }).click();
  let groupDialog = page.getByRole('dialog').filter({ hasText: 'Создать чат' });
  await expect(groupDialog).toBeVisible();
  await groupDialog.getByPlaceholder('Группа: Запуск Пицца Рондо').fill('Смена Пицца Рондо');
  const groupSearch = groupDialog.getByPlaceholder('Минимум 2 буквы или 4 цифры');
  await groupSearch.fill('4730');
  await expect(groupDialog.locator('.compact-person-choice').first()).toBeVisible();
  await groupDialog.locator('.compact-person-choice').first().getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(groupDialog.locator('.selected-person-chip')).toHaveCount(1);
  await requestMobileBack(page);
  await expect(groupDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Создать чат', exact: true }).click();
  groupDialog = page.getByRole('dialog').filter({ hasText: 'Создать чат' });
  await expect(groupDialog.getByPlaceholder('Группа: Запуск Пицца Рондо')).toHaveValue('Смена Пицца Рондо');
  await expect(groupDialog.locator('.selected-person-chip')).toHaveCount(1);
  await groupDialog.getByRole('button', { name: 'Отмена', exact: true }).click();

  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-chat-create.png`),
    fullPage: false,
  });
});

test('four account-scoped slots keep More permanent and slot one is home', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360-edge', 'Мобильные слоты и постоянная кнопка «Ещё» проверяются в mobile shell');

  await login(page);
  await expect(page.locator('.mobile-quick-nav .mobile-quick-button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Ещё', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.locator('.mobile-sheet-item.settings-entry').click();
  const settings = page.locator('.mobile-nav-sheet').filter({ hasText: 'Быстрые разделы' });
  await expect(settings.locator('.quick-nav-slot')).toHaveCount(4);
  await settings.locator('.quick-nav-slot').first().click();
  const picker = page.locator('.quick-slot-picker-panel');
  await expect(picker).toBeVisible();
  const washOption = picker.locator('.quick-slot-option').filter({ hasText: 'Мойка' }).first();
  await expect(washOption).toBeVisible();
  await washOption.click();
  await expect(picker).toHaveCount(0);
  await settings.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Мойка', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-quick-nav .mobile-quick-button').first()).toContainText('Мойка');
  await expect(page.getByRole('button', { name: 'Ещё', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-quick-slots.png`),
    fullPage: false,
  });
});

test('390 and 430 widths keep Plast3 surfaces inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные размеры проверяются один раз');

  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 } });
    const page = await context.newPage();
    await login(page);
    await openMainScreen(page, 'Люди');
    await expect(page.locator('.people-compact-row').first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: path.join(screenshotsDir, `mobile-${width}-people.png`),
      fullPage: false,
    });
    await context.close();
  }
});
