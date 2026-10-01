import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-route-acceptance-v1', 'screenshots');

type ScreenId =
  | 'Shift' | 'People' | 'Admin' | 'Situation' | 'Tasks' | 'Wash' | 'OKK' | 'Stock'
  | 'Orders' | 'Checklists' | 'Defrost' | 'Returns' | 'Log' | 'Chats' | 'Announcements'
  | 'Archive' | 'Notifications' | 'Ops' | 'Report';

type RouteView = {
  file: string;
  userId: string;
  screen: ScreenId;
  label: string;
};

const routeViews: RouteView[] = [
  { file: '01-access-guest-report-mobile.png', userId: 'pilot-pack-guest', screen: 'Report', label: 'Сообщить об ошибке' },
  { file: '02-worker-shift-mobile.png', userId: 'pilot-worker-1', screen: 'Shift', label: 'Смена' },
  { file: '03-master-shift-mobile.png', userId: 'pilot-master-1', screen: 'Shift', label: 'Смена' },
  { file: '04-people-search-mobile.png', userId: 'pilot-master-1', screen: 'People', label: 'Люди' },
  { file: '05-lines-mobile.png', userId: 'pilot-master-1', screen: 'Situation', label: 'Линии' },
  { file: '06-tasks-mobile.png', userId: 'pilot-master-1', screen: 'Tasks', label: 'Заявки' },
  { file: '07-wash-mobile.png', userId: 'pilot-master-1', screen: 'Wash', label: 'Мойка' },
  { file: '08-defrost-mobile.png', userId: 'pilot-master-1', screen: 'Defrost', label: 'Оттайка' },
  { file: '09-checklists-mobile.png', userId: 'pilot-pack-admin', screen: 'Checklists', label: 'Чек-листы' },
  { file: '10-handover-mobile.png', userId: 'pilot-master-1', screen: 'Log', label: 'Пересменка / Журнал' },
  { file: '11-chat-mobile.png', userId: 'pilot-tech-kipia-1', screen: 'Chats', label: 'Чаты' },
  { file: '12-announcements-mobile.png', userId: 'pilot-worker-1', screen: 'Announcements', label: 'Объявления' },
  { file: '13-notifications-mobile.png', userId: 'pilot-worker-1', screen: 'Notifications', label: 'Уведомления' },
  { file: '14-okk-mobile.png', userId: 'pilot-okk-1', screen: 'OKK', label: 'ОКК' },
  { file: '15-stock-mobile.png', userId: 'pilot-pack-admin', screen: 'Stock', label: 'Некондиция' },
  { file: '16-orders-mobile.png', userId: 'pilot-pack-admin', screen: 'Orders', label: 'Заказы / Остатки' },
  { file: '17-returns-mobile.png', userId: 'pilot-store-1', screen: 'Returns', label: 'Возвраты на производство' },
  { file: '18-archive-mobile.png', userId: 'pilot-pack-admin', screen: 'Archive', label: 'Архив' },
  { file: '19-statistics-audit-mobile.png', userId: 'pilot-pack-admin', screen: 'Ops', label: 'Статистика / Аудит' },
  { file: '20-admin-mobile.png', userId: 'pilot-pack-admin', screen: 'Admin', label: 'Админка' },
];

async function factoryIdFor(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`Не удалось открыть тестовую сессию ${userId}: HTTP ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error(`Для ${userId} не найден доступный завод`);
  return factory.id as string;
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await factoryIdFor(userId);
  // Use the static same-origin offline page as a storage bridge. It has no app
  // bootstrap that could race and write the previous dev user back.
  await page.goto('/offline.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 20_000 });
}

async function openScreen(page: Page, screen: ScreenId, label: string) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await expect(page.locator('.nav-button.active').filter({ hasText: label })).toHaveCount(1, { timeout: 12_000 });
  await expect.poll(async () => page.locator('body').innerText(), { timeout: 15_000 })
    .not.toMatch(/Загрузка(?: настроек)?\.\.\.|Загружаю\.\.\./i);
  await page.waitForTimeout(250);
}

async function expectHealthy(page: Page) {
  const metrics = await page.evaluate(() => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    textLength: document.body.innerText.trim().length,
    placeholders: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]'))
      .map((item) => item.placeholder)
      .filter((value) => /^(search|enter|select|type here|placeholder)/i.test(value.trim())),
  }));
  expect(metrics.overflow, 'Горизонтальный overflow').toBeLessThanOrEqual(4);
  expect(metrics.textLength, 'Экран не должен быть пустым').toBeGreaterThan(30);
  expect(metrics.placeholders, 'Видимые английские placeholders').toEqual([]);

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/Application error|Cannot read properties|Unexpected token/i);
  expect(text).not.toContain('Нет доступа к этому действию');
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+[A-Za-z0-9._-]+/i);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
}

async function saveEvidence(page: Page, file: string) {
  await page.screenshot({ path: path.join(screenshotsDir, file), fullPage: false });
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotsDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__pilotRouteDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещённый browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
});

test('desktop: сквозные пилотные поверхности доступны своим ролям', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop evidence only.');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });

  const views: RouteView[] = [
    { file: '21-lines-desktop.png', userId: 'pilot-master-1', screen: 'Situation', label: 'Линии' },
    { file: '22-checklists-desktop.png', userId: 'pilot-pack-admin', screen: 'Checklists', label: 'Чек-листы' },
    { file: '23-chat-desktop.png', userId: 'pilot-tech-kipia-1', screen: 'Chats', label: 'Чаты' },
    { file: '24-archive-desktop.png', userId: 'pilot-pack-admin', screen: 'Archive', label: 'Архив' },
    { file: '25-statistics-audit-desktop.png', userId: 'pilot-pack-admin', screen: 'Ops', label: 'Статистика / Аудит' },
    { file: '26-admin-desktop.png', userId: 'pilot-pack-admin', screen: 'Admin', label: 'Админка' },
  ];

  let activeUser = '';
  for (const view of views) {
    if (activeUser !== view.userId) {
      await loginAs(page, view.userId);
      activeUser = view.userId;
    }
    await openScreen(page, view.screen, view.label);
    await expectHealthy(page);
    await saveEvidence(page, view.file);
  }
});

test('mobile: 14 обязательных маршрутов читаемы на 360 px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile evidence only.');
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 360, height: 800 });

  let activeUser = '';
  for (const view of routeViews) {
    if (activeUser !== view.userId) {
      await loginAs(page, view.userId);
      activeUser = view.userId;
    }
    await openScreen(page, view.screen, view.label);
    await expectHealthy(page);
    const dialogs = await page.evaluate(() => (window as unknown as { __pilotRouteDialogs?: string[] }).__pilotRouteDialogs ?? []);
    expect(dialogs).toEqual([]);
    await saveEvidence(page, view.file);
  }
});

test('mobile: shell сохраняет геометрию на 390 и 430 px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile geometry only.');
  test.setTimeout(120_000);
  await loginAs(page, 'pilot-master-1');
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await openScreen(page, 'Situation', 'Линии');
    await expectHealthy(page);
    await saveEvidence(page, width === 390 ? '27-lines-mobile-390.png' : '28-lines-mobile-430.png');
  }
});
