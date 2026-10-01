import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage64-checklist-archive-journal-screenshots');
const marker = `Журнал чек-листов ${Date.now()}`;
const createdTemplateIds: string[] = [];
const createdAttachmentIds: string[] = [];
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|storagePath)\b/;
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
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage64User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
    Object.defineProperty(window, '__stage64Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage64Dialogs?: string[] }).__stage64Dialogs ?? []);
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
  form.append('operationId', `archive-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([tinyPngBlob()], { type: 'image/png' }), 'фото-журнал-ui.png');
  const response = await fetch(`${apiUrl}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  if (!response.ok) throw new Error(`upload photo failed: ${response.status} ${await response.text()}`);
  const attachment = await response.json() as { id?: string };
  if (attachment.id) createdAttachmentIds.push(attachment.id);
}

function currentShiftTarget() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour >= 8) {
    return { shiftDate: currentDate, shiftType: hour < 20 ? 'DAY' : 'NIGHT' };
  }
  const previous = new Date(`${currentDate}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    shiftDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(previous),
    shiftType: 'NIGHT',
  };
}

async function createTemplateWithRuns(factoryId: string) {
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
  const shift = currentShiftTarget();
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: `${marker}: Журнал смены`,
      description: 'Пилотный архив чек-листа по датам и сменам',
      departmentId: me.departmentId,
      lineId: preferredLineId,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'MANUAL',
      isMandatory: true,
    },
  });
  createdTemplateIds.push(template.id);
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
      body: { ...row, operationId: `stage64-browser-row-${Date.now()}-${row.sortOrder}` },
    });
  }
  await createClosedRun(factoryId, template.id, preferredLineId, shift, { markingOk: true, weight: 125, comment: 'Отклонений нет', withPhoto: true });
  await createClosedRun(factoryId, template.id, preferredLineId, shift, { markingOk: false, weight: 126, comment: 'Маркировку поправили', withPhoto: false });
  return { template, line };
}

async function createClosedRun(factoryId: string, templateId: string, lineId: string, shift: { shiftDate: string; shiftType: string }, answers: { markingOk: boolean; weight: number; comment: string; withPhoto: boolean }) {
  const run = await api('/checklists/runs/start', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { templateId, lineId, shiftDate: shift.shiftDate, shiftType: shift.shiftType },
  });
  const rows = new Map(run.rows.map((row: { title: string; id: string }) => [row.title, row.id]));
  await api(`/checklists/runs/${run.id}/rows/${rows.get('Проверить маркировку')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerBoolean: answers.markingOk } });
  await api(`/checklists/runs/${run.id}/rows/${rows.get('Вес заготовки')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerNumber: answers.weight } });
  await api(`/checklists/runs/${run.id}/rows/${rows.get('Комментарий технолога')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerText: answers.comment } });
  const photoRowId = rows.get('Фото готового изделия');
  if (answers.withPhoto && photoRowId) await uploadPhoto(factoryId, photoRowId);
  await api(`/checklists/runs/${run.id}/rows/${photoRowId}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: {} });
  await api(`/checklists/runs/${run.id}/close`, { method: 'POST', userId: 'test-management', factoryId, body: { comment: 'Закрыто для журнала архива' } });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  for (const attachmentId of createdAttachmentIds.splice(0).reverse()) {
    await api(`/attachments/${attachmentId}`, {
      method: 'DELETE', userId: 'test-admin', factoryId, expected: [200, 201, 409],
    }).catch(() => null);
  }
  for (const [index, templateId] of createdTemplateIds.splice(0).reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH', userId: 'test-admin', factoryId,
      body: { name: `Stage64 browser cleanup ${Date.now()}-${index + 1}` },
      expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', factoryId, body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('desktop archive journal, run detail, matrix and photo viewer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots are captured in the desktop project.');
  const factoryId = await resolveFactoryId();
  const { template } = await createTemplateWithRuns(factoryId);
  await loginAs(page, 'test-admin');

  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklist-manager-toolbar').getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('.checklist-archive-filters')).toContainText(template.name);
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.archive-run-row')).toHaveCount(2);
  await screenshot(page, '01-archive-journal-desktop.png');
  await screenshot(page, '02-shift-group-desktop.png');

  await page.locator('.archive-run-row').filter({ hasText: 'Фото: 1' }).first().click();
  await expect(page.locator('.checklist-archive-detail')).toContainText('Вес заготовки');
  await expect(page.locator('.checklist-archive-detail')).toContainText('Норма');
  await screenshot(page, '03-run-detail-desktop.png');
  await page.locator('.checklist-archive-detail .attachment-thumb-button').first().click();
  await expect(page.locator('.attachment-modal')).toBeVisible();
  await screenshot(page, '06-photo-viewer.png', false);
  await page.locator('.attachment-modal').getByRole('button', { name: 'Закрыть' }).click();
  await page.locator('.checklist-archive-detail').getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
  await page.locator('.checklist-archive-selector').getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect(page.locator('.checklist-archive-table')).toContainText('Вес заготовки');
  await screenshot(page, '04-matrix-desktop.png');

  await page.locator('.checklist-archive-selector').getByRole('button', { name: 'Журнал', exact: true }).click();
  await page.getByLabel('Только отклонения').check();
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.archive-run-row')).toHaveCount(1);
  await expect(page.locator('.archive-run-row')).toContainText('Отклонений: 1');
  await screenshot(page, '05-deviations-filter-desktop.png');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile archive journal is card-based and readable at 360px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile audit runs only in the mobile project.');
  const factoryId = await resolveFactoryId();
  const { template } = await createTemplateWithRuns(factoryId);
  await loginAs(page, 'test-admin');

  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklist-manager-toolbar').getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await card.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('.checklist-archive-filters')).toContainText(template.name);
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.archive-run-row')).toHaveCount(2);
  await screenshot(page, '07-journal-mobile.png');
  await expectNoHorizontalOverflow(page);

  await page.locator('.archive-run-row').filter({ hasText: 'Фото: 1' }).first().click({ force: true });
  await expect(page.locator('.checklist-archive-detail')).toContainText('Фото готового изделия');
  await screenshot(page, '08-run-detail-mobile.png');
  await expectNoHorizontalOverflow(page);
  await page.locator('.checklist-archive-detail').getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
  await page.getByLabel('Только с фото').check();
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.archive-run-row')).toHaveCount(1);
  await screenshot(page, '09-filters-mobile.png');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
