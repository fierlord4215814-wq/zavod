import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage54-final-visual-audit-screenshots');
const visibleEnglishPattern = /\b(Loading|No data|Access denied|Network unavailable|Action queued|Admin configuration|Internal server error)\b/;
const mojibakePattern = /РїС—Р|Р В|вЂ|Â|Р“С’/;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
};

async function api(pathname: string, options: ApiOptions = {}) {
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
    Object.defineProperty(window, '__stage54Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage54Dialogs?: string[] }).__stage54Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectStableHumanPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('storagePath');
  expect(text).not.toContain('passwordHash');
  expect(text).not.toContain('DATABASE_URL');
  await expectNoHorizontalOverflow(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage54Login=${Date.now()}`);
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
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage54User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableHumanPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableHumanPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableHumanPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function capture(page: Page, fileName: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  await expectStableHumanPage(page);
  await expectNoDialogs(page);
}

async function maybeClick(page: Page, label: RegExp | string) {
  const button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(250);
    await expectStableHumanPage(page);
    return true;
  }
  return false;
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: финальный human audit по ролям и ключевым рабочим экранам', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop audit выполняется только в desktop-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await expect(page.getByRole('button', { name: 'Текущая' })).toBeVisible();
  await capture(page, '01-master-shift-current-desktop.png');

  await page.getByRole('button', { name: 'Следующая' }).click();
  await expect(page.locator('body')).toContainText('Я буду');
  await expect(page.locator('body')).not.toContainText('Работает');
  await capture(page, '02-master-shift-next-desktop.png');

  const planButton = page.locator('.line-plan-button').first();
  if (await planButton.isVisible().catch(() => false)) {
    await planButton.click();
    await expect(page.locator('.modal-card')).toContainText(/Плановые слоты|Доска назначений/);
    await capture(page, '03-master-assignment-board-desktop.png');
    await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await page.getByRole('button', { name: 'Прошлые' }).click();
  await expect(page.locator('body')).toContainText(/Архив|Прошл/);
  await expect(page.locator('body')).not.toContainText('Зафиксировать простой');
  await capture(page, '04-master-past-shift-desktop.png');

  await openMenuItem(page, 'Линии');
  await expect(page.locator('body')).toContainText(/Линии|Открыть/);
  await capture(page, '15-master-lines-desktop.png');

  await openMenuItem(page, 'Заявки');
  await expect(page.locator('body')).toContainText('Заявки');
  await capture(page, '16-master-tasks-desktop.png');

  await openMenuItem(page, 'Пересменка / Журнал');
  await expect(page.locator('body')).toContainText(/Пересменка|Журнал/);
  await capture(page, '17-master-handover-desktop.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Чек-листы');
  await maybeClick(page, 'Библиотека');
  await expect(page.locator('body')).toContainText(/Библиотека|Доступные чек-листы/);
  await capture(page, '05-checklists-library-desktop.png');

  await openMenuItem(page, 'Чаты');
  await expect(page.locator('body')).toContainText(/Общий чат завода|Чаты/);
  await capture(page, '07-chats-desktop.png');

  await openMenuItem(page, 'Объявления');
  await maybeClick(page, 'Управление');
  await expect(page.locator('body')).toContainText(/Объявления|Ознакомились|Управление/);
  await capture(page, '10-announcements-manager-report-desktop.png');

  await openMenuItem(page, /Админка|Администрирование/);
  await page.getByRole('button', { name: 'Заводы' }).click();
  await expect(page.locator('.factory-context-card')).toContainText(/Выбран завод:.*Завод 4/);
  await capture(page, '11-admin-factory-context-desktop.png');
  const adminText = await page.locator('.factory-context-card').innerText();
  expect(adminText).not.toMatch(uuidPattern);

  await loginAs(page, 'test-store');
  await openMenuItem(page, 'Заказы / Остатки');
  await expect(page.locator('body')).toContainText(/Единица|Остатк|Заказ/);
  await capture(page, '12-stock-units-desktop.png');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, 'ОКК');
  await expect(page.locator('body')).toContainText('ОКК');
  await capture(page, '13-okk-form-desktop.png');

  await loginAs(page, 'test-management');
  await openMenuItem(page, 'Архив');
  await expect(page.locator('body')).toContainText('Архив');
  await capture(page, '18-archive-desktop.png');

  await openMenuItem(page, 'Статистика / Аудит');
  await expect(page.locator('body')).toContainText(/Аудит|Статистика/);
  await capture(page, '19-ops-audit-desktop.png');
});

test('mobile 360px: финальный audit основных mobile flows без overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile audit выполняется только в mobile-проекте.');
  await page.setViewportSize({ width: 360, height: 740 });

  await loginAs(page, 'test-management');
  await openMenuItem(page, 'Чек-листы');
  await maybeClick(page, 'В работе');
  await capture(page, '06-checklists-run-mobile.png');

  await openMenuItem(page, 'Чаты');
  await expect(page.locator('body')).toContainText(/Чаты|Общий чат завода/);
  await capture(page, '08-chats-mobile.png');

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('body')).toContainText(/Ознакомлен|Новых объявлений нет|Архив объявлений/);
  await capture(page, '09-announcements-worker-mobile.png');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, 'ОКК');
  await capture(page, '20-okk-mobile.png');

  await loginAs(page, 'test-store');
  await openMenuItem(page, 'Возвраты на производство');
  await capture(page, '21-returns-mobile.png');

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, 'Оттайка');
  await expect(page.locator('body')).toContainText(/Оттайка|Производственные линии/);
  await capture(page, '22-defrost-mobile.png');

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Мойка');
  await expect(page.locator('body')).toContainText('Мойка');
  await capture(page, '14-wash-review-mobile.png');

  await openMenuItem(page, 'Смена');
  await expect(page.getByRole('button', { name: 'Следующая' })).toBeVisible();
  await capture(page, '23-shift-mobile.png');
});
