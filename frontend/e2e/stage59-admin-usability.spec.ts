import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage59-admin-usability-screenshots');

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
    Object.defineProperty(window, '__stage59Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage59Dialogs?: string[] }).__stage59Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage59Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage59User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  return factoryId;
}

async function openAdmin(page: Page) {
  const direct = page.locator('button:visible').filter({ hasText: /Админ|Администрирование/ });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  const more = page.locator('button:visible').filter({ hasText: /Ещё|Еще/ });
  if (await more.count()) {
    await more.first().click();
    await page.locator('button:visible').filter({ hasText: /Админ|Администрирование/ }).first().click();
    return;
  }
  throw new Error('Админка не найдена в навигации');
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN видит guided admin overview, quick actions, health и права без технической стены', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots проверяются отдельно от mobile.');
  await loginAsAdmin(page);
  await openAdmin(page);

  await expect(page.locator('.admin-overview')).toContainText('Выбран завод');
  await expect(page.locator('.admin-task-nav')).toContainText('Завод');
  await screenshot(page, '01-admin-overview-desktop.png');

  await expect(page.locator('.admin-quick-action-grid')).toContainText('Создать новый завод');
  await expect(page.locator('.admin-quick-action-grid')).toContainText('Проверить готовность завода');
  await screenshot(page, '02-admin-quick-actions-desktop.png');

  await page.locator('.admin-action-card').filter({ hasText: 'Добавить линию' }).click();
  await expect(page.locator('.admin-card').filter({ hasText: 'Создать линию' })).toContainText('После создания добавьте позиции');
  await screenshot(page, '03-admin-structure-section-desktop.png');

  await page.locator('.admin-task-nav button').filter({ hasText: 'Обзор' }).first().click();
  await expect(page.locator('.admin-health-grouped')).toContainText('Готовность завода');
  await screenshot(page, '04-admin-health-grouped-desktop.png');

  await page.locator('.admin-task-nav button').filter({ hasText: 'Роли и права' }).first().click();
  const permissionGrid = page.locator('.permission-grid');
  await expect(permissionGrid).toContainText('Управление');
  await expect(permissionGrid).not.toContainText(/admin\.[a-z]/);
  await screenshot(page, '05-admin-permissions-human-readable.png');
  await page.getByRole('button', { name: 'Расширенно' }).click();
  await expect(permissionGrid).toContainText(/admin\.[a-z]/);

  await page.locator('.admin-task-nav button').filter({ hasText: 'Заводы' }).first().click();
  await expect(page.locator('.factory-config-transfer')).toContainText('Экспорт и импорт конфигурации');
  await screenshot(page, '06-admin-export-import-clean.png');

  await expect(page.locator('body')).not.toContainText('storagePath');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('ADMIN mobile 360px читает обзор, grouped health и права без overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile сценарий запускается в mobile project.');
  await page.setViewportSize({ width: 360, height: 760 });
  await loginAsAdmin(page);
  await openAdmin(page);

  await expect(page.locator('.admin-overview')).toContainText('Что нужно настроить');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '07-admin-mobile-overview.png');

  await expect(page.locator('.admin-health-grouped')).toBeVisible();
  const expand = page.locator('.admin-health-grouped button').filter({ hasText: 'Показать список' }).first();
  if (await expand.count()) await expand.click();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '08-admin-mobile-health.png');

  await page.locator('.admin-task-nav button').filter({ hasText: 'Роли и права' }).first().click();
  await expect(page.locator('.permission-grid')).toContainText('Управление');
  await expect(page.locator('.permission-grid')).not.toContainText(/admin\.[a-z]/);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '09-admin-mobile-permissions.png');

  await expect(page.locator('body')).not.toContainText('storagePath');
  await expectNoDialogs(page);
});
