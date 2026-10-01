import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-field-fixes-v3-screenshots', 'plast6');

const templateId = 'c6000000-0000-4000-8000-000000000001';
const activeRunId = 'c6000000-0000-4000-8000-000000000002';
const archiveRunId = 'c6000000-0000-4000-8000-000000000003';
const rowId = 'c6000000-0000-4000-8000-000000000004';
const now = new Date();
const shiftDate = now.toISOString().slice(0, 10);

const template = {
  id: templateId,
  departmentId: 'department-quality',
  departmentName: 'Служба качества',
  departmentLabel: 'Служба качества',
  name: 'Осмотр упаковки',
  description: 'Короткая проверка качества упаковки.',
  isActive: true,
  assignmentRoles: ['ADMIN'],
  shiftType: null,
  frequencyRule: 'MANUAL',
  frequencyIntervalUnit: 'HOURS',
  frequencyIntervalValue: null,
  frequencyLabel: 'По необходимости',
  isMandatory: false,
  availability: { alreadyTaken: false, duplicateBlocked: false, currentRun: null, reason: null },
  rows: [{
    id: rowId,
    title: 'Упаковка без повреждений?',
    description: 'Осмотрите шов и этикетку.',
    sortOrder: 10,
    rowType: 'YES_NO',
    requiredAnswer: true,
    requiresPhoto: false,
    requiresComment: false,
    isRequired: true,
    isActive: true,
  }],
};

const completedRow = {
  id: rowId,
  templateRowId: rowId,
  title: 'Упаковка без повреждений?',
  description: 'Осмотрите шов и этикетку.',
  sortOrder: 10,
  rowType: 'YES_NO',
  requiredAnswer: true,
  status: 'OK',
  requiresPhoto: false,
  requiresComment: false,
  isRequired: true,
  answerBoolean: true,
  answerText: null,
  answerNumber: null,
  selectedOption: null,
  comment: null,
  attachments: [],
  completedByName: 'Администратор',
  completedAt: now.toISOString(),
};

const activeRun = {
  id: activeRunId,
  status: 'ACTIVE',
  startedAt: new Date(now.getTime() - 25 * 60_000).toISOString(),
  nextCheckAt: new Date(now.getTime() + 55 * 60_000).toISOString(),
  shiftEndsAt: new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
  frequencyRule: 'EVERY_N_HOURS',
  frequencyIntervalValue: 1,
  frequencyLabel: 'Каждый час',
  template: { name: 'Осмотр упаковки', description: template.description, departmentName: 'Служба качества', departmentLabel: 'Служба качества' },
  departmentName: 'Служба качества',
  departmentLabel: 'Служба качества',
  lineName: 'Линия упаковки',
  lineLabel: 'Линия упаковки',
  shiftDate,
  shiftType: 'DAY',
  shiftLabel: 'Дневная',
  executorName: 'Администратор',
  rows: [completedRow],
  checks: [{ id: 'c6000000-0000-4000-8000-000000000005', sequence: 1, status: 'COMPLETED', completedAt: now.toISOString(), rows: [completedRow] }],
  currentCheck: null,
  attachments: [],
  completion: { total: 1, done: 1, missingRequired: 0, percent: 100 },
};

const archiveRun = {
  ...activeRun,
  id: archiveRunId,
  status: 'CLOSED',
  closedAt: now.toISOString(),
  nextCheckAt: null,
  frequencyRule: 'MANUAL',
  frequencyIntervalValue: null,
  frequencyLabel: 'По необходимости',
  checks: [],
};

async function installReadOnlyChecklistFixture(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    const url = new URL(request.url());
    const isBackendRequest = url.origin === new URL(apiUrl).origin || url.pathname.startsWith('/api/');
    if (!isBackendRequest) return route.continue();
    const pathname = url.pathname.replace(/^\/api/, '');

    if (pathname === '/checklists/workspace') {
      return route.fulfill({
        json: {
          generatedAt: now.toISOString(),
          shift: {
            shiftDate,
            shiftType: 'DAY',
            startsAt: new Date(now.getTime() - 2 * 60 * 60_000).toISOString(),
            endsAt: new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
          },
          activeRuns: [activeRun],
          completedRuns: [archiveRun],
          available: [template],
          manager: {
            summary: { inProgress: 1, dueSoon: 0, overdue: 0, paused: 0, completed: 1, autoClosed: 0, notTaken: 1 },
            runs: [activeRun],
          },
        },
      });
    }
    if (pathname === '/checklists/templates/library') return route.fulfill({ json: [template] });
    if (pathname === '/checklists/archive/by-template') {
      return route.fulfill({ json: { template: null, columns: [], rows: [] } });
    }
    if (pathname === '/checklists/archive') return route.fulfill({ json: { runs: [archiveRun], templates: [] } });
    if (pathname === `/checklists/runs/${activeRunId}`) return route.fulfill({ json: activeRun });
    if (pathname === `/checklists/runs/${archiveRunId}`) return route.fulfill({ json: archiveRun });
    return route.continue();
  });
}

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'test-admin' }),
  });
  if (!response.ok) throw new Error(`dev-login test-admin: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 недоступен администратору');

  await page.goto(frontendUrl);
  await page.evaluate(({ factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { factoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openChecklists(page: Page) {
  const navigation = page.locator('nav[aria-label="Основная навигация"]:visible');
  const direct = navigation.getByRole('button', { name: /^Чек-листы(?:\s|$)/ }).first();
  if (await direct.count()) {
    await direct.click();
  } else {
    await page.locator('.mobile-more-button:visible').click();
    await page.locator('.mobile-sheet-item').filter({ hasText: 'Чек-листы' }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Чек-листы', exact: true })).toBeVisible();
  await expect(page.getByText('Загрузка...', { exact: true })).toHaveCount(0);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('checklist home has four focused categories and compact archive', async ({ page }, testInfo) => {
  await installReadOnlyChecklistFixture(page);
  await login(page);
  await openChecklists(page);

  const kpis = page.locator('.checklist-kpi-strip .premium-kpi-card');
  await expect(kpis).toHaveCount(4);
  await expect(kpis.nth(0)).toContainText('В работе');
  await expect(kpis.nth(1)).toContainText('Доступные');
  await expect(kpis.nth(2)).toContainText('Просрочено');
  await expect(kpis.nth(3)).toContainText('Архив');
  await expect(page.getByRole('heading', { name: 'В работе', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы', exact: true })).toHaveCount(0);

  await kpis.nth(1).click();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы', exact: true })).toBeVisible();
  await expect(page.locator('.checklist-work-card.available').getByRole('button', { name: 'Взять в работу', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'В работе', exact: true })).toHaveCount(0);

  await kpis.nth(3).click();
  await expect(page.locator('.checklist-archive-compact-card')).toHaveCount(1);
  await expect(page.locator('.checklist-archive-filters')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Фильтры и отчёты', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-compact-archive.png`), fullPage: false });

  await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Фильтры и отчёты чек-листов' })).toBeVisible();
  await expect(page.locator('.checklist-archive-filters')).toBeVisible();
  await noOverflow(page);
});

test('canonical constructor and focused runner remain compact and protect dirty answer', async ({ page }, testInfo) => {
  await installReadOnlyChecklistFixture(page);
  await login(page);
  await openChecklists(page);

  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const builder = page.locator('.checklist-template-builder-modal');
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel('Интервал: сначала выберите минуты или часы')).toBeVisible();
  await expect(builder.getByLabel('Интервал: затем укажите число')).toBeVisible();
  await expect(builder.getByLabel('Привязать к линии')).toContainText('Без привязки к линии');
  await expect(builder.getByRole('button', { name: 'Добавить пункт', exact: true })).toBeVisible();
  await builder.locator('.modal-actions').getByRole('button', { name: 'Отмена', exact: true }).click();

  await page.locator('.checklist-kpi-strip .premium-kpi-card').filter({ hasText: 'В работе' }).click();
  await page.locator('.checklist-work-card.active').getByRole('button', { name: 'Продолжить', exact: true }).click();
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await expect(runner.locator('.guided-progress')).toContainText('Пункт 1 из 1');
  await expect(runner.locator('.guided-row-heading strong')).toHaveText('Упаковка без повреждений?');
  await expect(runner.getByRole('button', { name: 'Проверить и завершить', exact: true })).toBeVisible();
  await expect(runner.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-focused-runner.png`), fullPage: false });

  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Проверьте результат');
  await expect(review).toContainText('Заполнено');
  await page.waitForTimeout(250);
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-final-review.png`), fullPage: false });
  await review.getByRole('button', { name: 'Вернуться', exact: true }).click();

  await runner.getByRole('button', { name: 'Нет', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  const dirtyDialog = page.getByRole('dialog', { name: 'Ответ не сохранён' });
  await expect(dirtyDialog).toBeVisible();
  await expect(dirtyDialog).toContainText('потерять несохранённый ответ');
  await dirtyDialog.getByRole('button', { name: 'Остаться', exact: true }).click();
});

test('390 and 430 widths keep checklist home, runner and archive inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные размеры проверяются один раз');
  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await installReadOnlyChecklistFixture(page);
    await login(page);
    await openChecklists(page);
    await noOverflow(page);
    await page.locator('.checklist-work-card.active').getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.locator('.guided-run-modal')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-focused-runner.png`), fullPage: false });
    await page.locator('.guided-run-modal').getByRole('button', { name: 'Вернуться к чек-листам' }).click();
    await page.locator('.checklist-kpi-strip .premium-kpi-card').filter({ hasText: 'Архив' }).click();
    await noOverflow(page);
    await context.close();
  }
});
