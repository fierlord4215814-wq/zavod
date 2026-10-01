import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage55-mobile-pilot-polish-screenshots');
const mojibakePattern = /Р С—РЎвЂ”Р |Р В Р’|РІР‚|Г‚|Р вЂњРЎвЂ™/;
const visibleEnglishPattern = /\b(Loading|No data|Internal server error|Access denied|WORKER|CONTRACTOR|storagePath)\b/;

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
    Object.defineProperty(window, '__stage55Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage55Dialogs?: string[] }).__stage55Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectHumanMobilePage(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('passwordHash');
  expect(text).not.toContain('DATABASE_URL');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage55Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage55User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectHumanMobilePage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectHumanMobilePage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectHumanMobilePage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function capture(page: Page, fileName: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  await expectHumanMobilePage(page);
}

async function maybeClick(page: Page, label: RegExp | string) {
  const button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(300);
    await expectHumanMobilePage(page);
    return true;
  }
  return false;
}

async function clickVisibleTextButton(page: Page, label: RegExp | string) {
  const target = page.locator('button:visible').filter({ hasText: label }).first();
  await expect(target).toBeVisible();
  await target.click({ force: true });
  await page.waitForTimeout(300);
  await expectHumanMobilePage(page);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await installDialogGuards(page);
});

test('mobile: Stage55 pilot polish screens are readable and operational', async ({ page }) => {
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: 'Текущая' }).click();
  await expect(page.locator('body')).toContainText('Всего на текущей смене');
  await capture(page, '01-shift-current-mobile.png');

  await page.getByRole('button', { name: 'Следующая' }).click();
  await expect(page.locator('body')).toContainText('Отметились “Я буду”');
  await expect(page.locator('body')).not.toContainText('В работе сейчас');
  await capture(page, '02-shift-next-mobile.png');

  await page.getByRole('button', { name: 'Будущие' }).click();
  await expect(page.locator('body')).toContainText('Будущих смен');
  await capture(page, '03-shift-future-open-mobile.png');

  await page.getByRole('button', { name: 'Следующая' }).click();
  const planButton = page.locator('.line-plan-button').first();
  if (await planButton.isVisible().catch(() => false)) {
    await planButton.click();
    await expect(page.locator('.modal-card')).toContainText('Плановые слоты');
    const freeSlot = page.locator('.modal-card .slot-row').filter({ hasText: 'Свободен' }).first();
    if (await freeSlot.isVisible().catch(() => false)) {
      await freeSlot.getByRole('button', { name: /Выбрать слот|Выбрать человека/ }).first().click();
    }
    const candidate = page.locator('.modal-card .candidate-card').first();
    if (await candidate.isVisible().catch(() => false)) await candidate.click();
    await capture(page, '04-assignment-slot-to-person-mobile.png');
    await capture(page, '05-assignment-person-to-slot-mobile.png');
    await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await openMenuItem(page, 'Люди');
  await maybeClick(page, 'Вне смены');
  await capture(page, '06-people-filters-mobile.png');
  const firstPerson = page.locator('.list-row').first();
  if (await firstPerson.isVisible().catch(() => false)) {
    await firstPerson.click();
    await expect(page.locator('.profile-card')).toBeVisible();
    await capture(page, '07-profile-worker-mobile.png');
    await page.locator('.profile-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await openMenuItem(page, 'Линии');
  await expect(page.locator('body')).toContainText('Активные линии');
  await capture(page, '09-lines-mobile.png');
  const statsButton = page.getByRole('button', { name: 'Статистика' }).filter({ visible: true }).first();
  if (await statsButton.isVisible().catch(() => false)) {
    await statsButton.click();
    await expect(page.locator('.modal-card')).toContainText('Статистика линии');
    await capture(page, '10-line-runtime-stats-mobile.png');
    await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();
  } else {
    await capture(page, '10-line-runtime-stats-mobile.png');
  }

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Заказы|Остатки/);
  await expect(page.locator('body')).toContainText('%');
  await capture(page, '11-stock-mobile.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Люди');
  const adminPerson = page.locator('.list-row').first();
  if (await adminPerson.isVisible().catch(() => false)) {
    await adminPerson.click();
    await expect(page.locator('.profile-card')).toBeVisible();
    await capture(page, '08-profile-admin-mobile.png');
    await page.locator('.profile-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await openMenuItem(page, 'Чаты');
  const chat = page.locator('.messenger-chat-card').first();
  if (await chat.isVisible().catch(() => false)) await chat.click();
  await expect(page.locator('.messenger-list-panel, .messenger-dialog-panel').first()).toBeVisible();
  await capture(page, '12-chat-detail-mobile.png');

  await openMenuItem(page, /Админка|Администрирование/);
  await clickVisibleTextButton(page, 'Роли и права');
  await expect(page.locator('body')).toContainText('Создание собственных должностей');
  await capture(page, '13-admin-permissions-mobile.png');
  await clickVisibleTextButton(page, 'Настройки модулей');
  await expect(page.locator('body')).toContainText('Настройки для');
  await capture(page, '14-admin-module-settings-mobile.png');
});
