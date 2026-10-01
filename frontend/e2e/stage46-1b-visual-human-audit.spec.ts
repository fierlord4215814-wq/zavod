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
    Object.defineProperty(window, '__stage461bDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage461bDialogs?: string[] }).__stage461bDialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage461bUser=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
  const anyNavButton = page.locator('.bottom-nav button, .mobile-quick-nav button').filter({ hasText: label });
  if ((await anyNavButton.count()) > 0) {
    await anyNavButton.first().evaluate((node: HTMLElement) => node.click());
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheetButton = page.locator('.mobile-nav-sheet button').filter({ hasText: label }).first();
    await sheetButton.scrollIntoViewIfNeeded();
    await sheetButton.click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: нижнее меню не перекрывает рабочую область, подсказки смены компактные', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop layout проверяется в desktop-проекте.');
  const factoryId = await loginAs(page, 'test-master');
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  await openMenuItem(page, 'Смена');

  const nav = await page.locator('.bottom-nav').boundingBox();
  const paddingBottom = await page.locator('.app-shell').evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom));
  expect(nav).not.toBeNull();
  expect(paddingBottom).toBeGreaterThanOrEqual((nav?.height ?? 0) + 16);

  const hint = page.locator('.hint-card').first();
  if ((await hint.count()) > 0) {
    const hintBox = await hint.boundingBox();
    const buttonBox = await hint.getByRole('button', { name: 'Понятно' }).boundingBox();
    expect(hintBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.width).toBeLessThan(hintBox!.width * 0.45);
  }

  await expectNoDialogs(page);
});

test('desktop: линии, чаты и возвраты выглядят как рабочие списки без Stage/test шума', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop visual audit проверяется в desktop-проекте.');
  await loginAs(page, 'test-master');

  await openMenuItem(page, 'Линии');
  await expect(page.locator('.line-card').first()).toBeVisible();
  await expect(page.locator('.line-card').first().getByRole('button', { name: 'Простой' })).toBeVisible();
  const pauseColor = await page.locator('.line-card').first().getByRole('button', { name: 'Простой' }).evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(pauseColor).toMatch(/245,\s*158,\s*11|rgb\(245/);
  await expect(page.locator('body')).not.toContainText(fixturePattern);

  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-card').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Общий чат заводаОбщий чат|Чат отдела:.*Чат отдела:/);
  await expect(page.locator('body')).not.toContainText(fixturePattern);

  await loginAs(page, 'test-store');
  let returnsOpened = false;
  try {
    await openMenuItem(page, /Возвраты/);
    returnsOpened = true;
  } catch {
    await loginAs(page, 'test-admin');
    try {
      await openMenuItem(page, /Возвраты/);
      returnsOpened = true;
    } catch {
      returnsOpened = false;
    }
  }
  if (returnsOpened) {
    await expect(page.locator('body')).toContainText('Возвраты на производство');
    await expect(page.locator('body')).not.toContainText(fixturePattern);
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: ключевые рабочие экраны не ломают ширину и не выглядят как raw UI', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile проверяется только в mobile-проекте.');
  await loginAs(page, 'test-master');
  for (const label of ['Смена', 'Линии', 'Чаты', 'Чек-листы', 'Уведомления']) {
    await openMenuItem(page, label);
    await expectNoHorizontalOverflow(page);
    await expectStableRussianPage(page);
  }

  await loginAs(page, 'test-store');
  try {
    await openMenuItem(page, /Возвраты/);
  } catch {
    await loginAs(page, 'test-admin');
    await openMenuItem(page, /Возвраты/);
  }
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('body')).not.toContainText(fixturePattern);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
