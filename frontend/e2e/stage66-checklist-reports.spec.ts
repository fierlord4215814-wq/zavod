import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage66-checklist-reports-screenshots');
const marker = `Отчёт по чек-листам ${Date.now()}`;
const missingMarker = `Обязательный чек-лист без запуска ${Date.now()}`;
const createdTemplateIds: string[] = [];
const createdAttachmentIds: string[] = [];
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|storagePath)\b/;
const mojibakePattern = /Р В РЎ|Р РЋ|Р“С’|Р“вЂ/;

type ApiOptions = { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] };

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
  await page.goto(`${frontendUrl}/?stage66User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
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
    Object.defineProperty(window, '__stage66Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage66Dialogs?: string[] }).__stage66Dialogs ?? []);
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
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

async function screenshot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

function tinyPngBlob() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
}

async function uploadPhoto(factoryId: string, rowId: string) {
  const form = new FormData();
  form.append('entityType', 'CHECKLIST_RUN_ROW');
  form.append('entityId', rowId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `report-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([tinyPngBlob()], { type: 'image/png' }), 'фото-отчёта.png');
  const response = await fetch(`${apiUrl}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-management', 'x-factory-id': factoryId },
    body: form,
  });
  if (!response.ok) throw new Error(`photo upload failed: ${response.status} ${await response.text()}`);
  const attachment = await response.json() as { id?: string };
  if (attachment.id) createdAttachmentIds.push(attachment.id);
}

function currentShiftTarget() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour >= 8) return { shiftDate: currentDate, shiftType: hour < 20 ? 'DAY' : 'NIGHT' };
  const previous = new Date(`${currentDate}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    shiftDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(previous),
    shiftType: 'NIGHT',
  };
}

async function prepareChecklistData(factoryId: string) {
  const me = await api('/auth/me', { userId: 'test-management', factoryId });
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: marker,
      description: 'Шаблон для проверки Excel и PDF отчётов',
      departmentId: me.departmentId,
      lineId: null,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'ONCE_PER_SHIFT',
      isMandatory: true,
    },
  });
  createdTemplateIds.push(template.id);
  const missingTemplate = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: missingMarker,
      description: 'Нужен для карточки пропущенных обязательных чек-листов',
      departmentId: me.departmentId,
      lineId: null,
      assignmentRoles: ['MANAGEMENT'],
      frequencyRule: 'ONCE_PER_SHIFT',
      isMandatory: true,
    },
  });
  createdTemplateIds.push(missingTemplate.id);
  await api(`/checklists/templates/${missingTemplate.id}/rows`, { method: 'POST', userId: 'test-admin', factoryId, body: { title: 'Проверка перед сменой', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true } });
  const rows = [
    { title: 'Проверить маркировку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
    { title: 'Температура камеры', rowType: 'NUMBER', sortOrder: 20, unit: '°C', minValue: 2, maxValue: 6, requiredAnswer: true },
    { title: 'Комментарий смены', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true },
    { title: 'Фото результата', rowType: 'PHOTO', sortOrder: 40 },
  ];
  for (const row of rows) await api(`/checklists/templates/${template.id}/rows`, { method: 'POST', userId: 'test-admin', factoryId, body: row });
  const { shiftDate, shiftType } = currentShiftTarget();
  const run = await api('/checklists/runs/start', { method: 'POST', userId: 'test-management', factoryId, body: { templateId: template.id, shiftDate, shiftType } });
  const byTitle = new Map(run.rows.map((row: { title: string; id: string }) => [row.title, row.id]));
  await api(`/checklists/runs/${run.id}/rows/${byTitle.get('Проверить маркировку')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerBoolean: true } });
  await api(`/checklists/runs/${run.id}/rows/${byTitle.get('Температура камеры')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerNumber: 4 } });
  await api(`/checklists/runs/${run.id}/rows/${byTitle.get('Комментарий смены')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: { answerText: 'Показатели в норме' } });
  await uploadPhoto(factoryId, String(byTitle.get('Фото результата')));
  await api(`/checklists/runs/${run.id}/rows/${byTitle.get('Фото результата')}/complete`, { method: 'POST', userId: 'test-management', factoryId, body: {} });
  await api(`/checklists/runs/${run.id}/close`, { method: 'POST', userId: 'test-management', factoryId, body: { comment: 'Готово для Stage66 UI' } });
  return { template, shiftDate, shiftType };
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
      body: { name: `Stage66 browser cleanup ${Date.now()}-${index + 1}` }, expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST', userId: 'test-admin', factoryId, body: {}, expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('Stage66 checklist reports are visible, downloadable and mobile-safe', async ({ page }) => {
  const factoryId = await loginAs(page, 'test-admin');
  const { template, shiftDate, shiftType } = await prepareChecklistData(factoryId);
  await loginAs(page, 'test-management');

  await openMenuItem(page, /Чек-листы/);
  await page.locator('.checklists-screen .segmented-control').getByRole('button', { name: 'Библиотека' }).click();
  const reportSourceCard = page.locator('.checklist-template-card').filter({ hasText: template.name }).first();
  await expect(reportSourceCard).toBeVisible();
  await reportSourceCard.getByRole('button', { name: /Архив/ }).click();
  await page.locator('.checklist-archive-selector').scrollIntoViewIfNeeded();
  if ((await page.getByRole('button', { name: /Экспорт в Excel/ }).count()) === 0) {
    await page.getByRole('button', { name: /Применить/ }).click();
  }
  await expect(page.getByRole('button', { name: /Экспорт в Excel/ })).toBeVisible();
  await expect(page.locator('.archive-run-row').first()).toBeVisible();
  await screenshot(page, '01-archive-export-actions.png');

  await page.locator('label').filter({ hasText: /^С$/ }).locator('input[type="date"]').fill(shiftDate);
  await page.locator('label').filter({ hasText: /Смена/ }).locator('select').selectOption(shiftType);
  await page.getByRole('button', { name: /Показать сводку/ }).click();
  await expect(page.locator('.checklist-shift-report')).toContainText(/не хватает|выполнено/i);
  await screenshot(page, '02-shift-summary-desktop.png');
  await expect(page.locator('.checklist-shift-report')).toContainText(/не хватает/i);
  await screenshot(page, '03-shift-missing-checklists.png');

  await expect(page.getByRole('button', { name: /PDF смены/ })).toBeVisible();

  await page.locator('.archive-run-row').first().click();
  await expect(page.getByRole('button', { name: /Скачать PDF/ })).toBeVisible();
  await screenshot(page, '04-run-pdf-action.png');
  await page.getByRole('button', { name: /Закрыть/ }).click();

  await page.setViewportSize({ width: 360, height: 760 });
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '05-shift-summary-mobile.png');
  await screenshot(page, '06-report-filters-mobile.png');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
