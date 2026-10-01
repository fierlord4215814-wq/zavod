import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'v1-resilience-screenshots');

async function api(pathname: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', body: { userId: 'pilot-pack-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__resilienceDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __resilienceDialogs?: string[] }).__resilienceDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectNoTechnicalLeak(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|internalPath|passwordHash|DATABASE_URL|JWT_SECRET|SESSION_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
  expect(text).not.toMatch(/Cannot read properties|Unhandled Runtime Error|Application error|Unexpected token|TypeError|ReferenceError/i);
}

async function expectHealthyScreen(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toHaveText('');
  await expectNoTechnicalLeak(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function loginAsAdmin(page: Page, factoryId: string) {
  await page.goto('/');
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'pilot-pack-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthyScreen(page);
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

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function closePilotErrorReports(factoryId: string, marker: string) {
  const response = await fetch(`${apiUrl}/error-reports`, {
    headers: { 'x-user-id': 'pilot-pack-admin', 'x-factory-id': factoryId },
  });
  if (!response.ok) return;
  const reports = await response.json();
  for (const report of Array.isArray(reports) ? reports : []) {
    if (String(report.title ?? '').includes(marker) && report.status !== 'CLOSED') {
      await fetch(`${apiUrl}/error-reports/${report.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'pilot-pack-admin', 'x-factory-id': factoryId },
        body: JSON.stringify({ status: 'CLOSED' }),
      });
    }
  }
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop survives offline, reconnect and slow API without white screen', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop resilience smoke.');
  const factoryId = await resolveFactoryId();
  await loginAsAdmin(page, factoryId);
  await screenshot(page, 'desktop-online.png');

  await context.setOffline(true);
  await openSection(page, /Заявки/);
  await page.waitForTimeout(700);
  await expectHealthyScreen(page);
  await screenshot(page, 'desktop-offline-tasks.png');

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthyScreen(page);

  const marker = `PILOT_RESILIENCE_OFFLINE_${Date.now()}`;
  await openSection(page, /Сообщить об ошибке/);
  await page.getByLabel(/Тема/).fill(`${marker} submit`);
  await page.getByLabel(/Описание/).fill(`${marker} offline form submit`);
  await context.setOffline(true);
  await page.getByRole('button', { name: /Отправить/ }).click();
  await page.waitForTimeout(800);
  await expectHealthyScreen(page);
  await screenshot(page, 'desktop-offline-form-submit.png');
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthyScreen(page);
  await closePilotErrorReports(factoryId, marker);

  await context.route(`${apiUrl}/tasks**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await openSection(page, /Заявки/);
  await page.waitForTimeout(1_200);
  await expectHealthyScreen(page);
  await screenshot(page, 'desktop-slow-api-tasks.png');
});

test('mobile 360/390/430 keeps navigation and content readable after reconnect', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile resilience smoke.');
  const factoryId = await resolveFactoryId();
  await loginAsAdmin(page, factoryId);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    for (const section of [/Смена/, /Линии/, /Чек-листы/, /Чаты/, /Сообщить об ошибке/]) {
      await openSection(page, section);
      await page.waitForTimeout(200);
      await expectHealthyScreen(page);
    }

    await context.setOffline(true);
    await openSection(page, /Объявления/);
    await page.waitForTimeout(500);
    await expectHealthyScreen(page);
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
    await expectHealthyScreen(page);
    await screenshot(page, `mobile-${width}-reconnected.png`);
  }
});
