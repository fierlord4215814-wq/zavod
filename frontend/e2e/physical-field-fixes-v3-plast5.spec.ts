import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v3-screenshots', 'plast5');
const washFixture = [{
  id: 'b3000000-0000-4000-8000-000000000001',
  lineId: 'b1000000-0000-4000-8000-000000000001',
  lineName: 'Линия фасовки',
  targetType: 'LINE',
  createdAt: new Date(Date.now() - 42 * 60_000).toISOString(),
  status: 'ACTIVE',
  lifecycleStatus: 'ISSUE',
  lifecycleLabel: 'Есть проблема',
  active: true,
  canViewControl: true,
  attachments: [],
  participants: [{ userId: 'worker-a', displayName: 'Иванов Иван', startedAt: new Date(Date.now() - 35 * 60_000).toISOString() }],
  participantsHistory: [{ userId: 'worker-a', displayName: 'Иванов Иван', startedAt: new Date(Date.now() - 35 * 60_000).toISOString() }],
  messages: [{ id: 'message-a', message: 'Проверили оборудование', authorName: 'Мастер смены', createdAt: new Date().toISOString(), attachments: [] }],
  events: [{ id: 'event-a', type: 'START', typeLabel: 'Мойка началась', text: 'Линия передана на мойку', actorName: 'Мастер смены', createdAt: new Date().toISOString() }],
  issues: [{
    id: 'issue-a',
    title: 'Остатки продукта',
    description: 'Нужно повторно промыть узел',
    status: 'OPEN',
    createdByName: 'ОКК',
    attachments: [],
  }],
  controlItems: [
    { id: 'control-a', title: 'Проверить узел', description: 'Контроль после промывки', type: 'CONTROL', status: 'NEW', statusLabel: 'Новое', createdByName: 'ОКК', attachments: [] },
    { id: 'task-a', title: 'Промыть лоток', description: 'До завершения мойки', type: 'MINI_TASK', status: 'IN_PROGRESS', statusLabel: 'В работе', createdByName: 'Мастер смены', attachments: [] },
  ],
  okkReviews: [],
}];

async function installReadOnlyWashFixture(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    const url = new URL(request.url());
    if (url.origin !== new URL(apiUrl).origin) return route.continue();
    if (url.pathname === '/wash') return route.fulfill({ json: washFixture });
    return route.continue();
  });
}

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'pilot-master-1' }),
  });
  if (!response.ok) throw new Error(`dev-login pilot-master-1: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 недоступен мастеру');

  await page.goto(frontendUrl);
  await page.evaluate(({ factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'pilot-master-1');
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { factoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openWash(page: Page) {
  const washResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === new URL(apiUrl).origin && url.pathname === '/wash';
  }, { timeout: 8_000 }).catch(() => null);
  const navigation = page.locator('nav[aria-label="Основная навигация"]:visible');
  const direct = navigation.getByRole('button', { name: /^Мойка(?:\s|$)/ }).first();
  if (await direct.count()) {
    await direct.click();
  } else {
    await page.locator('.mobile-more-button:visible').click();
    await page.locator('.mobile-sheet-item').filter({ hasText: 'Мойка' }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Мойка', exact: true })).toBeVisible();
  await washResponse;
  await expect(page.getByText('Загрузка мойки...', { exact: true })).toHaveCount(0);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function openFirstWash(page: Page) {
  let firstCard = page.locator('.wash-session-grid:visible .wash-session-card').first();
  if (!(await firstCard.count())) {
    await page.getByRole('tab', { name: /^Архив/ }).click();
    firstCard = page.locator('.wash-session-grid:visible .wash-session-card').first();
  }
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator('.wash-card-actions button')).toHaveCount(1);
  await expect(firstCard.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
  await firstCard.getByRole('button', { name: 'Открыть', exact: true }).click();
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('wash main screen keeps one compact list and three explicit modes', async ({ page }, testInfo) => {
  await login(page);
  await openWash(page);

  await expect(page.locator('.wash-screen .premium-kpi-card')).toHaveCount(4);
  const modes = page.locator('.wash-mode-switch [role="tab"]');
  await expect(modes).toHaveCount(3);
  await expect(modes.nth(0)).toContainText('Активные');
  await expect(modes.nth(1)).toContainText('Задания');
  await expect(modes.nth(2)).toContainText('Архив');
  await expect(page.locator('.wash-session-grid:visible, .wash-request-grid:visible')).toHaveCount(1);

  await modes.nth(1).click();
  await expect(page.locator('.wash-request-grid:visible')).toHaveCount(1);
  await expect(page.locator('.wash-session-grid:visible')).toHaveCount(0);
  await modes.nth(2).click();
  await expect(page.locator('.wash-session-grid:visible')).toHaveCount(1);
  await expect(page.locator('.wash-request-grid:visible')).toHaveCount(0);

  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-wash-main.png`), fullPage: false });
});

test('wash detail shows one focused tab and Android Back returns to list', async ({ page }, testInfo) => {
  await installReadOnlyWashFixture(page);
  await login(page);
  await openWash(page);
  await openFirstWash(page);

  await expect(page.getByRole('button', { name: 'Назад к мойкам', exact: true })).toBeVisible();
  await expect(page.locator('.wash-detail-tabs [role="tab"]')).toHaveCount(7);
  await expect(page.locator('.wash-overview-card')).toBeVisible();
  await expect(page.locator('.wash-detail-grid')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Люди', exact: true }).click();
  await expect(page.locator('.wash-people-panel')).toBeVisible();
  await expect(page.locator('.wash-overview-card')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Проблемы', exact: true }).click();
  await expect(page.locator('.wash-panel:visible')).toHaveCount(1);

  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-wash-detail.png`), fullPage: false });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(page.locator('.wash-detail-screen')).toHaveCount(0);
  await expect(page.locator('.wash-screen')).toBeVisible();
});

test('390 and 430 widths keep wash list and detail inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные размеры проверяются один раз');
  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await installReadOnlyWashFixture(page);
    await login(page);
    await openWash(page);
    await noOverflow(page);
    await openFirstWash(page);
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-wash-detail.png`), fullPage: false });
    await context.close();
  }
});
