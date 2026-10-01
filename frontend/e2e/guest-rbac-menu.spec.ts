import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const backendUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const backendCwd = path.resolve(process.cwd(), '..', 'backend');
const fallbackGuestId = 'stage-rbac-menu-e2e-guest';
const createdGuests = new Set<string>();

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${backendUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function findActiveGuest(factoryId: string) {
  const users = await api(`/admin/users?factoryId=${encodeURIComponent(factoryId)}&hasFactoryAccess=true`, { userId: 'test-admin', factoryId });
  const guest = (users as Array<{ id: string; displayName?: string; selectedFactoryAccess?: { isGuest?: boolean; isActive?: boolean } }>).find((user) =>
    user.selectedFactoryAccess?.isGuest && user.selectedFactoryAccess?.isActive && !user.id.toLowerCase().includes('stage'),
  ) ?? (users as Array<{ id: string; selectedFactoryAccess?: { isGuest?: boolean; isActive?: boolean } }>).find((user) =>
    user.selectedFactoryAccess?.isGuest && user.selectedFactoryAccess?.isActive,
  );
  if (guest) return guest.id;
  ensureTemporaryGuest(factoryId);
  return fallbackGuestId;
}

function runBackendPrisma(script: string) {
  execFileSync(process.execPath, ['-e', script], {
    cwd: backendCwd,
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
}

function ensureTemporaryGuest(factoryId: string) {
  const script = `
const { PrismaClient, UserRole } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const userId = ${JSON.stringify(fallbackGuestId)};
  const factoryId = ${JSON.stringify(factoryId)};
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role: UserRole.OTHER, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role: UserRole.OTHER, blockedAt: null, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role: UserRole.OTHER, departmentId: null, companyId: null, isGuest: true, isActive: true, deactivatedAt: null },
    create: { userId, factoryId, role: UserRole.OTHER, departmentId: null, companyId: null, isGuest: true, isActive: true },
  });
})().finally(() => db.$disconnect());
`;
  runBackendPrisma(script);
  createdGuests.add(factoryId);
}

function deactivateTemporaryGuest(factoryId: string) {
  const script = `
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const userId = ${JSON.stringify(fallbackGuestId)};
  const factoryId = ${JSON.stringify(factoryId)};
  await db.userFactoryAccess.updateMany({
    where: { userId, factoryId },
    data: { isActive: false, deactivatedAt: new Date(), deactivatedById: 'test-admin', deactivationReason: 'role hierarchy e2e cleanup' },
  });
})().finally(() => db.$disconnect());
`;
  runBackendPrisma(script);
}

async function loginAs(page: Page, userId: string, factoryId: string) {
  await page.goto('/');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
}

async function expectGuestMenu(page: Page) {
  await expect(page.getByRole('button', { name: 'Объявления', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Главная', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сообщить об ошибке', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ещё', exact: true })).toHaveCount(0);

  const forbiddenLabels = [
    'Смена',
    'Люди',
    'Линии',
    'Заявки',
    'Мойка',
    'ОКК',
    'Некондиция',
    'Заказы / Остатки',
    'Чек-листы',
    'Оттайка',
    'Пересменка',
    'Чаты',
    'Возвраты',
    'Архив',
    'Статистика / Аудит',
    'Администрирование',
  ];

  for (const label of forbiddenLabels) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\b(ADMIN|MANAGEMENT|MASTER|WORKER|CONTRACTOR)\b/);
  expect(body).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);

  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

test.describe('guest RBAC menu', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Достаточно Chromium для targeted smoke.');

  test('desktop: гость видит назначение и сообщение об ошибке без рабочих разделов', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('desktop'), 'Проверка относится к desktop viewport.');
    const factoryId = await resolveFactoryId();
    const guestUserId = await findActiveGuest(factoryId);
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, guestUserId, factoryId);
    await expectGuestMenu(page);
  });

  test('mobile 360/390/430: гостевой контур не имеет overflow и рабочих разделов', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Проверка относится к мобильной навигации.');
    const factoryId = await resolveFactoryId();
    const guestUserId = await findActiveGuest(factoryId);
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await loginAs(page, guestUserId, factoryId);
      await expectGuestMenu(page);
    }
  });
});

test.afterEach(async () => {
  for (const factoryId of createdGuests) deactivateTemporaryGuest(factoryId);
  createdGuests.clear();
});
