import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const backendEnv = path.resolve(__dirname, '..', '..', 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(backendEnv)) {
  const line = fs.readFileSync(backendEnv, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const factoryId = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const runId = 'PFFV4_20260727T075200Z';
const marker = '__PFFV4_PFFV4_20260727T075200Z__';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-screenshots', 'stage6');
const artifactDir = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-stage6-artifacts');

type ApiResult<T = any> = { status: number; payload: T };
type RunPayload = {
  id: string;
  status: string;
  closeKind?: string | null;
  closeReason?: string | null;
  closedById?: string | null;
  closedAt?: string | null;
  nextCheckAt?: string | null;
  checks?: Array<{ id: string; sequence: number; status: string; dueAt?: string | null }>;
  rows?: Array<{ id: string; status: string }>;
  currentCheck?: { id: string; sequence: number; status: string; dueAt?: string | null } | null;
};

type FixtureState = {
  project: string;
  templateId: string | null;
  templateName: string;
  runId: string | null;
  ownerId: string;
};

let state: FixtureState = {
  project: '',
  templateId: null,
  templateName: '',
  runId: null,
  ownerId: 'pilot-master-1',
};

async function apiResponse<T = any>(
  userId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Connection: 'close',
      'x-user-id': userId,
      'x-factory-id': factoryId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

async function api<T = any>(
  userId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const result = await apiResponse<T>(userId, pathname, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${options.method || 'GET'} ${pathname}: ${result.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(({ selectedFactoryId, selectedUserId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', selectedUserId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { selectedFactoryId: factoryId, selectedUserId: userId });
  await page.goto(`${frontendUrl}/?stage44User=${encodeURIComponent(userId)}&pffv4=${Date.now()}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.app-shell .screen-panel').first()).toBeVisible();
}

async function openChecklists(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Checklists' } }));
  });
  await expect(page.locator('.checklists-screen')).toBeVisible();
  await expect(page.locator('.checklists-screen')).not.toContainText(/TypeError|ReferenceError|Internal Server Error|storagePath|passwordHash|DATABASE_URL/i);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

function projectLabel(projectName: string) {
  return projectName.toLowerCase().includes('mobile') ? 'mobile-360' : 'desktop';
}

async function capture(page: Page, name: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: true });
}

async function createPeriodicFixture(projectName: string) {
  const me = await api<{ departmentId?: string }>(state.ownerId, '/auth/me');
  if (!me.departmentId) throw new Error('Pilot master department is not configured.');
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  state.templateName = `${marker} Stage6 periodic ${projectName} ${stamp}`;

  const template = await api<{ id: string }>('test-admin', '/checklists/templates', {
    method: 'POST',
    body: {
      name: state.templateName,
      description: `${marker} Stage6 browser periodic lifecycle`,
      departmentId: me.departmentId,
      assignmentRoles: ['MASTER'],
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 5,
      isMandatory: false,
    },
  });
  state.templateId = template.id;
  await api('test-admin', `/checklists/templates/${template.id}/rows`, {
    method: 'POST',
    body: {
      title: `${marker} Контроль выполнен`,
      rowType: 'YES_NO',
      sortOrder: 10,
      requiredAnswer: true,
      isRequired: true,
    },
  });
  const run = await api<RunPayload>(state.ownerId, '/checklists/runs/start', {
    method: 'POST',
    body: { templateId: template.id },
  });
  state.runId = run.id;
  return run;
}

async function archiveFixture() {
  if (state.runId) {
    await apiResponse(state.ownerId, `/checklists/runs/${state.runId}/close`, {
      method: 'POST',
      body: { comment: `${marker} Завершение Stage6 browser evidence` },
    }).catch(() => undefined);
  }
  if (state.templateId) {
    await apiResponse('test-admin', `/checklists/templates/${state.templateId}/archive`, {
      method: 'POST',
      body: {},
    }).catch(() => undefined);
  }
  if (state.templateId || state.runId) {
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `${state.project}.json`), `${JSON.stringify({
      runId,
      marker,
      project: state.project,
      artifacts: [
        ...(state.templateId ? [{
          model: 'ChecklistTemplate',
          id: state.templateId,
          businessKey: state.templateName,
          cleanupStatus: 'ARCHIVED',
        }] : []),
        ...(state.runId ? [{
          model: 'ChecklistRun',
          id: state.runId,
          businessKey: `${state.templateName}:run`,
          cleanupStatus: 'CLOSED_EVIDENCE',
        }] : []),
      ],
    }, null, 2)}\n`, 'utf8');
  }
}

function activeCard(page: Page) {
  return page.locator('.checklist-work-card.active').filter({ hasText: state.templateName }).first();
}

async function completeCycleFromUi(page: Page, action: 'Выполнить проверку' | 'Начать раньше') {
  const card = activeCard(page);
  await card.getByRole('button', { name: action, exact: true }).click();
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  const review = page.locator('.checklist-final-review');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Проверьте результат');
  await review.getByRole('button', { name: 'Завершить текущую проверку', exact: true }).click();
  await expect(runner).toBeHidden();
  await expect(page.locator('.success-state[role="status"]')).toContainText('Проверка выполнена. Следующая проверка:');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
});

test.beforeEach(async ({ page }, testInfo) => {
  state = {
    project: testInfo.project.name,
    templateId: null,
    templateName: '',
    runId: null,
    ownerId: 'pilot-master-1',
  };
  page.on('dialog', (dialog) => {
    throw new Error(`Browser dialog is forbidden: ${dialog.type()} ${dialog.message()}`);
  });
});

test.afterEach(async () => {
  await archiveFixture();
});

test.afterAll(async () => {
  await db.$disconnect();
});

test('checklist item editor uses nested shared modal and restores page scroll', async ({ page }, testInfo) => {
  const label = projectLabel(testInfo.project.name);
  await loginAs(page, 'test-admin');
  await openChecklists(page);

  await page.evaluate(() => {
    document.documentElement.style.minHeight = '1800px';
    window.scrollTo({ top: 260, behavior: 'auto' });
  });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();

  const editor = page.locator('.checklist-item-editor-modal');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await expect(editor.getByLabel('Название пункта')).toBeVisible();
  await expect(editor.getByLabel('Тип пункта')).toBeVisible();
  await expect(editor.getByLabel('Подсказка или описание примера')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');
  await capture(page, `${label}-checklist-item-editor-modal.png`);

  await editor.getByLabel('Тип пункта').selectOption('NUMBER');
  await expect(editor.getByLabel('Единица')).toBeVisible();
  await expect(editor.getByLabel('Минимум')).toBeVisible();
  await expect(editor.getByLabel('Максимум')).toBeVisible();
  await expect(editor.getByLabel('Целевое значение')).toBeVisible();
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Изменения не сохранены' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');

  const parent = page.locator('.modal-backdrop').filter({ has: page.getByRole('heading', { name: 'Новый шаблон' }) }).first();
  await parent.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(parent).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await page.evaluate(() => {
    document.documentElement.style.minHeight = '';
  });
});

test('periodic checklist keeps one run, supports early and overdue cycles, then closes fully', async ({ page }, testInfo) => {
  const label = projectLabel(testInfo.project.name);
  const started = await createPeriodicFixture(testInfo.project.name);
  const initialCheck = started.currentCheck ?? started.checks?.find((check) => check.status === 'ACTIVE');
  expect(initialCheck?.id).toBeTruthy();

  const denied = await apiResponse('pilot-worker-1', `/checklists/runs/${started.id}/checks/current/complete`, {
    method: 'POST',
    body: { checkId: initialCheck?.id, operationId: `${marker}:forbidden:${Date.now()}` },
  });
  expect([403, 409]).toContain(denied.status);
  const stillActive = await api<RunPayload>(state.ownerId, `/checklists/runs/${started.id}`);
  expect(stillActive.checks?.filter((check) => check.status === 'COMPLETED')).toHaveLength(0);

  const operationBodies: Array<{ checkId?: string; operationId?: string }> = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes(`/checklists/runs/${started.id}/checks/current/complete`)) {
      try {
        operationBodies.push(request.postDataJSON());
      } catch {
        // The response assertion below remains the source of truth.
      }
    }
  });

  await loginAs(page, state.ownerId);
  await openChecklists(page);
  const dueCard = activeCard(page);
  await expect(dueCard).toBeVisible();
  await expect(dueCard).toContainText('Пора выполнить');
  await expect(dueCard.getByRole('button', { name: 'Выполнить проверку', exact: true })).toBeVisible();
  await capture(page, `${label}-periodic-due.png`);

  if (testInfo.project.name.toLowerCase().includes('mobile')) {
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'mobile-390-periodic-due.png');
    await page.setViewportSize({ width: 430, height: 932 });
    await capture(page, 'mobile-430-periodic-due.png');
    await page.setViewportSize({ width: 360, height: 800 });
  }

  await completeCycleFromUi(page, 'Выполнить проверку');
  const afterFirst = await api<RunPayload>(state.ownerId, `/checklists/runs/${started.id}`);
  expect(afterFirst.status).toBe('ACTIVE');
  expect(afterFirst.checks?.filter((check) => check.status === 'COMPLETED')).toHaveLength(1);
  expect(afterFirst.checks?.filter((check) => check.status === 'ACTIVE')).toHaveLength(1);
  expect(afterFirst.nextCheckAt).toBeTruthy();
  await expect(activeCard(page)).toContainText('Следующая проверка по плану через');
  await expect(activeCard(page).getByRole('button', { name: 'Начать раньше', exact: true })).toBeVisible();

  const firstOperation = operationBodies[0];
  expect(firstOperation?.operationId).toBeTruthy();
  const repeated = await apiResponse<RunPayload>(state.ownerId, `/checklists/runs/${started.id}/checks/current/complete`, {
    method: 'POST',
    body: firstOperation,
  });
  expect(repeated.status).toBe(201);
  expect(repeated.payload.checks?.filter((check) => check.status === 'COMPLETED')).toHaveLength(1);

  const stableNextCheckAt = afterFirst.nextCheckAt;
  await page.reload({ waitUntil: 'networkidle' });
  await openChecklists(page);
  await expect(activeCard(page)).toContainText('Следующая проверка по плану через');
  const afterReload = await api<RunPayload>(state.ownerId, `/checklists/runs/${started.id}`);
  expect(afterReload.nextCheckAt).toBe(stableNextCheckAt);
  await capture(page, `${label}-periodic-next-reminder.png`);

  await completeCycleFromUi(page, 'Начать раньше');
  const afterSecond = await api<RunPayload>(state.ownerId, `/checklists/runs/${started.id}`);
  expect(afterSecond.status).toBe('ACTIVE');
  expect(afterSecond.checks?.filter((check) => check.status === 'COMPLETED')).toHaveLength(2);
  expect(new Set(afterSecond.checks?.map((check) => check.sequence)).size).toBe(afterSecond.checks?.length);

  const current = afterSecond.checks?.find((check) => check.status === 'ACTIVE');
  if (!current) throw new Error('Active third periodic check was not created.');
  const overdueAt = new Date(Date.now() - 3 * 60_000);
  await db.$transaction([
    db.checklistRunCheck.update({ where: { id: current.id }, data: { dueAt: overdueAt } }),
    db.checklistRun.update({ where: { id: started.id }, data: { nextCheckAt: overdueAt } }),
  ]);

  await page.reload({ waitUntil: 'networkidle' });
  await openChecklists(page);
  const overdueCard = activeCard(page);
  await expect(overdueCard).toContainText('Просрочено');
  await capture(page, `${label}-periodic-overdue.png`);

  const checkCountBeforeClose = afterSecond.checks?.length ?? 0;
  await overdueCard.getByRole('button', { name: 'Завершить чек-лист полностью', exact: true }).click();
  const closeDialog = page.locator('.modal-backdrop').filter({
    has: page.getByRole('heading', { name: 'Завершить чек-лист полностью' }),
  }).first();
  const reason = closeDialog.locator('textarea[name="comment"]');
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute('required', '');
  await closeDialog.getByRole('button', { name: 'Завершить чек-лист полностью', exact: true }).click();
  await expect(closeDialog).toBeVisible();
  await reason.fill('Проверки завершены досрочно по окончании контрольной задачи');
  await closeDialog.getByRole('button', { name: 'Завершить чек-лист полностью', exact: true }).click();
  await expect(closeDialog).toBeHidden();

  const closed = await api<RunPayload>(state.ownerId, `/checklists/runs/${started.id}`);
  expect(closed.status).toBe('CLOSED');
  expect(closed.closeKind).toBe('MANUAL_EARLY');
  expect(closed.closeReason).toBe('Проверки завершены досрочно по окончании контрольной задачи');
  expect(closed.closedById).toBe(state.ownerId);
  expect(closed.closedAt).toBeTruthy();
  expect(closed.nextCheckAt).toBeNull();
  expect(closed.checks).toHaveLength(checkCountBeforeClose);

  const afterCloseAttempt = await apiResponse(state.ownerId, `/checklists/runs/${started.id}/checks/current/complete`, {
    method: 'POST',
    body: { checkId: current.id, operationId: `${marker}:after-close:${Date.now()}` },
  });
  expect(afterCloseAttempt.status).toBe(409);
  const auditCount = await db.auditLog.count({
    where: {
      factoryId,
      action: 'CHECKLIST_RUN_CHECK_COMPLETED',
      entityId: { in: closed.checks?.filter((check) => check.status === 'COMPLETED').map((check) => check.id) ?? [] },
    },
  });
  expect(auditCount).toBe(2);
  await expectNoOverflow(page);
});
