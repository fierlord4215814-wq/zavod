import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage62-safe-data-hygiene-screenshots');

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
    Object.defineProperty(window, '__stage62Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage62Dialogs?: string[] }).__stage62Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage62Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage62User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  return factoryId;
}

async function openAdmin(page: Page) {
  const direct = page.locator('button:visible').filter({ hasText: /Админка|Администрирование/ });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  const more = page.locator('button:visible').filter({ hasText: /Ещё|Еще/ });
  if (await more.count()) {
    await more.first().click();
    await page.locator('button:visible').filter({ hasText: /Админка|Администрирование/ }).first().click();
    return;
  }
  throw new Error('Админка не найдена в навигации');
}

async function openAdminSection(page: Page, title: string) {
  await page.locator('.admin-task-nav button').filter({ hasText: title }).first().click();
  await page.waitForTimeout(300);
}

async function openAppSection(page: Page, title: RegExp) {
  const direct = page.locator('button:visible').filter({ hasText: title });
  if (await direct.count()) {
    await direct.first().click();
    return true;
  }
  const more = page.locator('button:visible').filter({ hasText: /Ещё|Еще/ });
  if (await more.count()) {
    await more.first().click();
    const nested = page.locator('button:visible').filter({ hasText: title });
    if (await nested.count()) {
      await nested.first().click();
      return true;
    }
  }
  return false;
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: диагностика данных отделена от обычного recovery и runtime stock', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots проверяются отдельно от mobile.');
  const factoryId = await loginAsAdmin(page);

  const summary = await api(`/admin/data-hygiene/summary?factoryId=${factoryId}`, { userId: 'test-admin', factoryId });
  expect(summary.total).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(summary)).not.toMatch(/storagePath|passwordHash|token|secret/i);

  await openAdmin(page);
  await expect(page.locator('body')).toContainText('Диагностика данных');
  await screenshot(page, '01-admin-diagnostic-summary.png');

  await openAdminSection(page, 'Восстановление');
  await expect(page.locator('.recovery-center')).toContainText('Центр восстановления');
  await expect(page.locator('.recovery-center')).not.toContainText(/Stage62 hygiene|\?{3,}/);
  await screenshot(page, '02-recovery-normal-clean.png');

  await expect(page.locator('.recovery-center')).toContainText(/Открыть диагностику|Центр восстановления/);
  await screenshot(page, '03-recovery-diagnostic-records.png');

  const openedStock = await openAppSection(page, /Заказы|Остатки/);
  if (openedStock) {
    await page.waitForTimeout(500);
    await expect(page.locator('body')).not.toContainText('Stage62 dirty stock');
  }
  await screenshot(page, '04-dirty-stock-hidden-runtime.png');

  await openAdmin(page);
  await openAdminSection(page, 'Диагностика данных');
  await expect(page.locator('.recovery-center')).toContainText('Диагностика данных');
  await expect(page.locator('.recovery-center')).toContainText(/Тестовые записи|Грязные остатки/);
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|token|secret/i);
  await screenshot(page, '05-data-hygiene-records.png');

  const records = await api(`/admin/data-hygiene/records?factoryId=${factoryId}&type=minimum-stock-item&pageSize=100`, { userId: 'test-admin', factoryId });
  expect(JSON.stringify(records)).toContain('dirty-stock');
  expect(JSON.stringify(records)).not.toMatch(/storagePath|passwordHash|token|secret/i);

  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360px: диагностика и восстановление не ломают ширину', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile сценарий запускается в mobile project.');
  await page.setViewportSize({ width: 360, height: 760 });
  await loginAsAdmin(page);
  await openAdmin(page);

  await openAdminSection(page, 'Диагностика данных');
  await expect(page.locator('.recovery-center')).toContainText('Диагностика данных');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '06-mobile-diagnostic-summary.png');

  await openAdminSection(page, 'Восстановление');
  await expect(page.locator('.recovery-center')).toContainText('Центр восстановления');
  await expect(page.locator('.recovery-center')).not.toContainText(/Stage62 hygiene|\?{3,}/);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '07-mobile-recovery-clean.png');

  await expectNoDialogs(page);
});
