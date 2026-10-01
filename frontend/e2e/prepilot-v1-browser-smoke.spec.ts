import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

type UserRow = {
  id: string;
  role?: string;
  displayName?: string;
  selectedFactoryAccess?: {
    role?: string;
    isGuest?: boolean;
    isActive?: boolean;
  };
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
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  const shell = page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first();
  if ((await shell.count()) > 0 && await shell.isVisible()) return;

  const devForm = page.locator('form.dev-login-card').filter({ hasText: 'Тестовый пользователь' }).first();
  await expect(devForm).toBeVisible({ timeout: 15_000 });
  await devForm.locator('#dev-user-id').fill(userId);
  const loginButton = devForm.getByRole('button', { name: /Войти/ });
  await expect(loginButton).toBeEnabled({ timeout: 15_000 });
  await loginButton.click();

  const preferredFactory = page.locator('.factory-card').filter({ hasText: /factory-4|Завод 4/ }).first();
  const fallbackFactory = page.locator('.factory-card').first();
  const factoryCard = (await preferredFactory.count()) > 0 ? preferredFactory : fallbackFactory;
  await expect(factoryCard).toBeVisible({ timeout: 15_000 });
  await factoryCard.getByRole('button', { name: /Выбрать завод/ }).click();
  await expect(shell).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error', { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Unexpected token');
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__prepilotDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __prepilotDialogs?: string[] }).__prepilotDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectNoTechnicalLeak(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
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
    await expect(sheetButton.first()).toBeVisible();
    await sheetButton.first().click();
    return;
  }
  throw new Error(`Раздел не найден: ${label}`);
}

async function expectHealthyScreen(page: Page) {
  await expect(page.locator('body')).not.toContainText('Cannot read properties');
  await expect(page.locator('body')).not.toContainText('undefined is not');
  await expect(page.locator('body')).not.toContainText('NaN');
  await expectNoTechnicalLeak(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: admin opens core v1 screens without raw errors', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop smoke only.');
  const factoryId = await resolveFactoryId();
  await page.setViewportSize({ width: 1280, height: 900 });
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
    /Чаты/,
    /Статистика|Аудит/,
    /Администрирование/,
    /Сообщить об ошибке/,
  ];
  for (const section of sections) {
    await openSection(page, section);
    await expectHealthyScreen(page);
  }
});

test('mobile 360/390/430: main screens fit without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile smoke only.');
  const factoryId = await resolveFactoryId();
  await page.setViewportSize({ width: 360, height: 820 });
  await loginAs(page, 'test-admin', factoryId);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    for (const section of [/Объявления/, /Смена/, /Линии/, /Заявки/, /Чек-листы/, /Чаты/]) {
      await openSection(page, section);
      await expectHealthyScreen(page);
    }
  }
});

test('role menu sanity: worker does not see admin/statistics controls', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile role smoke only.');
  const factoryId = await resolveFactoryId();
  const workerId = await findUser(factoryId, 'WORKER', 'test-worker');
  await page.setViewportSize({ width: 360, height: 820 });
  await loginAs(page, workerId, factoryId);

  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) await more.first().click();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/Администрирование/);
  expect(body).not.toMatch(/Статистика\s*\/\s*Аудит/);
  await expectHealthyScreen(page);
});
