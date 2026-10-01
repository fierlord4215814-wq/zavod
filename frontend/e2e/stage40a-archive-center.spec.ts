import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage40aDialogs', {
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
  const calls = await page.evaluate(() => (window as unknown as { __stage40aDialogs?: string[] }).__stage40aDialogs ?? []);
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
  await page.context().clearCookies();
  const loginResponse = await page.request.post(`${apiUrl}/auth/dev-login`, { data: { userId } });
  expect(loginResponse.ok()).toBeTruthy();
  const login = await loginResponse.json();
  const factoryId = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4')?.id
    ?? login.recommendedFactoryId
    ?? login.availableFactories?.[0]?.id;
  expect(factoryId).toBeTruthy();
  await page.goto('/');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`/?stage40aUser=${encodeURIComponent(userId)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
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
  const navButton = page.locator('nav, [role="navigation"]').getByRole('button', { name: label }).filter({ visible: true });
  if ((await navButton.count()) > 0) {
    await navButton.first().click();
    await expectStableRussianPage(page);
    return;
  }

  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheet = page.locator('.mobile-nav-sheet:visible').first();
    const item = sheet.getByRole('button', { name: label }).filter({ visible: true }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expectStableRussianPage(page);
    return;
  }

  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }

  await page.getByRole('button', { name: label }).first().click();
  await expectStableRussianPage(page);
}

function sectionCard(page: Page, label: string) {
  return page.locator('.archive-section-card').filter({
    has: page.locator('strong').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN: единый архив открывается и показывает основные папки', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка архива выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible();
  for (const label of [
    'Заявки и простои',
    'Чек-листы',
    'ОКК',
    'Возвраты на производство',
    'Некондиция',
    'Заказы / Остатки',
    'Мойка',
    'Оттайка',
    'Пересменка / Журнал',
    'Объявления',
    'Файлы и вложения',
  ]) {
    await expect(sectionCard(page, label)).toBeVisible();
  }
  await sectionCard(page, 'Файлы и вложения').click();
  await expect(page.locator('body')).toContainText(/Файлы и вложения|За выбранный период вложений не найдено/);
  await expectNoDialogs(page);
  await logout(page);
});

test('STORE: архив показывает складские папки без лишнего управления', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка архива выполняется в desktop-проекте.');

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Архив/);
  await expect(sectionCard(page, 'Возвраты на производство')).toBeVisible();
  await expect(sectionCard(page, 'Некондиция')).toBeVisible();
  await expect(sectionCard(page, 'Заказы / Остатки')).toBeVisible();
  await sectionCard(page, 'Возвраты на производство').click();
  await expect(page.locator('body')).toContainText(/Возвраты на производство|За выбранный период возвратов не найдено/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('OKK: архив показывает профильную папку без лишнего управления', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка архива выполняется в desktop-проекте.');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /Архив/);
  await expect(sectionCard(page, 'ОКК')).toBeVisible();
  await sectionCard(page, 'ОКК').click();
  await expect(page.locator('body')).toContainText(/ОКК|За выбранный период записей ОКК не найдено/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('WORKER: управленческие архивные папки не видны', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка архива выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Архив/);
  const text = await page.locator('body').innerText();
  expect(text).toContain('Архив');
  expect(text).not.toContain('Некондиция');
  expect(text).not.toContain('Заказы / Остатки');
  expect(text).not.toContain('ОКК');
  await expectNoDialogs(page);
});

test('mobile 360px: архив и папка вложений читаются без горизонтального переполнения', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage40A выполняется только в mobile-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  await expectNoHorizontalOverflow(page);
  await sectionCard(page, 'Файлы и вложения').click();
  await expect(page.locator('body')).toContainText(/Файлы и вложения/);
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
