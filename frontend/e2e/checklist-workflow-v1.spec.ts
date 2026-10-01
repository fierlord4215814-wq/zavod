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

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-checklists-ux-screenshots');
const stamp = Date.now();
const createdTemplates: string[] = [];
const createdRuns: string[] = [];
const createdRunOwners = new Map<string, string>();
let skipProject = false;
let factoryId = '';
let employeeDepartmentId = '';
let managerDepartmentId = '';
let mainTemplate: any;
let managerTemplate: any;
let backgroundTemplateId = '';
let mainRunId = '';
let managerRunId = '';

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
  const selectedFactoryId = options.factoryId === null ? '' : options.factoryId || factoryId;
  if (selectedFactoryId) headers['x-factory-id'] = selectedFactoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  if (!(options.expected ?? [200, 201]).includes(response.status)) {
    throw new Error(`${pathname}: ${response.status} ${responseText}`);
  }
  return responseText ? JSON.parse(responseText) : null;
}

function currentFactoryShift() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour >= 8 && hour < 20) return { shiftDate: date, shiftType: 'DAY' };
  if (hour >= 20) return { shiftDate: date, shiftType: 'NIGHT' };
  const previous = new Date(`${date}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    shiftDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(previous),
    shiftType: 'NIGHT',
  };
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', {
    method: 'POST',
    userId: null,
    factoryId: null,
    body: { userId: 'test-admin' },
  });
  return login.availableFactories.find((item: any) => item.code === 'factory-4')?.id
    ?? login.recommendedFactoryId
    ?? login.availableFactories[0]?.id;
}

async function createTemplate(name: string, departmentId: string, role: string, rows: any[], periodic = false) {
  const shift = currentFactoryShift();
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    body: {
      name,
      description: 'Пошаговый контроль текущей смены',
      departmentId,
      assignmentRoles: [role],
      shiftType: shift.shiftType,
      frequencyRule: periodic ? 'EVERY_N_HOURS' : 'MANUAL',
      frequencyIntervalUnit: periodic ? 'MINUTES' : undefined,
      frequencyIntervalValue: periodic ? 30 : undefined,
      isMandatory: true,
    },
  });
  createdTemplates.push(template.id);
  for (const row of rows) {
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      body: row,
    });
  }
  return api(`/checklists/templates/${template.id}`, { userId: 'test-admin' });
}

async function startRun(userId: string, templateId: string) {
  const run = await api('/checklists/runs/start', { method: 'POST', userId, body: { templateId } });
  if (!createdRuns.includes(run.id)) createdRuns.push(run.id);
  createdRunOwners.set(run.id, userId);
  return run;
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?checklistWorkflow=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openChecklists(page: Page) {
  const direct = page.getByRole('button', { name: 'Чек-листы', exact: true }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await page.getByRole('button', { name: 'Ещё' }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: 'Чек-листы' }).first().click();
  }
  await expect(page.getByRole('button', { name: 'В работе', exact: true })).toBeVisible();
  await expectStableRussianPage(page);
}

async function expectStableRussianPage(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(/TypeError|ReferenceError|Unhandled|Internal Server Error|storagePath|passwordHash|DATABASE_URL/i);
  expect(text).not.toContain('\uFFFD');
  expect(text).not.toMatch(/\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied)\b/);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(8);
}

async function screenshot(page: Page, name: string, fullPage = true) {
  await expectStableRussianPage(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

async function nextRow(page: Page) {
  const runner = page.locator('.guided-run-modal');
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.locator('.guided-save-state')).toContainText(/Сохранено|Ответ/);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, workerInfo) => {
  skipProject = workerInfo.project.name.includes('mobile');
  if (skipProject) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  factoryId = await resolveFactoryId();
  const employee = await api('/auth/me', { userId: 'pilot-technolog-1' });
  const manager = await api('/auth/me', { userId: 'test-management' });
  employeeDepartmentId = employee.departmentId;
  managerDepartmentId = manager.departmentId;
  if (!employeeDepartmentId || !managerDepartmentId) throw new Error('Не удалось определить отделы browser fixture');

  mainTemplate = await createTemplate(`Контроль ингредиентов ${stamp}`, employeeDepartmentId, 'TECHNOLOG', [
    { title: 'Температура ингредиента', description: 'Введите фактическую температуру', rowType: 'NUMBER', unit: '°C', minValue: 2, maxValue: 8, requiredAnswer: true, isRequired: true, sortOrder: 10 },
    { title: 'Фото подготовленного ингредиента', description: 'Пример: ингредиент и маркировка полностью видны в кадре', rowType: 'PHOTO', requiresPhoto: true, requiredAnswer: true, isRequired: true, sortOrder: 20 },
    { title: 'Состояние ингредиента', rowType: 'YES_NO', requiredAnswer: true, isRequired: true, sortOrder: 30 },
    { title: 'Комментарий по подготовке', rowType: 'TEXT', requiredAnswer: true, isRequired: true, sortOrder: 40 },
    { title: 'Решение по партии', rowType: 'SELECT', optionsText: 'Допустить\nПроверить повторно\nОстановить', requiredAnswer: true, isRequired: true, sortOrder: 50 },
    { title: 'Маркировка применима', rowType: 'YES_NO_NA', requiredAnswer: true, isRequired: true, sortOrder: 60 },
    { title: 'Количество упаковок', rowType: 'NUMBER', unit: 'шт', minValue: 1, maxValue: 100, requiredAnswer: true, isRequired: true, sortOrder: 70 },
    { title: 'Примечание сотрудника', rowType: 'TEXT', requiredAnswer: true, isRequired: true, sortOrder: 80 },
    { title: 'Рабочее место чистое', rowType: 'YES_NO', requiredAnswer: true, isRequired: true, sortOrder: 90 },
    { title: 'Итоговая проверка выполнена', rowType: 'YES_NO', requiredAnswer: true, isRequired: true, sortOrder: 100 },
  ], true);

  const backgroundTemplate = await createTemplate(`Текущий контроль зоны ${stamp}`, employeeDepartmentId, 'TECHNOLOG', [
    { title: 'Осмотр зоны', rowType: 'YES_NO', requiredAnswer: true, sortOrder: 10 },
  ]);
  backgroundTemplateId = backgroundTemplate.id;
  await startRun('pilot-technolog-1', backgroundTemplate.id);

  managerTemplate = await createTemplate(`Контроль отдела руководства ${stamp}`, managerDepartmentId, 'MANAGEMENT', [
    { title: 'Проверка руководителя', rowType: 'YES_NO', requiredAnswer: true, sortOrder: 10 },
  ], true);
  managerRunId = (await startRun('test-management', managerTemplate.id)).id;
});

test.afterAll(async () => {
  if (skipProject) return;
  for (const runId of [...createdRuns].reverse()) {
    await api(`/checklists/runs/${runId}/close`, {
      method: 'POST',
      userId: createdRunOwners.get(runId) ?? 'test-admin',
      body: { reason: 'Завершение browser-проверки' },
      expected: [200, 201, 409],
    }).catch(() => null);
  }
  const occurrenceRows = createdRuns.length
    ? await db.checklistRunCheckRow.findMany({ where: { runId: { in: createdRuns } }, select: { id: true } })
    : [];
  if (occurrenceRows.length) {
    const attachments = await db.attachment.findMany({
      where: { deletedAt: null, entityType: 'CHECKLIST_ENTRY', entityId: { in: occurrenceRows.map((row: any) => row.id) } },
      select: { id: true },
    });
    for (const attachment of attachments) {
      await api(`/attachments/${attachment.id}`, {
        method: 'DELETE', userId: 'test-admin', expected: [200, 201, 409],
      }).catch(() => null);
    }
  }
  for (const [index, templateId] of [...createdTemplates].reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH',
      userId: 'test-admin',
      body: { name: `Browser evidence чек-листов ${stamp}-${index + 1}` },
      expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
  await db.$disconnect();
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
});

test('сотрудник проходит периодический чек-лист на 360, 390 и 430 px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Размеры mobile проверяются внутри desktop-проекта.');
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await loginAs(page, 'pilot-technolog-1');
  await openChecklists(page);

  await expect(page.getByRole('heading', { name: 'В работе' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы' })).toBeVisible();
  await expect(page.getByText(mainTemplate.name)).toBeVisible();
  await screenshot(page, 'mobile-360-checklists-active-available.png');

  const availableCard = page.locator('.checklist-work-card.available').filter({ hasText: mainTemplate.name });
  await availableCard.getByRole('button', { name: 'Взять в работу' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Взять в работу' }).click();
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  const runs = await api('/checklists/runs/my', { userId: 'pilot-technolog-1' });
  mainRunId = runs.find((item: any) => item.templateId === mainTemplate.id)?.id;
  expect(mainRunId).toBeTruthy();
  if (!createdRuns.includes(mainRunId)) createdRuns.push(mainRunId);
  createdRunOwners.set(mainRunId, 'pilot-technolog-1');

  await runner.getByRole('button', { name: 'Вернуться к чек-листам' }).click();
  const activeCheck = await db.checklistRunCheck.findFirst({ where: { runId: mainRunId, status: 'ACTIVE' } });
  expect(activeCheck?.id).toBeTruthy();
  const overdue = new Date(Date.now() - 3 * 60_000);
  await db.checklistRun.update({ where: { id: mainRunId }, data: { nextCheckAt: overdue } });
  await db.checklistRunCheck.update({ where: { id: activeCheck.id }, data: { dueAt: overdue } });
  await page.reload();
  await openChecklists(page);
  await expect(page.locator('.checklist-work-card.overdue').filter({ hasText: mainTemplate.name })).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-overdue.png');
  await page.locator('.checklist-work-card.active').filter({ hasText: mainTemplate.name }).getByRole('button', { name: 'Продолжить' }).click();

  await expect(runner.getByText('Температура ингредиента')).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-point-number.png', false);
  await runner.locator('.guided-current-row input[type="number"]').fill('5');
  await nextRow(page);

  await expect(runner.getByText('Фото подготовленного ингредиента')).toBeVisible();
  await runner.locator('.guided-current-row input[type="file"]').last().setInputFiles({
    name: 'ingredient.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(runner.getByText('ingredient.png')).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-point-photo.png', false);
  await nextRow(page);

  await runner.locator('.guided-current-row').getByRole('button', { name: 'Да', exact: true }).click();
  await screenshot(page, 'mobile-360-checklist-point-choice.png', false);
  await nextRow(page);
  await runner.locator('.guided-current-row textarea').first().fill('Подготовка выполнена по инструкции');
  await nextRow(page);
  await runner.locator('.guided-current-row select').selectOption({ label: 'Допустить' });
  await screenshot(page, 'mobile-360-checklist-number-navigation.png', false);
  await runner.getByRole('button', { name: 'Сохранить пункт' }).click();
  await expect(runner.locator('.guided-save-state')).toContainText('Сохранено');

  await runner.getByRole('button', { name: 'Пауза', exact: true }).click();
  const pauseDialog = page.getByRole('dialog').last();
  await pauseDialog.getByLabel('Причина паузы').fill('Короткая остановка для сверки');
  await screenshot(page, 'mobile-360-checklist-pause.png', false);
  await pauseDialog.getByRole('button', { name: 'Сохранить' }).click();
  await runner.getByRole('button', { name: 'Возобновить' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Возобновить' }).click();
  await nextRow(page);

  await runner.locator('.guided-current-row').getByRole('button', { name: 'Не применимо' }).click();
  await nextRow(page);
  await runner.locator('.guided-current-row input[type="number"]').fill('12');
  await screenshot(page, 'mobile-360-checklist-progress.png', false);
  await nextRow(page);

  await page.setViewportSize({ width: 390, height: 820 });
  await runner.locator('.guided-current-row textarea').first().fill('Отклонений нет');
  await screenshot(page, 'mobile-390-checklist-runner.png', false);
  await nextRow(page);

  await page.setViewportSize({ width: 430, height: 860 });
  await runner.locator('.guided-current-row').getByRole('button', { name: 'Да', exact: true }).click();
  await screenshot(page, 'mobile-430-checklist-runner.png', false);
  await nextRow(page);

  await page.setViewportSize({ width: 360, height: 780 });
  await runner.locator('.guided-current-row').getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Проверить и завершить' }).click();
  await expect(runner.getByRole('heading', { name: 'Всё готово' })).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-final-review.png', false);
  await runner.getByRole('button', { name: 'Завершить проверку' }).click();
  await expect(runner.locator('.guided-save-state')).toContainText('Проверка сохранена');
  await runner.getByRole('button', { name: 'Вернуться к чек-листам' }).click();

  const activeCard = page.locator('.checklist-work-card.active').filter({ hasText: mainTemplate.name });
  await activeCard.getByRole('button', { name: 'Завершить вручную' }).click();
  const closeDialog = page.getByRole('dialog').last();
  await closeDialog.getByLabel('Причина завершения').fill('Контроль смены завершён');
  await closeDialog.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByRole('heading', { name: 'Завершённые за смену' })).toBeVisible();
  await expect(page.locator('.checklist-completed-shift').getByText(mainTemplate.name)).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-completed.png');
});

test('сетевая ошибка не выдаёт ложное сохранение', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Проверяется один раз в desktop-проекте.');
  await page.setViewportSize({ width: 360, height: 780 });
  await loginAs(page, 'pilot-technolog-1');
  await openChecklists(page);
  const runs = await api('/checklists/runs/my', { userId: 'pilot-technolog-1' });
  const run = runs.find((item: any) => item.templateId === backgroundTemplateId);
  expect(run?.id).toBeTruthy();
  const currentCard = page.locator('.checklist-work-card.active').filter({
    has: page.getByText(run.template.name, { exact: true }),
  });
  await currentCard.getByRole('button', { name: 'Продолжить' }).click();
  const runner = page.locator('.guided-run-modal');
  await runner.locator('.guided-current-row').getByRole('button', { name: 'Да', exact: true }).click();
  await page.route('**/checklists/runs/*/rows/*/complete', (route) => route.abort('failed'));
  await runner.getByRole('button', { name: 'Сохранить пункт' }).click();
  await expect(runner.locator('.guided-save-state')).toContainText(/Не удалось|не сохранён/i);
  await expect(runner.locator('.guided-save-state')).not.toHaveText('Сохранено');
  await page.unroute('**/checklists/runs/*/rows/*/complete');
  await runner.getByRole('button', { name: 'Повторить' }).click();
  await expect(runner.locator('.guided-save-state')).toContainText('Сохранено');
});

test('руководитель видит контроль отдела и архив', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Размеры mobile и desktop проверяются внутри desktop-проекта.');
  await page.setViewportSize({ width: 360, height: 820 });
  await loginAs(page, 'test-management');
  await openChecklists(page);
  await expect(page.getByRole('heading', { name: 'Контроль отдела' })).toBeVisible();
  await expect(page.locator('.checklist-manager-control').getByText(managerTemplate.name, { exact: true })).toBeVisible();
  await screenshot(page, 'mobile-360-manager-control.png');

  await api(`/checklists/runs/${managerRunId}/close`, {
    method: 'POST',
    userId: 'test-management',
    body: { reason: 'Проверка архива руководителя' },
  });
  await page.reload();
  await openChecklists(page);
  await page.getByRole('button', { name: 'Библиотека' }).click();
  const managerCard = page.locator('.checklist-template-card').filter({ hasText: managerTemplate.name });
  await managerCard.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.getByText('Архив чек-листов')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(managerTemplate.name) }).first()).toBeVisible();
  await screenshot(page, 'mobile-360-checklist-archive.png');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'В работе', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Контроль отдела' })).toBeVisible();
  await screenshot(page, 'desktop-manager-checklists.png');
});
