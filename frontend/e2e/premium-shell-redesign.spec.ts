import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-premium-shell-redesign-screenshots');
const visibleEnglish = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data)\b/i;
const technicalLeak = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+/i;

const lineFixture = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    name: 'Хинкали мини',
    status: 'PAUSE',
    activeWorkersCount: 1,
    activeDowntimeEvent: {
      id: 'a2000000-0000-4000-8000-000000000001',
      status: 'PAUSE',
      createdAt: new Date(Date.now() - 37 * 60_000).toISOString(),
      downtimeReason: 'TECHNICAL',
      comment: 'Проверка датчика температуры',
    },
  },
  { id: 'a1000000-0000-4000-8000-000000000002', name: 'Пицца Рондо', status: 'WORK', activeWorkersCount: 3 },
  { id: 'a1000000-0000-4000-8000-000000000003', name: 'Пельмени домашние', status: 'STOP', activeWorkersCount: 0 },
  { id: 'a1000000-0000-4000-8000-000000000004', name: 'Блины с творогом', status: 'STOP', activeWorkersCount: 0 },
];

const washFixture = [{
  id: 'a3000000-0000-4000-8000-000000000001',
  lineId: lineFixture[2].id,
  lineName: lineFixture[2].name,
  targetType: 'LINE',
  createdAt: new Date(Date.now() - 22 * 60_000).toISOString(),
  status: 'ACTIVE',
  lifecycleStatus: 'STARTED',
  lifecycleLabel: 'Мойка идёт',
  active: true,
  messages: [],
  issues: [],
  controlItems: [],
  startedByName: 'Петров А. С.',
}];

const workerFixture: Record<string, Array<{ id: string; name: string }>> = {
  [lineFixture[0].id]: [{ id: 'person-1', name: 'Смирнов И. О.' }],
  [lineFixture[1].id]: [
    { id: 'person-2', name: 'Иванов И. П.' },
    { id: 'person-3', name: 'Петров А. С.' },
    { id: 'person-4', name: 'Сидорова М. В.' },
  ],
};

async function factory4Id() {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'pilot-pack-admin' }),
  });
  if (!response.ok) throw new Error(`Не удалось открыть пилотную сессию: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string; name?: string }) => item.code === 'factory-4' || item.name === 'Завод 4')
    ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error('Завод 4 недоступен для визуальной проверки');
  return factory.id as string;
}

async function installReadOnlyLineFixture(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    const url = new URL(request.url());
    if (url.origin !== new URL(apiUrl).origin) return route.continue();
    if (url.pathname === '/lines') return route.fulfill({ json: lineFixture });
    if (url.pathname === '/wash') return route.fulfill({ json: washFixture });
    const dashboard = url.pathname.match(/^\/lines\/([^/]+)\/dashboard$/);
    if (dashboard) {
      const line = lineFixture.find((item) => item.id === dashboard[1]);
      const workers = workerFixture[dashboard[1]] ?? [];
      return route.fulfill({
        status: line ? 200 : 404,
        json: line ? {
          line,
          assignmentsByPosition: [],
          withoutPosition: workers.map((worker) => ({ id: worker.id, userId: worker.id, displayName: worker.name, startedAt: new Date().toISOString() })),
          activeTasks: [],
          activeWash: [],
          activeDefrost: null,
        } : { message: 'Линия не найдена' },
      });
    }
    const workers = url.pathname.match(/^\/lines\/([^/]+)\/workers$/);
    if (workers) return route.fulfill({ json: workerFixture[workers[1]] ?? [] });
    return route.continue();
  });
}

async function installSession(page: Page) {
  const factoryId = await factory4Id();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { userId: 'pilot-pack-admin', selectedFactoryId: factoryId });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

async function openScreen(page: Page, screen: string, heading: string) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await expect(page.locator('.premium-screen-heading h2')).toHaveText(heading, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

async function expectNoOverflow(page: Page, label: string) {
  const layout = await page.evaluate(() => ({
    page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    app: document.querySelector('.app-shell')
      ? (document.querySelector('.app-shell') as HTMLElement).scrollWidth - (document.querySelector('.app-shell') as HTMLElement).clientWidth
      : 0,
  }));
  expect(layout.page, `${label}: page overflow`).toBeLessThanOrEqual(2);
  expect(layout.app, `${label}: app overflow`).toBeLessThanOrEqual(2);
}

async function expectCleanUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(visibleEnglish);
  expect(text).not.toMatch(technicalLeak);
  expect(text).not.toMatch(/Рџ|РЎ|РµР|Р°Р|�/);
}

async function screenshotTopSection(page: Page, fileName: string) {
  const viewport = page.viewportSize();
  const kpi = await page.locator('.premium-kpi-strip').first().boundingBox();
  if (!viewport || !kpi) throw new Error(`Не найден верхний KPI-блок для ${fileName}`);
  const height = Math.min(viewport.height, Math.ceil(kpi.y + kpi.height + 12));
  await page.screenshot({
    path: path.join(screenshotDir, fileName),
    clip: { x: 0, y: 0, width: viewport.width, height },
  });
}

async function verifyMobileLines(page: Page) {
  await openScreen(page, 'Situation', 'Линии');
  await expect(page.locator('.line-filter-metrics .premium-kpi-card')).toHaveCount(4);
  await expect(page.locator('.line-filter-metrics')).toContainText('Простой');
  await expect(page.locator('.line-filter-metrics')).toContainText('В работе');
  await expect(page.locator('.line-filter-metrics')).toContainText('Мойка');
  await expect(page.locator('.line-filter-metrics')).toContainText('Назначены');

  const geometry = await page.locator('.line-filter-metrics .premium-kpi-card').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { top: Math.round(rect.top), width: rect.width, height: rect.height };
  }));
  expect(new Set(geometry.map((item) => item.top)).size).toBe(1);
  const viewportWidth = page.viewportSize()?.width ?? 360;
  const maximumTileWidth = viewportWidth <= 360 ? 86 : viewportWidth <= 390 ? 94 : 104;
  for (const item of geometry) {
    expect(item.width).toBeGreaterThanOrEqual(70);
    expect(item.width).toBeLessThanOrEqual(maximumTileWidth);
    expect(item.height).toBeLessThanOrEqual(86);
  }

  const working = page.locator('.line-card.status-work').filter({ hasText: 'Пицца Рондо' });
  await expect(working).toBeVisible();
  await expect(working.locator('.action-grid').getByRole('button')).toHaveText(['Простой', 'Остановить', 'Подробнее']);
  await expect(working.getByRole('button', { name: 'Статистика' })).toHaveCount(0);

  const downtime = page.locator('.line-card-downtime').filter({ hasText: 'Хинкали мини' });
  await expect(downtime).toContainText('Проверка датчика температуры');
  await expect(downtime).toContainText('Длится:');
  await expect(page.locator('.line-card-wash')).toContainText('Пельмени домашние');
  await expect(page.locator('.line-card-stopped')).toContainText('Блины с творогом');
  await expectNoOverflow(page, 'Линии 360');
  await expectCleanUi(page);
}

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__premiumShellDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  await installReadOnlyLineFixture(page);
  await installSession(page);
});

test('Industrial Premium shell, Lines states and required visual evidence', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await verifyMobileLines(page);

  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-before-reference-comparison.png'), fullPage: false });
  await screenshotTopSection(page, 'mobile-360-lines-header-kpi-strip.png');
  const workingCard = page.locator('.line-card.status-work').filter({ hasText: 'Пицца Рондо' });
  await workingCard.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  await workingCard.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-working-card.png') });
  await page.locator('.line-card-downtime').filter({ hasText: 'Хинкали мини' }).screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-downtime-card.png') });

  const working = page.locator('.line-card.status-work').filter({ hasText: 'Пицца Рондо' });
  await working.getByRole('button', { name: 'Подробнее' }).click();
  const detail = page.locator('.line-detail-inline-card').filter({ hasText: 'Пицца Рондо' });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Закрыть' })).toHaveCount(1);
  await expect(detail.getByRole('button', { name: 'История линии' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Статистика' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Обновить' })).toBeVisible();
  await detail.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-details.png') });
  await detail.getByRole('button', { name: 'Закрыть' }).click();

  await openScreen(page, 'Shift', 'Смена');
  await expect(page.locator('.premium-kpi-strip').first()).toBeVisible();
  await screenshotTopSection(page, 'mobile-360-shift-header.png');
  await expectNoOverflow(page, 'Смена 360');

  await openScreen(page, 'Tasks', 'Заявки');
  await expect(page.locator('.task-kpi-grid > .metric-card')).toHaveCount(4);
  await screenshotTopSection(page, 'mobile-360-tasks-header.png');
  await expectNoOverflow(page, 'Заявки 360');

  await openScreen(page, 'Checklists', 'Чек-листы');
  await expect(page.locator('.checklist-kpi-strip > .premium-kpi-card')).toHaveCount(4);
  await screenshotTopSection(page, 'mobile-360-checklists-header.png');
  await expectNoOverflow(page, 'Чек-листы 360');

  const quickLabels = await page.locator('.mobile-quick-button').allTextContents();
  expect(quickLabels.map((label) => label.trim())).toEqual(['Смена', 'Линии', 'Заявки', 'Чек-листы']);
  const moreButton = page.getByRole('button', { name: 'Ещё', exact: true });
  await moreButton.click();
  const sheet = page.locator('.mobile-nav-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Люди', exact: true })).toHaveCount(1);
  await expect(sheet.getByRole('button', { name: 'Чек-листы', exact: true })).toHaveCount(0);
  await sheet.screenshot({ path: path.join(screenshotDir, 'mobile-360-more-people-entry.png') });
  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.screenshot({
    path: path.join(screenshotDir, 'mobile-360-bottom-nav-checklists.png'),
    clip: { x: 0, y: 700, width: 360, height: 100 },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await verifyMobileLines(page);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-lines.png'), fullPage: false });

  await page.setViewportSize({ width: 430, height: 932 });
  await verifyMobileLines(page);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-430-lines.png'), fullPage: false });

  await page.setViewportSize({ width: 1280, height: 900 });
  await openScreen(page, 'Situation', 'Линии');
  await expectNoOverflow(page, 'Линии desktop');
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-lines.png'), fullPage: false });
  await openScreen(page, 'Shift', 'Смена');
  await expectNoOverflow(page, 'Смена desktop');
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-shift.png'), fullPage: false });

  const dialogCalls = await page.evaluate(() => (window as unknown as { __premiumShellDialogs?: string[] }).__premiumShellDialogs ?? []);
  expect(dialogCalls).toEqual([]);
});
