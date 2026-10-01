import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

type RuntimeIssue = { type: string; message: string; url?: string; status?: number };
type UserRow = {
  id: string;
  role?: string;
  selectedFactoryAccess?: { role?: string; isActive?: boolean; isGuest?: boolean };
};

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

async function usersWithAccess(factoryId: string) {
  return api(`/admin/users?factoryId=${encodeURIComponent(factoryId)}&hasFactoryAccess=true`, { userId: 'test-admin', factoryId }) as Promise<UserRow[]>;
}

function roleOf(user: UserRow) {
  return user.selectedFactoryAccess?.role ?? user.role;
}

async function findUser(factoryId: string, role: string, fallback: string) {
  const rows = await usersWithAccess(factoryId);
  const user = rows.find((item) =>
    item.selectedFactoryAccess?.isActive &&
    !item.selectedFactoryAccess?.isGuest &&
    roleOf(item) === role &&
    !item.id.toLowerCase().includes('stage') &&
    !item.id.toLowerCase().includes('regression'),
  ) ?? rows.find((item) => item.selectedFactoryAccess?.isActive && roleOf(item) === role);
  return user?.id ?? fallback;
}

async function loginAs(page: Page, userId: string, factoryId: string) {
  await page.goto('/');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthyScreen(page);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__runtimeDialogs', { value: calls, configurable: true });
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

function attachRuntimeCollectors(page: Page, issues: RuntimeIssue[]) {
  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/favicon\.ico/i.test(text)) return;
    issues.push({ type: `console.${message.type()}`, message: text });
  });
  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', message: error.message });
  });
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    issues.push({ type: request.resourceType() === 'websocket' ? 'requestfailed.websocket' : 'requestfailed', message: request.failure()?.errorText ?? 'request failed', url: request.url() });
  });
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 500) issues.push({ type: 'response.5xx', message: `${status}`, url, status });
    if (status === 404 && /\/api\/|127\.0\.0\.1:3000|localhost:3000/i.test(url)) issues.push({ type: 'response.404', message: '404', url, status });
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __runtimeDialogs?: string[] }).__runtimeDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectNoTechnicalLeak(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|internalPath|passwordHash|DATABASE_URL|JWT_SECRET|SESSION_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
  expect(text).not.toMatch(/Cannot read properties|Unhandled Runtime Error|Application error|Unexpected token/i);
}

async function expectNoSensitiveStorage(page: Page) {
  const values = await page.evaluate(() => ({
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage),
  }));
  expect(values.localStorage).not.toMatch(/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|SESSION_SECRET|refreshToken/i);
  expect(values.sessionStorage).not.toMatch(/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|SESSION_SECRET|refreshToken/i);
}

async function openSection(page: Page, label: RegExp) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheetButton = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label });
    await expect(sheetButton.first()).toBeVisible({ timeout: 10_000 });
    await sheetButton.first().click();
    return;
  }
  throw new Error(`Раздел не найден: ${label}`);
}

async function expectHealthyScreen(page: Page) {
  await expect(page.locator('body')).not.toContainText('Cannot read properties');
  await expect(page.locator('body')).not.toContainText('undefined is not');
  await expect(page.locator('body')).not.toContainText('Application error');
  await expect(page.locator('body')).not.toContainText('Unexpected token');
  await expect(page.locator('body')).not.toContainText('Внутренняя ошибка сервера');
  await expectNoTechnicalLeak(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
  await expectNoSensitiveStorage(page);
}

async function openAdminSubsections(page: Page) {
  await openSection(page, /Администрирование/);
  await expectHealthyScreen(page);
  for (const label of [
    /Пользователи|Люди/,
    /Отделы|Подраздел/,
    /Должност/,
    /Права|Роли/,
    /Линии/,
    /Чек-лист/,
  ]) {
    const button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
    if ((await button.count()) > 0) {
      await button.click();
      await expectHealthyScreen(page);
    }
  }
}

async function openShiftFutureTabs(page: Page) {
  await openSection(page, /Смена/);
  await expectHealthyScreen(page);
  for (const label of [/Следующая/, /Будущие/]) {
    const button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
    if ((await button.count()) > 0) {
      await button.click();
      await expectHealthyScreen(page);
    }
  }
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop runtime stability: admin traverses core screens without runtime or network failures', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop stability only.');
  const issues: RuntimeIssue[] = [];
  attachRuntimeCollectors(page, issues);
  const factoryId = await resolveFactoryId();
  await page.setViewportSize({ width: 1366, height: 900 });
  await loginAs(page, 'test-admin', factoryId);

  const sections = [
    /Объявления/,
    /Смена/,
    /Линии/,
    /Заявки/,
    /Чек-листы/,
    /Мойка/,
    /ОКК/,
    /Некондиция/,
    /Возвраты/,
    /Заказы|Остатки/,
    /Оттайка/,
    /Пересменка|Журнал/,
    /Чаты/,
    /Сообщить об ошибке/,
    /Статистика|Аудит/,
  ];
  for (const section of sections) {
    await openSection(page, section);
    await page.waitForTimeout(150);
    await expectHealthyScreen(page);
  }

  await openShiftFutureTabs(page);
  await openAdminSubsections(page);
  await page.reload();
  await expectHealthyScreen(page);
  await page.goBack().catch(() => null);
  await page.goForward().catch(() => null);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthyScreen(page);

  expect(issues).toEqual([]);
});

test('mobile runtime stability: 360/390/430 main screens fit and stay quiet', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile stability only.');
  const issues: RuntimeIssue[] = [];
  attachRuntimeCollectors(page, issues);
  const factoryId = await resolveFactoryId();
  await loginAs(page, 'test-admin', factoryId);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    for (const section of [
      /Объявления/,
      /Смена/,
      /Линии/,
      /Заявки/,
      /Чек-листы/,
      /Мойка/,
      /Чаты/,
      /Сообщить об ошибке/,
      /Администрирование/,
    ]) {
      await openSection(page, section);
      await page.waitForTimeout(150);
      await expectHealthyScreen(page);
    }
  }

  expect(issues).toEqual([]);
});

test('session recovery: reload and broken saved user return to Russian login instead of white screen', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Session recovery smoke is enough on desktop.');
  const issues: RuntimeIssue[] = [];
  attachRuntimeCollectors(page, issues);
  const factoryId = await resolveFactoryId();
  const workerId = await findUser(factoryId, 'WORKER', 'test-worker');
  await loginAs(page, workerId, factoryId);
  await page.reload();
  await expectHealthyScreen(page);

  await page.evaluate(() => {
    localStorage.setItem('zavod.devUserId', 'runtime-stability-missing-user');
    localStorage.removeItem('zavod.authToken');
  });
  await page.reload();
  await expect(page.locator('body')).toContainText(/Тестовый пользователь|Войти|Объявления|Данные не найдены/, { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error');
  await expectNoTechnicalLeak(page);

  expect(issues).toEqual([]);
});
