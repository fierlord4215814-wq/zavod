import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage38Dialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage38Dialogs?: string[] }).__stage38Dialogs ?? []);
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
  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.locator('.mobile-quick-nav')).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMore(page: Page) {
  const button = page.getByRole('button', { name: 'Ещё' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
}

async function closeMore(page: Page) {
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toHaveCount(0);
}

async function quickLabels(page: Page) {
  return page.locator('.mobile-quick-button').allInnerTexts();
}

async function sheetLabels(page: Page) {
  return page.locator('.mobile-sheet-item').allInnerTexts();
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('mobile 360px ADMIN: верхние быстрые разделы и шторка с остальными', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Stage38 проверяет мобильную навигацию только в mobile-проекте.');

  await loginAs(page, 'test-admin');
  await expect(page.locator('.bottom-nav')).toBeHidden();

  const quick = (await quickLabels(page)).join('\n');
  for (const label of ['Смена', 'Люди', 'Уведомления', 'Чек-листы', 'Объявления']) {
    expect(quick).toContain(label);
  }

  const factoryId = await page.evaluate(() => window.localStorage.getItem('zavod.selectedFactoryId') ?? '');
  const unread = await (await fetch('http://127.0.0.1:3000/notifications/unread-count', {
    headers: { 'x-user-id': 'test-admin', 'x-factory-id': factoryId },
  })).json();
  if ((unread.count ?? 0) > 0) {
    await expect(page.locator('.mobile-quick-button').filter({ hasText: 'Уведомления' }).locator('.nav-badge')).toBeVisible();
  }

  await openMore(page);
  const sheet = (await sheetLabels(page)).join('\n');
  for (const label of ['Линии', 'Заявки', 'Мойка', 'Чаты', 'ОКК', 'Некондиция', 'Возвраты на производство', 'Заказы / Остатки', 'Оттайка', 'Пересменка / Журнал', 'Статистика / Аудит', 'Администрирование']) {
    expect(sheet).toContain(label);
  }
  await closeMore(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360px MASTER: быстрые разделы доступны, управленческая админка скрыта', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Stage38 проверяет мобильную навигацию только в mobile-проекте.');

  await loginAs(page, 'test-master');
  const quick = (await quickLabels(page)).join('\n');
  expect(quick).toContain('Смена');
  expect(quick).toContain('Люди');
  expect(quick).toContain('Уведомления');

  await openMore(page);
  const sheet = (await sheetLabels(page)).join('\n');
  expect(sheet).toContain('Линии');
  expect(sheet).toContain('Заявки');
  expect(sheet).toContain('Мойка');
  expect(sheet).not.toContain('Администрирование');
  await page.getByRole('button', { name: /Линии/ }).click();
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360px WORKER: лишние управленческие разделы не видны', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Stage38 проверяет мобильную навигацию только в mobile-проекте.');

  await loginAs(page, 'worker-1');
  const quick = (await quickLabels(page)).join('\n');
  expect(quick).toContain('Смена');
  expect(quick).toContain('Люди');
  expect(quick).toContain('Уведомления');

  await openMore(page);
  const sheet = (await sheetLabels(page)).join('\n');
  expect(sheet).not.toContain('Администрирование');
  expect(sheet).not.toContain('Статистика / Аудит');
  expect(sheet).not.toContain('ОКК');
  expect(sheet).toContain('Оттайка');
  await closeMore(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360px STORE и OKK: шторка показывает только разрешённые рабочие разделы', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Stage38 проверяет мобильную навигацию только в mobile-проекте.');

  await loginAs(page, 'test-store');
  await openMore(page);
  const storeSheet = (await sheetLabels(page)).join('\n');
  expect(storeSheet).toContain('Некондиция');
  expect(storeSheet).toContain('Возвраты на производство');
  expect(storeSheet).toContain('Заказы / Остатки');
  expect(storeSheet).not.toContain('Администрирование');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
  await closeMore(page);
  await page.getByRole('button', { name: 'Выйти' }).click();

  await loginAs(page, 'test-okk');
  await openMore(page);
  const okkSheet = (await sheetLabels(page)).join('\n');
  expect(okkSheet).toContain('ОКК');
  expect(okkSheet).toContain('Мойка');
  expect(okkSheet).not.toContain('Администрирование');
  await closeMore(page);
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});
