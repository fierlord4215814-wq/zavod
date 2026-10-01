import { Browser, BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast11');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P11_${runId}__`;
const markerPrefix = '__PFFV5_P11_';

const credentials = {
  master: { phone: '+79000004720', password: '1234' },
  kipia: { phone: '+79000004750', password: '1234' },
  holod: { phone: '+79000004760', password: '1234' },
  management: { phone: '+79000009008', password: '1234' },
  admin: { phone: '+79000009009', password: '1234' },
  worker: { phone: '+79000004701', password: '1234' },
  store: { phone: '+79000004740', password: '1234' },
};

type Runtime = { context: BrowserContext; page: Page; name: string };
type JsonValue = Record<string, any> | any[] | string | number | boolean | null;

const state = {
  factoryId: '',
  urgentTaskId: '',
  longTaskId: '',
  stockItemId: '',
  orderRequestId: '',
  kipiaDepartmentId: '',
  holodDepartmentId: '',
  managementDepartmentId: '',
  lineId: '',
  lineName: '',
};

const evidence: Record<string, any> = {
  runId,
  marker,
  startedAt: new Date().toISOString(),
  uiMutations: [],
  realtime: [],
  denials: [],
  filters: [],
  screenshots: [],
  cleanup: [],
  emergencyCleanup: [],
  browserErrors: [],
  serverErrors: [],
  stockBaselineHash: '',
  stockFinalHash: '',
  activeTestRequests: null,
  activeTestUrgentRequests: null,
  activeTestLongRequests: null,
  activeTestStockItems: null,
  activeTestOrderRequests: null,
  activeTestArtifacts: null,
  preexistingEntitiesDeleted: 0,
  preexistingEntitiesUnintentionallyModified: 0,
  preexistingStockValuesModified: null,
  physicalDeletes: 0,
  directDatabaseWrites: 0,
  migrationCreated: false,
};

function screenshotPath(name: string) {
  evidence.screenshots.push(name);
  return path.join(evidenceDir, name);
}

function stableStockHash(items: any[]) {
  const rows = items
    .filter((item) => !String(item.name ?? '').includes('__PFFV5_P11_') && !String(item.description ?? '').includes('__PFFV5_P11_'))
    .map((item) => ({
      id: item.id,
      currentQuantity: Number(item.currentQuantity),
      minThreshold: Number(item.minThreshold),
      unit: item.unit,
      isActive: item.isActive,
      archivedAt: item.archivedAt ? new Date(item.archivedAt).toISOString() : null,
      updatedAt: new Date(item.updatedAt).toISOString(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function session(page: Page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('zavod.authToken') ?? '',
    userId: localStorage.getItem('zavod.devUserId') ?? '',
    factoryId: localStorage.getItem('zavod.selectedFactoryId') ?? '',
  }));
}

async function apiCall<T = any>(page: Page, method: string, pathname: string, data?: any, factoryId?: string) {
  const auth = await session(page);
  const response = await page.request.fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : { 'x-user-id': auth.userId }),
      'x-factory-id': factoryId ?? auth.factoryId ?? state.factoryId,
      ...(data === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  let body: T | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text as T; }
  return { status: response.status(), ok: response.ok(), body, text };
}

async function apiOk<T = any>(page: Page, method: string, pathname: string, data?: any) {
  const result = await apiCall<T>(page, method, pathname, data);
  expect(result.status, `${method} ${pathname}: ${result.text}`).toBeGreaterThanOrEqual(200);
  expect(result.status, `${method} ${pathname}: ${result.text}`).toBeLessThan(300);
  return result.body as T;
}

function assertNoForbiddenKeys(value: JsonValue) {
  const forbidden = new Set(['storagePath', 'passwordHash', 'databaseUrl', 'accessToken', 'refreshToken', 'authToken', 'secret']);
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      expect(forbidden.has(key), `Публичный payload содержит ${key}`).toBe(false);
      visit(child);
    }
  };
  visit(value);
}

async function resetSession(page: Page) {
  const resetId = `${Date.now()}-${Math.random()}`;
  await page.context().addInitScript(({ expectedResetId }) => {
    if (new URL(window.location.href).searchParams.get('p11reset') !== expectedResetId) return;
    localStorage.removeItem('zavod.authToken');
    localStorage.removeItem('zavod.devUserId');
    localStorage.removeItem('zavod.selectedFactoryId');
    sessionStorage.clear();
  }, { expectedResetId: resetId });
  await page.goto(`${frontendUrl}/?p11reset=${encodeURIComponent(resetId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 25_000 });
  await page.evaluate(() => history.replaceState(null, '', '/'));
}

async function chooseFactory4(page: Page) {
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible, .factory-select-button:visible').first()).toBeVisible({ timeout: 30_000 });
  const selectFactory = page.getByRole('button', { name: 'Выбрать завод', exact: true }).first();
  if (await selectFactory.isVisible()) await selectFactory.click();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
  const factoryId = await page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId') ?? '');
  expect(factoryId).not.toBe('');
  if (!state.factoryId) state.factoryId = factoryId;
  expect(factoryId).toBe(state.factoryId);
}

async function login(page: Page, account: { phone: string; password: string }) {
  await resetSession(page);
  await page.locator('#login-phone').fill(account.phone);
  await page.locator('#login-password').fill(account.password);
  await page.locator('#login-password').press('Enter');
  await chooseFactory4(page);
}

async function openMain(page: Page, label: string | RegExp) {
  const ready = typeof label === 'string'
    ? page.getByRole('heading', { name: label, exact: false }).first()
    : null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const direct = page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label, exact: false })
      .filter({ visible: true });
    if (await direct.count()) {
      await direct.first().click();
    } else {
      const more = page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first();
      await expect(more).toBeVisible();
      await more.click();
      const sheet = page.locator('.mobile-nav-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: label, exact: false }).first().click();
    }
    if (!ready) return;
    try {
      await expect(ready).toBeVisible({ timeout: 12_000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  if (ready) await expect(ready).toBeVisible({ timeout: 20_000 });
}

async function createRuntime(browser: Browser, name: string, account: { phone: string; password: string }, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.browserErrors.push(`${name}: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) evidence.serverErrors.push(`${name}: ${response.status()} ${response.url()}`);
  });
  await login(page, account);
  return { context, page, name } satisfies Runtime;
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
}

async function armRealtimeEvidence(page: Page) {
  await page.evaluate(() => {
    const runtime = window as any;
    runtime.__p11TaskEvents = [];
    runtime.__p11OrderEvents = [];
    window.addEventListener('zavod:task-updated', (event) => runtime.__p11TaskEvents.push((event as CustomEvent).detail));
    window.addEventListener('zavod:orders-updated', (event) => runtime.__p11OrderEvents.push((event as CustomEvent).detail));
  });
}

async function taskRealtimeCount(page: Page, taskId: string) {
  return page.evaluate((id) => ((window as any).__p11TaskEvents ?? []).filter((payload: any) => payload?.id === id).length, taskId);
}

async function orderRealtimeCount(page: Page) {
  return page.evaluate(() => ((window as any).__p11OrderEvents ?? []).length);
}

async function expectHumanScreen(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|authToken/i);
  expect(text).not.toMatch(/\bundefined\b/i);
}

async function taskCard(page: Page, text: string) {
  const card = page.locator('.task-card').filter({ hasText: text }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

async function openTask(page: Page, text: string) {
  const existingDialog = page.getByRole('dialog').filter({ hasText: text }).filter({ visible: true }).last();
  if (await existingDialog.isVisible().catch(() => false)) return existingDialog;
  const card = await taskCard(page, text);
  await card.getByRole('button', { name: 'Открыть', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: text }).last();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeVisibleTaskDialog(page: Page) {
  const close = page.getByRole('dialog').getByRole('button', { name: 'Закрыть окно', exact: true }).last();
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function createTask(page: Page, options: { description: string; type: 'URGENT' | 'LONG'; departmentId: string; lineId: string; withAttachment?: boolean }) {
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать заявку' }).last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Описание', { exact: true }).fill(options.description);
  await dialog.getByLabel('Тип', { exact: true }).selectOption(options.type);
  await dialog.getByLabel('Линия', { exact: true }).selectOption(options.lineId);
  await dialog.getByLabel('Служба / отдел', { exact: true }).selectOption(options.departmentId);
  if (options.type === 'LONG') {
    const deadline = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const local = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await dialog.getByLabel('Дедлайн для долгой заявки', { exact: true }).fill(local);
  }
  if (options.withAttachment) {
    await dialog.locator('input[type=file]').last().setInputFiles({
      name: 'p11-request-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${marker} request attachment`, 'utf8'),
    });
  }
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/tasks'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/tasks'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  const task = await response.json();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  evidence.uiMutations.push(`UI create ${options.type}: ${task.id}`);
  return { task, body: request.postDataJSON() };
}

async function takeTask(page: Page, description: string) {
  const dialog = await openTask(page, description);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/take'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/take'));
  await dialog.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  const settledDetail = page.getByRole('dialog').filter({ hasText: description }).last();
  await expect(settledDetail).toBeVisible({ timeout: 20_000 });
  await expect(settledDetail.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled({ timeout: 20_000 });
  evidence.uiMutations.push(`UI take: ${description}`);
  return request.postDataJSON();
}

async function commentTask(page: Page, description: string, comment: string, withAttachment = false) {
  await closeVisibleTaskDialog(page);
  const detail = await openTask(page, description);
  await detail.getByRole('button', { name: 'Добавить комментарий', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Комментарий к заявке' }).last();
  await dialog.getByPlaceholder('Комментарий').fill(comment);
  if (withAttachment) {
    await dialog.locator('input[type=file]').last().setInputFiles({
      name: 'p11-comment-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${marker} comment attachment`, 'utf8'),
    });
  }
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/comment'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/comment'));
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const settledDetail = page.getByRole('dialog').filter({ hasText: description }).last();
  await expect(settledDetail).toBeVisible({ timeout: 20_000 });
  await expect(settledDetail.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled({ timeout: 20_000 });
  evidence.uiMutations.push(`UI comment: ${description}`);
  return request.postDataJSON();
}

async function redirectTask(page: Page, description: string, departmentId: string, comment: string) {
  await closeVisibleTaskDialog(page);
  const detail = await openTask(page, description);
  await detail.getByRole('button', { name: 'Передать', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Передать заявку' }).last();
  await dialog.getByLabel('Комментарий', { exact: true }).fill(comment);
  await dialog.getByLabel('Новая служба / отдел', { exact: true }).selectOption(departmentId);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/redirect'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/redirect'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  evidence.uiMutations.push(`UI transfer: ${description}`);
  return request.postDataJSON();
}

async function completeTask(page: Page, description: string, comment: string) {
  await closeVisibleTaskDialog(page);
  const detail = await openTask(page, description);
  await detail.getByRole('button', { name: 'Завершить заявку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Завершить заявку' }).last();
  const commentField = dialog.getByLabel(/Комментарий/);
  if (await commentField.count()) await commentField.fill(comment);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/complete'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/complete'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  evidence.uiMutations.push(`UI complete: ${description}`);
  return request.postDataJSON();
}

async function fillAction(dialog: Locator, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const field = dialog.getByLabel(label, { exact: true });
    const tag = await field.evaluate((element) => element.tagName);
    if (tag === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
}

function nestedField(container: Locator, label: string, selector: 'input' | 'select') {
  return container.locator('label').filter({ hasText: label }).locator(selector).first();
}

async function submitAction(dialog: Locator) {
  const form = dialog.locator('form.premium-deep-form');
  await expect(form).toBeVisible();
  await dialog.getByRole('button', { name: /Сохранить|Подтвердить/, exact: true }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
}

async function markerNotifications(page: Page, entityIds: string[]) {
  const notifications = await apiOk<any[]>(page, 'GET', '/notifications');
  return notifications.filter((item) => entityIds.includes(item.entityId) || String(item.title).includes(marker) || String(item.message).includes(marker));
}

async function readMarkerNotifications(runtimes: Runtime[], entityIds: string[]) {
  for (const runtime of runtimes) {
    const notifications = await markerNotifications(runtime.page, entityIds).catch(() => []);
    for (const notification of notifications) {
      if (!notification.readAt) await apiOk(runtime.page, 'POST', `/notifications/${notification.id}/read`, {});
    }
  }
}

async function emergencyCleanup(admin: Runtime | undefined, master: Runtime | undefined) {
  if (master) {
    const discovered = await apiCall<any[]>(master.page, 'GET', `/tasks?includeDone=true&includeFixtures=true&search=${encodeURIComponent(marker)}`);
    const ids = new Set([
      ...[state.urgentTaskId, state.longTaskId].filter(Boolean),
      ...((discovered.ok && Array.isArray(discovered.body) ? discovered.body : [])
        .filter((task) => String(task.description ?? '').includes(marker))
        .map((task) => task.id)),
    ]);
    for (const id of ids) {
      const detail = await apiCall<any>(master.page, 'GET', `/tasks/${id}`);
      if (detail.ok && detail.body?.status !== 'DONE') {
        const result = await apiCall(master.page, 'POST', `/tasks/${id}/complete`, { operationId: crypto.randomUUID(), comment: `${marker} аварийное штатное завершение` });
        if (result.ok) evidence.emergencyCleanup.push(`completed task ${id}`);
      }
    }
  }
  if (admin && state.orderRequestId) {
    const request = await apiCall<any>(admin.page, 'GET', `/orders/requests/${state.orderRequestId}`);
    if (request.ok && request.body?.status === 'ACTIVE') {
      const result = await apiCall(admin.page, 'POST', `/orders/requests/${state.orderRequestId}/close`, { closeStatus: 'NOT_NEEDED', comment: `${marker} аварийное штатное закрытие` });
      if (result.ok) evidence.emergencyCleanup.push(`closed order ${state.orderRequestId}`);
    }
  }
  if (admin && state.stockItemId) {
    const item = await apiCall<any>(admin.page, 'GET', `/orders/items/${state.stockItemId}`);
    if (item.ok && item.body?.isActive && !item.body?.archivedAt) {
      const result = await apiCall(admin.page, 'POST', `/orders/items/${state.stockItemId}/archive`, { comment: `${marker} аварийная штатная архивация` });
      if (result.ok) evidence.emergencyCleanup.push(`archived stock ${state.stockItemId}`);
    }
  }
}

async function cleanupStaleP11Artifacts(admin: Runtime, master: Runtime, runtimes: Runtime[]) {
  const tasks = await apiOk<any[]>(master.page, 'GET', `/tasks?includeDone=true&includeFixtures=true&search=${encodeURIComponent(markerPrefix)}`);
  for (const task of tasks.filter((item) => String(item.description ?? '').includes(markerPrefix) && item.status !== 'DONE')) {
    const result = await apiCall(master.page, 'POST', `/tasks/${task.id}/complete`, {
      operationId: crypto.randomUUID(),
      comment: `${markerPrefix} восстановление после прерванной проверки`,
    });
    expect(result.status, `preflight task cleanup ${task.id}: ${result.text}`).toBeLessThan(300);
    evidence.emergencyCleanup.push(`preflight completed stale task ${task.id}`);
  }

  const orders = await apiOk<any[]>(admin.page, 'GET', `/orders/requests?status=ACTIVE&includeDiagnostics=true&search=${encodeURIComponent(markerPrefix)}`);
  for (const order of orders.filter((item) => String(item.title ?? '').includes(markerPrefix) || String(item.reasonComment ?? '').includes(markerPrefix))) {
    const result = await apiCall(admin.page, 'POST', `/orders/requests/${order.id}/close`, {
      closeStatus: 'NOT_NEEDED',
      comment: `${markerPrefix} восстановление после прерванной проверки`,
    });
    expect(result.status, `preflight order cleanup ${order.id}: ${result.text}`).toBeLessThan(300);
    evidence.emergencyCleanup.push(`preflight closed stale order ${order.id}`);
  }

  const items = await apiOk<any[]>(admin.page, 'GET', '/orders/items?includeArchive=true');
  for (const item of items.filter((row) => (String(row.name ?? '').includes(markerPrefix) || String(row.description ?? '').includes(markerPrefix)) && row.isActive && !row.archivedAt)) {
    const result = await apiCall(admin.page, 'POST', `/orders/items/${item.id}/archive`, {
      comment: `${markerPrefix} восстановление после прерванной проверки`,
    });
    expect(result.status, `preflight stock cleanup ${item.id}: ${result.text}`).toBeLessThan(300);
    evidence.emergencyCleanup.push(`preflight archived stale stock ${item.id}`);
  }

  for (const runtime of runtimes) {
    const notifications = await apiCall<any[]>(runtime.page, 'GET', '/notifications');
    if (!notifications.ok || !Array.isArray(notifications.body)) continue;
    for (const notification of notifications.body.filter((item) => !item.readAt && (String(item.title ?? '').includes(markerPrefix) || String(item.message ?? '').includes(markerPrefix)))) {
      await apiCall(runtime.page, 'POST', `/notifications/${notification.id}/read`, {});
    }
  }
}

test.describe.configure({ mode: 'serial' });

test('PFF V5 Plast 11 requests and stock/order live business integration', async ({ browser }) => {
  test.setTimeout(420_000);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runtimes: Runtime[] = [];
  let master: Runtime | undefined;
  let kipia: Runtime | undefined;
  let holod: Runtime | undefined;
  let management: Runtime | undefined;
  let admin: Runtime | undefined;

  try {
    [master, kipia, holod, management, admin] = await Promise.all([
      createRuntime(browser, 'MASTER', credentials.master),
      createRuntime(browser, 'TECH_KIPIA', credentials.kipia),
      createRuntime(browser, 'TECH_HOLOD', credentials.holod),
      createRuntime(browser, 'MANAGEMENT', credentials.management),
      createRuntime(browser, 'ADMIN', credentials.admin),
    ]);
    runtimes.push(master, kipia, holod, management, admin);
    await cleanupStaleP11Artifacts(admin, master, runtimes);

    await Promise.all([
      openMain(master.page, 'Заявки'),
      openMain(kipia.page, 'Заявки'),
      openMain(holod.page, 'Заявки'),
      openMain(management.page, 'Заказы / Остатки'),
      openMain(admin.page, 'Заказы / Остатки'),
    ]);
    await Promise.all(runtimes.map((runtime) => armRealtimeEvidence(runtime.page)));

    const departments = await apiOk<any[]>(master.page, 'GET', '/tasks/recipient-departments');
    const normalizedDepartmentNames = departments.map((item) => String(item.name).trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'));
    expect(new Set(normalizedDepartmentNames).size).toBe(normalizedDepartmentNames.length);
    state.kipiaDepartmentId = departments.find((item) => item.name === 'КИПиА')?.id ?? '';
    state.holodDepartmentId = departments.find((item) => item.name === 'Холодильная служба')?.id ?? '';
    expect(state.kipiaDepartmentId).not.toBe('');
    expect(state.holodDepartmentId).not.toBe('');

    const directoryDepartments = await apiOk<any[]>(admin.page, 'GET', '/directory/departments');
    state.managementDepartmentId = directoryDepartments.find((item) => item.name === 'Руководство')?.id ?? '';
    expect(state.managementDepartmentId).not.toBe('');
    const archiveOptions = await apiOk<any>(master.page, 'GET', '/archive/options');
    const realLine = (archiveOptions.lines ?? []).find((line: any) => !/PILOT|STAGE|TEST|ДИАГНОСТ/i.test(line.name));
    expect(realLine).toBeTruthy();
    state.lineId = realLine.id;
    state.lineName = realLine.name;

    const allStockBefore = await apiOk<any[]>(admin.page, 'GET', '/orders/items?includeArchive=true');
    evidence.stockBaselineHash = stableStockHash(allStockBefore);
    evidence.preexistingStockCount = allStockBefore.filter((item) => !String(item.name).includes(markerPrefix)).length;

    const urgentDescription = `${marker} Срочно проверить датчик линии`;
    const urgentStartedAt = Date.now();
    const urgent = await createTask(master.page, {
      description: urgentDescription,
      type: 'URGENT',
      departmentId: state.kipiaDepartmentId,
      lineId: state.lineId,
      withAttachment: true,
    });
    state.urgentTaskId = urgent.task.id;
    const urgentReplay = await apiOk<any>(master.page, 'POST', '/tasks', urgent.body);
    expect(urgentReplay.id).toBe(state.urgentTaskId);
    const urgentMatches = await apiOk<any[]>(master.page, 'GET', `/tasks?includeDone=true&includeFixtures=true&search=${encodeURIComponent(urgentDescription)}`);
    expect(urgentMatches.filter((task) => task.id === state.urgentTaskId)).toHaveLength(1);

    await expect(kipia.page.getByText(urgentDescription, { exact: false }).first()).toBeVisible({ timeout: 4_500 });
    const urgentRealtimeMs = Date.now() - urgentStartedAt;
    expect(urgentRealtimeMs).toBeLessThan(6_500);
    await expect.poll(() => taskRealtimeCount(kipia!.page, state.urgentTaskId), { timeout: 4_500 }).toBeGreaterThan(0);
    await expect(kipia.page.getByText(/^Обновлено/, { exact: false })).toBeVisible({ timeout: 4_500 });
    evidence.realtime.push({ event: 'urgent-created', milliseconds: urgentRealtimeMs, transport: 'websocket-ui-event' });
    await expect(holod.page.getByText(urgentDescription, { exact: false })).toHaveCount(0);
    const holodDeniedBeforeRedirect = await apiCall(holod.page, 'GET', `/tasks/${state.urgentTaskId}`);
    expect(holodDeniedBeforeRedirect.status).toBe(403);
    evidence.denials.push('TECH_HOLOD cannot read KIPIA request before transfer');

    await master.page.setViewportSize({ width: 390, height: 844 });
    await taskCard(master.page, urgentDescription);
    await master.page.screenshot({ path: screenshotPath('01-urgent-request-mobile-390.png'), fullPage: true });

    const takeBody = await takeTask(kipia.page, urgentDescription);
    const takeReplay = await apiOk<any>(kipia.page, 'POST', `/tasks/${state.urgentTaskId}/take`, takeBody);
    expect(takeReplay.status).toBe('IN_PROGRESS');
    await expect.poll(async () => (await apiOk<any>(master!.page, 'GET', `/tasks/${state.urgentTaskId}`)).status, { timeout: 4_500 }).toBe('IN_PROGRESS');
    await closeVisibleTaskDialog(kipia.page);
    await taskCard(kipia.page, urgentDescription);
    await kipia.page.screenshot({ path: screenshotPath('02-request-in-work-mobile-390.png'), fullPage: true });

    const urgentComment = `${marker} Диагностика выполнена, требуется холодильная служба`;
    const commentBody = await commentTask(kipia.page, urgentDescription, urgentComment, true);
    const commentReplay = await apiOk<any>(kipia.page, 'POST', `/tasks/${state.urgentTaskId}/comment`, commentBody);
    expect(commentReplay.id).toBeTruthy();
    await expect.poll(async () => {
      const detail = await apiOk<any>(master!.page, 'GET', `/tasks/${state.urgentTaskId}`);
      return detail.comments.filter((comment: any) => comment.message === urgentComment).length;
    }, { timeout: 4_500 }).toBe(1);

    const transferBody = await redirectTask(master.page, urgentDescription, state.holodDepartmentId, `${marker} Передача в холодильную службу`);
    const transferReplay = await apiOk<any>(master.page, 'POST', `/tasks/${state.urgentTaskId}/redirect`, transferBody);
    expect(transferReplay.id).toBe(state.urgentTaskId);
    await expect(holod.page.getByText(urgentDescription, { exact: false }).first()).toBeVisible({ timeout: 4_500 });
    await expect(kipia.page.getByText(urgentDescription, { exact: false })).toHaveCount(0, { timeout: 10_000 });
    const kipiaDeniedAfterRedirect = await apiCall(kipia.page, 'GET', `/tasks/${state.urgentTaskId}`);
    expect(kipiaDeniedAfterRedirect.status).toBe(403);
    evidence.denials.push('old KIPIA recipient loses request after transfer');

    await takeTask(holod.page, urgentDescription);
    const completeBody = await completeTask(holod.page, urgentDescription, `${marker} Работа выполнена`);
    const completeReplay = await apiOk<any>(holod.page, 'POST', `/tasks/${state.urgentTaskId}/complete`, completeBody);
    expect(completeReplay.status).toBe('DONE');
    const urgentDetail = await apiOk<any>(master.page, 'GET', `/tasks/${state.urgentTaskId}`);
    expect(urgentDetail.status).toBe('DONE');
    expect(urgentDetail.lineName).toBe(state.lineName);
    expect(urgentDetail.recipients).toHaveLength(1);
    expect(urgentDetail.recipients[0].departmentName).toBe('Холодильная служба');
    expect(urgentDetail.comments.filter((comment: any) => comment.message === urgentComment)).toHaveLength(1);
    expect(urgentDetail.attachments.length).toBeGreaterThan(0);
    expect(urgentDetail.comments.some((comment: any) => comment.attachments?.length)).toBe(true);
    assertNoForbiddenKeys(urgentDetail);

    await closeVisibleTaskDialog(master.page);
    await master.page.getByRole('button', { name: 'Архив и метрики', exact: true }).click();
    const archiveDialog = master.page.getByRole('dialog', { name: 'Архив и метрики заявок' });
    await expect(archiveDialog.getByText(urgentDescription, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await archiveDialog.screenshot({ path: screenshotPath('03-request-archive-mobile-390.png') });
    await archiveDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    const longDescription = `${marker} Долгая проверка шкафа управления`;
    const longTask = await createTask(master.page, {
      description: longDescription,
      type: 'LONG',
      departmentId: state.kipiaDepartmentId,
      lineId: state.lineId,
    });
    state.longTaskId = longTask.task.id;
    await expect(kipia.page.getByText(longDescription, { exact: false }).first()).toBeVisible({ timeout: 4_500 });
    const longCard = await taskCard(kipia.page, longDescription);
    await expect(longCard.getByText('Долгая', { exact: true })).toBeVisible();
    await takeTask(kipia.page, longDescription);
    await commentTask(kipia.page, longDescription, `${marker} Плановая диагностика начата`);
    await completeTask(kipia.page, longDescription, `${marker} Долгая заявка выполнена`);
    const longDetail = await apiOk<any>(master.page, 'GET', `/tasks/${state.longTaskId}`);
    expect(longDetail.type).toBe('LONG');
    expect(longDetail.deadlineAt).toBeTruthy();
    expect(longDetail.status).toBe('DONE');

    await openMain(master.page, 'Заявки');
    await master.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    let filterSheet = master.page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await expect(filterSheet).toBeVisible();
    await nestedField(filterSheet, 'Поиск', 'input').fill(marker);
    await nestedField(filterSheet, 'Тип заявки', 'select').selectOption('LONG');
    await nestedField(filterSheet, 'Служба / отдел', 'select').selectOption(state.kipiaDepartmentId);
    await nestedField(filterSheet, 'Линия', 'select').selectOption(state.lineId);
    await filterSheet.getByRole('button', { name: 'Завершённые', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(master.page.getByText(longDescription, { exact: false }).first()).toBeVisible();
    evidence.filters.push('requests search + done + LONG + department + line');
    await master.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    filterSheet = master.page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await filterSheet.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Показать', exact: true }).click();
    await master.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const backSheet = master.page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await expect(backSheet).toBeVisible();
    await master.page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
    await expect(backSheet).toBeVisible();
    await expect(nestedField(backSheet, 'Поиск', 'input')).not.toBeFocused();
    await master.page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
    await expect(backSheet).toBeHidden();
    await expect(master.page.getByRole('heading', { name: 'Заявки', exact: true })).toBeVisible();
    expect(master.page.url()).toContain('127.0.0.1:5173');
    evidence.filters.push('request reset and Android Back close only sheet');

    const urgentNotificationsKipia = await markerNotifications(kipia.page, [state.urgentTaskId]);
    expect(urgentNotificationsKipia.some((item) => item.type === 'TASK_CREATED')).toBe(true);
    const wrongNotificationsBefore = await markerNotifications(holod.page, [state.urgentTaskId]);
    expect(wrongNotificationsBefore.some((item) => item.type === 'TASK_CREATED')).toBe(false);
    expect(wrongNotificationsBefore.some((item) => item.type === 'TASK_REDIRECTED')).toBe(true);

    await admin.page.getByRole('button', { name: '+ Новая позиция', exact: true }).click();
    let actionDialog = admin.page.getByRole('dialog').filter({ hasText: 'Новая позиция остатка' }).last();
    await fillAction(actionDialog, {
      'Наименование': `${marker} Фильтр контрольный`,
      'Категория': `${marker} Расходники`,
      'Склад / зона хранения': 'Контрольная полка',
      'Отдел / владелец': state.managementDepartmentId,
      'Минимальный остаток': '20',
      'Текущий остаток': '100',
      'Единица измерения': 'шт',
      'Комментарий': `${marker} Изолированная позиция проверки`,
    });
    await actionDialog.locator('input[type=file]').last().setInputFiles({ name: 'p11-stock-note.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
    const stockCreateResponse = admin.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/orders/items'));
    const stockCreateStarted = Date.now();
    await submitAction(actionDialog);
    const stockCreated = await (await stockCreateResponse).json();
    state.stockItemId = stockCreated.id;
    evidence.uiMutations.push(`UI stock create: ${state.stockItemId}`);
    await expect(management.page.getByText(`${marker} Фильтр контрольный`, { exact: true }).first()).toBeVisible({ timeout: 4_500 });
    await expect.poll(() => orderRealtimeCount(management!.page), { timeout: 4_500 }).toBeGreaterThan(0);
    evidence.realtime.push({ event: 'stock-created', milliseconds: Date.now() - stockCreateStarted, transport: 'orders_updated' });
    await management.page.screenshot({ path: screenshotPath('04-stock-list-mobile-390.png'), fullPage: true });

    let stockCard = management.page.locator('.compact-record-card').filter({ hasText: `${marker} Фильтр контрольный` }).first();
    await stockCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
    let stockDialog = management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).last();
    await stockDialog.getByRole('button', { name: 'Израсходовать', exact: true }).click();
    actionDialog = management.page.getByRole('dialog').filter({ hasText: 'Израсходовать' }).last();
    await fillAction(actionDialog, { 'Количество, шт': '15', 'Комментарий к расходу': `${marker} Контрольный расход` });
    await submitAction(actionDialog);
    await expect.poll(async () => (await apiOk<any>(admin!.page, 'GET', `/orders/items/${state.stockItemId}`)).currentQuantity, { timeout: 4_500 }).toBe(85);
    await management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).getByRole('button', { name: 'Пополнить', exact: true }).click();
    actionDialog = management.page.getByRole('dialog').filter({ hasText: 'Пополнить остаток' }).last();
    await fillAction(actionDialog, { 'Количество, шт': '15', 'Комментарий к пополнению': `${marker} Возврат точного состояния` });
    await submitAction(actionDialog);
    await expect.poll(async () => (await apiOk<any>(admin!.page, 'GET', `/orders/items/${state.stockItemId}`)).currentQuantity, { timeout: 4_500 }).toBe(100);

    if (await management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).count()) {
      await management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    }
    stockCard = management.page.locator('.compact-record-card').filter({ hasText: `${marker} Фильтр контрольный` }).first();
    await stockCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
    stockDialog = management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).last();
    await stockDialog.getByRole('button', { name: 'Заказать', exact: true }).click();
    actionDialog = management.page.getByRole('dialog').filter({ hasText: 'Заказать пополнение' }).last();
    await fillAction(actionDialog, { 'Сколько заказать, шт': '20', 'Причина заказа': `${marker} Проверка заявки на пополнение` });
    await actionDialog.locator('input[type=file]').last().setInputFiles({ name: 'p11-order-note.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
    await admin.page.getByRole('button', { name: 'Заявки на заказ', exact: true }).click();
    const orderResponsePromise = management.page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/orders/items/${state.stockItemId}/order`));
    const orderStarted = Date.now();
    await submitAction(actionDialog);
    const orderCreated = await (await orderResponsePromise).json();
    state.orderRequestId = orderCreated.id;
    evidence.uiMutations.push(`UI order create: ${state.orderRequestId}`);
    const managementDetailAfterOrder = management.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).last();
    if (await managementDetailAfterOrder.isVisible().catch(() => false)) {
      await managementDetailAfterOrder.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
      await expect(managementDetailAfterOrder).toBeHidden();
    }
    await expect(admin.page.getByText(`${marker} Фильтр контрольный`, { exact: true }).first()).toBeVisible({ timeout: 4_500 });
    evidence.realtime.push({ event: 'order-created', milliseconds: Date.now() - orderStarted, transport: 'orders_updated' });
    await admin.page.screenshot({ path: screenshotPath('05-order-request-mobile-390.png'), fullPage: true });

    const orderCard = admin.page.locator('.card').filter({ hasText: `${marker} Фильтр контрольный` }).first();
    await orderCard.getByRole('button', { name: 'К заказу', exact: true }).click();
    actionDialog = admin.page.getByRole('dialog').filter({ hasText: 'Отметить как заказано' }).last();
    await fillAction(actionDialog, { 'Комментарий': `${marker} Передано к заказу` });
    const closeOrderRequest = admin.page.waitForRequest((request) => request.method() === 'POST' && request.url().includes(`/orders/requests/${state.orderRequestId}/close`));
    await submitAction(actionDialog);
    const closeOrderBody = (await closeOrderRequest).postDataJSON();
    const closeOrderReplay = await apiOk<any>(admin.page, 'POST', `/orders/requests/${state.orderRequestId}/close`, closeOrderBody);
    expect(closeOrderReplay.status).toBe('ORDERED');
    const closedOrder = await apiOk<any>(admin.page, 'GET', `/orders/requests/${state.orderRequestId}`);
    expect(closedOrder.status).toBe('ORDERED');
    const itemAfterOrderClose = await apiOk<any>(admin.page, 'GET', `/orders/items/${state.stockItemId}`);
    expect(itemAfterOrderClose.currentQuantity).toBe(100);

    await admin.page.getByRole('button', { name: 'Остатки', exact: true }).click();
    const adminStockCard = admin.page.locator('.compact-record-card').filter({ hasText: `${marker} Фильтр контрольный` }).first();
    await adminStockCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
    stockDialog = admin.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).last();
    await stockDialog.getByRole('button', { name: 'В архив', exact: true }).click();
    actionDialog = admin.page.getByRole('dialog').filter({ hasText: 'В архив' }).last();
    await fillAction(actionDialog, { 'Причина архивации': `${marker} Штатное завершение проверки` });
    await submitAction(actionDialog);
    evidence.uiMutations.push('UI stock archive');
    const archivedDetail = admin.page.getByRole('dialog').filter({ hasText: `${marker} Фильтр контрольный` }).last();
    if (await archivedDetail.isVisible().catch(() => false)) {
      await archivedDetail.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
      await expect(archivedDetail).toBeHidden();
    }

    await admin.page.getByRole('button', { name: 'Архив', exact: true }).click();
    await expect(admin.page.getByText(`${marker} Фильтр контрольный`, { exact: true }).first()).toBeVisible();
    await admin.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    let orderFilter = admin.page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await expect(orderFilter).toBeVisible();
    await nestedField(orderFilter, 'Поиск', 'input').fill(marker);
    await nestedField(orderFilter, 'Решение по заявке', 'select').selectOption('ORDERED');
    await orderFilter.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(admin.page.getByText(`${marker} Фильтр контрольный`, { exact: true }).first()).toBeVisible();
    evidence.filters.push('stock/order search + archive status');

    await openMain(management.page, 'Заказы / Остатки');
    await management.page.getByRole('button', { name: 'Заявки на заказ', exact: true }).click();
    await management.context.setOffline(true);
    await expect(management.page.getByRole('heading', { name: 'Заказы / Остатки' })).toBeVisible();
    await management.page.getByRole('button', { name: 'Подать заявку', exact: true }).click();
    actionDialog = management.page.getByRole('dialog').filter({ hasText: 'Подать заявку на заказ' }).last();
    await fillAction(actionDialog, {
      'Наименование': `${marker} offline attempt`,
      'Описание': 'Проверка отказа без сети',
      'Желаемое количество': '1',
      'Единица': 'шт',
      'Комментарий': `${marker} offline guarded`,
    });
    await actionDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(actionDialog.getByText(/Нет связи|Действие не выполнено|Failed to fetch|сервер/i)).toBeVisible({ timeout: 12_000 });
    await management.context.setOffline(false);
    await expect(management.page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 20_000 });
    await actionDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    const discard = management.page.getByRole('dialog').filter({ hasText: 'Изменения не сохранены' }).last();
    if (await discard.isVisible().catch(() => false)) await discard.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click();
    const offlineOrders = await apiOk<any[]>(management.page, 'GET', `/orders/requests?status=ACTIVE&includeDiagnostics=true&search=${encodeURIComponent(`${marker} offline attempt`)}`);
    expect(offlineOrders.filter((item) => item.title.includes(`${marker} offline attempt`))).toHaveLength(0);
    evidence.realtime.push({ event: 'offline-mutation', result: 'guarded-no-write' });

    const worker = await createRuntime(browser, 'WORKER', credentials.worker);
    const store = await createRuntime(browser, 'STORE', credentials.store);
    runtimes.push(worker, store);
    const [workerTasks, workerOrders, storeTasks, storeOrders, kipiaOrders, crossFactory] = await Promise.all([
      apiCall(worker.page, 'GET', '/tasks'),
      apiCall(worker.page, 'GET', '/orders/items'),
      apiCall(store.page, 'GET', '/tasks'),
      apiCall(store.page, 'GET', '/orders/items'),
      apiCall(kipia.page, 'GET', '/orders/items'),
      apiCall(master.page, 'GET', '/tasks', undefined, '00000000-0000-4000-8000-000000000011'),
    ]);
    expect([workerTasks.status, workerOrders.status, storeTasks.status, storeOrders.status, kipiaOrders.status, crossFactory.status]).toEqual([403, 403, 403, 403, 403, 403]);
    evidence.denials.push('WORKER/STORE/TECH_KIPIA order/task denies and cross-factory deny');

    const adminTask = await apiOk<any>(admin.page, 'GET', `/tasks/${state.urgentTaskId}`);
    const managementOrder = await apiOk<any>(management.page, 'GET', `/orders/requests/${state.orderRequestId}`);
    assertNoForbiddenKeys(adminTask);
    assertNoForbiddenKeys(managementOrder);

    const entityIds = [state.urgentTaskId, state.longTaskId, state.stockItemId, state.orderRequestId];
    const requiredAuditActions = ['TASK_CREATED', 'TASK_TAKEN', 'TASK_COMMENT_CREATED', 'TASK_REDIRECTED', 'TASK_DONE', 'ORDER_ITEM_CREATED', 'ORDER_ITEM_TAKEN', 'ORDER_ITEM_RESTOCKED', 'ORDER_REQUEST_CREATED', 'ORDER_REQUEST_CLOSED', 'ORDER_ITEM_ARCHIVED'];
    const auditByAction = await Promise.all(requiredAuditActions.map(async (action) => ({
      action,
      items: await apiOk<any[]>(admin!.page, 'GET', `/ops/audit?limit=100&includeDiagnostics=true&action=${encodeURIComponent(action)}`),
    })));
    const markerAudit = auditByAction.flatMap(({ items }) => items.filter((item) => (
      entityIds.includes(item.entityId)
      || entityIds.includes(item.details?.taskId)
      || item.details?.sourceItemId === state.stockItemId
    )));
    const actions = new Set(markerAudit.map((item) => item.action));
    for (const action of requiredAuditActions) {
      expect(actions.has(action), `Audit action ${action}`).toBe(true);
    }
    expect(markerAudit.every((item) => item.actionLabel && item.actorName && item.detailsSummary !== undefined)).toBe(true);
    assertNoForbiddenKeys(markerAudit);

    await readMarkerNotifications(runtimes, entityIds);
    await Promise.all([
      closeVisibleTaskDialog(master.page),
      closeVisibleTaskDialog(kipia.page),
      closeVisibleTaskDialog(holod.page),
    ]);

    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
      await master.page.setViewportSize(viewport);
      await openMain(master.page, 'Заявки');
      await noHorizontalOverflow(master.page);
      await expectHumanScreen(master.page);
      await management.page.setViewportSize(viewport);
      await openMain(management.page, 'Заказы / Остатки');
      await noHorizontalOverflow(management.page);
      await expectHumanScreen(management.page);
    }
    await admin.page.setViewportSize({ width: 1280, height: 900 });
    await openMain(admin.page, 'Заказы / Остатки');
    await noHorizontalOverflow(admin.page);
    evidence.viewports = ['360x800', '390x844', '430x900', '1280x900'];

    await master.page.setViewportSize({ width: 390, height: 844 });
    await openMain(master.page, 'Заявки');
    await expect(master.page.getByText(marker, { exact: false })).toHaveCount(0);
    await master.page.screenshot({ path: screenshotPath('06-post-cleanup-requests-mobile-390.png'), fullPage: true });
    await admin.page.setViewportSize({ width: 390, height: 844 });
    await openMain(admin.page, 'Заказы / Остатки');
    await admin.page.getByRole('button', { name: 'Остатки', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const cleanStockFilter = admin.page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await cleanStockFilter.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await cleanStockFilter.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(admin.page.getByText('Все доступные позиции', { exact: true })).toBeVisible();
    await expect(admin.page.locator('.compact-record-card').filter({ hasText: marker })).toHaveCount(0);
    await expect(admin.page.getByText(marker, { exact: false })).toHaveCount(0);
    await admin.page.screenshot({ path: screenshotPath('06b-post-cleanup-stock-mobile-390.png'), fullPage: true });

    const normalTaskCreateButton = master.page.getByRole('button', { name: 'Создать заявку', exact: true });
    await expect(normalTaskCreateButton).toBeVisible();
    await normalTaskCreateButton.click();
    const createDialog = master.page.getByRole('dialog').filter({ hasText: 'Создать заявку' }).last();
    expect(await createDialog.getByLabel('Линия', { exact: true }).locator('option').count()).toBeGreaterThan(1);
    expect(await createDialog.getByLabel('Служба / отдел', { exact: true }).locator('option').count()).toBeGreaterThan(1);
    await createDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    const normalStockCard = admin.page.locator('.compact-record-card').first();
    if (await normalStockCard.count()) {
      await normalStockCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
      await expect(admin.page.getByRole('dialog').last()).toBeVisible();
      await admin.page.getByRole('dialog').last().getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    }

    const allTasks = await apiOk<any[]>(master.page, 'GET', `/tasks?includeDone=true&includeFixtures=true&search=${encodeURIComponent(marker)}`);
    const markerTasks = allTasks.filter((task) => String(task.description).includes(marker));
    const activeTasks = markerTasks.filter((task) => task.status !== 'DONE');
    const allStockAfter = await apiOk<any[]>(admin.page, 'GET', '/orders/items?includeArchive=true');
    const markerStock = allStockAfter.filter((item) => String(item.name).includes(marker) || String(item.description).includes(marker));
    const activeStock = markerStock.filter((item) => item.isActive && !item.archivedAt);
    const activeOrders = await apiOk<any[]>(admin.page, 'GET', `/orders/requests?status=ACTIVE&includeDiagnostics=true&search=${encodeURIComponent(marker)}`);
    const unreadNotifications = (await Promise.all(runtimes.map((runtime) => markerNotifications(runtime.page, entityIds).catch(() => []))))
      .flat()
      .filter((notification) => !notification.readAt);
    evidence.stockFinalHash = stableStockHash(allStockAfter);
    evidence.activeTestRequests = activeTasks.length;
    evidence.activeTestUrgentRequests = activeTasks.filter((task) => task.type === 'URGENT').length;
    evidence.activeTestLongRequests = activeTasks.filter((task) => task.type === 'LONG').length;
    evidence.activeTestStockItems = activeStock.length;
    evidence.activeTestOrderRequests = activeOrders.filter((request) => String(request.title).includes(marker) || String(request.reasonComment).includes(marker)).length;
    evidence.activeTestArtifacts = evidence.activeTestRequests + evidence.activeTestStockItems + evidence.activeTestOrderRequests + unreadNotifications.length;
    evidence.preexistingStockValuesModified = evidence.stockBaselineHash === evidence.stockFinalHash ? 0 : 1;
    evidence.cleanupMetrics = {
      ACTIVE_TEST_REQUESTS: evidence.activeTestRequests,
      ACTIVE_TEST_URGENT_REQUESTS: evidence.activeTestUrgentRequests,
      ACTIVE_TEST_LONG_REQUESTS: evidence.activeTestLongRequests,
      ACTIVE_TEST_STOCK_ITEMS: evidence.activeTestStockItems,
      ACTIVE_TEST_ORDER_REQUESTS: evidence.activeTestOrderRequests,
      ACTIVE_TEST_ARTIFACTS: evidence.activeTestArtifacts,
      PREEXISTING_STOCK_VALUES_MODIFIED: evidence.preexistingStockValuesModified,
      PREEXISTING_ENTITIES_DELETED: evidence.preexistingEntitiesDeleted,
      PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: evidence.preexistingEntitiesUnintentionallyModified,
    };
    expect(evidence.cleanupMetrics).toMatchObject({
      ACTIVE_TEST_REQUESTS: 0,
      ACTIVE_TEST_URGENT_REQUESTS: 0,
      ACTIVE_TEST_LONG_REQUESTS: 0,
      ACTIVE_TEST_STOCK_ITEMS: 0,
      ACTIVE_TEST_ORDER_REQUESTS: 0,
      ACTIVE_TEST_ARTIFACTS: 0,
      PREEXISTING_STOCK_VALUES_MODIFIED: 0,
      PREEXISTING_ENTITIES_DELETED: 0,
      PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: 0,
    });
    expect(evidence.browserErrors).toEqual([]);
    expect(evidence.serverErrors).toEqual([]);
    evidence.cleanup.push('URGENT/LONG completed, order closed, marker stock archived, marker notifications read');
  } finally {
    await emergencyCleanup(admin, master).catch((error) => evidence.emergencyCleanup.push(String(error)));
    if (runtimes.length) await readMarkerNotifications(runtimes, [state.urgentTaskId, state.longTaskId, state.stockItemId, state.orderRequestId].filter(Boolean)).catch(() => undefined);
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await Promise.all(runtimes.map((runtime) => runtime.context.close().catch(() => undefined)));
  }
});
