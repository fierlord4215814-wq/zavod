import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage37Dialogs', {
      value: calls,
      configurable: true,
    });
    window.alert = (message?: unknown) => {
      calls.push(`alert:${String(message ?? '')}`);
    };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage37Dialogs?: string[] }).__stage37Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function loginAs(page: Page, userId: string) {
  await page.goto('/');
  await expect(page.locator('#login-phone')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#dev-user-id')).toBeVisible();
  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const clicked = await page.evaluate((source) => {
    const re = new RegExp(source);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.bottom-nav button'));
    const button = buttons.find((item) => re.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  }, typeof label === 'string' ? label : label.source);
  if (!clicked) {
    await page.locator('.bottom-nav').getByRole('button', { name: label }).first().click({ force: true });
  }
  await expectStableRussianPage(page);
}

async function openFirstLineCalendar(page: Page) {
  const kotlety = page.locator('.defrost-line-card').filter({ hasText: /Котлет/ }).first();
  if (await kotlety.count()) {
    await kotlety.click();
  } else {
    await page.locator('.defrost-line-card').first().click();
  }
  await expect(page.locator('.defrost-calendar-grid')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('body')).toContainText('Поставили на оттайку');
  await expect(page.locator('body')).toContainText('Запустили в работу');
  await expectStableRussianPage(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN, MASTER и WORKER открывают список линий оттайки на чтение', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полная ролевая проверка оттайки выполняется в desktop-проекте.');

  for (const userId of ['test-admin', 'test-master', 'worker-1']) {
    await loginAs(page, userId);
    await openMenuItem(page, /Оттайка/);
    await expect(page.getByRole('heading', { name: 'Оттайка' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Быстрая фиксация оттайки и запуска в работу');
    await expect(page.locator('body')).toContainText('Обдувов с последней оттайки');
    await expect(page.locator('.defrost-line-card').first()).toBeVisible({ timeout: 20000 });
    await openFirstLineCalendar(page);
    await page.getByRole('button', { name: 'К списку линий' }).click();
    await expect(page.locator('.defrost-line-card').first()).toBeVisible();
    await expectNoDialogs(page);
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.locator('#dev-user-id')).toBeVisible();
  }
});

test('TECH_HOLOD видит сегодняшние действия, а WORKER видит календарь только для чтения', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Проверка действий оттайки выполняется в desktop-проекте.');

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Оттайка/);
  await expect(page.getByRole('button', { name: 'Поставить на оттайку' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обдул шоковую камеру' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить в работу' })).toBeVisible();
  await openFirstLineCalendar(page);
  await expect(page.locator('body')).toContainText('Поставили на оттайку');
  await expect(page.locator('body')).toContainText('Запустили в работу');
  await expect(page.locator('body')).toContainText('Обдули шоковую камеру');
  await expectNoDialogs(page);
  await page.getByRole('button', { name: 'Выйти' }).click();

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Оттайка/);
  await expect(page.getByRole('button', { name: 'Поставить на оттайку' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обдул шоковую камеру' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Запустить в работу' })).toHaveCount(0);
  await openFirstLineCalendar(page);
  await expect(page.locator('body')).toContainText('Поставили на оттайку');
  await expect(page.locator('body')).toContainText('Запустили в работу');
  await expect(page.locator('body')).toContainText('Редактировать может только холодильная служба');
  await expectNoDialogs(page);
});

test('mobile 360px: календарь оттайки читается без горизонтального переполнения', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage37 выполняется только в mobile-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Оттайка/);
  await expect(page.locator('.defrost-line-card').first()).toBeVisible({ timeout: 20000 });
  await expectNoHorizontalOverflow(page);
  await openFirstLineCalendar(page);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.defrost-detail-card')).toBeVisible();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
