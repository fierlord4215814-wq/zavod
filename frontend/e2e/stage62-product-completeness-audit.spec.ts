import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage62-product-completeness-audit-screenshots');

const visibleEnglishPattern = /\b(Loading|No data|Access denied|Network unavailable|Action queued|Internal server error|Settings|Overview|Save|Cancel|Error)\b/;
const mojibakePattern = /Р\?|Рђ|Рџ|СЃ|С‚|\?{4,}/;
const runtimeNoisePattern = /\b(Stage\d+|stage\d+|regression|browser|simulation|demo line|test line)\b/i;
const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i;

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
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectProductScreen(page: Page, options: { allowStageNoise?: boolean } = {}) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toMatch(secretPattern);
  if (!options.allowStageNoise) expect(text).not.toMatch(runtimeNoisePattern);
  await expectNoHorizontalOverflow(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage62Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage62User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectProductScreen(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    await page.waitForTimeout(350);
    await expectProductScreen(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if (await more.count()) {
    await more.first().click();
    const sheetButton = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
    await sheetButton.scrollIntoViewIfNeeded();
    await sheetButton.click();
    await page.waitForTimeout(350);
    await expectProductScreen(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function capture(page: Page, fileName: string, options: { allowStageNoise?: boolean } = {}) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await expectProductScreen(page, options);
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  await expectNoDialogs(page);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('mobile 360px: рабочие модули открываются как продуктовые экраны', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile audit запускается только в mobile project.');
  await page.setViewportSize({ width: 360, height: 760 });

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await expect(page.locator('body')).toContainText(/Текущая|Следующая|Будущие|Прошлые/);
  await capture(page, '01-shift-mobile.png');

  await openMenuItem(page, 'Линии');
  await expect(page.locator('body')).toContainText(/Линии|Открыть|В работе|Простой|Мойка/);
  await capture(page, '02-lines-mobile.png');

  await openMenuItem(page, 'Мойка');
  await expect(page.locator('body')).toContainText(/Мойка|Начать мойку|В работе|Завершена|Моек пока нет/);
  await capture(page, '03-wash-mobile.png');

  await openMenuItem(page, 'Заявки');
  await expect(page.locator('body')).toContainText(/Заявки|Новая заявка|Взять|Передать|Нет заявок/);
  await capture(page, '04-tasks-mobile.png');

  await openMenuItem(page, 'Чек-листы');
  await expect(page.locator('body')).toContainText(/Чек-листы|Библиотека|В работе|Архив|Доступные/);
  await capture(page, '05-checklists-mobile.png');

  await loginAs(page, 'test-okk');
  await openMenuItem(page, 'ОКК');
  await expect(page.locator('body')).toContainText(/ОКК|Новый брак|Журнал|Записей нет/);
  await capture(page, '06-okk-mobile.png');

  await loginAs(page, 'test-store');
  await openMenuItem(page, 'Заказы / Остатки');
  await expect(page.locator('body')).toContainText(/Остатки|Заказы|Единица|Израсходовано|Пополнено/);
  await capture(page, '07-stock-mobile.png');

  await openMenuItem(page, /Возвраты/);
  await expect(page.locator('body')).toContainText(/Возвраты|Новая запись|Архив|Записей нет/);
  await capture(page, '08-returns-mobile.png');

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, 'Оттайка');
  await expect(page.locator('body')).toContainText(/Оттайка|Календарь|Недостаточно данных|30 дней|60 дней/);
  await capture(page, '09-defrost-mobile.png');

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('body')).toContainText(/Объявления|Новых объявлений нет|Ознакомлен|Архив объявлений/);
  await capture(page, '10-announcements-mobile.png');

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('body')).toContainText(/Чаты|Общий чат завода|Сообщение|Непрочитанные/);
  await capture(page, '11-chats-mobile.png');
});

test('desktop: архив, статистика и админка открываются без demo-layer признаков', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop audit запускается только в desktop project.');

  await loginAs(page, 'test-management');
  await openMenuItem(page, 'Архив');
  await expect(page.locator('body')).toContainText(/Архив|Файлы и вложения|Заявки и простои|Мойка/);
  await capture(page, '12-archive-desktop.png');

  await openMenuItem(page, 'Статистика / Аудит');
  await expect(page.locator('body')).toContainText(/Статистика|Аудит|Действия|Фильтр/);
  await capture(page, '13-statistics-desktop.png', { allowStageNoise: true });

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Админка|Администрирование/);
  await expect(page.locator('body')).toContainText(/Админка|Выбран завод|Роли и права|Настройки модулей/);
  await capture(page, '14-admin-desktop.png', { allowStageNoise: true });
});
