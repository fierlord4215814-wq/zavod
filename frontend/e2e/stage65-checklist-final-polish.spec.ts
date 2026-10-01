import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage65-checklist-final-polish-screenshots');
const marker = `Финальная проверка чек-листов ${Date.now()}`;
const hiddenMarker = `Stage65 regression hidden ${Date.now()}`;
const createdTemplateIds: string[] = [];
const createdRunIds: string[] = [];
const createdAttachmentIds: string[] = [];
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|storagePath)\b/;
const mojibakePattern = /Р С—РЎ|Р В |РЎРѓ|Р вЂњ|Р Сњ|Р Р€|Гђ|Г‘/;

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
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
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
  await page.goto(`${frontendUrl}/?stage65User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage65Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage65Dialogs?: string[] }).__stage65Dialogs ?? []);
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
  expect(overflow).toBeLessThanOrEqual(8);
}

async function screenshot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

function tinyPngBlob() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
}

async function uploadPhoto(factoryId: string, rowId: string) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `checklist-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([tinyPngBlob()], { type: 'image/png' }), 'фото-проверка-ui.png');
  const response = await fetch(`${apiUrl}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  if (!response.ok) throw new Error(`upload photo failed: ${response.status} ${await response.text()}`);
  const attachment = await response.json() as { id?: string };
  if (attachment.id) createdAttachmentIds.push(attachment.id);
}

async function createTemplateWithRun(factoryId: string) {
  const me = await api('/auth/me', { userId: 'test-management', factoryId });
  const library = await api('/checklists/templates/library', { userId: 'test-admin', factoryId });
  const libraryTemplates = Array.isArray(library) ? library : library.items ?? library.templates ?? [];
  const cleanTemplateLine = libraryTemplates.find((item: { lineId?: string; lineName?: string }) =>
    item.lineId && !/Stage\d+|regression|browser|demo|simulation|test/i.test(`${item.lineId ?? ''} ${item.lineName ?? ''}`),
  );
  const lines = await api('/directory/lines', { userId: 'test-admin', factoryId });
  const productionLines = lines.filter((item: { id?: string; name?: string }) => !/Stage\d+|regression|browser|demo|simulation|test/i.test(`${item.id ?? ''} ${item.name ?? ''}`));
  const line = productionLines.find((item: { name: string }) => item.name.includes('Рондо')) ?? productionLines[0] ?? lines[0];
  const preferredLineId = cleanTemplateLine?.lineId ?? line.id;
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: `${marker}: Контроль пиццы Рондо`,
      description: 'Шаблон для проверки чистого интерфейса',
      departmentId: me.departmentId,
      lineId: preferredLineId,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isMandatory: true,
    },
  });
  createdTemplateIds.push(template.id);
  const hiddenTemplate = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: hiddenMarker,
      departmentId: me.departmentId,
      lineId: preferredLineId,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
    },
  });
  createdTemplateIds.push(hiddenTemplate.id);
  const rows = [
    { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
    { title: 'Вес заготовки', rowType: 'NUMBER', sortOrder: 20, unit: 'г', minValue: 120, maxValue: 130, targetValue: 125, requiredAnswer: true },
    { title: 'Комментарий технолога', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true },
    { title: 'Фото готового изделия', rowType: 'PHOTO', sortOrder: 40 },
  ];
  for (const row of rows) {
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: row,
    });
  }
  const run = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { templateId: template.id, lineId: preferredLineId },
  });
  createdRunIds.push(run.id);
  const rowByTitle = new Map(run.rows.map((row: { title: string; id: string }) => [row.title, row.id]));
  await api(`/checklists/runs/${run.id}/rows/${rowByTitle.get('Проверить маркировку')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerBoolean: true } });
  await api(`/checklists/runs/${run.id}/rows/${rowByTitle.get('Вес заготовки')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerNumber: 125 } });
  await api(`/checklists/runs/${run.id}/rows/${rowByTitle.get('Комментарий технолога')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerText: 'Отклонений нет' } });
  await uploadPhoto(factoryId, String(rowByTitle.get('Фото готового изделия')));
  await api(`/checklists/runs/${run.id}/rows/${rowByTitle.get('Фото готового изделия')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: {} });
  await api(`/checklists/runs/${run.id}/close`, { method: 'POST', userId: 'test-management', factoryId, body: { comment: 'Закрыто для Stage65 UI' } });

  const activeRun = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { templateId: template.id, lineId: preferredLineId },
  });
  createdRunIds.push(activeRun.id);
  return { template, line, activeRun };
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
      body: { name: `Stage65 browser cleanup ${Date.now()}-${index + 1}` }, expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', factoryId, body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('desktop: clean library, compact card, archive detail and photo viewer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots are captured in desktop project.');
  const factoryId = await resolveFactoryId();
  const { template } = await createTemplateWithRun(factoryId);
  await loginAs(page, 'test-admin');

  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklist-manager-toolbar').getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await expect(page.locator('body')).toContainText(template.name);
  await expect(page.locator('body')).not.toContainText(hiddenMarker);
  await expect(page.locator('body')).not.toContainText(/Stage65 regression hidden|Stage11 wash regression|browser regression/i);
  const card = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await expect(card.getByRole('button', { name: 'Ещё' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Добавить пункт' })).toHaveCount(0);
  await screenshot(page, '01-library-clean-desktop.png');

  await card.getByRole('button', { name: 'Ещё' }).click();
  await expect(card.getByRole('button', { name: 'Добавить пункт' })).toBeVisible();
  await screenshot(page, '02-template-card-compact-desktop.png');

  await card.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('.checklist-archive-journal')).toBeVisible();
  await screenshot(page, '10-archive-desktop.png');
  await page.locator('.archive-run-row').filter({ hasText: 'Отклонений нет' }).first().click();
  await expect(page.locator('.checklist-archive-detail')).toBeVisible();
  await screenshot(page, '08-run-detail-mobile.png');
  const photo = page.locator('.checklist-archive-detail .attachment-thumb-button').first();
  await expect(photo).toBeVisible();
  await photo.click();
  await expect(page.locator('.attachment-modal')).toBeVisible();
  await expect(page.locator('.attachment-modal')).not.toContainText(/Нет прав|отсутствует|storagePath/i);
  await screenshot(page, '06-run-photo-preview-mobile.png');
  await page.locator('.attachment-modal').getByRole('button', { name: 'Закрыть' }).click();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360: guided run, archive journal and table do not overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile UX is verified in mobile project.');
  await page.setViewportSize({ width: 360, height: 760 });
  const factoryId = await resolveFactoryId();
  const { template, activeRun } = await createTemplateWithRun(factoryId);
  await loginAs(page, 'test-management');

  await openMenuItem(page, /Чек-листы/);
  await expect(page.locator('body')).toContainText(template.name);
  await expect(page.locator('body')).not.toContainText(hiddenMarker);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '03-library-clean-mobile.png');

  await page.locator('.checklist-work-card.active').filter({ hasText: template.name })
    .getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('.guided-run-modal')).toBeVisible();
  await expect(page.locator('.guided-row-heading')).toBeVisible();
  await expect(page.locator('.guided-row-heading strong')).toContainText('Проверить маркировку');
  await expect(page.locator('.guided-run-modal').getByRole('button', { name: 'Да', exact: true })).toBeVisible();
  await expect(page.locator('.guided-run-modal').getByRole('button', { name: 'Нет', exact: true })).toBeVisible();
  await expect(page.locator('.guided-row-heading .checklist-row-badges')).toHaveCount(0);
  await screenshot(page, '04-guided-run-mobile.png');
  await page.locator('.guided-run-modal').getByRole('button', { name: 'Да', exact: true }).click();
  await page.locator('.guided-run-modal').getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(page.locator('.guided-save-state')).toContainText(/Сохранено|Сохраняется/);
  await screenshot(page, '05-guided-run-save-status-mobile.png');
  await page.locator('.guided-run-modal').getByRole('button', { name: 'Вернуться к чек-листам' }).click();

  await page.locator('.checklist-manager-toolbar').getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await page.locator('.checklist-template-card').filter({ hasText: template.name }).first().getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('.archive-group-heading')).toBeVisible();
  await expect(page.locator('.archive-group-heading')).not.toContainText(/Дата и смена\d|День\d/);
  await screenshot(page, '07-archive-group-mobile.png');
  await expectNoHorizontalOverflow(page);

  await page.locator('.archive-run-row').first().click();
  await expect(page.locator('.checklist-archive-detail')).toBeVisible();
  await expect(page.locator('.archive-detail-summary-grid')).toContainText('Заполнил');
  await screenshot(page, '08-run-detail-mobile.png');
  await page.locator('.checklist-archive-detail').getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
  await page.locator('.compact-segmented').getByRole('button', { name: 'Таблица' }).click();
  await expect(page.locator('.checklist-archive-table-scroll')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '09-mobile-table-contained-scroll.png');
  await expect(page.locator('body')).not.toContainText('storagePath');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
  expect(activeRun.id).toBeTruthy();
});
