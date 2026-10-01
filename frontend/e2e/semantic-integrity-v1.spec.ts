import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'semantic-integrity-red-team-v1', 'screenshots');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const checklistName = `Проверка целостности чек-листа ${suffix}`;
const chatTitle = `Проверка связи чата ${suffix}`;
const offlineChatText = `Сообщение без сети ${suffix}`;
let factoryId = '';
let workerDepartmentId = '';
let templateId = '';
let chatId = '';

const pilotCredentials: Record<string, { phone: string; password: string }> = {
  'pilot-pack-admin': { phone: '+79000009009', password: '1234' },
  'pilot-pack-guest': { phone: '+79000009000', password: '1234' },
  'pilot-master-1': { phone: '+79000004720', password: '1234' },
  'pilot-worker-1': { phone: '+79000004701', password: '1234' },
};

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'pilot-pack-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'pilot-worker-1' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  factoryId = factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('Завод 4 не найден для browser evidence');
  const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: 'pilot-worker-1', factoryId } } });
  if (!access?.departmentId) throw new Error('У тестового работника не назначен отдел');
  workerDepartmentId = access.departmentId;
  const template = await db.checklistTemplate.create({
    data: {
      factoryId,
      departmentId: workerDepartmentId,
      name: checklistName,
      scope: 'DEPARTMENT',
      frequencyRule: 'MANUAL',
      assignmentRoles: ['ADMIN'],
      assignmentUserIds: ['pilot-pack-admin'],
      createdById: 'pilot-pack-admin',
      rows: { create: [{ title: 'Подтвердить контроль', sortOrder: 1, rowType: 'YES_NO', requiredAnswer: true, isRequired: true }] },
    },
  });
  templateId = template.id;
  const chat = await db.chat.create({
    data: {
      factoryId,
      type: 'CUSTOM',
      title: chatTitle,
      isHidden: true,
      createdById: 'pilot-pack-admin',
      members: {
        create: [
          { userId: 'pilot-pack-admin', canRead: true, canWrite: true, canManage: true },
          { userId: 'pilot-worker-1', canRead: true, canWrite: true, canManage: false },
        ],
      },
    },
  });
  chatId = chat.id;
}

async function cleanupFixture() {
  const now = new Date();
  if (templateId) {
    await db.checklistRun.updateMany({
      where: { templateId, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'CLOSED', closedAt: now, closedById: 'pilot-pack-admin', closeReason: 'Browser evidence cleanup', closeKind: 'MANUAL', nextCheckAt: null },
    });
    await db.checklistTemplate.update({ where: { id: templateId }, data: { isActive: false, archivedAt: now } });
  }
  if (chatId) await db.chat.update({ where: { id: chatId }, data: { isActive: false, archivedAt: now } });
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__semanticDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
}

async function loginAs(page: Page, userId: string, width: number, height = 820) {
  const credentials = pilotCredentials[userId];
  if (!credentials) throw new Error(`Pilot credentials are not configured for ${userId}`);
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error(`Pilot login ${userId} returned ${response.status}`);
  const login = await response.json();
  const accessToken = login.accessToken ?? login.token;
  const factory = login.availableFactories?.find((item: { id?: string }) => item.id === factoryId);
  if (!accessToken || !factory) throw new Error(`Pilot session or selected factory is unavailable for ${userId}`);

  await page.setViewportSize({ width, height });
  await page.goto('/manifest.webmanifest');
  const sessionUrl = `/?semanticSession=${Date.now()}-${encodeURIComponent(userId)}`;
  await page.evaluate(({ token, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
  }, { token: accessToken, nextFactoryId: factoryId });
  await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('zavod.authToken'))).toBe(accessToken);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthy(page);
}

async function openSection(page: Page, label: RegExp) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const item = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();
    return;
  }
  throw new Error(`Раздел не найден: ${label}`);
}

async function expectHealthy(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|internalPath|passwordHash|DATABASE_URL|JWT_SECRET|SESSION_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
  expect(text).not.toMatch(/Cannot read properties|Unhandled Runtime Error|Application error|Unexpected token|TypeError|ReferenceError/i);
  expect(text).not.toMatch(/\u0420\u00a0\u0421|\u0420\u040e\u0420\u0453|\u0413\u0452|\u0413\u2018/);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
  const dialogs = await page.evaluate(() => (window as unknown as { __semanticDialogs?: string[] }).__semanticDialogs ?? []);
  expect(dialogs).toEqual([]);
}

async function shot(page: Page, name: string, fullPage = false) {
  await expectHealthy(page);
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

test.beforeAll(async () => setupFixture());
test.afterAll(async () => {
  await cleanupFixture();
  await db.$disconnect();
});
test.beforeEach(async ({ page }) => installDialogGuards(page));

test('mobile semantic safe states and network failures', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Single evidence run controls all viewports itself.');

  await loginAs(page, 'pilot-pack-admin', 360);
  await openSection(page, /^Линии/);
  await expect(page.getByRole('heading', { name: 'Линии', exact: true })).toBeVisible();
  await expect(page.getByText('Загрузка линий...')).toBeHidden({ timeout: 15_000 });
  await shot(page, 'mobile-360-line-conflict-safe-state.png');

  await openSection(page, /^Заявки/);
  await shot(page, 'mobile-360-task-duplicate-safe.png');

  await loginAs(page, 'pilot-master-1', 360);
  await openSection(page, /^Смена/);
  await shot(page, 'mobile-360-assignment-conflict.png');
  const handoverAvailability = await api('/shift-log/handover/availability', { userId: 'pilot-master-1', factoryId });
  const handoverButton = page.getByRole('button', { name: /Передать смену|Открыть передачу смены/ }).filter({ visible: true }).first();
  if (handoverAvailability.available) {
    await expect(handoverButton).toBeVisible();
    await handoverButton.click();
    await expect(page.getByText('Закрыть и передать смену')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'mobile-360-handover-idempotent.png');
    await page.setViewportSize({ width: 430, height: 820 });
    await shot(page, 'mobile-430-handover.png');
  } else {
    await expect(handoverButton).toHaveCount(0);
    await shot(page, 'mobile-360-handover-closed-window.png');
  }

  await loginAs(page, 'pilot-pack-admin', 360);
  await openSection(page, /^Чек-листы/);
  await page.getByRole('button', { name: 'Начать новый чек-лист' }).click();
  const checklistCard = page.locator('article').filter({ hasText: checklistName }).first();
  await expect(checklistCard).toBeVisible({ timeout: 15_000 });
  await shot(page, 'mobile-360-checklist-double-take.png');
  await checklistCard.getByRole('button', { name: 'Взять в работу' }).click();
  const startDialog = page.getByRole('dialog').filter({ hasText: checklistName }).first();
  await expect(startDialog).toBeVisible();
  await context.setOffline(true);
  await page.waitForTimeout(250);
  await startDialog.getByRole('button', { name: 'Взять в работу' }).click();
  await expect(startDialog.getByText('Нет связи с сервером. Действие не сохранено.')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'mobile-360-checklist-network-error.png');
  expect(await db.checklistRun.count({ where: { templateId } })).toBe(0);
  await context.setOffline(false);

  await loginAs(page, 'pilot-worker-1', 360);
  await openSection(page, /^Чаты/);
  const chatCard = page.locator('.messenger-chat-card').filter({ hasText: chatTitle }).first();
  await expect(chatCard).toBeVisible({ timeout: 15_000 });
  await chatCard.click();
  await expect(page.getByLabel('Сообщение')).toBeVisible();
  await page.getByLabel('Сообщение').fill(offlineChatText);
  await context.setOffline(true);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Отправить' }).click();
  const chatError = page.locator('.error-state:visible').filter({ hasText: 'Нет связи с сервером. Действие не сохранено.' });
  await expect(chatError).toBeVisible({ timeout: 10_000 });
  await chatError.scrollIntoViewIfNeeded();
  await shot(page, 'mobile-360-chat-network-error.png');
  expect(await db.chatMessage.count({ where: { chatId, text: offlineChatText } })).toBe(0);
  await context.setOffline(false);

  await loginAs(page, 'pilot-pack-guest', 360);
  await shot(page, 'mobile-360-role-downgrade.png');
  const guestText = await page.locator('body').innerText();
  expect(guestText).toContain('Вы вошли как Гость');
  expect(guestText).toContain('Сообщить об ошибке');
  expect(guestText).not.toContain('Объявления');
  expect(guestText).not.toContain('Администрирование');
});

test('line timeline and desktop integrity smoke', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Single evidence run controls all viewports itself.');
  await loginAs(page, 'pilot-pack-admin', 390);
  await openSection(page, /^Линии/);
  const details = page.getByRole('button', { name: 'Подробнее' }).filter({ visible: true }).first();
  await expect(details).toBeVisible({ timeout: 15_000 });
  await details.click();
  const detailDialog = page.getByRole('dialog', { name: /Подробнее о линии/ });
  await expect(detailDialog).toBeVisible({ timeout: 15_000 });
  const history = detailDialog.getByRole('button', { name: 'История линии' });
  await expect(history).toBeVisible({ timeout: 15_000 });
  await history.click();
  await expect(page.getByRole('dialog', { name: 'История линии' })).toBeVisible({ timeout: 15_000 });
  await shot(page, 'mobile-390-line-timeline.png');

  await loginAs(page, 'pilot-pack-admin', 1366, 900);
  await openSection(page, /^Линии/);
  await expect(page.getByText('Загрузка линий...')).toBeHidden({ timeout: 15_000 });
  await shot(page, 'desktop-integrity-smoke.png');
});
