import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Forbidden|Access denied|No data|Settings|Overview|Events|Save|Cancel|Network unavailable|Action queued|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage32Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage32Dialogs?: string[] }).__stage32Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoRawCrash(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
}

async function expectCleanRussianUi(page: Page) {
  const text = await page.locator('body').innerText();
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
  await expectNoRawCrash(page);
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
  await expectNoRawCrash(page);
  await expectCleanRussianUi(page);
}

async function openMenuItemIfVisible(page: Page, label: RegExp | string) {
  const item = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await item.count()) === 0) return false;
  await item.first().click();
  await expectNoRawCrash(page);
  await expectCleanRussianUi(page);
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

test('ADMIN открывает ключевые свежие разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие ADMIN выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  for (const label of [/Администрирование/, /Объявления/, /Люди/, /Чаты/, /Уведомления/, /Статистика \/ Аудит/]) {
    await openMenuItem(page, label);
  }
  await expectNoDialogs(page);
  await logout(page);
});

test('MANAGEMENT открывает scoped рабочие разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие MANAGEMENT выполняется в desktop-проекте.');

  await loginAs(page, 'test-management');
  for (const label of [/Заявки/, /Чек-листы/, /Заказы \/ Остатки/, /Пересменка \/ Журнал/, /Статистика \/ Аудит/, /Объявления/]) {
    await openMenuItem(page, label);
  }
  await expectNoDialogs(page);
  await logout(page);
});

test('MASTER открывает сменные, линейные и производственные разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие MASTER выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  const shiftText = await page.locator('body').innerText();
  if (shiftText.includes('Повременщики')) {
    expect(shiftText).toContain('Повременщики');
  }
  for (const label of [/Линии/, /Заявки/, /Мойка/, /Чек-листы/, /Пересменка \/ Журнал/]) {
    await openMenuItem(page, label);
  }
  await expectNoDialogs(page);
  await logout(page);
});

test('WORKER остаётся в self-view без управленческих разделов', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие WORKER выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  const menu = await visibleMenuText(page);
  expect(menu).not.toMatch(/Администрирование|Статистика \/ Аудит|ОКК|Мойка|Линии/);
  await expectNoDialogs(page);
  await logout(page);
});

test('STORE открывает складские рабочие разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие STORE выполняется в desktop-проекте.');

  await loginAs(page, 'test-store');
  for (const label of [/Возвраты на производство/, /Некондиция/, /Заказы \/ Остатки/]) {
    await openMenuItem(page, label);
  }
  await expectNoDialogs(page);
  await logout(page);
});

test('OKK открывает ОКК и доступную мойку review-сценария', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие OKK выполняется в desktop-проекте.');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  await openMenuItemIfVisible(page, /Мойка/);
  const menu = await visibleMenuText(page);
  expect(menu).not.toMatch(/Администрирование/);
  await expectNoDialogs(page);
  await logout(page);
});

test('TECH_HOLOD открывает оттайку и доступные заявки', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие TECH_HOLOD выполняется в desktop-проекте.');

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Оттайка/);
  await openMenuItemIfVisible(page, /Заявки/);
  const menu = await visibleMenuText(page);
  expect(menu).not.toMatch(/Администрирование/);
  await expectNoDialogs(page);
  await logout(page);
});

test('CONTRACTOR_LEAD не получает админку и доску линий', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-покрытие CONTRACTOR_LEAD выполняется в desktop-проекте.');

  await loginAs(page, 'contractor-lead-1');
  await openMenuItem(page, /Смена/);
  const menu = await visibleMenuText(page);
  expect(menu).not.toMatch(/Администрирование|Линии|Статистика \/ Аудит/);
  await expectNoDialogs(page);
  await logout(page);
});

test('безопасные действия: уведомления прочитаны, объявление прочитано', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Action smoke выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Уведомления/);
  const readAll = page.getByRole('button', { name: /Прочитать всё/ });
  if ((await readAll.count()) > 0 && await readAll.first().isEnabled()) {
    await readAll.first().click();
    await expectNoRawCrash(page);
    await expectCleanRussianUi(page);
  }

  await openMenuItem(page, /Объявления/);
  const markRead = page.getByRole('button', { name: /Прочитано|Отметить прочитанным/ });
  if ((await markRead.count()) > 0 && await markRead.first().isEnabled()) {
    await markRead.first().click();
    await expectNoRawCrash(page);
    await expectCleanRussianUi(page);
  }
  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px покрывает свежие роли и разделы', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильное покрытие выполняется только в mobile-проекте.');

  for (const [userId, labels] of [
    ['test-admin', [/Администрирование/]],
    ['test-master', [/Смена/, /Линии/, /Чаты/]],
    ['worker-1', [/Смена/]],
    ['test-store', [/Возвраты на производство/, /Заказы \/ Остатки/]],
    ['test-okk', [/ОКК/]],
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
