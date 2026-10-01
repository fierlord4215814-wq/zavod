import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Forbidden|Access denied|No data|Settings|Overview|Events|Save|Cancel|Network unavailable|Action queued|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function expectCleanRussianUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage31Dialogs', {
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
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage31Dialogs?: string[] }).__stage31Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function loginAs(page: Page, userId: string) {
  await page.goto('/');
  await expect(page.locator('#login-phone')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#dev-user-id')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' }).first()).toBeVisible();

  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await expectCleanRussianUi(page);
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.locator('#dev-user-id')).toBeVisible();
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const directItem = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await directItem.count()) > 0) {
    await directItem.first().click();
  } else {
    const moreButton = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
    if ((await moreButton.count()) > 0) {
      await moreButton.first().click();
      await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    } else {
      await page.getByRole('button', { name: label }).click();
    }
  }
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  await expectCleanRussianUi(page);
}

async function visibleMenuLabels(page: Page) {
  return page.locator('.bottom-nav button').allInnerTexts();
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещённый браузерный dialog: ${dialog.type()} ${dialog.message()}`);
  });
});

test('login screen, dev-login, factory select and ADMIN smoke', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Админский глубокий smoke выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Администрирование/);
  await openMenuItem(page, /Уведомления/);
  await openMenuItem(page, /Статистика \/ Аудит/);
  await expectNoDialogs(page);
  await logout(page);
});

test('MASTER рабочие экраны открываются без падений', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Мастерский глубокий smoke выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  await openMenuItem(page, /Линии/);
  await openMenuItem(page, /Заявки/);
  await openMenuItem(page, /Мойка/);
  await expectNoDialogs(page);
  await logout(page);
});

test('WORKER видит self-view и не видит управленческие разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Worker RBAC smoke выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  const labels = await visibleMenuLabels(page);
  const joined = labels.join('\n');
  expect(joined).not.toMatch(/Администрирование|Статистика \/ Аудит|ОКК|Мойка/);
  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px smoke для ADMIN, MASTER и WORKER', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильный smoke выполняется только в mobile-проекте.');

  for (const [userId, labels] of [
    ['test-admin', [/Администрирование/, /Уведомления/]],
    ['test-master', [/Смена/, /Линии/]],
    ['worker-1', [/Смена/]],
  ] as const) {
    await loginAs(page, userId);
    for (const label of labels) {
      await openMenuItem(page, label);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(8);
    }
    await expectNoDialogs(page);
    await logout(page);
  }
});
