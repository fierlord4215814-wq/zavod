import { expect, Page, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-handover-summary-correction-screenshots');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let factoryId = '';
let factoryName = '';
let departmentId = '';
let browserHandoverView: any = null;

function factoryTarget(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((item) => [item.type, item.value]));
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  if (hour >= 8 && hour < 20) return { shiftDate: dateKey, shiftType: 'DAY', shiftLabel: 'День' };
  if (hour >= 20) return { shiftDate: dateKey, shiftType: 'NIGHT', shiftLabel: 'Ночь' };
  const previous = new Date(`${dateKey}T12:00:00+03:00`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(previous);
  return { shiftDate: previousKey, shiftType: 'NIGHT', shiftLabel: 'Ночь' };
}

function addShift(target: ReturnType<typeof factoryTarget>, offset: number) {
  if (offset !== -1) throw new Error('fixture supports previous shift only');
  if (target.shiftType === 'NIGHT') return { shiftDate: target.shiftDate, shiftType: 'DAY', shiftLabel: 'День' };
  const date = new Date(`${target.shiftDate}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() - 1);
  return { shiftDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date), shiftType: 'NIGHT', shiftLabel: 'Ночь' };
}

function handoverId(target: { shiftDate: string; shiftType: string }) {
  const hex = createHash('sha256').update(`shift-handover:${factoryId}:${departmentId}:${target.shiftDate}:${target.shiftType}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  factoryName = `Проверка передачи смены ${suffix}`;
  const factory = await db.factory.create({ data: { code: `handover-${suffix}`, name: factoryName, isActive: true } });
  factoryId = factory.id;
  const department = await db.department.create({ data: { factoryId, code: `masters-${suffix}`, name: 'Мастера передачи смены' } });
  departmentId = department.id;
  await db.userFactoryAccess.create({ data: { userId: 'pilot-master-1', factoryId, departmentId, role: 'MASTER', isActive: true, isGuest: false } });
  const now = new Date();
  const line = await db.line.create({ data: { factoryId, name: 'Линия оперативной передачи', status: 'PAUSE' } });
  const event = await db.lineEvent.create({ data: { factoryId, lineId: line.id, createdById: 'pilot-master-1', status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: 'Проверить привод', createdAt: new Date(now.getTime() - 45 * 60_000) } });
  const task = await db.task.create({ data: { factoryId, lineId: line.id, lineStatusEventId: event.id, createdById: 'pilot-master-1', status: 'IN_PROGRESS', type: 'URGENT', description: 'Восстановить привод', createdAt: new Date(now.getTime() - 40 * 60_000), startedAt: new Date(now.getTime() - 35 * 60_000) } });
  await db.taskDepartmentRecipient.create({ data: { taskId: task.id, departmentId, factoryId, active: true } });
  const washLine = await db.line.create({ data: { factoryId, name: 'Линия на мойке', status: 'PAUSE' } });
  await db.lineEvent.create({ data: { factoryId, lineId: washLine.id, createdById: 'pilot-master-1', status: 'PAUSE', downtimeReason: 'WASH', comment: 'Линия передана на мойку', createdAt: new Date(now.getTime() - 52 * 60_000) } });
  const wash = await db.washSession.create({ data: { factoryId, lineId: washLine.id, targetType: 'LINE', startedById: 'pilot-master-1', status: 'REVIEW', createdAt: new Date(now.getTime() - 50 * 60_000) } });
  await db.washIssue.create({ data: { factoryId, washSessionId: wash.id, createdById: 'pilot-master-1', message: 'Повторно проверить пену', status: 'OPEN' } });
  await db.washSession.create({ data: { factoryId, targetType: 'OTHER', objectName: 'Площадка мойки', startedById: 'pilot-master-1', status: 'IN_PROGRESS', createdAt: new Date(now.getTime() - 48 * 60_000) } });
  await db.defrostEvent.create({ data: { factoryId, lineId: line.id, startedById: 'pilot-master-1', status: 'ACTIVE', eventType: 'DEFROST', comment: 'Контроль температуры', startAt: new Date(now.getTime() - 55 * 60_000) } });
  await db.okkRecord.create({ data: { factoryId, lineId: line.id, createdById: 'pilot-master-1', assignedMasterId: 'pilot-master-1', status: 'BLOCKED', description: 'Контроль продукта', productName: 'Тестовый продукт', mismatchReason: 'Проверить упаковку', defectQuantity: '1 шт' } });
  await db.auditLog.create({ data: { factoryId, userId: 'pilot-master-1', action: 'EMPLOYEE_SENT_HOME', entityType: 'User', entityId: 'pilot-worker-1', details: { comment: 'Плохое самочувствие' }, createdAt: new Date(now.getTime() - 30 * 60_000) } });
  await db.shiftLog.create({ data: { factoryId, departmentId, createdById: 'pilot-master-1', title: 'Важная запись', text: 'Проверить образец', isImportant: true, createdAt: new Date(now.getTime() - 25 * 60_000) } });

  const current = factoryTarget(now);
  const previous = addShift(current, -1);
  const previousSnapshot = {
    schema: 'zavod.shift-handover', version: 1, factoryId, departmentId, departmentName: department.name,
    shiftDate: previous.shiftDate, shiftType: previous.shiftType, shiftLabel: previous.shiftLabel,
    window: { from: now.toISOString(), to: now.toISOString() },
    nextShift: { shiftDate: current.shiftDate, shiftType: current.shiftType, shiftLabel: current.shiftLabel },
    generatedAt: new Date(now.getTime() - 60 * 60_000).toISOString(), authorId: 'pilot-master-1', authorName: 'Тестовый мастер 1',
    comment: 'Продолжить контроль линии',
    sections: {
      lines: [], tasks: [], defrosts: [], people: [], importantLogs: [],
      washes: [{ id: wash.id, washSessionId: wash.id, title: 'LEGACY_WASH_HIDDEN', status: 'REVIEW', statusLabel: 'На контроле' }],
      wash: [{ id: wash.id, title: 'LEGACY_WASH_ALIAS_HIDDEN', status: 'REVIEW', statusLabel: 'На контроле' }],
      okk: [{ id: 'legacy-okk-hidden', defectId: 'legacy-okk-hidden', title: 'LEGACY_OKK_HIDDEN', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
      quality: [{ id: 'legacy-quality-hidden', title: 'LEGACY_QUALITY_HIDDEN', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
      defects: [{ id: 'legacy-defect-hidden', title: 'LEGACY_DEFECT_HIDDEN', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
    },
    counts: { lines: 0, tasks: 0, washes: 1, wash: 1, defrosts: 0, okk: 1, quality: 1, defects: 1, people: 0, importantLogs: 0, total: 5 },
  };
  browserHandoverView = {
    snapshot: {
      ...previousSnapshot,
      shiftDate: current.shiftDate,
      shiftType: current.shiftType,
      shiftLabel: current.shiftLabel,
      nextShift: previousSnapshot.nextShift,
      comment: null,
    },
    logId: null,
    immutable: false,
    alreadyHandedOver: false,
  };
  await db.shiftLog.create({ data: { id: handoverId(previous), factoryId, departmentId, createdById: 'pilot-master-1', title: 'Автоматическая сводка передачи смены', text: `__ZAVOD_SHIFT_HANDOVER_V1__${JSON.stringify(previousSnapshot)}`, logDate: new Date(`${previous.shiftDate}T00:00:00+03:00`), shiftLabel: previous.shiftLabel } });
}

async function login(page: Page) {
  const diagnosticFactory = {
    id: factoryId,
    name: factoryName,
    code: `handover-${suffix}`,
    isActive: true,
    role: 'MASTER',
    departmentName: 'Мастера передачи смены',
    companyName: null,
    isGuest: false,
  };
  const exposeDiagnosticFactory = async (route: any) => {
    const response = await route.fetch();
    const payload = await response.json();
    const availableFactories = Array.isArray(payload.availableFactories)
      ? payload.availableFactories.filter((factory: { id?: string }) => factory.id !== factoryId)
      : [];
    await route.fulfill({ response, json: { ...payload, availableFactories: [...availableFactories, diagnosticFactory] } });
  };
  await page.route('**/auth/dev-login', exposeDiagnosticFactory);
  await page.route('**/auth/me', exposeDiagnosticFactory);
  await page.route('**/shift-log/handover/availability', async (route) => {
    expect(route.request().headers()['x-factory-id']).toBe(factoryId);
    await route.fulfill({ json: {
      available: true,
      shiftDate: browserHandoverView.snapshot.shiftDate,
      shiftType: browserHandoverView.snapshot.shiftType,
      opensAt: new Date().toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      message: 'Передача смены доступна.',
    } });
  });
  await page.route('**/shift-log/handover/summary', async (route) => {
    expect(route.request().headers()['x-factory-id']).toBe(factoryId);
    await route.fulfill({ json: browserHandoverView });
  });
  await page.route('**/shift-log/handover', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().headers()['x-factory-id']).toBe(factoryId);
    const submitted = route.request().postDataJSON();
    const snapshot = { ...browserHandoverView.snapshot, comment: submitted.comment ?? null };
    await route.fulfill({ json: {
      id: `browser-handover-${suffix}`,
      message: 'Смена передана следующей смене',
      alreadyHandedOver: false,
      handover: { snapshot, logId: `browser-handover-${suffix}`, immutable: true, alreadyHandedOver: true },
    } });
  });
  await page.goto(frontendUrl);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'pilot-master-1');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?handoverDiagnostics=${encodeURIComponent(suffix)}`);
  const shiftButton = page.getByRole('button', { name: /Смена/ }).filter({ visible: true });
  await expect(shiftButton.first()).toBeVisible({ timeout: 15_000 });
  await shiftButton.first().click();
  await expect(page.getByRole('button', { name: /Передать смену|Открыть передачу смены/ })).toBeVisible({ timeout: 15_000 });
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
  expect(text).not.toMatch(/Р С|РЎРѓ|Гђ|Г‘/);
}

async function expectExcludedHandoverCategoriesHidden(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('ОКК / Брак', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Нет активных записей ОКК|LEGACY_(?:OKK|QUALITY|DEFECT)/)).toHaveCount(0);
}

test.beforeAll(async () => setupFixture());
test.afterAll(async () => {
  if (factoryId) await db.factory.update({ where: { id: factoryId }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Handover browser E2E completed' } });
  await db.$disconnect();
});

test('mobile handover flow and next shift snapshot', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile only');
  await page.setViewportSize({ width: 360, height: 820 });
  await login(page);
  await page.getByRole('button', { name: 'Передать смену' }).click();
  await expect(page.getByText('Закрыть и передать смену')).toBeVisible();
  const handoverDialog = page.getByRole('dialog');
  await expect(handoverDialog.getByText('Линии в работе')).toBeVisible();
  await expect(handoverDialog.getByText('Мойка', { exact: true })).toBeVisible();
  await expect(handoverDialog.getByText('Простои и заявки')).toBeVisible();
  await expectExcludedHandoverCategoriesHidden(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-handover-minimal.png'), fullPage: false });
  const comment = page.getByLabel('Комментарий следующей смене');
  await comment.fill('Передать контроль следующему мастеру');
  await page.getByRole('button', { name: 'Обновить' }).click();
  await page.getByRole('button', { name: 'Передать следующей смене' }).click();
  await expect(page.getByText('Смена уже передана')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Закрыть' }).last().click();
  const previousCard = page.locator('.handover-received-card');
  await expect(previousCard).toBeVisible();
  await previousCard.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByText('Передано предыдущей сменой')).toBeVisible();
  await expectExcludedHandoverCategoriesHidden(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-next-shift-minimal.png'), fullPage: false });
  await expectNoOverflow(page);

  await page.setViewportSize({ width: 390, height: 820 });
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-handover.png'), fullPage: false });
  await expectExcludedHandoverCategoriesHidden(page);
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 430, height: 820 });
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-430-handover.png'), fullPage: false });
  await expectExcludedHandoverCategoriesHidden(page);
  await expectNoOverflow(page);
});

test('desktop handover summary opens', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'desktop only');
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.getByRole('button', { name: /Открыть передачу смены|Передать смену/ }).click();
  await expect(page.getByText('Закрыть и передать смену')).toBeVisible();
  await expectExcludedHandoverCategoriesHidden(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-handover.png'), fullPage: false });
  await expectNoOverflow(page);
});
