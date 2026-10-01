import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage36Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage36Dialogs?: string[] }).__stage36Dialogs ?? []);
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

async function logout(page: Page) {
  await openMenuItem(page, /Настройки/);
  await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await expect(page.locator('#dev-user-id')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function clickAdminSection(page: Page, section: string) {
  const clicked = await page.evaluate((target) => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-section-nav button'));
    const button = buttons.find((item) => item.innerText.trim() === target);
    if (!button) return false;
    button.click();
    return true;
  }, section);
  expect(clicked).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN: админка открывает заводы, роли, пользователей, линии и настройки', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный desktop smoke админки выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Администрирование/);

  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Заводы');
  await expect(page.locator('body')).toContainText('Отделы и службы');

  for (const section of ['Пользователи и доступы', 'Роли и права', 'Линии и позиции', 'Шаблоны состава', 'Повременщики / рабочие зоны', 'Настройки модулей', 'Аудит действий админки']) {
    await clickAdminSection(page, section);
    await expect(page.locator('body')).toContainText(section);
    await expectStableRussianPage(page);
  }

  await clickAdminSection(page, 'Заводы');
  await expect(page.getByRole('button', { name: 'Создать завод', exact: true })).toBeVisible();
  const marker = Date.now();
  const factoryName = `Stage36 браузер ${marker}`;
  const factoryCode = `stage36-browser-${marker}`;
  await page.getByLabel('Название завода', { exact: true }).fill(factoryName);
  await page.getByLabel('Короткий код', { exact: true }).fill(factoryCode);
  await page.getByLabel('Площадка / комментарий', { exact: true }).fill('Stage36 Playwright проверка');
  await page.getByRole('button', { name: 'Создать завод', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Создать завод');
  await page.locator('#admin-confirm-text').fill('ЗАВОД');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.locator('body')).toContainText(factoryName, { timeout: 15000 });

  await page.getByRole('button', { name: 'Показать диагностику заводов' }).click();
  await page.getByRole('button', { name: new RegExp(factoryName) }).click();
  const deactivate = page.getByRole('button', { name: 'Деактивировать' }).first();
  await expect(deactivate).toBeVisible();
  await deactivate.click();
  await expect(page.getByRole('dialog')).toContainText(`Деактивировать ${factoryName}`);
  await page.locator('#admin-confirm-text').fill('ЗАВОД');
  await page.getByRole('dialog').getByLabel('Причина').fill('Stage36 Playwright проверка завершена');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.locator('body')).toContainText('Отключён', { timeout: 15000 });

  await expectNoDialogs(page);
  await logout(page);
});

test('non-admin: worker не получает админку через меню', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop role visibility админки выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  const menu = (await page.locator('.bottom-nav button').allInnerTexts()).join('\n');
  expect(menu).not.toMatch(/Администрирование/);
  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px: админка читаема и не имеет горизонтального переполнения', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage36 выполняется только в mobile-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Администрирование/);
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  await expect(page.locator('.admin-section-nav').first()).toBeVisible({ timeout: 20000 });
  await expectNoHorizontalOverflow(page);

  for (const section of ['Заводы', 'Пользователи и доступы', 'Роли и права', 'Настройки модулей']) {
    await clickAdminSection(page, section);
    await expectStableRussianPage(page);
    await expectNoHorizontalOverflow(page);
  }

  await expectNoDialogs(page);
});
