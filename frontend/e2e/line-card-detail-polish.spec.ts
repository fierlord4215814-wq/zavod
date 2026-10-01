import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-line-card-detail-polish-screenshots');

const taskAssigned = {
  taskId: 'b2000000-0000-4000-8000-000000000001',
  taskStatus: 'IN_PROGRESS',
  taskStatusLabel: 'В работе',
  taskType: 'URGENT',
  taskTypeLabel: 'Срочная',
  serviceLabel: 'Механики',
  assigneeDisplayName: 'Сервисов С. С.',
  hasAssignee: true,
  createdAt: new Date(Date.now() - 35 * 60_000).toISOString(),
  startedAt: new Date(Date.now() - 29 * 60_000).toISOString(),
  deadlineAt: null,
  overdue: false,
  sourceKind: 'LINE',
  sourceLabel: 'Заявка по линии',
  canOpen: true,
  additionalActiveCount: 2,
};

const taskWaiting = {
  ...taskAssigned,
  taskId: 'b2000000-0000-4000-8000-000000000002',
  taskStatus: 'NEW',
  taskStatusLabel: 'Ожидает',
  serviceLabel: 'КИПиА',
  assigneeDisplayName: null,
  hasAssignee: false,
  startedAt: null,
  sourceKind: 'DOWNTIME',
  sourceLabel: 'Заявка по простою',
  additionalActiveCount: 0,
};

const lines = [
  {
    id: 'b1000000-0000-4000-8000-000000000001',
    name: 'Пицца Рондо',
    status: 'WORK',
    activeWorkersCount: 3,
    activeTasksCount: 3,
    activeTaskSummary: taskAssigned,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000002',
    name: 'Пельмени домашние',
    status: 'WORK',
    activeWorkersCount: 2,
    activeTasksCount: 1,
    activeTaskSummary: taskWaiting,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000003',
    name: 'Блины с творогом',
    status: 'WORK',
    activeWorkersCount: 1,
    activeTasksCount: 0,
    activeTaskSummary: null,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000004',
    name: 'Хинкали мини',
    status: 'PAUSE',
    activeWorkersCount: 1,
    activeTasksCount: 1,
    activeTaskSummary: { ...taskAssigned, taskId: 'b2000000-0000-4000-8000-000000000004', additionalActiveCount: 0 },
    activeDowntimeEvent: {
      id: 'b3000000-0000-4000-8000-000000000001',
      status: 'PAUSE',
      createdAt: new Date(Date.now() - 47 * 60_000).toISOString(),
      downtimeReason: 'TECHNICAL',
      comment: 'Проверка датчика температуры',
    },
  },
];

const productionNames = ['Иванов И. П.', 'Петров А. С.', 'Сидорова М. В.'];

function dashboard(line: typeof lines[number]) {
  const activeTasks = line.id === lines[0].id
    ? [taskAssigned, { ...taskWaiting, taskId: 'b2000000-0000-4000-8000-000000000003' }, { ...taskWaiting, taskId: 'b2000000-0000-4000-8000-000000000005', serviceLabel: 'Электрики' }]
    : line.activeTaskSummary ? [line.activeTaskSummary] : [];
  return {
    line: { id: line.id, name: line.name, status: line.status },
    positions: [],
    staffingTemplates: [],
    assignmentsByPosition: line.id === lines[0].id ? [
      {
        position: { id: 'position-1', name: 'Оператор линии', displayName: 'Оператор линии' },
        assignments: productionNames.slice(0, 2).map((displayName, index) => ({ id: `assignment-${index}`, userId: `person-${index}`, displayName, startedAt: new Date().toISOString() })),
      },
      {
        position: { id: 'position-2', name: 'Упаковщик', displayName: 'Упаковщик' },
        assignments: [{ id: 'assignment-3', userId: 'person-3', displayName: productionNames[2], startedAt: new Date().toISOString() }],
      },
    ] : [],
    withoutPosition: [],
    activeTemplate: null,
    shortageSummary: null,
    activeTasks,
    activeWash: [],
    activeDefrost: null,
    latestDefrost: [],
    recentEvents: [],
  };
}

async function factoryId(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`Не удалось открыть тестовую сессию: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string; name?: string }) => item.code === 'factory-4' || item.name === 'Завод 4') ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error('Завод для browser evidence недоступен');
  return factory.id as string;
}

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    const url = new URL(request.url());
    if (url.origin !== new URL(apiUrl).origin) return route.continue();
    if (url.pathname === '/lines') return route.fulfill({ json: lines });
    if (url.pathname === '/wash') return route.fulfill({ json: [] });
    const detail = url.pathname.match(/^\/lines\/([^/]+)\/dashboard$/);
    if (detail) {
      const line = lines.find((item) => item.id === detail[1]);
      return route.fulfill({ status: line ? 200 : 404, json: line ? dashboard(line) : { message: 'Линия не найдена' } });
    }
    return route.continue();
  });
}

async function installSession(page: Page, userId = 'pilot-pack-admin') {
  const selectedFactoryId = await factoryId(userId);
  await page.goto('/pwa-icon.svg', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ id, factory }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', id);
    localStorage.setItem('zavod.selectedFactoryId', factory);
    localStorage.removeItem('zavod.authToken');
  }, { id: userId, factory: selectedFactoryId });
  await page.goto(`/?lineCardUser=${encodeURIComponent(userId)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('zavod.devUserId'))).toBe(userId);
  await page.waitForTimeout(500);
}

async function openScreen(page: Page, screen: string, heading: string) {
  const navigationButton = page.getByRole('button', { name: heading, exact: true }).first();
  if (await navigationButton.isVisible().catch(() => false)) {
    await navigationButton.click();
  } else {
    await page.evaluate((next) => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: next } })), screen);
  }
  await expect(page.locator('.premium-screen-heading h2')).toHaveText(heading, { timeout: 15_000 });
  await page.waitForTimeout(350);
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow, label).toBeLessThanOrEqual(2);
}

async function verifyKpi(page: Page) {
  const metrics = page.locator('.line-filter-metrics .premium-kpi-card');
  await expect(metrics).toHaveCount(4);
  const geometry = await metrics.evaluateAll((items) => items.map((item) => {
    const element = item as HTMLElement;
    const label = element.querySelector('.metric-label') as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      labelFits: label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 2,
      fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
    };
  }));
  expect(new Set(geometry.map((item) => item.top)).size).toBe(1);
  expect(geometry.every((item) => item.labelFits && item.fontSize >= 10)).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await installFixtures(page);
  await installSession(page);
});

test('clean line cards, safe task summaries, detail and checklist top section', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openScreen(page, 'Situation', 'Линии');
  await verifyKpi(page);

  const assigned = page.locator('.line-card.status-work').filter({ hasText: 'Пицца Рондо' });
  const waiting = page.locator('.line-card.status-work').filter({ hasText: 'Пельмени домашние' });
  const clean = page.locator('.line-card.status-work').filter({ hasText: 'Блины с творогом' });
  const downtime = page.locator('.line-card-downtime').filter({ hasText: 'Хинкали мини' });
  await expect(assigned).toContainText('Людей: 3');
  await expect(assigned).toContainText('Механики — Сервисов С. С.');
  await expect(assigned).toContainText('+ ещё 2 заявки');
  await expect(waiting).toContainText('КИПиА — ожидает исполнителя');
  for (const name of productionNames) await expect(assigned).not.toContainText(name);
  await expect(downtime).toContainText('Проверка датчика температуры');
  await expectNoOverflow(page, 'Линии 360');

  await clean.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-clean-working-card.png') });
  await assigned.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-task-assignee.png') });
  await waiting.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-task-waiting.png') });
  await assigned.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-multiple-tasks.png') });
  await downtime.screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-clean-downtime-card.png') });
  await page.locator('.line-filter-metrics').screenshot({ path: path.join(screenshotDir, 'mobile-360-lines-kpi-readable.png') });

  await assigned.getByRole('button', { name: 'Подробнее' }).click();
  const detail = page.locator('.line-detail-inline-card');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.line-detail-people')).toContainText('Иванов И. П.');
  await expect(detail.locator('.line-detail-people')).toContainText('Оператор линии');
  await expect(detail.locator('.line-detail-tasks')).toContainText('Механики — Сервисов С. С.');
  await expect(detail.locator('.line-detail-tasks').getByRole('button', { name: 'Открыть заявку' })).toHaveCount(3);
  await detail.locator('.line-detail-people').screenshot({ path: path.join(screenshotDir, 'mobile-360-line-detail-people.png') });
  await detail.locator('.line-detail-tasks').screenshot({ path: path.join(screenshotDir, 'mobile-360-line-detail-active-tasks.png') });
  await detail.locator('.detail-sticky-actions').screenshot({ path: path.join(screenshotDir, 'mobile-360-line-detail-actions.png') });
  await expectNoOverflow(page, 'Подробнее 360');
  await detail.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(detail).toHaveCount(0);

  await openScreen(page, 'Checklists', 'Чек-листы');
  const checklistKpi = page.locator('.checklist-kpi-strip');
  const toolbar = page.locator('.checklist-manager-toolbar');
  await expect(checklistKpi).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Создать шаблон' })).toBeVisible();
  const order = await page.evaluate(() => {
    const kpi = document.querySelector('.checklist-kpi-strip');
    const manage = document.querySelector('.checklist-manager-toolbar');
    return Boolean(kpi && manage && (kpi.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBeTruthy();
  const top = page.locator('.checklists-screen');
  await top.screenshot({ path: path.join(screenshotDir, 'mobile-360-checklists-kpi-before-manage-action.png') });
  await expectNoOverflow(page, 'Чек-листы 360');

  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, 'Situation', 'Линии');
  await verifyKpi(page);
  await page.locator('.line-card.status-work').filter({ hasText: 'Блины с творогом' }).screenshot({ path: path.join(screenshotDir, 'mobile-390-lines-clean-card.png') });
  await expectNoOverflow(page, 'Линии 390');

  await page.setViewportSize({ width: 430, height: 900 });
  await page.locator('.line-card.status-work').filter({ hasText: 'Блины с творогом' }).screenshot({ path: path.join(screenshotDir, 'mobile-430-lines-clean-card.png') });
  await expectNoOverflow(page, 'Линии 430');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openScreen(page, 'Situation', 'Линии');
  await page.locator('.line-card.status-work').filter({ hasText: 'Блины с творогом' }).screenshot({ path: path.join(screenshotDir, 'desktop-lines-clean-card.png') });
  await page.locator('.line-card.status-work').filter({ hasText: 'Пицца Рондо' }).getByRole('button', { name: 'Подробнее' }).click();
  await page.locator('.line-detail-inline-card').screenshot({ path: path.join(screenshotDir, 'desktop-line-detail.png') });
  await page.locator('.line-detail-inline-card').getByRole('button', { name: 'Закрыть' }).first().click();
  await openScreen(page, 'Checklists', 'Чек-листы');
  await page.locator('.checklists-screen').screenshot({ path: path.join(screenshotDir, 'desktop-checklists-top-section.png') });

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
});

test('ordinary employee keeps Checklists in bottom navigation without manager action', async ({ page }) => {
  await installSession(page, 'pilot-worker-1');
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('button', { name: 'Чек-листы', exact: true }).filter({ visible: true })).toBeVisible();
  await openScreen(page, 'Checklists', 'Чек-листы');
  await expect(page.locator('.checklist-kpi-strip')).toBeVisible();
  await expect(page.locator('.checklist-manager-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Люди', exact: true }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ещё', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.mobile-nav-sheet').getByRole('button', { name: 'Люди', exact: true })).toBeVisible();
  await expectNoOverflow(page, 'Навигация сотрудника 360');
});
