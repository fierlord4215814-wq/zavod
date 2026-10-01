import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast5');

let factoryId = '';
let templateId = '';
let runId = '';

async function api(method: string, url: string, userId: string, body?: unknown) {
  const response = await fetch(`${apiUrl}${url}`, {
    method,
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${text}`);
  return data;
}

async function factory4Id(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`dev-login ${userId}: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 unavailable for ${userId}`);
  return factory.id as string;
}

async function login(page: Page, userId: string, diagnostics = false) {
  const selectedFactoryId = await factory4Id(userId);
  const targetUrl = diagnostics ? `${frontendUrl}/?stage50User=${encodeURIComponent(userId)}` : frontendUrl;
  await page.goto(targetUrl);
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
  }, { nextUserId: userId, nextFactoryId: selectedFactoryId });
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openScreen(page: Page, label: string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) return direct.first().click();
  await page.locator('.mobile-more-button:visible').click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function safeBody(page: Page) {
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/);
}

test.beforeAll(async () => {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  factoryId = await factory4Id('pilot-master-1');
  const me = await api('GET', '/auth/me', 'pilot-master-1');
  if (!me.departmentId) throw new Error('pilot master department is required');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const template = await api('POST', '/checklists/templates', 'test-admin', {
    name: `Температура перед выпуском ${suffix}`,
    description: 'Временная проверка мобильного runner',
    departmentId: me.departmentId,
    assignmentRoles: ['MASTER'],
    frequencyRule: 'MANUAL',
    operationId: `pf5-e2e-template-${suffix}`,
  });
  templateId = template.id;
  await api('POST', `/checklists/templates/${templateId}/rows`, 'test-admin', {
    title: 'Проверьте температуру', rowType: 'NUMBER', sortOrder: 10, requiredAnswer: true,
    minValue: -30, maxValue: -6, targetValue: -18, unit: '°C', requiresComment: false,
    operationId: `pf5-e2e-row-${suffix}`,
  });
});

test.afterAll(async () => {
  try {
    if (runId) {
      const run = await api('GET', `/checklists/runs/${runId}`, 'test-admin');
      if (run.status === 'ACTIVE') {
        const row = run.rows?.[0];
        if (row?.status === 'PENDING') await api('POST', `/checklists/runs/${runId}/rows/${row.id}/complete`, 'test-admin', { answerNumber: -18, operationId: `pf5-e2e-clean-row-${Date.now()}` });
        await api('POST', `/checklists/runs/${runId}/close`, 'test-admin', { comment: 'Временная browser-проверка завершена' });
      }
    }
  } finally {
    if (templateId) await api('POST', `/checklists/templates/${templateId}/archive`, 'test-admin');
  }
});

test('MASTER journal and order request stay in own department', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await openScreen(page, 'Пересменка');
  await expect(page.getByRole('heading', { name: 'Пересменка', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новая запись' }).click();
  const journalDialog = page.getByRole('dialog');
  await expect(journalDialog.getByLabel('Комментарий к смене')).toBeVisible();
  await expect(journalDialog.getByLabel('Отдел')).toHaveCount(0);
  await journalDialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(journalDialog).toHaveCount(0);

  await openScreen(page, 'Заказы');
  await expect(page.getByRole('heading', { name: 'Заказы / Остатки' })).toBeVisible();
  await page.getByRole('button', { name: 'Заявки на заказ' }).click();
  await page.getByRole('button', { name: 'Подать заявку' }).click();
  const orderDialog = page.getByRole('dialog');
  await expect(orderDialog.getByLabel('Наименование')).toBeVisible();
  await expect(orderDialog.getByLabel('Единица')).toBeVisible();
  await expect(orderDialog.getByLabel('Отдел')).toHaveCount(0);
  await noOverflow(page);
  await safeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-department-forms.png`), fullPage: true });
});

test('STORE sees returns and balance navigation without stock defects', async ({ page }, testInfo) => {
  await login(page, 'test-store');
  const allNavigation = page.locator('.bottom-nav, .mobile-quick-nav, .mobile-nav-sheet');
  await expect(allNavigation.getByRole('button', { name: /Заказы/ }).first()).toBeVisible();
  await openScreen(page, 'Заказы');
  await expect(page.getByRole('heading', { name: 'Заказы / Остатки' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Новая позиция/ })).toHaveCount(0);
  await openScreen(page, 'Возвраты');
  await expect(page.getByRole('heading', { name: 'Возвраты на производство' })).toBeVisible();
  await expect(page.locator('.returns-screen .premium-kpi-strip')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Опубликовать возврат' })).toBeVisible();
  await noOverflow(page);
  await safeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-returns.png`), fullPage: true });
});

test('checklist runner auto-saves and records range deviation', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1', true);
  await openScreen(page, 'Чек-листы');
  await page.getByRole('button', { name: 'Начать новый чек-лист' }).click();
  const templateCard = page.locator('.checklist-work-card.available').filter({ hasText: 'Температура перед выпуском' }).first();
  await expect(templateCard).toBeVisible();
  await templateCard.getByRole('button', { name: 'Взять в работу' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Взять в работу' }).click();
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  const runs = await api('GET', '/checklists/runs/my', 'pilot-master-1');
  runId = runs.find((run: { templateId?: string; template?: { id?: string } }) => run.templateId === templateId || run.template?.id === templateId)?.id ?? '';
  expect(runId).not.toBe('');
  await runner.getByLabel(/Значение/).fill('-40');
  await expect(runner.getByText('Значение ниже нормы. Оно будет сохранено как отклонение.')).toBeVisible();
  await expect(runner.getByRole('button', { name: 'Сохранить пункт' })).toHaveCount(0);
  await expect(runner.getByText('Добавить комментарий')).toBeVisible();
  await noOverflow(page);
  await safeBody(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-checklist-runner.png`), fullPage: true });
  await runner.getByRole('button', { name: 'Проверить и завершить' }).click();
  await expect(runner.getByText('Всё готово')).toBeVisible();
  await runner.getByRole('button', { name: 'Завершить чек-лист' }).click();
  const closeDialog = page.getByRole('dialog').last();
  await closeDialog.getByLabel('Причина завершения').fill('Проверка мобильного runner завершена');
  await closeDialog.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('.guided-run-modal')).toHaveCount(0);
});

test('390 and 430 screens keep department forms and returns inside viewport', async ({ browser }) => {
  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, 'pilot-master-1');
    await openScreen(page, 'Пересменка');
    await page.getByRole('button', { name: 'Новая запись' }).click();
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-journal.png`), fullPage: true });
    await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
    await login(page, 'test-store');
    await openScreen(page, 'Возвраты');
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-returns.png`), fullPage: true });
    await context.close();
  }
});
