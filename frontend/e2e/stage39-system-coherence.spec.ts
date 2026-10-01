import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage39Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage39Dialogs?: string[] }).__stage39Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
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
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
}

async function logout(page: Page) {
  const button = page.getByRole('button', { name: 'Выйти' }).filter({ visible: true });
  if ((await button.count()) > 0) {
    await button.first().click();
    await expect(page.locator('#dev-user-id')).toBeVisible();
  }
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }

  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
    await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await expectStableRussianPage(page);
    return;
  }

  await page.getByRole('button', { name: label }).first().click();
  await expectStableRussianPage(page);
}

async function visibleMenuText(page: Page) {
  const desktop = await page.locator('.bottom-nav button:visible').allInnerTexts();
  const mobileQuick = await page.locator('.mobile-quick-button:visible').allInnerTexts();
  const mobileSheet = await page.locator('.mobile-sheet-item:visible').allInnerTexts();
  return [...desktop, ...mobileQuick, ...mobileSheet].join('\n');
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN coherence: админка, заводы, роли, уведомления и аудит доступны без сырой ошибки', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop coherence выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Администрирование/);
  await expect(page.locator('body')).toContainText(/Администрирование|Заводы|Роли и права|Пользователи/);
  await expect(page.locator('body')).toContainText(/Настройки модулей|Линии и позиции|Повременщики/);

  await openMenuItem(page, /Уведомления/);
  await expect(page.locator('body')).toContainText(/Уведомления|Прочитать всё|Уведомлений нет/);

  await openMenuItem(page, /Статистика \/ Аудит/);
  await expect(page.locator('body')).toContainText(/Статистика|Аудит|События|Доступ/);

  await expectNoDialogs(page);
  await logout(page);
});

test('MASTER coherence: смена, линии, заявки, мойка и пересменка складываются в рабочий путь', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop coherence выполняется в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  await expect(page.locator('body')).toContainText(/Смена|Люди|Повременщики|На смене/);

  await openMenuItem(page, /Линии/);
  await expect(page.locator('body')).toContainText(/Активные линии|Линии|Запустить линию|Назнач/);

  await openMenuItem(page, /Заявки/);
  await expect(page.locator('body')).toContainText(/Заявки|Новая заявка|Срочная|В работе/);

  await openMenuItem(page, /Мойка/);
  await expect(page.locator('body')).toContainText(/Мойка|Активные|История|Проблем/);

  await openMenuItem(page, /Пересменка \/ Журнал/);
  await expect(page.locator('body')).toContainText(/Пересменка|Журнал|Важные|Запись/);

  await expectNoDialogs(page);
  await logout(page);
});

test('WORKER coherence: self-view есть, управленческие разделы скрыты', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop coherence выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  const menu = await visibleMenuText(page);
  expect(menu).toContain('Смена');
  expect(menu).not.toContain('Администрирование');
  expect(menu).not.toContain('Статистика / Аудит');
  expect(menu).not.toContain('ОКК');

  await openMenuItem(page, /Смена/);
  await expect(page.locator('body')).toContainText(/Моя смена|Я буду|Смена|worker-1/);
  await expectNoDialogs(page);
  await logout(page);
});

test('STORE, OKK и TECH_HOLOD: профильные разделы видны, чужие действия не становятся меню по умолчанию', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop coherence выполняется в desktop-проекте.');

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты на производство/);
  await expect(page.locator('body')).toContainText(/Возвраты на производство|Активные|Архив/);
  await openMenuItem(page, /Заказы \/ Остатки/);
  await expect(page.locator('body')).toContainText(/Заказы|Остатки|Минимальный/);
  await openMenuItem(page, /Некондиция/);
  await expect(page.locator('body')).toContainText(/Некондиция|Склад|Активные/);
  await logout(page);

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  await expect(page.locator('body')).toContainText(/ОКК|Новый брак|Активные|Архив/);
  await openMenuItem(page, /Мойка/);
  await expect(page.locator('body')).toContainText(/Мойка|ОКК|Провер/);
  await logout(page);

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Оттайка/);
  await expect(page.locator('.defrost-line-card').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.defrost-line-card').first().click();
  await expect(page.locator('.defrost-calendar-grid')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('body')).toContainText(/Поставили на оттайку|Запустили в работу/);
  await expectNoDialogs(page);
  await logout(page);
});

test('MANAGEMENT и CONTRACTOR_LEAD: scope-разделы доступны, assignment/admin лишнее скрыто', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop coherence выполняется в desktop-проекте.');

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Заявки/);
  await expect(page.locator('body')).toContainText(/Заявки|Срочные|Долгие/);
  await openMenuItem(page, /Уведомления/);
  await expect(page.locator('body')).toContainText(/Уведомления|Прочитать всё|Уведомлений нет/);
  await openMenuItem(page, /Статистика \/ Аудит/);
  await expect(page.locator('body')).toContainText(/Статистика|Аудит|События/);
  await logout(page);

  await loginAs(page, 'contractor-lead-1');
  const menu = await visibleMenuText(page);
  expect(menu).toContain('Смена');
  expect(menu).not.toContain('Администрирование');
  expect(menu).not.toContain('Линии');
  await openMenuItem(page, /Смена/);
  await expect(page.locator('body')).toContainText(/Смена|Наём|Я буду|Заявка/);
  await expectNoDialogs(page);
});

test('mobile 360px: ключевые рабочие экраны читаются без горизонтального переполнения', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage39 выполняется только в mobile-проекте.');

  await loginAs(page, 'test-master');
  for (const label of [/Смена/, /Линии/]) {
    await openMenuItem(page, label);
    await expectNoHorizontalOverflow(page);
  }
  await logout(page);

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Оттайка/);
  await expectNoHorizontalOverflow(page);
  await page.locator('.defrost-line-card').first().click();
  await expect(page.locator('.defrost-calendar-grid')).toBeVisible({ timeout: 20000 });
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты на производство/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Уведомления/);
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
