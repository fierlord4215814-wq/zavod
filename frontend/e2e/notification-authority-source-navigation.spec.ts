import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient, PermissionEffect } = require('../../backend/node_modules/@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(rootDir, '.codex-runtime', 'notification-authority', 'fixture.json');
const envPath = path.join(rootDir, 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

type FixtureNotification = {
  id: string;
  factoryId: string;
  title: string;
  message: string;
  type: string;
  severity: string;
  createdAt: string;
};

type Fixture = {
  factoryA: string;
  factoryB: string;
  factoryAName: string;
  factoryBName: string;
  worker: string;
  notifications: Record<string, FixtureNotification>;
};

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture;
const db = new PrismaClient();
const screenshotsDir = path.join(rootDir, '.codex-runtime', 'notification-authority', 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

test.describe.configure({ mode: 'serial' });

async function restoreAuthority() {
  await db.factory.update({
    where: { id: fixture.factoryB },
    data: { isActive: true, deletedAt: null, deactivatedAt: null },
  });
  await db.user.update({
    where: { id: fixture.worker },
    data: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
  });
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId: fixture.worker, factoryId: fixture.factoryB } },
    data: { isActive: true, isGuest: false, deactivatedAt: null, deactivationReason: null },
  });
  for (const permissionCode of ['notifications.read', 'tasks.read']) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: fixture.worker, factoryId: fixture.factoryB, permissionCode } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId: fixture.worker, factoryId: fixture.factoryB, permissionCode, effect: PermissionEffect.ALLOW },
    });
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  await restoreAuthority();
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__notificationDialogs', { value: calls, configurable: true });
    Object.defineProperty(window, '__browserNotifications', { value: [], configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: class MockNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        onclick: (() => void) | null = null;
        data: unknown;
        constructor(public title: string, options: NotificationOptions = {}) {
          this.data = options.data;
          (window as unknown as { __browserNotifications: MockNotification[] }).__browserNotifications.push(this);
        }
        close() {}
      },
    });
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Forbidden browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
});

test.afterEach(async () => {
  await restoreAuthority();
});

test.afterAll(async () => {
  await restoreAuthority();
  await db.$disconnect();
});

async function loginAtFactoryA(page: Page) {
  await page.goto('/');
  await page.evaluate(({ userId, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { userId: fixture.worker, factoryId: fixture.factoryA });
  await page.reload();
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryAName, { timeout: 15_000 });
  await expect(page.locator('.compact-status-label')).toContainText('Онлайн');
}

async function openNotifications(page: Page) {
  await page.getByRole('button', { name: /Уведомления/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
}

function card(page: Page, title: string) {
  return page.locator('.notification-card').filter({ hasText: title });
}

async function clickSource(page: Page, item: FixtureNotification) {
  const itemCard = card(page, item.title);
  await expect(itemCard).toBeVisible();
  await itemCard.getByRole('button', { name: 'Открыть' }).click();
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoTechnicalLeak(page: Page) {
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/tasks\.read|factoryId|userId|permissionCode|storagePath|passwordHash|DATABASE_URL|token|secret/i);
  const dialogs = await page.evaluate(() => (window as unknown as { __notificationDialogs: string[] }).__notificationDialogs);
  expect(dialogs).toEqual([]);
}

test('in-app click opens same Factory and canonically switches A to allowed B', async ({ page }, testInfo) => {
  const taskRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/tasks(?:\?|$)/.test(request.url())) taskRequests.push(request.headers()['x-factory-id'] || '');
  });
  await loginAtFactoryA(page);
  await openNotifications(page);
  await clickSource(page, fixture.notifications.sameFactory);
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryAName);

  await openNotifications(page);
  taskRequests.length = 0;
  await clickSource(page, fixture.notifications.remoteAllowed);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryBName);
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expect.poll(() => taskRequests.length).toBeGreaterThan(0);
  expect(taskRequests.every((factoryId) => factoryId === fixture.factoryB)).toBeTruthy();
  await expectNoOverflow(page);
  await expectNoTechnicalLeak(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-allowed-a-to-b.png`), fullPage: true });
});

test('UFA revoke between delivery and click denies without changing Factory A', async ({ page }, testInfo) => {
  const remoteTaskRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/tasks(?:\?|$)/.test(request.url())) remoteTaskRequests.push(request.headers()['x-factory-id'] || '');
  });
  await loginAtFactoryA(page);
  await openNotifications(page);
  await expect(card(page, fixture.notifications.remoteRevoked.title)).toBeVisible();
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId: fixture.worker, factoryId: fixture.factoryB } },
    data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Проверка отзыва перед открытием' },
  });
  await clickSource(page, fixture.notifications.remoteRevoked);
  await expect(page.locator('.error-state')).toContainText(/Нет доступа|больше не действует/);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryAName);
  expect(remoteTaskRequests.filter((factoryId) => factoryId === fixture.factoryB)).toHaveLength(0);
  await expectNoTechnicalLeak(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-revoked-denial.png`), fullPage: true });
});

test('Factory deactivation between delivery and click denies without stale B data', async ({ page }) => {
  const remoteTaskRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/tasks(?:\?|$)/.test(request.url())) remoteTaskRequests.push(request.headers()['x-factory-id'] || '');
  });
  await loginAtFactoryA(page);
  await openNotifications(page);
  await expect(card(page, fixture.notifications.remoteDeactivated.title)).toBeVisible();
  await db.factory.update({ where: { id: fixture.factoryB }, data: { isActive: false, deactivatedAt: new Date() } });
  await clickSource(page, fixture.notifications.remoteDeactivated);
  await expect(page.locator('.error-state')).toContainText(/Нет доступа|больше не действует/);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryAName);
  expect(remoteTaskRequests.filter((factoryId) => factoryId === fixture.factoryB)).toHaveLength(0);
  await expectNoTechnicalLeak(page);
});

test('effective source permission removal before click denies safely', async ({ page }) => {
  const remoteTaskRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/tasks(?:\?|$)/.test(request.url())) remoteTaskRequests.push(request.headers()['x-factory-id'] || '');
  });
  await loginAtFactoryA(page);
  await openNotifications(page);
  await expect(card(page, fixture.notifications.remoteDenied.title)).toBeVisible();
  await db.userPermissionOverride.update({
    where: { userId_factoryId_permissionCode: { userId: fixture.worker, factoryId: fixture.factoryB, permissionCode: 'tasks.read' } },
    data: { effect: PermissionEffect.DENY },
  });
  await clickSource(page, fixture.notifications.remoteDenied);
  await expect(page.locator('.error-state')).toContainText(/Нет доступа|больше не действует/);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryAName);
  expect(remoteTaskRequests.filter((factoryId) => factoryId === fixture.factoryB)).toHaveLength(0);
  await expectNoTechnicalLeak(page);
});

test('browser Notification click transports the same validated navigation intent', async ({ page }) => {
  await loginAtFactoryA(page);
  const item = fixture.notifications.browserIntent;
  await page.evaluate(async (notification) => {
    localStorage.setItem('zavod.browserNotificationsEnabled', '1');
    const module = await (0, eval)("import('/src/notifications/browser-notifications.ts')");
    await module.signalImportantNotification({
      ...notification,
      entityType: 'TASK',
      sourceRoute: 'tasks',
      readAt: null,
      expiresAt: null,
    });
    const created = (window as unknown as { __browserNotifications: Array<{ onclick: (() => void) | null; data: unknown }> }).__browserNotifications[0];
    if (!created?.onclick) throw new Error('Browser notification click handler is missing');
    const data = created.data as { factoryId?: string; sourceRoute?: string };
    if (data.factoryId !== notification.factoryId || data.sourceRoute !== 'tasks') throw new Error('Browser notification lost source provenance');
    created.onclick();
  }, item);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryBName);
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expectNoTechnicalLeak(page);
});

test('service-worker open-client and cold-start intents are consumed only by the app', async ({ page }, testInfo) => {
  await loginAtFactoryA(page);
  const swItem = fixture.notifications.serviceWorkerIntent;
  await page.evaluate((notification) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'ZAVOD_NOTIFICATION_NAVIGATION',
        intent: { notificationId: notification.id, factoryId: notification.factoryId, sourceRoute: 'tasks' },
      },
    }));
  }, swItem);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryBName);
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();

  await page.evaluate(({ userId, factoryId }) => {
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { userId: fixture.worker, factoryId: fixture.factoryA });
  const cold = fixture.notifications.coldStartIntent;
  await page.goto(`/?notificationId=${encodeURIComponent(cold.id)}&notificationFactory=${encodeURIComponent(cold.factoryId)}&notificationRoute=tasks`);
  await expect(page.locator('.brand-name')).toHaveText(fixture.factoryBName, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await expectNoOverflow(page);
  await expectNoTechnicalLeak(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-sw-cold-start.png`), fullPage: true });
});
