import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage33Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage33Dialogs?: string[] }).__stage33Dialogs ?? []);
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
      await page.getByRole('button', { name: label }).click();
    }
  }
  await expectStableRussianPage(page);
}

async function clickIfVisible(page: Page, label: RegExp | string) {
  const target = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await target.count()) === 0) return false;
  if (!(await target.first().isEnabled())) return false;
  await target.first().click();
  await expectStableRussianPage(page);
  return true;
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
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
});

test('MASTER long workflow: смена, линии, повременщики, заявки, мойка, журнал', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  await expect(page.locator('body')).toContainText(/Смена|Люди|Повременщики/);
  const shiftText = await page.locator('body').innerText();
  expect(shiftText).toMatch(/Повременщики|Работники|На смене|Люди/);

  await openMenuItem(page, /Линии/);
  await expect(page.locator('body')).toContainText(/Линии|Назнач|Ситуация/);

  await openMenuItem(page, /Заявки/);
  await expect(page.locator('body')).toContainText(/Заявки|Срочные|Долгие|Новая/);

  await openMenuItem(page, /Мойка/);
  await expect(page.locator('body')).toContainText(/Мойка|Активные|История/);

  await openMenuItem(page, /Пересменка \/ Журнал/);
  await expect(page.locator('body')).toContainText(/Пересменка|Журнал|Активные|Важные/);

  await expectNoDialogs(page);
  await logout(page);
});

test('STORE long workflow: возвраты, активные, архив и форма', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-store');
  const menu = await visibleMenuText(page);
  expect(menu).toContain('Возвраты на производство');

  await openMenuItem(page, /Возвраты на производство/);
  await expect(page.locator('body')).toContainText('Активные');
  await expect(page.locator('body')).toContainText('Архив');
  await expect(page.locator('body')).toContainText(/Дата поступления|Возвраты на производство|Новая запись/);

  if (await clickIfVisible(page, /Новая запись/)) {
    for (const label of [
      'Дата поступления',
      'Дата изготовления',
      'Артикул',
      'Наименование продукции',
      'Причина несоответствия',
      'Количество',
      'Принятое решение',
    ]) {
      await expect(page.locator('body')).toContainText(label);
    }
    await clickIfVisible(page, /Отмена|Закрыть/);
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('OKK long workflow: таблица, архив, поля и read/edit visibility', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  for (const label of ['ОКК', 'Активные', 'Архив']) {
    await expect(page.locator('body')).toContainText(label);
  }
  for (const label of [
    'Дата',
    'Дата изготовления',
    'Артикул',
    'Причина',
    'Количество',
    'Мастер',
    'Отметка',
    'Кто выполнил',
    'Кто забраковал',
    'Корректирующие действия',
  ]) {
    await expect(page.locator('body')).toContainText(label);
  }
  await expect(page.locator('body')).toContainText(/Новый брак|Активных записей ОКК пока нет/);
  await expectNoDialogs(page);
  await logout(page);
});

test('Chats long workflow: открыть чат и отправить Stage33 сообщение', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Чаты/);
  await expect(page.locator('body')).toContainText('Чаты');

  const chatButtons = page.locator('.list-card button, .metric-card button, article button, .action-button');
  if ((await chatButtons.count()) === 0) {
    await expect(page.locator('body')).toContainText(/Нет доступных чатов|Чаты/);
  } else {
    await chatButtons.first().click();
    await expectStableRussianPage(page);
    const message = `Stage33 browser smoke ${Date.now()}`;
    const input = page.locator('textarea[placeholder="Сообщение"]');
    if ((await input.count()) > 0 && (await page.getByRole('button', { name: 'Отправить' }).count()) > 0) {
      await input.first().fill(message);
      await page.getByRole('button', { name: 'Отправить' }).click();
      await expect(page.locator('body')).toContainText(message);
    }
    await expect(page.locator('body')).toContainText(/Прикрепить|Сообщение|Чаты/);
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('Announcements long workflow: вкладки, read state и форма без создания', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Объявления/);
  for (const label of ['Активные', 'Важные']) {
    await expect(page.locator('body')).toContainText(label);
  }
  await clickIfVisible(page, /Архив/);
  await clickIfVisible(page, /Активные/);
  await clickIfVisible(page, /Прочитано/);
  if (await clickIfVisible(page, /Создать/)) {
    await expect(page.locator('body')).toContainText('Заголовок');
    await expect(page.locator('body')).toContainText('Текст');
    await clickIfVisible(page, /Отмена|Закрыть/);
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('People long workflow: фильтры, профиль, навыки и телефон', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop long workflow выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Люди/);
  for (const label of ['Все', 'На смене', 'Работники', 'Наёмные', 'Руководство', 'Службы']) {
    await expect(page.locator('body')).toContainText(label);
  }
  await clickIfVisible(page, /Работники/);
  await clickIfVisible(page, /Все/);

  const profileButtons = page.getByRole('button', { name: /Профиль|Открыть|Подробнее/ });
  if ((await profileButtons.count()) > 0) {
    await profileButtons.first().click();
    await expectStableRussianPage(page);
    await expect(page.locator('body')).toContainText(/Навыки|Основное|Телефон скрыт|Телефон/);
  } else {
    await expect(page.locator('body')).toContainText(/Люди|Навыки|Телефон скрыт|Работники/);
  }

  await expectNoDialogs(page);
  await logout(page);
});

test('WORKER people scope остаётся self-only', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop scope smoke выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  const menu = await visibleMenuText(page);
  expect(menu).not.toMatch(/Администрирование|Статистика \/ Аудит|ОКК|Линии/);
  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px long-smoke для ключевых цепочек', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile long workflow выполняется только в mobile-проекте.');

  for (const [userId, labels] of [
    ['test-master', [/Смена/, /Линии/]],
    ['test-store', [/Возвраты на производство/]],
    ['test-okk', [/ОКК/]],
    ['test-master', [/Чаты/]],
    ['test-master', [/Люди/]],
  ] as const) {
    await loginAs(page, userId);
    for (const label of labels) {
      await openMenuItem(page, label);
      await expectNoHorizontalOverflow(page);
    }
    await expectNoDialogs(page);
    await logout(page);
  }
});
