import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage35Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage35Dialogs?: string[] }).__stage35Dialogs ?? []);
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
      await page.getByRole('button', { name: label }).first().click();
    }
  }
  await expectStableRussianPage(page);
}

async function visibleMenuText(page: Page) {
  return (await page.locator('.bottom-nav button').allInnerTexts()).join('\n');
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

test('Line UX: активный список, запуск линии и безопасная смена статуса', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop UX-проверка линий выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Линии/);

  await expect(page.locator('body')).toContainText('Активные линии');
  await expect(page.getByRole('button', { name: 'Запустить линию' })).toBeVisible();
  await expect(page.locator('body')).toContainText(/Дашборд линии|Активных линий пока нет/);

  await page.getByRole('button', { name: 'Запустить линию' }).click();
  await expect(page.getByRole('dialog')).toContainText('Запустить линию');
  await expect(page.getByRole('dialog')).toContainText(/Выберите неактивную линию|Неактивных линий нет/);
  await page.getByRole('button', { name: 'Отмена' }).click();

  const pauseButton = page.getByRole('button', { name: 'Простой' }).first();
  if ((await pauseButton.count()) > 0) {
    await pauseButton.click();
    await expect(page.getByRole('dialog')).toContainText(/Изменить статус|Простой/);
    await expect(page.getByRole('dialog')).toContainText('Комментарий');
    await page.getByRole('button', { name: 'Отмена' }).click();
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('Role visibility: worker и contractor lead не получают управленческие действия', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop role visibility выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  const workerMenu = await visibleMenuText(page);
  expect(workerMenu).not.toMatch(/Администрирование|Линии|Статистика \/ Аудит|ОКК/);
  await expect(page.locator('body')).not.toContainText(/Назначить на линию|Отправить домой/);
  await logout(page);

  await loginAs(page, 'contractor-lead-1');
  await openMenuItem(page, /Смена/);
  const contractorMenu = await visibleMenuText(page);
  expect(contractorMenu).not.toMatch(/Администрирование|Линии|Статистика \/ Аудит/);
  await expect(page.locator('body')).not.toContainText(/Доска назначений|Назначить на линию/);
  await expectNoDialogs(page);
  await logout(page);
});

test('Notifications UX: группы, severity, read-all и звук только вручную', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop notifications UX выполняется в desktop-проекте.');

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Уведомления/);

  await expect(page.locator('body')).toContainText('Уведомления');
  await expect(page.locator('body')).toContainText(/Новые|Сегодня|Ранее|Уведомлений нет/);
  await expect(page.getByRole('button', { name: /Звук уведомлений:/ })).toBeVisible();
  await page.getByRole('button', { name: /Звук уведомлений:/ }).click();
  await expect(page.getByRole('button', { name: /Проверить звук/ })).toBeVisible();
  await page.getByRole('button', { name: /Звук уведомлений:/ }).click();

  const readAll = page.getByRole('button', { name: 'Прочитать всё' });
  await expect(readAll).toBeVisible();
  if (await readAll.isEnabled()) {
    await readAll.click();
    await expectStableRussianPage(page);
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px: линии, уведомления и опасные рабочие экраны без overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage35 выполняется только в mobile-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Линии/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Смена/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Уведомления/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты на производство/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Чаты/);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});
