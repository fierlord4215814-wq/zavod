import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /пїЅпїЅпїЅпїЅ|пїЅ|Гђ|Р Сџ/;

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
    Object.defineProperty(window, '__stage49Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage49Dialogs?: string[] }).__stage49Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
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
  await page.goto(`${frontendUrl}/?stage49User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('MASTER opens past shift list and read-only detail tabs', async ({ page }) => {
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: /Прошлая/ }).click();

  await expect(page.locator('.archive-shift-card')).toContainText('Архив смен');
  await expect(page.locator('.past-shift-card').first()).toContainText(/День|Ночь/);
  const fixtureShiftCard = page.locator('.past-shift-card').filter({ hasText: 'Тестовый мастер 1' }).first();
  if ((await fixtureShiftCard.count()) > 0) {
    await fixtureShiftCard.click();
  } else {
    await page.locator('.past-shift-card').first().click();
  }
  const detail = page.locator('.past-shift-detail');

  for (const tab of ['Обзор', 'Люди', 'Линии', 'Простои', 'Заявки', 'Мойка', 'Пересменка']) {
    await expect(detail.getByRole('button', { name: tab })).toBeVisible();
  }
  await expect(detail).toContainText('режим только для просмотра');
  await expect(detail).toContainText('Людей на смене');

  await detail.getByRole('button', { name: 'Люди' }).click();
  await expect(detail).toContainText(/Тестовый|Работник|Наёмный|Назначений в этой смене не найдено/);
  await detail.getByRole('button', { name: 'Линии' }).click();
  await expect(detail).toContainText(/Людей:|Работавших линий не найдено/);
  await detail.getByRole('button', { name: 'Простои' }).click();
  await expect(detail).toContainText(/Причина:|Простоев в этой смене не найдено/);
  await detail.getByRole('button', { name: 'Заявки' }).click();
  await expect(detail).toContainText(/заявка|Заявок в этой смене не найдено/i);
  await detail.getByRole('button', { name: 'Мойка' }).click();
  await expect(detail).toContainText(/Мойка|Моек в этой смене не найдено|Проблемы:/);
  await detail.getByRole('button', { name: 'Пересменка' }).click();
  await expect(detail).toContainText(/Пересменка|Записей пересменки|Технолог|КИПиА|Отдел/);

  await expect(page.locator('.archive-shift-card')).not.toContainText(/Назначить|Освободить|Запустить \/ добавить|Остановить|Создать заявку из простоя|Вернуть в работу/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px past shift archive has no overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only check');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: /Прошлая/ }).click();
  await page.locator('.past-shift-card').first().click();
  const detail = page.locator('.past-shift-detail');
  await expectNoHorizontalOverflow(page);
  await detail.getByRole('button', { name: 'Люди' }).click();
  await expectNoHorizontalOverflow(page);
  await detail.getByRole('button', { name: 'Пересменка' }).click();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
