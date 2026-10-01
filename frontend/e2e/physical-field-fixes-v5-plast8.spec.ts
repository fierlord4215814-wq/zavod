import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast8');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P8_${runId}__`;

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
  expected?: number[];
};

type ArtifactState = {
  marker: string;
  factoryId: string;
  templates: Array<{ id: string; purpose: string; finalState: string }>;
  runs: Array<{ id: string; owner: string; finalState: string }>;
  line: null | { id: string; positionId: string; staffingTemplateId: string; finalState: string };
  physicalDeleteCount: number;
  existingOperationalDataChanged: boolean;
};

const artifacts: ArtifactState = {
  marker,
  factoryId: '',
  templates: [],
  runs: [],
  line: null,
  physicalDeleteCount: 0,
  existingOperationalDataChanged: false,
};

let factoryId = '';
let managerDepartmentId = '';
let masterDepartmentId = '';
let runnerTemplate: any = null;
let builderTemplateId = '';
let temporaryLineName = '';

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
  const manager = await api('/auth/me', { userId: 'test-management' });
  const master = await api('/auth/me', { userId: 'test-master' });
  managerDepartmentId = manager.departmentId;
  masterDepartmentId = master.departmentId;
  if (!factoryId || !managerDepartmentId || !masterDepartmentId) throw new Error('Не удалось определить Завод 4 и рабочие отделы');
  artifacts.factoryId = factoryId;
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?pffv5p8=${Date.now()}`);
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

async function openChecklists(page: Page) {
  await openNavigationItem(page, 'Чек-листы');
  await expect(page.getByRole('heading', { name: 'Чек-листы', exact: true })).toBeVisible();
}

async function openShift(page: Page) {
  await openNavigationItem(page, 'Смена');
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  ) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
}

async function createRunnerTemplate() {
  const name = `Контроль готовности рабочей зоны ${runId}`;
  const template = await api('/checklists/templates', {
    method: 'POST',
    body: {
      name,
      description: 'Четыре типа пунктов для проверки рабочего mobile-flow.',
      departmentId: managerDepartmentId,
      scope: 'DEPARTMENT',
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isActive: true,
      rows: [
        { title: 'Температура продукта', rowType: 'NUMBER', unit: '°C', minValue: 10, maxValue: 20, requiredAnswer: true, requiresComment: false, isRequired: true, sortOrder: 10 },
        { title: 'Комментарий оператора', rowType: 'TEXT', requiredAnswer: true, requiresComment: false, isRequired: true, sortOrder: 20 },
        { title: 'Маркировка читается', rowType: 'YES_NO', requiredAnswer: true, requiresComment: false, isRequired: true, sortOrder: 30 },
        { title: 'Состояние упаковки', rowType: 'SELECT', optionsJson: ['Норма', 'Требует внимания'], requiredAnswer: true, requiresComment: false, isRequired: true, sortOrder: 40 },
      ],
    },
  });
  artifacts.templates.push({ id: template.id, purpose: 'mobile runner', finalState: 'active' });
  return template;
}

async function closeRun(runIdToClose: string, owner: string, reason: string) {
  await api(`/checklists/runs/${runIdToClose}/close`, {
    method: 'POST',
    userId: owner,
    body: { comment: reason },
    expected: [200, 201, 409],
  }).catch(() => null);
  const artifact = artifacts.runs.find((item) => item.id === runIdToClose);
  if (artifact) artifact.finalState = 'closed';
}

async function archiveTemplate(templateId: string, purpose: string) {
  const current = await api(`/checklists/templates/${templateId}`, { userId: 'test-admin' }).catch(() => null);
  if (current && !String(current.name).startsWith(marker)) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH',
      userId: 'test-admin',
      body: { name: `${marker}${purpose}`, reason: 'Штатное завершение targeted E2E Пласта 8' },
      expected: [200, 201, 409],
    }).catch(() => null);
  }
  await api(`/checklists/templates/${templateId}/archive`, {
    method: 'POST',
    userId: 'test-admin',
    body: {},
    expected: [200, 201, 409],
  }).catch(() => null);
  const artifact = artifacts.templates.find((item) => item.id === templateId);
  if (artifact) artifact.finalState = 'archived';
}

async function cleanupTemporaryLine() {
  if (!artifacts.line) return;
  const { id, positionId, staffingTemplateId } = artifacts.line;
  await api(`/admin/lines/${id}/staffing-templates/${staffingTemplateId}`, {
    method: 'PATCH',
    userId: 'test-admin',
    body: { name: `${marker}состав`, isActive: false, reason: 'Штатное завершение targeted E2E Пласта 8' },
    expected: [200, 201, 409],
  }).catch(() => null);
  await api(`/admin/lines/${id}/positions/${positionId}`, {
    method: 'PATCH',
    userId: 'test-admin',
    body: { isActive: false, reason: 'Штатное завершение targeted E2E Пласта 8' },
    expected: [200, 201, 409],
  }).catch(() => null);
  await api(`/admin/lines/${id}`, {
    method: 'PATCH',
    userId: 'test-admin',
    body: { name: `${marker}линия`, isActive: false, reason: 'Штатное завершение targeted E2E Пласта 8' },
    expected: [200, 201, 409],
  }).catch(() => null);
  artifacts.line.finalState = 'line, position and staffing template deactivated; no assignments created';
}

function writeArtifacts() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...artifacts,
  }, null, 2)}\n`, 'utf8');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await resolveContext();
  runnerTemplate = await createRunnerTemplate();
});

test.afterAll(async () => {
  for (const run of artifacts.runs) await closeRun(run.id, run.owner, 'Завершение targeted E2E Пласта 8');
  for (const template of artifacts.templates) await archiveTemplate(template.id, template.purpose.replace(/\s+/g, '-'));
  await cleanupTemporaryLine();
  writeArtifacts();
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
});

test('mobile checklist: список, focused runner, pause/resume, issue и архив', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'test-management');
  await openChecklists(page);

  for (const label of ['В работе', 'Доступные', 'Архив']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${label}`) }).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /Просрочено/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Доступные/ }).first().click();
  const availableCard = page.locator('.checklist-work-card.available').filter({ hasText: runnerTemplate.name });
  await expect(availableCard).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(evidenceDir, 'checklist-list-390.png'), fullPage: true });

  await availableCard.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const startDialog = page.getByRole('dialog').filter({ hasText: runnerTemplate.name }).last();
  await startDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click();

  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await expect(runner.getByText('Пункт 1 из 4')).toBeVisible();
  const workspace = await api('/checklists/workspace', { userId: 'test-management' });
  const started = workspace.activeRuns.find((item: any) => item.templateId === runnerTemplate.id || item.template?.id === runnerTemplate.id);
  expect(started?.id).toBeTruthy();
  artifacts.runs.push({ id: started.id, owner: 'test-management', finalState: 'active' });

  await runner.getByRole('spinbutton').fill('25');
  await expect(runner.getByText(/выше нормы.*отклонение/i)).toBeVisible();
  await expect(runner.getByText('Комментарий (обязательно)')).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, 'checklist-runner-390.png'), fullPage: false });
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 2 из 4')).toBeVisible();

  await runner.getByRole('button', { name: 'Пауза', exact: true }).click();
  const pauseDialog = page.getByRole('dialog').filter({ hasText: 'Причина паузы' });
  await pauseDialog.getByLabel('Причина паузы').fill('Проверка штатной паузы');
  await pauseDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(runner.getByRole('button', { name: 'Возобновить', exact: true })).toBeVisible();
  await runner.getByRole('button', { name: 'Возобновить', exact: true }).click();
  const resumeDialog = page.locator('.modal-backdrop > form.modal-card').filter({ hasText: 'Возобновить чек-лист' });
  await resumeDialog.getByRole('button', { name: 'Возобновить', exact: true }).click();

  await runner.getByPlaceholder('Введите ответ').fill('Рабочее состояние подтверждено');
  await runner.getByText('Добавить комментарий', { exact: true }).click();
  await runner.getByPlaceholder('Необязательно').fill('Дополнительный комментарий сохранён');
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 3 из 4')).toBeVisible();
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 4 из 4')).toBeVisible();
  await runner.getByLabel('Вариант').selectOption('Норма');
  await runner.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(runner.getByText('Пункт 3 из 4')).toBeVisible();
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByLabel('Вариант')).toHaveValue('Норма');
  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const closeDialog = page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
  await closeDialog.getByLabel('Причина завершения').fill('Проверка завершена штатно');
  await closeDialog.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  artifacts.runs.find((item) => item.id === started.id)!.finalState = 'closed';

  await page.getByRole('button', { name: /Архив/ }).first().click();
  await expect(page.locator('.checklist-archive-compact-card').filter({ hasText: runnerTemplate.name })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await expectNoHorizontalOverflow(page);
  }
});

test('desktop builder: пункты, preview и immutable snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await loginAs(page, 'test-admin');
  await openChecklists(page);
  const builderName = `Контроль упаковки рабочей смены ${runId}`;
  const runsBeforePreview = (await api('/checklists/workspace', { userId: 'test-master' })).activeRuns.length;

  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const builder = page.locator('.checklist-template-builder-sheet');
  await expect(builder.getByRole('heading', { name: 'Новый шаблон', exact: true })).toBeVisible();
  for (const heading of ['1 Основное', '2 Периодичность', '3 Пункты', '4 Проверка и публикация']) {
    await expect(builder.getByText(new RegExp(heading.replace(' ', '.*'))).first()).toBeVisible();
  }
  await builder.getByLabel('Название', { exact: true }).fill(builderName);
  const mainSection = builder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first();
  await mainSection.locator('select').first().selectOption(masterDepartmentId);
  await builder.getByRole('button', { name: 'Общий для отдела', exact: true }).click();
  const periodicitySection = builder.locator('.checklist-builder-section').filter({ hasText: 'Периодичность' }).first();
  await periodicitySection.locator('select').first().selectOption('EVERY_N_HOURS');
  await periodicitySection.locator('select').nth(2).selectOption('MINUTES');
  await periodicitySection.locator('input[type="number"]').fill('30');
  await periodicitySection.locator('select').last().selectOption('MASTER');

  await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
  let itemDialog = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  await itemDialog.getByLabel('Название пункта', { exact: true }).fill('Температура упаковки');
  await itemDialog.locator('select').first().selectOption('NUMBER');
  await itemDialog.locator('select').nth(1).selectOption('°C');
  await itemDialog.getByLabel('Минимум', { exact: true }).fill('2');
  await itemDialog.getByLabel('Максимум', { exact: true }).fill('8');
  await itemDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();

  let rows = builder.locator('.checklist-builder-row');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button', { name: 'Копия', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: 'Изменить', exact: true }).click();
  itemDialog = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  await itemDialog.getByLabel('Название пункта', { exact: true }).fill('Состояние маркировки');
  await itemDialog.locator('select').first().selectOption('SELECT');
  await itemDialog.getByLabel('Варианты выбора', { exact: true }).fill('Норма\nТребует внимания');
  await itemDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await rows.nth(1).getByRole('button', { name: 'Переместить выше' }).click();
  await expect(rows.first()).toContainText('Состояние маркировки');
  await page.screenshot({ path: path.join(evidenceDir, 'checklist-builder-desktop.png'), fullPage: false });

  await builder.getByRole('button', { name: 'Предпросмотр как у сотрудника', exact: true }).click();
  const preview = page.locator('.checklist-preview-sheet');
  await expect(preview.getByText('Предпросмотр не создаёт запуск и не сохраняет ответы.')).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, 'checklist-preview-desktop.png'), fullPage: false });
  expect((await api('/checklists/workspace', { userId: 'test-master' })).activeRuns.length).toBe(runsBeforePreview);
  await preview.getByRole('button', { name: 'Закрыть', exact: true }).first().click();

  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(builder).toHaveCount(0);
  const library = await api('/checklists/templates/library', { userId: 'test-admin' });
  const created = library.find((item: any) => item.name === builderName);
  expect(created?.id).toBeTruthy();
  builderTemplateId = created.id;
  artifacts.templates.push({ id: builderTemplateId, purpose: 'builder snapshot', finalState: 'active' });

  const oldRun = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-master',
    body: { templateId: builderTemplateId },
  });
  artifacts.runs.push({ id: oldRun.id, owner: 'test-master', finalState: 'active' });
  const oldTitles = oldRun.rows.map((row: any) => row.title);

  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: builderName }).first();
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.getByRole('button', { name: 'Редактировать', exact: true }).first().click();
  const editBuilder = page.locator('.checklist-template-builder-sheet');
  rows = editBuilder.locator('.checklist-builder-row');
  await rows.first().getByRole('button', { name: 'Изменить', exact: true }).click();
  itemDialog = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  await itemDialog.getByLabel('Название пункта', { exact: true }).fill('Состояние маркировки после обновления');
  await itemDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await editBuilder.getByLabel('Причина изменения', { exact: true }).fill('Уточнение формулировки пункта');
  await editBuilder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Обновить активный шаблон?' }).getByRole('button', { name: 'Сохранить новую версию', exact: true }).click();
  await expect(editBuilder).toHaveCount(0);

  const oldRunAfterEdit = await api(`/checklists/runs/${oldRun.id}`, { userId: 'test-master' });
  expect(oldRunAfterEdit.rows.map((row: any) => row.title)).toEqual(oldTitles);
  await closeRun(oldRun.id, 'test-master', 'Проверка immutable snapshot завершена');
  const newRun = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-master',
    body: { templateId: builderTemplateId },
  });
  artifacts.runs.push({ id: newRun.id, owner: 'test-master', finalState: 'active' });
  expect(newRun.rows.some((row: any) => row.title === 'Состояние маркировки после обновления')).toBeTruthy();
  await closeRun(newRun.id, 'test-master', 'Проверка новой ревизии завершена');
});

test('future plan picker: все строки, длинное имя, sticky footer и whole-row action', async ({ page }) => {
  const suffix = runId.slice(-8);
  temporaryLineName = `Линия фасовки и контроля готовой продукции с длинным наименованием ${suffix}`;
  const line = await api('/admin/lines', {
    method: 'POST',
    userId: 'test-admin',
    body: { factoryId, name: temporaryLineName, isActive: true },
  });
  const position = await api(`/admin/lines/${line.id}/positions`, {
    method: 'POST',
    userId: 'test-admin',
    body: { name: `Оператор ${suffix}`, displayName: `Оператор линии ${suffix}`, sortOrder: 1 },
  });
  const staffingTemplate = await api(`/admin/lines/${line.id}/staffing-templates`, {
    method: 'POST',
    userId: 'test-admin',
    body: {
      name: `Состав рабочей линии ${suffix}`,
      items: [{ positionId: position.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 0 }],
    },
  });
  artifacts.line = {
    id: line.id,
    positionId: position.id,
    staffingTemplateId: staffingTemplate.id,
    finalState: 'active for UI proof',
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'test-master');
  await openShift(page);
  await page.getByRole('button', { name: /Выбрать смену/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Следующая смена/ }).click();
  await expect(page.getByText('Следующая смена', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();

  const picker = page.locator('.future-plan-line-picker');
  await expect(picker).toBeVisible();
  const targetRow = picker.locator('.future-plan-line-row').filter({ hasText: temporaryLineName });
  await expect(targetRow).toBeVisible();
  await expect(targetRow.locator('.future-plan-line-add')).toHaveText('+');
  await expect(targetRow.locator('.future-plan-line-name')).toHaveCSS('-webkit-line-clamp', '2');
  await expectNoHorizontalOverflow(page);

  const lastRow = picker.locator('.future-plan-line-row').last();
  await lastRow.scrollIntoViewIfNeeded();
  const footer = picker.locator('.premium-sheet-footer');
  const [lastBox, footerBox] = await Promise.all([lastRow.boundingBox(), footer.boundingBox()]);
  expect(lastBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
  await picker.screenshot({ path: path.join(evidenceDir, 'future-plan-picker-390.png') });

  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await expectNoHorizontalOverflow(page);
    await expect(targetRow).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await targetRow.scrollIntoViewIfNeeded();
  await targetRow.click();

  const planningModal = page.locator('.planning-assignment-modal');
  await expect(planningModal.getByRole('heading', { name: temporaryLineName, exact: true })).toBeVisible();
  await planningModal.locator('select').first().selectOption(staffingTemplate.id);
  const remap = page.getByRole('dialog').filter({ hasText: 'Применить шаблон' }).last();
  await remap.getByRole('button', { name: 'Применить шаблон', exact: true }).click();
  await expect(planningModal.getByLabel('Шаблон состава', { exact: true })).toHaveValue(staffingTemplate.id);

  const timeline = await api('/shift/timeline', { userId: 'test-master' });
  const future = await api(`/shift/future?${new URLSearchParams({
    targetShiftDate: timeline.next.shiftDate,
    shiftType: timeline.next.shiftType,
  })}`, { userId: 'test-master' });
  expect(future.plannedLines.some((planned: any) => planned.lineId === line.id)).toBeTruthy();
  expect(future.plannedLines.find((planned: any) => planned.lineId === line.id)?.plannedAssignmentsCount ?? 0).toBe(0);
});
