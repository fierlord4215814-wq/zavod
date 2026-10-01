import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage63-checklist-ux-hardening-screenshots');
const marker = `Контроль чек-листа ${Date.now()}`;
const createdTemplateIds: string[] = [];
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /РїС|Р |СЃ|Р“|Рќ|РЈ|Ð|Ñ/;

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
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage63Dialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage63Dialogs?: string[] }).__stage63Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error|storagePath/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage63User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButtons = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await navButtons.count()) > 0) {
    await navButtons.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

function writeTinyPng(pathname: string) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(pathname, png);
}

async function createStage63Template(factoryId: string) {
  const me = await api('/auth/me', { userId: 'test-management', factoryId });
  const library = await api('/checklists/templates/library', { userId: 'test-admin', factoryId });
  const libraryTemplates = Array.isArray(library) ? library : library.items ?? library.templates ?? [];
  const cleanTemplateLine = libraryTemplates.find((item: { lineId?: string; lineName?: string }) =>
    item.lineId && !/Stage\d+|regression|browser|demo|simulation|test/i.test(`${item.lineId ?? ''} ${item.lineName ?? ''}`),
  );
  const lines = await api('/directory/lines', { userId: 'test-admin', factoryId });
  const line = lines.find((item: { name: string }) => item.name.includes('Рондо')) ?? lines[0];
  const preferredLineId = cleanTemplateLine?.lineId ?? line.id;
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: `${marker}: Контроль пиццы Рондо`,
      description: 'Пилотная проверка мобильного прохождения чек-листа',
      departmentId: me.departmentId,
      lineId: preferredLineId,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isMandatory: true,
      operationId: `stage63-browser-template-${Date.now()}`,
    },
  });
  createdTemplateIds.push(template.id);
  const rows = [
    { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
    { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, targetValue: 125, requiredAnswer: true },
    { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true },
    { title: 'Фото готового изделия', rowType: 'REQUIRED_PHOTO', sortOrder: 40, requiresPhoto: true },
    { title: 'Решение по пункту', rowType: 'SELECT', sortOrder: 50, optionsText: 'Норма\nТребует внимания', requiredAnswer: true },
  ];
  for (const row of rows) {
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { ...row, operationId: `stage63-browser-row-${Date.now()}-${row.sortOrder}` },
    });
  }
  return { ...template, line };
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  for (const [index, templateId] of createdTemplateIds.splice(0).reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { name: `Stage63 browser cleanup ${Date.now()}-${index + 1}` },
      expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', factoryId, body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('ADMIN видит библиотеку, конструктор и архив чек-листов без технической каши', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-аудит конструктора выполняется в desktop-проекте.');
  const factoryId = await resolveFactoryId();
  let template = await createStage63Template(factoryId);
  const library = await api('/checklists/templates/library', { userId: 'test-admin', factoryId });
  const visibleTemplates = Array.isArray(library) ? library : library.items ?? library.templates ?? [];
  template = visibleTemplates.find((item: { id?: string }) => item.id === template.id)
    ?? visibleTemplates.find((item: { name?: string; lineName?: string }) =>
      String(item.name ?? '').includes('Контроль чек-листа')
      && !/Stage\d+|regression|browser|demo|simulation|test/i.test(`${item.name ?? ''} ${item.lineName ?? ''}`),
    )
    ?? template;
  await loginAs(page, 'test-admin');

  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklists-screen .segmented-control').getByRole('button', { name: 'Библиотека' }).click();
  await expect(page.locator('.checklist-template-card').filter({ hasText: template.name })).toBeVisible();
  await screenshot(page, '01-checklist-builder-desktop.png');

  const card = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.getByRole('button', { name: 'Редактировать' }).first().click();
  await expect(page.locator('form.modal-card')).toContainText('Кому предназначен');
  await page.locator('form.modal-card').getByRole('button', { name: 'Отмена' }).click();

  await card.getByRole('button', { name: 'Добавить пункт' }).first().click();
  await expect(page.locator('form.modal-card')).toContainText('Тип пункта');
  await expect(page.locator('form.modal-card')).toContainText('Для числового пункта заполните единицу и диапазон');
  await screenshot(page, '02-checklist-row-editor-desktop.png');
  await page.locator('form.modal-card').getByRole('button', { name: 'Отмена' }).click();

  await card.getByRole('button', { name: 'Предпросмотр' }).click();
  await expect(page.locator('.modal-card')).toContainText('Предпросмотр на телефоне');
  await expect(page.locator('.modal-card')).toContainText('Вес заготовки');
  await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();

  await page.locator('.checklists-screen .segmented-control').getByRole('button', { name: 'Архив' }).click();
  await expect(page.locator('body')).toContainText('Архив чек-листов');
  await expect(page.locator('body')).toContainText('Выберите шаблон из библиотеки');
  await screenshot(page, '10-checklist-archive-desktop.png');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile guided-run показывает один пункт, понятные ошибки, фото и результат', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильное прохождение выполняется только в mobile-проекте.');
  const filePath = testInfo.outputPath('фото-пилот.png');
  writeTinyPng(filePath);
  const factoryId = await resolveFactoryId();
  const template = await createStage63Template(factoryId);

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Чек-листы/);
  await expect(page.locator('body')).toContainText('Доступные чек-листы');
  await screenshot(page, '04-checklist-library-mobile.png');

  const availableCard = page.locator('.checklist-work-card.available').filter({ hasText: template.name }).first();
  await availableCard.getByRole('button', { name: 'Посмотреть чек-лист' }).click();
  await expect(page.locator('.modal-card')).toContainText('Предпросмотр на телефоне');
  await screenshot(page, '03-checklist-mobile-preview.png');
  await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();

  await availableCard.getByRole('button', { name: 'Взять в работу' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Взять в работу' }).click();

  await expect(page.getByText('Пункт 1 из 5')).toBeVisible();
  await expect(page.locator('.guided-current-row')).toContainText('Проверить маркировку');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(page.locator('.error-state')).toContainText('Проверить маркировку');
  await screenshot(page, '08-checklist-required-errors-mobile.png');
  await page.getByRole('button', { name: 'Да', exact: true }).click();
  await screenshot(page, '06-checklist-run-yesno-mobile.png');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 2 из 5')).toBeVisible();
  await expect(page.locator('.guided-current-row')).toContainText('Вес заготовки');
  await expect(page.locator('.guided-current-row')).toContainText('Допустимо');
  await page.getByLabel(/Значение/).fill('125');
  await screenshot(page, '05-checklist-run-numeric-mobile.png');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 3 из 5')).toBeVisible();
  await page.getByLabel('Ответ').fill('Отклонений нет');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 4 из 5')).toBeVisible();
  await page.locator('input[type="file"]').last().setInputFiles(filePath);
  await expect(page.getByText('фото-пилот.png')).toBeVisible();
  await screenshot(page, '07-checklist-run-photo-mobile.png');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 5 из 5')).toBeVisible();
  await page.getByLabel('Вариант').selectOption('Норма');
  await page.getByRole('button', { name: 'Проверить и завершить' }).click();
  await expect(page.getByRole('heading', { name: 'Всё готово' })).toBeVisible();
  await page.getByRole('button', { name: 'Завершить чек-лист' }).click();
  const closeDialog = page.getByRole('dialog').last();
  await closeDialog.getByLabel('Причина завершения').fill('Проверка Stage63 завершена');
  await closeDialog.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('.guided-run-modal')).toHaveCount(0);
  await screenshot(page, '09-checklist-result-mobile.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklists-screen .segmented-control').getByRole('button', { name: 'Архив' }).click();
  await expect(page.locator('body')).toContainText('Архив чек-листов');
  await expect(page.locator('body')).toContainText('Выберите шаблон из библиотеки');
  await screenshot(page, '11-checklist-archive-mobile.png');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
