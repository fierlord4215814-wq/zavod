import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v2-screenshots', 'stage04');
const createdTemplates: string[] = [];
const createdRuns = new Map<string, string>();
let factoryId = '';
let managerDepartmentId = '';
let runnerTemplate: any = null;

type ApiOptions = { method?: string; userId?: string | null; body?: unknown; expected?: number[] };

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${pathname}: ${response.status} ${text}`);
  return data;
}

function currentShift() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return { shiftType: hour >= 8 && hour < 20 ? 'DAY' : 'NIGHT' };
}

async function resolveContext() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  factoryId = login.availableFactories.find((factory: any) => factory.code === 'factory-4')?.id ?? login.recommendedFactoryId;
  const manager = await api('/auth/me', { userId: 'test-management' });
  managerDepartmentId = manager.departmentId;
  if (!factoryId || !managerDepartmentId) throw new Error('Не удалось определить контекст Stage04 E2E');
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?stage04=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openChecklists(page: Page) {
  const direct = page.getByRole('button', { name: 'Чек-листы', exact: true }).filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else {
    await page.getByRole('button', { name: 'Ещё', exact: true }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: 'Чек-листы' }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Чек-листы' })).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

async function createRunnerTemplate(label: string) {
  const template = await api('/checklists/templates', {
    method: 'POST',
    body: {
      name: label,
      description: 'Мобильная проверка общего конструктора',
      departmentId: managerDepartmentId,
      assignmentRoles: ['MANAGEMENT'],
      shiftType: currentShift().shiftType,
      frequencyRule: 'EVERY_N_HOURS',
      frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 30,
      rows: [
        { title: 'Температура продукта', description: 'Введите фактическое значение', rowType: 'NUMBER', unit: '°C', minValue: 2, maxValue: 8, requiredAnswer: true, isRequired: true, sortOrder: 10 },
        { title: 'Внешний вид соответствует норме', rowType: 'YES_NO', requiredAnswer: true, isRequired: true, sortOrder: 20 },
      ],
    },
  });
  createdTemplates.push(template.id);
  return template;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await resolveContext();
  runnerTemplate = await createRunnerTemplate(`Мобильный контроль смены ${testInfo.project.name} ${Date.now()}`);
});

test.afterAll(async () => {
  for (const [runId, ownerId] of createdRuns) {
    await api(`/checklists/runs/${runId}/close`, { method: 'POST', userId: ownerId, body: { comment: 'Завершение Stage04 E2E' }, expected: [200, 201, 409] }).catch(() => null);
  }
  for (const templateId of [...createdTemplates].reverse()) {
    await api(`/checklists/templates/${templateId}/archive`, { method: 'POST', body: {}, expected: [200, 201, 409] }).catch(() => null);
  }
  const library = await api('/checklists/templates/library', { userId: 'test-admin' }).catch(() => []);
  for (const template of library.filter((item: any) => /^(Контроль маркировки|Мобильный контроль смены) (desktop-edge|mobile-360-edge) \d+/.test(item.name))) {
    await api(`/checklists/templates/${template.id}/archive`, { method: 'POST', body: {}, expected: [200, 201, 409] }).catch(() => null);
  }
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
});

test('четыре раздела ведут только к выбранному списку', async ({ page }, testInfo) => {
  await loginAs(page, 'test-management');
  await openChecklists(page);

  for (const label of ['В работе', 'Доступные', 'Просрочено', 'Архив']) {
    await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible();
  }
  await expect(page.getByText('Скоро', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Доступные/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'В работе', exact: true })).toHaveCount(0);
  await expect(page.getByText(runnerTemplate.name, { exact: true })).toBeVisible();

  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-home.png`), fullPage: true });
});

test('canonical конструктор создаёт, редактирует и копирует шаблон с пунктами', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const name = `Контроль маркировки ${testInfo.project.name} ${stamp}`;
  await loginAs(page, 'test-admin');
  await openChecklists(page);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();

  const modal = page.locator('.checklist-template-builder-modal');
  await expect(modal.getByRole('heading', { name: 'Новый шаблон' })).toBeVisible();
  const templateNameInput = modal.getByRole('textbox', { name: 'Название', exact: true });
  await expect(templateNameInput).toBeEnabled();
  await templateNameInput.fill(name);
  const departmentSelect = modal.locator('select[name="departmentId"]');
  await departmentSelect.selectOption(managerDepartmentId);

  const departmentOptions = await departmentSelect.locator('option').evaluateAll((options) => options
    .map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent?.trim() ?? '' }))
    .filter((option) => option.value));
  expect(new Set(departmentOptions.map((option) => option.value)).size).toBe(departmentOptions.length);
  expect(new Set(departmentOptions.map((option) => option.text.toLocaleLowerCase('ru-RU'))).size).toBe(departmentOptions.length);

  await modal.getByLabel('Название пункта', { exact: true }).fill('Проверить маркировку');
  await modal.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(modal.getByText('1. Проверить маркировку')).toBeVisible();
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-builder.png`), fullPage: false });
  await modal.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await openChecklists(page);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  let card = page.locator('.checklist-template-card').filter({ hasText: name }).first();
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.locator('.secondary-card-actions').getByRole('button', { name: 'Редактировать', exact: true }).click();
  const editModal = page.locator('.checklist-template-builder-modal');
  await editModal.getByRole('button', { name: 'Изменить', exact: true }).click();
  await editModal.getByLabel('Название пункта', { exact: true }).fill('Проверить маркировку и дату');
  await editModal.getByRole('button', { name: 'Готово', exact: true }).click();
  await editModal.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(editModal).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await openChecklists(page);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();

  card = page.locator('.checklist-template-card').filter({ hasText: name }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.locator('.secondary-card-actions').getByRole('button', { name: 'Создать копию', exact: true }).click();
  const copyModal = page.locator('.checklist-template-builder-modal');
  const copyName = `${name} — копия`;
  await expect(copyModal.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue(copyName);
  await expect(copyModal.getByText('Проверить маркировку и дату')).toBeVisible();
  await copyModal.getByRole('button', { name: 'Создать копию', exact: true }).click();
  await expect(copyModal).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await openChecklists(page);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await expect(page.getByText(copyName, { exact: true })).toBeVisible();

  const library = await api('/checklists/templates/library', { userId: 'test-admin' });
  for (const template of library.filter((item: any) => item.name === name || item.name === copyName)) createdTemplates.push(template.id);
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-library.png`), fullPage: true });
});

test('focused runner держит один пункт и сохраняет навигацию назад', async ({ page }, testInfo) => {
  await loginAs(page, 'test-management');
  await openChecklists(page);
  await page.getByRole('button', { name: /Доступные/ }).first().click();
  const card = page.locator('.checklist-work-card.available').filter({ hasText: runnerTemplate.name });
  await card.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const confirm = page.locator('.modal-card').filter({ hasText: runnerTemplate.name }).last();
  await confirm.getByRole('button', { name: 'Взять в работу', exact: true }).click();

  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await expect(runner.getByText('Пункт 1 из 2')).toBeVisible();
  await expect(runner.getByText('Температура продукта', { exact: true })).toBeVisible();
  const runId = await page.evaluate(async ({ base, templateId, selectedFactoryId }) => {
    const response = await fetch(`${base}/checklists/workspace`, { headers: { 'x-user-id': 'test-management', 'x-factory-id': selectedFactoryId } });
    const data = await response.json();
    return data.activeRuns.find((run: any) => run.templateId === templateId || run.template?.id === templateId)?.id ?? null;
  }, { base: apiUrl, templateId: runnerTemplate.id, selectedFactoryId: factoryId });
  if (runId) createdRuns.set(runId, 'test-management');

  const numericAnswer = runner.getByRole('spinbutton');
  await numericAnswer.fill('5');
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 2 из 2')).toBeVisible();
  await runner.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(runner.getByText('Пункт 1 из 2')).toBeVisible();
  await expect(runner.getByRole('spinbutton')).toHaveValue('5');
  await runner.getByRole('spinbutton').fill('6');
  await runner.getByRole('button', { name: 'Вернуться к чек-листам' }).click();
  const discard = page.getByRole('dialog').filter({ hasText: 'Ответ не сохранён' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Остаться' }).click();
  await expect(runner).toBeVisible();
  await expect(runner.getByRole('spinbutton')).toHaveValue('6');

  if (testInfo.project.name.includes('mobile')) {
    await expect(runner.locator('.checklist-number-navigation')).toBeHidden();
    const runnerOverflow = await runner.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(runnerOverflow).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoOverflow(page);
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-edge-runner.png'), fullPage: false });
  }
  await expectNoOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-runner.png`), fullPage: false });
  await runner.getByRole('button', { name: 'Вернуться к чек-листам' }).click();
  await page.getByRole('dialog').filter({ hasText: 'Ответ не сохранён' }).getByRole('button', { name: 'Выйти без сохранения' }).click();
  await expect(runner).toHaveCount(0);
});
