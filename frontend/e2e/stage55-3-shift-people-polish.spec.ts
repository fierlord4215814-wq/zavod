import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage55-3-shift-people-polish-screenshots');
const mojibakePattern = /Рџ|Рќ|РЎ|Р’|Р—|Рґ|Р°|СЃ|С‹|В·/;
const visibleEnglishPattern = /\b(Loading|No data|Internal server error|Access denied|storagePath|passwordHash|admin\.|assignments\.|tasks\.)\b/;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string; body?: unknown } = {}) {
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
    Object.defineProperty(window, '__stage553Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage553Dialogs?: string[] }).__stage553Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectHumanPage(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage553Login=${Date.now()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?stage553User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectHumanPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectHumanPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё/ }).filter({ visible: true });
  await expect(more.first()).toBeVisible();
  await more.first().click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
  await expectHumanPage(page);
}

async function capture(page: Page, fileName: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  await expectHumanPage(page);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('Stage55.3: future planning, work areas, people and service status feel human', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');

  await page.getByRole('button', { name: 'Будущие' }).click();
  await expect(page.locator('.planning-card')).toContainText('Выберите дату');
  const futureCard = page.locator('.planning-card .position-row').first();
  await expect(futureCard).toBeVisible();
  await futureCard.click();
  await expect(page.locator('.planning-card')).toContainText('Плановые линии выбранной смены');
  await expect(page.locator('.planning-card')).not.toContainText('Работает');
  await capture(page, '01-future-shift-planning.png');

  const addLine = page.getByRole('button', { name: 'Добавить линию в план' }).first();
  if (await addLine.isVisible().catch(() => false)) {
    await addLine.click();
    await expect(page.locator('.compact-modal')).toContainText('Выберите реальную производственную линию');
    const lineButton = page.locator('.line-plan-button').first();
    if (await lineButton.isVisible().catch(() => false)) {
      await lineButton.click();
      await expect(page.locator('.assignment-board')).toContainText('Плановые слоты');
    } else {
      await page.locator('.compact-modal').getByRole('button', { name: 'Закрыть' }).click();
    }
  }
  await capture(page, '02-future-line-board.png');

  const closePlanning = page.locator('.line-dashboard-card .sticky-actions').getByRole('button', { name: 'Закрыть' }).first();
  if (await closePlanning.isVisible().catch(() => false)) await closePlanning.click();
  await page.getByRole('button', { name: 'Текущая' }).click();
  const workAreaOpen = page.getByRole('button', { name: /Открыть/ }).filter({ hasText: /Повремен|рабоч|зон/i }).first();
  if (await workAreaOpen.isVisible().catch(() => false)) {
    await workAreaOpen.click();
    await expect(page.locator('.assignment-board')).toBeVisible();
    await expect(page.locator('.line-dashboard-card').getByRole('button', { name: 'Выбрать сотрудника' }).first()).toBeVisible();
    await expect(page.locator('.candidate-card').first()).toContainText(/Выбрать|Выбран/);
    await expect(page.locator('.sticky-actions').getByRole('button', { name: /Выберите слот и сотрудника|Назначить:/ })).toBeVisible();
    await capture(page, '03-work-area-compact.png');
    await page.locator('.line-dashboard-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await openMenuItem(page, 'Люди');
  await expect(page.locator('.list-row').first()).toBeVisible();
  await expect(page.locator('.list-row.on-shift').first()).toBeVisible();
  await capture(page, '04-people-on-shift-highlight.png');

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Люди');
  await page.locator('input[placeholder*="Поиск"]').fill('электрик');
  await page.getByRole('button', { name: 'Обновить' }).click();
  const electricRow = page.locator('.list-row').filter({ hasText: /Электрик|электрик|Электрики/ }).first();
  await expect(electricRow).toBeVisible();
  await electricRow.click();
  await expect(page.locator('.profile-card')).toContainText(/Сейчас на заявке|Свободен/);
  await capture(page, '05-service-profile-task-status.png');

  await page.setViewportSize({ width: 360, height: 760 });
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: 'Будущие' }).click();
  await expect(page.locator('.planning-card')).toBeVisible();
  await capture(page, '06-mobile-future-planning.png');
});
