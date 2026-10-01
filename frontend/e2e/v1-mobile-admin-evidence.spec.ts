import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'v1-completion-screenshots', 'mobile-admin');

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

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareV1MobileAdmin=${Date.now()}`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?v1MobileAdmin=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openAdminFromMore(page: Page) {
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  await expect(more).toHaveCount(1);
  await more.click();
  const admin = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: 'Админка' });
  await expect(admin).toHaveCount(1);
  await admin.click();
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__v1MobileAdminDialogs', { value: calls, configurable: true });
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
});

test('mobile 360: admin users access section has no technical overflow', async ({ page }, testInfo) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 360, height: 740 });
  await loginAsAdmin(page);
  await openAdminFromMore(page);

  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.mobile-nav-sheet:visible')).toHaveCount(0);

  const usersSection = page.getByRole('button', { name: 'Пользователи и доступы' });
  await expect(usersSection).toHaveCount(1);
  await usersSection.click();
  await expect(page.getByRole('heading', { name: 'Пользователи с доступом' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/recovery-worker|Проверка восстановления|Stage60|stage60|pilot-tech-electric-1/i);
  expect(text).toContain('Тестовый электрик 1');
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token=/i);

  const dialogCalls = await page.evaluate(() => (window as unknown as { __v1MobileAdminDialogs?: string[] }).__v1MobileAdminDialogs ?? []);
  expect(dialogCalls).toEqual([]);

  const screenshotPath = path.join(screenshotDir, 'v1-mobile-admin-evidence.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('v1-mobile-admin-evidence', { path: screenshotPath, contentType: 'image/png' });
});
