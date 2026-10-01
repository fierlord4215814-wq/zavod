import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /пїЅ|пїЅпїЅпїЅпїЅ|Гђ|Р Сџ/;
const marker = `Контроль чек-листа ${Date.now()}`;
const createdTemplateIds: string[] = [];
const createdRunIds: string[] = [];
const createdAttachmentIds: string[] = [];

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
    Object.defineProperty(window, '__stage50Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage50Dialogs?: string[] }).__stage50Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
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
  await page.goto(`${frontendUrl}/?stage50User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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

async function createStage50Template(factoryId: string) {
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
      description: 'Проверка библиотеки, назначения и архива',
      departmentId: me.departmentId,
      lineId: preferredLineId,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isMandatory: true,
      operationId: `stage50-browser-template-${Date.now()}`,
    },
  });
  createdTemplateIds.push(template.id);
  const rows = [
    { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
    { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, requiredAnswer: true },
    { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true },
    { title: 'Фото готовой пиццы', rowType: 'REQUIRED_PHOTO', sortOrder: 40, requiresPhoto: true },
  ];
  for (const row of rows) {
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { ...row, operationId: `stage50-browser-row-${Date.now()}-${row.sortOrder}` },
    });
  }
  return { ...template, line: cleanTemplateLine ? { id: cleanTemplateLine.lineId, name: cleanTemplateLine.lineName } : line };
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  for (const runId of createdRunIds.splice(0).reverse()) {
    await api(`/checklists/runs/${runId}/close`, {
      method: 'POST', userId: 'test-management', factoryId,
      body: { reason: 'Завершение browser-проверки' }, expected: [200, 201, 409],
    }).catch(() => null);
  }
  for (const attachmentId of createdAttachmentIds.splice(0).reverse()) {
    await api(`/attachments/${attachmentId}`, {
      method: 'DELETE', userId: 'test-admin', factoryId, expected: [200, 201, 409],
    }).catch(() => null);
  }
  for (const [index, templateId] of createdTemplateIds.splice(0).reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH', userId: 'test-admin', factoryId,
      body: { name: `Stage50 browser cleanup ${Date.now()}-${index + 1}` }, expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', factoryId, body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('MANAGEMENT берёт назначенный чек-лист в работу, проходит guided-run и видит архивную таблицу', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий создания и прохождения выполняется на desktop.');
  const filePath = testInfo.outputPath('фото-проверка.png');
  writeTinyPng(filePath);
  const factoryId = await resolveFactoryId();
  const template = await createStage50Template(factoryId);

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Чек-листы/);
  await expect(page.getByRole('button', { name: 'В работе' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Шаблоны', exact: true })).toBeVisible();
  await page.locator('.checklist-kpi-strip').getByRole('button').filter({ hasText: 'Доступные' }).click();
  await expect(page.locator('body')).toContainText('Доступные чек-листы');

  const availableCard = page.locator('.checklist-work-card.available').filter({ hasText: template.name }).first();
  await expect(availableCard).toContainText('Вручную');
  await expect(availableCard).toContainText(template.line.name);
  await availableCard.getByRole('button', { name: 'Посмотреть чек-лист' }).click();
  await expect(page.locator('.modal-card')).toContainText('Вес заготовки');
  await expect(page.locator('.modal-card')).toContainText('Фото готовой пиццы');
  await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();

  await availableCard.getByRole('button', { name: 'Взять в работу' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Взять в работу' }).click();
  const startedRuns = await api('/checklists/runs/my', { userId: 'test-management', factoryId });
  const startedRun = startedRuns.find((item: { templateId?: string; status?: string }) => item.templateId === template.id && item.status === 'ACTIVE');
  if (startedRun?.id) createdRunIds.push(startedRun.id);

  await expect(page.getByText('Пункт 1 из 4')).toBeVisible();
  await page.getByRole('button', { name: 'Да', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 2 из 4')).toBeVisible();
  await page.getByLabel(/Значение/).fill('125');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 3 из 4')).toBeVisible();
  await page.getByLabel('Ответ').fill('Норма');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 4 из 4')).toBeVisible();
  await page.locator('input[type="file"]').last().setInputFiles(filePath);
  await expect(page.getByText('фото-проверка.png')).toBeVisible();
  const uploadResponse = page.waitForResponse((response) => response.url().includes('/attachments/upload') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Проверить и завершить' }).click();
  const uploadedAttachment = await (await uploadResponse).json() as { id?: string };
  if (uploadedAttachment.id) createdAttachmentIds.push(uploadedAttachment.id);
  await expect(page.getByRole('heading', { name: 'Проверьте результат' })).toBeVisible();
  await page.locator('.checklist-final-review').getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const closeDialog = page.getByRole('dialog').last();
  await closeDialog.getByLabel('Причина завершения').fill('Проверка Stage50 завершена');
  await closeDialog.getByRole('button', { name: 'Завершить' }).click();

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Чек-листы/);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await page.locator('.checklist-template-card').filter({ hasText: template.name }).first().getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('body')).toContainText('Архив чек-листов');
  await page.locator('.archive-run-row').filter({ hasText: template.line.name }).first().click();
  const archiveDetail = page.locator('.checklist-archive-detail');
  await expect(archiveDetail).toContainText('Вес заготовки');
  await expect(archiveDetail).toContainText('125');
  await expect(archiveDetail).toContainText(template.line.name);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('ADMIN видит библиотеку с назначением, периодичностью и конструктором пунктов', async ({ page }) => {
  const factoryId = await resolveFactoryId();
  const template = await createStage50Template(factoryId);
  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Чек-листы/);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await expect(card).toContainText('Доступен для работы');
  await expect(card).toContainText('Вручную');
  await expect(card).toContainText('4 пунктов');
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.getByRole('button', { name: 'Редактировать' }).first().click();
  await expect(page.locator('form.modal-card')).toContainText('Кто может брать в работу');
  await expect(page.locator('form.modal-card')).toContainText('Периодичность');
  await page.locator('form.modal-card').getByRole('button', { name: 'Отмена' }).click();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('WORKER не видит управление библиотекой шаблонов', async ({ page }) => {
  await loginAs(page, 'pilot-worker-1');
  const checklistButton = page.getByRole('button', { name: /Чек-листы/ }).filter({ visible: true });
  if ((await checklistButton.count()) === 0) {
    await expect(page.locator('body')).not.toContainText('Создать шаблон');
    await expectNoDialogs(page);
    return;
  }
  await openMenuItem(page, /Чек-листы/);
  await expect(page.locator('body')).not.toContainText('Создать шаблон');
  await expect(page.locator('body')).not.toContainText('Редактировать шаблон');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: библиотека, в работе и архив чек-листов без горизонтального overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  const factoryId = await resolveFactoryId();
  await createStage50Template(factoryId);
  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Чек-листы/);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await page.locator('.checklist-kpi-strip').getByRole('button').filter({ hasText: 'Архив' }).click();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
