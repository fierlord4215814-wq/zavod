import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /пїЅ|пїЅпїЅпїЅпїЅ|Гђ|Р Сџ/;
const fixturePattern = /Stage\d+|stage\d+|regression|simulation|browser|demo|test line|Линия теста|тестовая линия/i;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage46Dialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
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
  const calls = await page.evaluate(() => (window as unknown as { __stage46Dialogs?: string[] }).__stage46Dialogs ?? []);
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
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage46User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButtons = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await navButtons.count()) > 0) {
    await navButtons.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheetButton = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
    await sheetButton.click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('MASTER: смена визуально разделяет работу, план и архив', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Основной UX смены проверяется в desktop-проекте.');
  const factoryId = await loginAs(page, 'test-master');
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  await openMenuItem(page, 'Смена');

  await expect(page.locator('.operational-metrics')).toBeVisible();
  await expect(page.locator('.operational-workspace')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(fixturePattern);

  await page.getByRole('button', { name: 'Следующая' }).click();
  await expect(page.locator('.planning-card')).toBeVisible();
  await expect(page.locator('body')).toContainText('Плановые линии');
  await expect(page.locator('body')).not.toContainText('Запустить / добавить линию в смену');

  await page.getByRole('button', { name: 'Прошлые' }).click();
  await expect(page.locator('.archive-shift-card')).toBeVisible();
  await expect(page.locator('body')).toContainText('Архив смен');
  await expect(page.locator('body')).not.toContainText('Домой');
  await expectNoDialogs(page);
});

test('Чаты выглядят как рабочий мессенджер без Stage/test шума', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Чаты проверяются в desktop-проекте.');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-card').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(fixturePattern);
  await expect(page.locator('body')).not.toContainText(/Чат отдела:/i);

  const chats = page.locator('.messenger-chat-card:visible');
  if ((await chats.count()) > 0) {
    await chats.first().click();
    await expect(page.locator('.messenger-dialog-panel')).toBeVisible();
    await expect(page.locator('.messenger-composer, .empty-state').first()).toBeVisible();
    const messages = page.locator('.chat-message:visible');
    if ((await messages.count()) > 0) {
      await expect(messages.first().locator('.chat-message-head')).toBeVisible();
      await expect(messages.first().locator('.chat-avatar')).toBeVisible();
    }
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('Чек-лист открывается в focus-mode с отдельным планом', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Guided-run проверяется в desktop-проекте.');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Чек-листы');
  await expect(page.locator('body')).not.toContainText(fixturePattern);
  const runs = page.locator('.list-row:visible').filter({ hasText: /Актив|Пункт|Чек/i });
  if ((await runs.count()) > 0) {
    await runs.first().click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.locator('.focus-progress')).toBeVisible();
    await expect(dialog.locator('.focus-current-row')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /План чек-листа|Скрыть план чек-листа/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
  } else {
    await expect(page.locator('body')).toContainText(/Чек-лист|Шаблон|Запуск/);
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('Уведомления показывают приоритеты как рабочие события', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Уведомления проверяются в desktop-проекте.');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Уведомления');
  await expect(page.locator('.notification-card, .empty-state').first()).toBeVisible();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: ключевые рабочие экраны без overflow и dev-ощущения', async ({ browser, page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile проверяется только в mobile-проекте.');
  await loginAs(page, 'test-master');
  for (const label of ['Смена', 'Линии', 'Заявки', 'Чаты', 'Чек-листы', 'Уведомления']) {
    await openMenuItem(page, label);
    await expectNoHorizontalOverflow(page);
    await expectStableRussianPage(page);
  }

  const okkContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const okkPage = await okkContext.newPage();
  await installDialogGuards(okkPage);
  await loginAs(okkPage, 'test-okk');
  await openMenuItem(okkPage, 'ОКК');
  await expectNoHorizontalOverflow(okkPage);
  await expectStableRussianPage(okkPage);
  await okkContext.close();

  await expectNoDialogs(page);
});
