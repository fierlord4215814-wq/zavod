import { expect, Page, test } from '@playwright/test';
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const suffix = `${Date.now()}-${process.pid}`;
const factoryCode = `store-contract-ui-${suffix}`;
const password = 'Store1234';
const phone = `+7998${String(Date.now()).slice(-7)}`;
const itemName = `Перчатки складские ${String(Date.now()).slice(-6)}`;
const returnName = `Материал возврата ${String(Date.now()).slice(-6)}`;
const screenshotDir = path.join(rootDir, 'docs', 'domain-fixes', 'store-material-contract');

const ids = { factoryId: '', departmentId: '', userId: '', accessId: '', itemId: '', returnId: '' };

function passwordHash(value: string) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(value, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const factory = await db.factory.create({ data: { code: factoryCode, name: `Учебный склад ${suffix}`, isActive: true } });
  ids.factoryId = factory.id;
  const department = await db.department.create({ data: {
    factoryId: factory.id,
    name: `Склад материалов ${suffix}`,
    normalizedName: `склад материалов ${suffix}`,
    code: `${factoryCode}-department`,
  } });
  ids.departmentId = department.id;
  const user = await db.user.create({ data: {
    factoryId: factory.id,
    firstName: 'Мария',
    lastName: 'Кладовщик',
    role: 'STORE',
    phone,
    normalizedPhone: phone,
    passwordHash: passwordHash(password),
  } });
  ids.userId = user.id;
  const access = await db.userFactoryAccess.create({ data: {
    userId: user.id,
    factoryId: factory.id,
    departmentId: department.id,
    role: 'STORE',
    isGuest: false,
    isActive: true,
  } });
  ids.accessId = access.id;
  const item = await db.minimumStockItem.create({ data: {
    factoryId: factory.id,
    departmentId: department.id,
    name: itemName,
    category: 'Расходные материалы',
    storageLocation: 'Основной склад',
    minThreshold: 4,
    initialQuantity: 10,
    currentQuantity: 10,
    referenceQuantity: 10,
    unit: 'шт',
    createdById: user.id,
  } });
  ids.itemId = item.id;
  const returnRecord = await db.returnRecord.create({ data: {
    factoryId: factory.id,
    createdById: user.id,
    description: `${returnName} - Повреждена упаковка`,
    photoUrl: 'attachment-pending',
    receivedAt: new Date(),
    article: 'MAT-01',
    productName: returnName,
    mismatchReason: 'Повреждена упаковка',
    quantity: 10,
    unit: 'шт',
    status: 'ACTIVE',
  } });
  ids.returnId = returnRecord.id;
}

async function cleanupFixture() {
  const now = new Date();
  if (ids.returnId) await db.returnRecord.updateMany({ where: { id: ids.returnId }, data: { status: 'ARCHIVED', archivedAt: now, deletedAt: now } });
  if (ids.factoryId) await db.minimumStockItem.updateMany({ where: { factoryId: ids.factoryId }, data: { isActive: false, archivedAt: now } });
  if (ids.accessId) await db.userFactoryAccess.updateMany({ where: { id: ids.accessId }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение изолированной browser-проверки' } });
  if (ids.userId) await db.user.updateMany({ where: { id: ids.userId }, data: { blockedAt: now, deletedAt: now } });
  if (ids.departmentId) await db.department.updateMany({ where: { id: ids.departmentId }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной browser-проверки' } });
  if (ids.factoryId) await db.factory.updateMany({ where: { id: ids.factoryId }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной browser-проверки' } });

  const active = {
    factory: await db.factory.count({ where: { id: ids.factoryId, isActive: true, deletedAt: null } }),
    department: await db.department.count({ where: { id: ids.departmentId, isActive: true, deletedAt: null } }),
    user: await db.user.count({ where: { id: ids.userId, deletedAt: null } }),
    access: await db.userFactoryAccess.count({ where: { id: ids.accessId, isActive: true } }),
    item: await db.minimumStockItem.count({ where: { id: ids.itemId, isActive: true, archivedAt: null } }),
    returns: await db.returnRecord.count({ where: { id: ids.returnId, deletedAt: null } }),
  };
  if (Object.values(active).some((count) => count !== 0)) throw new Error(`STORE browser fixture cleanup failed: ${JSON.stringify(active)}`);
}

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`STORE login failed (${response.status})`);
  const token = body.accessToken ?? body.token;
  const factory = body.availableFactories?.find((entry: { code?: string }) => entry.code === factoryCode);
  if (!token || !factory?.id) throw new Error('Изолированный завод STORE недоступен после входа.');
  await page.goto(frontendUrl);
  await page.evaluate(({ authToken, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', authToken);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { authToken: token, factoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  return token as string;
}

async function firstVisible(page: Page, label: RegExp | string) {
  const buttons = page.getByRole('button', { name: label });
  for (let index = 0; index < await buttons.count(); index += 1) {
    if (await buttons.nth(index).isVisible()) return buttons.nth(index);
  }
  return null;
}

async function openScreen(page: Page, label: RegExp | string) {
  const direct = await firstVisible(page, label);
  if (direct) return direct.click();
  await page.locator('.mobile-more-button:visible').click();
  const inSheet = await firstVisible(page, label);
  if (!inSheet) throw new Error(`Раздел «${String(label)}» недоступен.`);
  await inSheet.click();
}

async function expectNoOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(metrics.body, metrics.document) - metrics.viewport, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
}

async function directApi(pathname: string, token: string, body: unknown) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-factory-id': ids.factoryId },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

test.beforeAll(setupFixture);
test.afterAll(async () => {
  await cleanupFixture();
  await db.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.alert = () => { throw new Error('alert запрещён'); };
    window.confirm = () => { throw new Error('confirm запрещён'); };
    window.prompt = () => { throw new Error('prompt запрещён'); };
  });
});

test('STORE uses Returns and balances without unrelated warehouse authority', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  const token = await login(page);

  await openScreen(page, 'Возвраты на производство');
  await expect(page.getByRole('heading', { name: 'Возвраты на производство', exact: true })).toBeVisible();
  const returnCard = page.locator('.returns-publication-card').filter({ hasText: returnName }).first();
  await expect(returnCard).toBeVisible();
  await returnCard.getByRole('button', { name: 'Открыть', exact: true }).click();
  const returnDialog = page.getByRole('dialog').filter({ hasText: returnName });
  await expect(returnDialog).toContainText('10 шт');
  await expect(returnDialog.getByRole('button', { name: 'Выдать часть', exact: true })).toBeVisible();
  await returnDialog.getByRole('button', { name: 'Выдать часть', exact: true }).click();
  const releaseSheet = page.getByRole('dialog').filter({ hasText: 'Выдать часть продукции' });
  await releaseSheet.getByLabel('Количество').fill('2');
  await releaseSheet.getByLabel('Комментарий').fill('Выдано в производство');
  await releaseSheet.getByRole('button', { name: 'Выдать 2 шт' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: returnName })).toContainText(/Осталось\s*8 шт/);
  await expect.poll(() => db.quantityReleaseOperation.count({ where: { sourceId: ids.returnId } })).toBe(1);
  await page.getByRole('dialog').filter({ hasText: returnName }).getByRole('button', { name: 'Закрыть', exact: true }).click();

  await openScreen(page, 'Заказы / Остатки');
  await expect(page.getByRole('heading', { name: 'Заказы / Остатки', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Новая позиция', exact: true })).toHaveCount(0);
  const itemCard = page.locator('.compact-record-card').filter({ hasText: itemName }).first();
  await expect(itemCard).toContainText('10 шт');
  await itemCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  let itemDialog = page.getByRole('dialog').filter({ hasText: itemName });
  await expect(itemDialog).toContainText('Количество: 10 шт');
  await expect(itemDialog.getByRole('button', { name: 'Израсходовать', exact: true })).toBeVisible();
  await expect(itemDialog.getByRole('button', { name: 'Пополнить', exact: true })).toBeVisible();
  await expect(itemDialog.getByRole('button', { name: /Редактировать|В архив|Заказать/ })).toHaveCount(0);

  await itemDialog.getByRole('button', { name: 'Израсходовать', exact: true }).click();
  let movementSheet = page.getByRole('dialog').filter({ hasText: 'Израсходовать' });
  await movementSheet.getByLabel('Количество, шт').fill('2');
  await movementSheet.getByLabel('Комментарий к расходу').fill('Выдано на участок');
  await movementSheet.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(itemDialog).toContainText('Количество: 8 шт');
  await expect(itemDialog).toContainText('Расход');

  await itemDialog.getByRole('button', { name: 'Пополнить', exact: true }).click();
  movementSheet = page.getByRole('dialog').filter({ hasText: 'Пополнить остаток' });
  await movementSheet.getByLabel('Количество, шт').fill('1');
  await movementSheet.getByLabel('Комментарий к пополнению').fill('Получено со склада');
  await movementSheet.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(itemDialog).toContainText('Количество: 9 шт');
  await expect(itemDialog).toContainText('Пополнение');
  await page.waitForTimeout(250);
  await itemDialog.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await expect(itemCard).toContainText('9 шт');
  await expect.poll(() => db.minimumStockMovement.count({ where: { itemId: ids.itemId } })).toBe(2);

  await page.getByRole('button', { name: 'Заявки на заказ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подать заявку', exact: true })).toHaveCount(0);
  const createDenied = await directApi('/orders/items', token, { name: 'Запрещённая позиция', unit: 'шт', minThreshold: 1, initialQuantity: 1 });
  expect(createDenied.status).toBe(403);
  expect(createDenied.text).toMatch(/Нет прав|Недостаточно прав/);
  expect(createDenied.text).not.toMatch(/orders\.items\.manage|Missing permission/i);
  const requestDenied = await directApi('/orders/requests', token, { title: 'Запрещённая заявка', unit: 'шт', reasonComment: 'Проверка', operationId: `${suffix}-forbidden-request` });
  expect(requestDenied.status).toBe(403);
  expect(requestDenied.text).not.toMatch(/orders\.request|Missing permission/i);

  const stockDefectResponse = await fetch(`${apiUrl}/stock?factoryId=${ids.factoryId}`, { headers: { authorization: `Bearer ${token}`, 'x-factory-id': ids.factoryId } });
  expect(stockDefectResponse.status).toBe(403);
  const navigationText = (await page.locator('.bottom-nav, .mobile-quick-nav, .mobile-nav-sheet').allInnerTexts()).join('\n');
  expect(navigationText).not.toContain('Некондиция');
  await expectNoOverflow(page);
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|authToken|Missing permission/i);
  expect(bodyText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  await page.screenshot({ path: path.join(screenshotDir, `${mobile ? 'mobile-390' : 'desktop'}-store-material-contract.png`), fullPage: true });
});
