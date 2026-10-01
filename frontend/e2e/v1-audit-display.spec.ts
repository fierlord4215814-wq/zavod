import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'v1-completion-screenshots', 'audit-display');
const unsafeAuditText = /Chat read|CHAT_READ|test-[a-z0-9-]+|"dateFrom"|"dateTo"|"shiftType"|storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token=|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/i;
const mojibakePattern = /Гђ|Г‘|РІР‚|Р В|Р’В/;

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

async function loginAsManagement(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareV1AuditLogin=${Date.now()}`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'test-management');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?v1AuditUser=test-management&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if (await more.count()) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__v1AuditDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __v1AuditDialogs?: string[] }).__v1AuditDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function expectAuditReadable(page: Page) {
  const auditTab = page.getByRole('button', { name: 'Аудит', exact: true });
  await expect(auditTab).toBeVisible();
  await auditTab.click();
  await expect(page.locator('body')).toContainText('Доступ запрещён');
  await expect(page.locator('body')).toContainText('Доступ');
  await expect(page.locator('body')).toContainText(/Администратор|Руководитель|Мастер|Работник/);
  await expect(page.locator('body')).toContainText('раздел:');
  await expect(page.locator('.details-pre')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(unsafeAuditText);
  expect(text).not.toMatch(mojibakePattern);
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|internal server error/i);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('v1 audit display is human-readable on desktop and mobile', async ({ page }) => {
  await loginAsManagement(page);
  await openMenuItem(page, /Статистика \/ Аудит/);
  await expectAuditReadable(page);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '01-audit-display-desktop.png');

  await page.setViewportSize({ width: 360, height: 760 });
  await expectAuditReadable(page);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '02-audit-display-mobile.png');
  await expectNoDialogs(page);
});
