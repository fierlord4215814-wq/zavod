import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage60-admin-safety-recovery-screenshots');

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

async function createStage60Line(factoryId: string, marker: string) {
  return api('/admin/lines', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      factoryId,
      name: `Проверка восстановления линия ${marker}`,
      status: 'STOP',
      reason: 'Проверка центра восстановления',
    },
  });
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage60Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage60Dialogs?: string[] }).__stage60Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?prepareStage60Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage60User=test-admin&t=${Date.now()}`);
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

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN отключает и восстанавливает линию через Центр восстановления', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop flow проверяется отдельно от mobile overflow.');
  const marker = Date.now().toString(36);
  const factoryId = await loginAsAdmin(page);
  const createdLine = await createStage60Line(factoryId, marker);
  await api(`/admin/lines/${createdLine.id}`, {
    method: 'PATCH',
    userId: 'test-admin',
    factoryId,
    body: { isActive: false, reason: 'Линия больше не используется' },
  });
  await openAdmin(page);

  await expect(page.locator('.admin-overview')).toContainText('В восстановлении');
  await screenshot(page, '01-admin-overview-recovery-summary.png');

  await page.locator('.admin-task-nav button').filter({ hasText: 'Восстановление' }).first().click();
  await expect(page.locator('.recovery-center')).toContainText(`Проверка восстановления линия ${marker}`);
  await expect(page.locator('.recovery-center')).toContainText('Линия больше не используется');
  await screenshot(page, '04-recovery-center-line.png');

  const recoveryRow = page.locator('.recovery-row').filter({ hasText: `Проверка восстановления линия ${marker}` }).first();
  await recoveryRow.getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.locator('.modal-card')).toContainText('Восстановить');
  await screenshot(page, '05-restore-modal.png');
  await page.locator('.modal-card .primary-button').click();
  await expect(page.locator('.modal-card')).toHaveCount(0);
  await expect(page.locator('.recovery-center')).not.toContainText(`Проверка восстановления линия ${marker}`);
  await screenshot(page, '06-recovery-after-restore.png');

  await page.locator('.admin-task-nav button').filter({ hasText: 'Аудит действий админки' }).first().click();
  await expect(page.locator('.admin-card').filter({ hasText: 'Аудит изменений' })).toBeVisible();
  await screenshot(page, '07-admin-audit-context.png');

  await expect(page.locator('body')).not.toContainText('storagePath');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('ADMIN mobile 360px видит Центр восстановления без overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile сценарий запускается в mobile project.');
  await page.setViewportSize({ width: 360, height: 800 });
  await loginAsAdmin(page);
  await openAdmin(page);

  await page.locator('.admin-task-nav button').filter({ hasText: 'Восстановление' }).first().click();
  await expect(page.locator('.recovery-center')).toContainText('Центр восстановления');
  await expect(page.locator('.recovery-center')).toContainText('Окно восстановления: 30 дней');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '08-mobile-recovery-center.png');

  await expect(page.locator('body')).not.toContainText('storagePath');
  await expectNoDialogs(page);
});
