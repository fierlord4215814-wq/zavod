import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast9');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P9_${runId}__`;

let factoryId = '';
let departmentId = '';
let templateId = '';
let checklistRunId = '';
let templateName = '';
const artifact = {
  marker,
  templatesCreated: 0,
  runsCreated: 0,
  activeArtifactsAfterCleanup: 0,
  archivedArtifactsAfterCleanup: 0,
  physicalDeletes: 0,
  existingOperationalDataChanged: false,
};

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
  expected?: number[];
};

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  const selectedFactory = options.factoryId === null ? '' : options.factoryId ?? factoryId;
  if (selectedFactory) headers['x-factory-id'] = selectedFactory;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!(options.expected ?? [200, 201]).includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return data;
}

async function resolveContext() {
  const login = await api('/auth/dev-login', {
    method: 'POST',
    userId: null,
    factoryId: null,
    body: { userId: 'test-admin' },
  });
  factoryId = login.availableFactories?.find((factory: any) => factory.code === 'factory-4')?.id
    ?? login.recommendedFactoryId
    ?? login.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('Завод 4 не найден.');
  const manager = await api('/auth/me', { userId: 'test-management' });
  departmentId = manager.departmentId;
  if (!departmentId) throw new Error('У руководителя не определён рабочий отдел.');
}

async function createChecklistFixture() {
  templateName = `Контроль рабочей зоны ${runId}`;
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    body: {
      name: templateName,
      description: `${marker} Targeted runner evidence`,
      departmentId,
      scope: 'DEPARTMENT',
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isActive: true,
      rows: [
        {
          title: 'Температура продукта',
          rowType: 'NUMBER',
          unit: '°C',
          minValue: 10,
          maxValue: 20,
          requiredAnswer: true,
          requiresComment: false,
          isRequired: true,
          sortOrder: 10,
        },
        {
          title: 'Маркировка читается',
          rowType: 'YES_NO',
          requiredAnswer: true,
          requiresComment: false,
          isRequired: true,
          sortOrder: 20,
        },
      ],
    },
  });
  templateId = template.id;
  artifact.templatesCreated = 1;
  const run = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-management',
    body: { templateId },
  });
  checklistRunId = run.id;
  artifact.runsCreated = 1;
}

async function cleanupFixture() {
  if (checklistRunId) {
    const closed = await api(`/checklists/runs/${checklistRunId}/close`, {
      method: 'POST',
      userId: 'test-management',
      body: { comment: `${marker} Targeted browser gate завершён` },
      expected: [200, 201, 409],
    }).catch(() => null);
    if (!closed || !['CLOSED', 'AUTO_CLOSED'].includes(closed.status)) {
      await api('/checklists/runs/auto-close', {
        method: 'POST',
        userId: 'test-admin',
        body: { runId: checklistRunId, force: true, comment: `${marker} Targeted browser gate завершён` },
        expected: [200, 201],
      });
    }
  }
  if (templateId) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH',
      userId: 'test-admin',
      body: { name: `${marker} runner`, reason: `${marker} Targeted browser gate завершён` },
      expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST',
      userId: 'test-admin',
      body: {},
      expected: [200, 201, 409],
    }).catch(() => null);
  }
  const finalRun = checklistRunId
    ? await api(`/checklists/runs/${checklistRunId}`, { userId: 'test-admin' }).catch(() => null)
    : null;
  artifact.activeArtifactsAfterCleanup = finalRun && ['ACTIVE', 'PAUSED'].includes(finalRun.status) ? 1 : 0;
  artifact.archivedArtifactsAfterCleanup = templateId ? 1 : 0;
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...artifact,
  }, null, 2)}\n`, 'utf8');
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?pffv5p9=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openNavigationItem(page: Page, label: string) {
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await page.getByRole('button', { name: 'Ещё', exact: true }).filter({ visible: true }).first().click();
  const sheetItem = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
  await expect(sheetItem).toBeVisible();
  await sheetItem.click();
}

async function expectNoHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  ) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await resolveContext();
  await createChecklistFixture();
});

test.afterAll(async () => {
  await cleanupFixture();
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
});

test('focused checklist runner is compact and stable at desktop/360/390/430', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'test-management');
  await openNavigationItem(page, 'Чек-листы');
  await expect(page.getByRole('heading', { name: 'Чек-листы', exact: true })).toBeVisible();

  const card = page.locator('.checklist-work-card.active').filter({ hasText: templateName }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await expect(runner.getByRole('heading', { name: templateName, exact: true })).toBeVisible();
  await expect(runner.getByText('Пункт 1 из 2', { exact: true })).toBeVisible();
  await expect(runner.getByText('Добавить комментарий', { exact: true })).toBeVisible();
  await expect(runner.getByPlaceholder('Необязательно')).toBeHidden();

  const currentRow = runner.locator('.focus-current-row');
  await expect(currentRow.getByText(/Допустимо.*10.*20/)).toHaveCount(1);
  await currentRow.getByRole('spinbutton').fill('25');
  await expect(currentRow.getByText(/выше нормы/i)).toBeVisible();

  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 2 из 2', { exact: true })).toBeVisible();
  await runner.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(runner.getByText('Пункт 1 из 2', { exact: true })).toBeVisible();

  await runner.getByRole('button', { name: 'Действия с чек-листом' }).click();
  const actionsSheet = page.locator('.checklist-runner-actions-sheet');
  await expect(actionsSheet.getByText('Поставить на паузу', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(actionsSheet).toBeHidden();
  await expect(runner).toBeVisible();
  await runner.getByRole('button', { name: 'Действия с чек-листом' }).click();
  await actionsSheet.getByText('Поставить на паузу', { exact: true }).click();
  const pauseDialog = page.getByRole('dialog').filter({ hasText: 'Пауза чек-листа' }).last();
  await pauseDialog.getByLabel('Причина паузы').fill(`${marker} Проверка паузы`);
  await pauseDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(runner.getByRole('button', { name: 'Возобновить чек-лист', exact: true })).toBeVisible();
  await runner.getByRole('button', { name: 'Возобновить чек-лист', exact: true }).click();
  const resumeDialog = page.getByRole('dialog').filter({ hasText: 'Возобновить чек-лист' }).last();
  await resumeDialog.getByRole('button', { name: 'Возобновить', exact: true }).click();

  await expect(currentRow.getByRole('spinbutton')).toHaveValue('25');
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 2 из 2', { exact: true })).toBeVisible();
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await expect(runner.getByRole('button', { name: 'Проверить и завершить', exact: true })).toBeVisible();
  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await expect(review).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(review).toBeHidden();
  await expect(runner).toBeVisible();

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    const stickyActions = runner.locator('.checklist-runner-sticky-actions');
    await expect(stickyActions).toBeVisible();
    const footerBox = await stickyActions.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.x).toBeGreaterThanOrEqual(0);
    expect(footerBox!.x + footerBox!.width).toBeLessThanOrEqual(width + 1);
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(845);
    await page.screenshot({ path: path.join(evidenceDir, `checklist-runner-${width}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDir, 'checklist-runner-desktop.png'), fullPage: false });
});

test('assignment cards separate position, person and status on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await loginAs(page, 'test-management');
  await openNavigationItem(page, 'Смена');
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  const lineCard = page.locator('.current-shift-line-card').first();
  await expect(lineCard).toBeVisible();
  await expect(lineCard.locator('.line-people-count')).toHaveText(/Люди \d+\/\d+/);
  await expect(lineCard.locator('.line-compact-meta')).toContainText('Утверждённый состав');
  await lineCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.compact-line-dashboard');
  await expect(dashboard).toBeVisible();
  const slot = dashboard.locator('.slot-row').first();
  await expect(slot).toBeVisible();
  await expect(slot.locator('.assignment-slot-eyebrow')).toContainText('Позиция');
  await expect(slot.locator('.assignment-slot-person, .assignment-slot-empty')).toBeVisible();
  await expect(slot.locator('.tag')).toContainText(/Назначен|Не назначен/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDir, 'assignment-cards-360.png'), fullPage: false });
});

test('announcement audience keeps three modes and selected-all semantics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'test-management');
  await openNavigationItem(page, 'Объявления');
  await expect(page.locator('.announcements-screen')).toBeVisible();
  await expect(page.locator('.announcement-mobile-bar')).toContainText('Объявления');
  await page.getByRole('button', { name: 'Создать объявление', exact: true }).first().click();
  const editor = page.locator('.announcement-editor-modal');
  await expect(editor).toBeVisible();
  for (const label of ['Весь завод', 'Мой отдел', 'Выбранные отделы']) {
    await expect(editor.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await editor.getByRole('button', { name: 'Выбранные отделы', exact: true }).click();
  const departmentButtons = editor.locator('.announcement-department-grid button');
  await expect(departmentButtons).toHaveCount(13);
  await editor.getByRole('button', { name: 'Выбрать все', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Выбранные отделы', exact: true })).toHaveClass(/active/);
  await expect(editor.locator('.announcement-audience-chips .tag')).toHaveCount(13);
  await page.screenshot({ path: path.join(evidenceDir, 'announcement-audience-390.png'), fullPage: false });
  await editor.getByRole('button', { name: 'Снять все', exact: true }).click();
  await expect(editor.locator('.announcement-audience-chips .tag')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDir, 'announcement-audience-desktop.png'), fullPage: false });
});
