import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Factory|Users|Department)\b/;
const mojibakePattern = /Р С—РЎвЂ”Р вЂ¦|Р вЂњРЎвЂ™|Р В Р’В Р РЋРЎСџ/;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown } = {}) {
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
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage53Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage53Dialogs?: string[] }).__stage53Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('storagePath');
  expect(text).not.toContain('passwordHash');
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage53Login=${Date.now()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage53User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
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

test('ADMIN видит выбранный завод как отдельный контекст управления', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный admin-context сценарий выполняется на desktop.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);
  await page.getByRole('button', { name: 'Заводы' }).click();

  const factoryList = page.locator('.factory-context-list');
  await expect(factoryList).toBeVisible();
  const factory4 = factoryList.locator('button').filter({ hasText: /Завод 4|factory-4/ }).first();
  await expect(factory4).toBeVisible();
  await factory4.click();
  await expect(page.locator('.factory-context-card')).toContainText(/Выбран завод:.*Завод 4/);
  await expect(page.locator('.factory-context-card')).toContainText('Пользователи с доступом');
  await expect(page.locator('.factory-context-card')).toContainText('Отделы и службы');
  await expect(page.locator('.factory-context-card')).toContainText('Линии и позиции');
  await expect(page.locator('.factory-context-card')).toContainText('Шаблоны состава');
  await expect(page.locator('.factory-context-card')).toContainText('Рабочие зоны');
  await expect(page.locator('.factory-context-card')).toContainText('Настройки модулей');
  await expect(page.locator('.factory-context-card')).toContainText('Аудит изменений');
  await expect(factoryList).not.toContainText(/Stage\d+|regression|browser|fixture|simulation/i);

  await page.getByRole('button', { name: 'Пользователи' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Пользователи с доступом' })).toBeVisible();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Пользователи с доступом' })).toContainText(/Администратор|Мастер|Тестовый/);

  await page.getByRole('button', { name: 'Отделы и службы' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Общие' })).toContainText('Общая служба');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Общие' })).toContainText('Не даёт автоматический доступ');

  await page.getByRole('button', { name: 'Линии и позиции' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Линии и позиции' })).toContainText(/Позици|Шаблон/);
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Линии и позиции' })).not.toContainText(/Stage\d+|simulation|test line/i);

  await page.getByRole('button', { name: 'Повременщики / рабочие зоны' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Рабочие зоны' })).toContainText(/Рабочие зоны|Повременщики/);

  await page.getByRole('button', { name: 'Настройки модулей' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Настройки модулей' })).toContainText(/Настройки для:.*Завод 4/);

  await page.getByRole('button', { name: 'Аудит действий админки' }).click();
  await expect(page.locator('.admin-card.wide').filter({ hasText: /Аудит/ })).toContainText('Без хэшей паролей');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(uuidPattern);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: контекст завода читается без горизонтального overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);
  await page.getByRole('button', { name: 'Заводы' }).click();
  await expect(page.locator('.factory-context-list')).toBeVisible();
  await expect(page.locator('.factory-context-card')).toContainText('Выбран завод');
  await expect(page.locator('.factory-context-card')).toContainText('Пользователи с доступом');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
