import { expect, Page, test } from '@playwright/test';
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
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const marker = `__PFFV5_P1_${runId}__`;

let factoryId = '';
let departmentId = '';
let masterId = '';
let workerId = '';
let stopWorkerId = '';
let archiveWorkerId = '';
let archiveLineName = '';
let stableRunningName = '';
let startLineName = '';
let downtimeLineName = '';
let washLineName = '';
let stopLineName = '';
let plannedStoppedName = '';

function factoryDateKey(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return factoryDateKey(date);
}

function currentTarget(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const shiftDate = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  if (hour >= 8 && hour < 20) return { shiftDate, shiftType: 'DAY' as const };
  if (hour >= 20) return { shiftDate, shiftType: 'NIGHT' as const };
  return { shiftDate: addDays(shiftDate, -1), shiftType: 'NIGHT' as const };
}

function addShift(target: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' }, offset: number) {
  let result = { ...target };
  const step = offset >= 0 ? 1 : -1;
  for (let index = 0; index < Math.abs(offset); index += 1) {
    if (step > 0) result = result.shiftType === 'DAY'
      ? { shiftDate: result.shiftDate, shiftType: 'NIGHT' as const }
      : { shiftDate: addDays(result.shiftDate, 1), shiftType: 'DAY' as const };
    else result = result.shiftType === 'NIGHT'
      ? { shiftDate: result.shiftDate, shiftType: 'DAY' as const }
      : { shiftDate: addDays(result.shiftDate, -1), shiftType: 'NIGHT' as const };
  }
  return result;
}

function shiftWindow(target: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' }) {
  return target.shiftType === 'DAY'
    ? { from: new Date(`${target.shiftDate}T08:00:00+03:00`), to: new Date(`${target.shiftDate}T20:00:00+03:00`) }
    : { from: new Date(`${target.shiftDate}T20:00:00+03:00`), to: new Date(`${addDays(target.shiftDate, 1)}T08:00:00+03:00`) };
}

async function createUser(role: string, label: string, employeeState = 'AVAILABLE') {
  const id = `test-pffv5-p1-${label}-${suffix}`;
  await db.user.create({ data: { id, factoryId, role, employeeState } });
  await db.userFactoryAccess.create({ data: { userId: id, factoryId, departmentId, role, isActive: true, isGuest: false } });
  return id;
}

async function createLine(name: string, status: 'WORK' | 'PAUSE' | 'STOP', createdAt?: Date) {
  return db.line.create({ data: { factoryId, name: `${marker} ${name}`, status, ...(createdAt ? { createdAt } : {}) } });
}

async function addComposition(lineId: string, requiredCount: number, target = currentTarget()) {
  const position = await db.linePosition.create({ data: { factoryId, lineId, name: 'Оператор', displayName: 'Оператор', sortOrder: 1 } });
  const template = await db.lineStaffingTemplate.create({ data: { factoryId, lineId, name: `${marker} Основной состав` } });
  await db.lineStaffingTemplateItem.create({ data: { templateId: template.id, positionId: position.id, requiredCount, plannedCount: requiredCount, minRequired: requiredCount, maxRequired: requiredCount } });
  const plan = await db.lineShiftWorkPlan.create({
    data: { factoryId, lineId, staffingTemplateId: template.id, shiftDate: new Date(`${target.shiftDate}T00:00:00+03:00`), shiftType: target.shiftType, createdById: masterId },
  });
  return { position, template, plan };
}

async function setupFixture() {
  const factory = await db.factory.create({ data: { code: `pffv5-p1-e2e-${suffix}`, name: `${marker} Browser`, isActive: true } });
  factoryId = factory.id;
  const department = await db.department.create({ data: { factoryId, code: `masters-${suffix}`, name: `${marker} Мастера` } });
  departmentId = department.id;
  masterId = await createUser('MASTER', 'master');
  workerId = await createUser('WORKER', 'worker', 'ASSIGNED');
  stopWorkerId = await createUser('WORKER', 'stop-worker', 'ASSIGNED');
  archiveWorkerId = await createUser('WORKER', 'archive-worker');

  const stableRunning = await createLine('Рабочая линия', 'WORK');
  stableRunningName = stableRunning.name;
  const stableComposition = await addComposition(stableRunning.id, 1);
  await db.assignment.create({ data: { factoryId, lineId: stableRunning.id, userId: workerId, kind: 'LINE', positionId: stableComposition.position.id, staffingTemplateId: stableComposition.template.id, slotIndex: 1, startedById: masterId } });

  const startLine = await createLine('Линия запуска и простоя', 'STOP');
  startLineName = startLine.name;
  await addComposition(startLine.id, 1);

  const downtimeLine = await createLine('Стабильная линия простоя', 'PAUSE');
  downtimeLineName = downtimeLine.name;
  await addComposition(downtimeLine.id, 1);
  await db.lineEvent.create({ data: { factoryId, lineId: downtimeLine.id, createdById: masterId, status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker} Активный простой` } });

  const washLine = await createLine('Линия для мойки', 'STOP');
  washLineName = washLine.name;

  const stopLine = await createLine('Линия остановки', 'WORK');
  stopLineName = stopLine.name;
  const stopComposition = await addComposition(stopLine.id, 1);
  await db.assignment.create({ data: { factoryId, lineId: stopLine.id, userId: stopWorkerId, kind: 'LINE', positionId: stopComposition.position.id, staffingTemplateId: stopComposition.template.id, slotIndex: 1, startedById: masterId } });

  const plannedStopped = await createLine('Плановая остановленная линия', 'STOP');
  plannedStoppedName = plannedStopped.name;
  await addComposition(plannedStopped.id, 1);

  const previous = addShift(currentTarget(), -1);
  const window = shiftWindow(previous);
  const archiveLine = await createLine('Архивная линия', 'STOP', new Date(window.from.getTime() - 86_400_000));
  archiveLineName = archiveLine.name;
  const archiveComposition = await addComposition(archiveLine.id, 1, previous);
  const at = (hours: number) => new Date(window.from.getTime() + hours * 3_600_000);
  await db.shiftSession.create({ data: { factoryId, userId: masterId, startedAt: at(0.1), endedAt: at(11.9), shiftType: previous.shiftType, status: 'ENDED', startedById: masterId, endedById: masterId, durationHours: 12, plannedEndAt: window.to } });
  await db.lineEvent.createMany({ data: [
    { factoryId, lineId: archiveLine.id, createdById: masterId, status: 'WORK', comment: `${marker} Работа`, createdAt: at(-1), confirmedEndAt: at(-1) },
    { factoryId, lineId: archiveLine.id, createdById: masterId, status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker} Простой`, createdAt: at(2), confirmedEndAt: at(3) },
    { factoryId, lineId: archiveLine.id, createdById: masterId, status: 'WORK', comment: `${marker} Возобновление`, createdAt: at(3), confirmedEndAt: at(3) },
    { factoryId, lineId: archiveLine.id, createdById: masterId, status: 'STOP', comment: `${marker} Завершение`, createdAt: at(7) },
  ] });
  await db.assignment.create({ data: { factoryId, lineId: archiveLine.id, userId: archiveWorkerId, kind: 'LINE', positionId: archiveComposition.position.id, staffingTemplateId: archiveComposition.template.id, slotIndex: 1, startedById: masterId, endedById: masterId, startedAt: at(1), endedAt: at(6) } });
  await db.lineShiftWorkPlanRow.create({ data: { workPlanId: archiveComposition.plan.id, sortOrder: 1, article: 'PFFV5', productName: 'Архивный продукт', plannedGofrCount: 10 } });
  await db.line.update({ where: { id: archiveLine.id }, data: { deactivatedAt: new Date(), deactivationReason: `${marker} отключена после смены` } });
}

async function cleanupFixture() {
  if (!factoryId) return;
  const now = new Date();
  await db.assignment.updateMany({ where: { factoryId, endedAt: null }, data: { endedAt: now, comment: `${marker} завершение E2E` } });
  await db.washSession.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: now } });
  await db.defrostEvent.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endAt: now, durationSeconds: 0 } });
  await db.lineEvent.updateMany({ where: { factoryId, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null }, data: { confirmedEndAt: now } });
  await db.shiftSession.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now } });
  await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { deactivatedAt: now, deactivationReason: `${marker} E2E завершён` } });
  await db.userFactoryAccess.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} E2E завершён` } });
  await db.factory.update({ where: { id: factoryId }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} E2E завершён` } });
  await db.user.updateMany({ where: { id: { in: [masterId, workerId, stopWorkerId, archiveWorkerId] } }, data: { deletedAt: now, blockedAt: now, employeeState: 'OFF_SHIFT' } });
  const activeCounts = await Promise.all([
    db.factory.count({ where: { id: factoryId, isActive: true } }),
    db.line.count({ where: { factoryId, deactivatedAt: null } }),
    db.washSession.count({ where: { factoryId, status: { not: 'DONE' } } }),
    db.assignment.count({ where: { factoryId, endedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId, isActive: true } }),
  ]);
  if (activeCounts.some((count) => count !== 0)) throw new Error(`PFFV5 cleanup failed: ${activeCounts.join(',')}`);
}

async function login(page: Page, userId = masterId) {
  await page.goto(frontendUrl);
  await page.evaluate(({ userId, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { userId, selectedFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Онлайн', { exact: false }).first()).toBeVisible();
}

async function openMainScreen(page: Page, name: string) {
  const navigation = page.locator('nav[aria-label="Основная навигация"]:visible');
  const direct = navigation.getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).first();
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.locator('.mobile-sheet-item').filter({ hasText: name }).first().click();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

function lineCard(page: Page, name: string) {
  return page.locator('.line-card').filter({ hasText: name }).first();
}

function shiftLineCard(page: Page, name: string) {
  return page.locator('.lines-active-section article').filter({ hasText: name }).first();
}

async function closeLineDetail(page: Page) {
  const detail = page.locator('[role="dialog"][aria-label^="Подробнее о линии"]');
  if (await detail.count()) await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
}

async function confirmLineAction(page: Page, comment?: string) {
  const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('button', { name: 'Подтвердить', exact: true }) }).last();
  await expect(modal).toBeVisible();
  if (comment !== undefined) await modal.getByLabel('Комментарий').fill(comment);
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(modal).toHaveCount(0);
}

async function assertShiftOrder(page: Page) {
  const headings = ['Линии в работе', 'Повременщики и рабочие зоны', 'Линии на мойке', 'Остановленные линии'];
  const positions = [];
  for (const heading of headings) {
    const locator = page.getByRole('heading', { name: heading, exact: true });
    await expect(locator).toBeVisible();
    positions.push((await locator.boundingBox())?.y ?? -1);
  }
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  expect(positions[2]).toBeLessThan(positions[3]);
}

async function expectProductionStaffingCounter(page: Page, value: string) {
  const counter = page.getByTestId('production-staffing-counter');
  await expect(counter).toBeVisible();
  await expect(counter).toContainText('На производственных линиях:');
  await expect(counter).toContainText(value);
}

test.beforeAll(async () => setupFixture());
test.afterAll(async () => {
  await cleanupFixture();
  await db.$disconnect();
});

test('canonical current state stays equal through UI transitions', async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openMainScreen(page, 'Смена');
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  await assertShiftOrder(page);
  await expectProductionStaffingCounter(page, '2 из 5');
  await expect(page.locator('.lines-active-section')).toContainText(stableRunningName);
  await expect(page.locator('.lines-active-section')).toContainText(downtimeLineName);
  await expect(page.locator('.lines-stopped-section')).toContainText(startLineName);
  await expect(page.locator('.lines-active-section .section-subhead')).toContainText('3');
  await expect(page.locator('.lines-wash-section .section-subhead')).toContainText('0');
  await expect(page.locator('.lines-stopped-section .section-subhead')).toContainText('3');
  await expect(shiftLineCard(page, stableRunningName)).toContainText('Работает');
  await expect(shiftLineCard(page, stableRunningName)).toContainText('Люди 1/1');
  await expect(shiftLineCard(page, downtimeLineName)).toContainText('Простой');
  await expect(shiftLineCard(page, downtimeLineName)).toContainText('Люди 0/1');

  await openMainScreen(page, 'Линии');
  await expect(page.getByRole('heading', { name: 'Линии', exact: true })).toBeVisible();
  await expect(page.locator('.line-state-section.work')).toContainText('Линии в работе — 2');
  await expect(page.locator('.line-state-section.downtime')).toContainText('Простой — 1');
  await expect(page.locator('.line-state-section.wash')).toContainText('Производится мойка — 0');
  await expect(page.locator('.line-state-section.stopped')).toContainText('Остановленные линии — 3');
  await expect(lineCard(page, stableRunningName)).toContainText('Работает');
  await expect(lineCard(page, stableRunningName)).toContainText('Людей: 1');
  await expect(lineCard(page, downtimeLineName)).toContainText('Простой');
  await expect(lineCard(page, downtimeLineName)).toContainText('Людей: 0');
  await lineCard(page, startLineName).getByRole('button', { name: 'Вернуть в работу', exact: true }).click();
  await confirmLineAction(page);
  await closeLineDetail(page);
  await expect(lineCard(page, startLineName)).toContainText('Работает');

  await lineCard(page, startLineName).getByRole('button', { name: 'Простой', exact: true }).click();
  await confirmLineAction(page, 'Проверка единого простоя');
  await closeLineDetail(page);
  await expect(lineCard(page, startLineName)).toContainText('Простой');

  await openMainScreen(page, 'Мойка');
  await page.getByRole('button', { name: 'Начать мойку', exact: true }).first().click();
  const washModal = page.locator('.modal-backdrop').filter({ has: page.getByRole('heading', { name: 'Начать мойку', exact: true }) });
  await expect(washModal).toBeVisible();
  await washModal.getByLabel('Остановленная линия').selectOption({ label: washLineName });
  await washModal.getByRole('button', { name: 'Начать мойку', exact: true }).click();
  await expect(washModal).toHaveCount(0);
  await expect(page.getByText(washLineName, { exact: true }).first()).toBeVisible();

  await openMainScreen(page, 'Линии');
  await expect(page.locator('.line-state-section.wash')).toContainText(washLineName);
  await expect(page.locator('.line-state-section.wash').getByText(washLineName, { exact: true })).toHaveCount(1);

  await lineCard(page, stopLineName).getByRole('button', { name: 'Остановить', exact: true }).click();
  await confirmLineAction(page, 'Штатная остановка с освобождением');
  await closeLineDetail(page);
  await expect(lineCard(page, stopLineName)).toContainText('Остановлена');
  const closedAssignment = await db.assignment.findFirst({ where: { factoryId, userId: stopWorkerId, lineId: { not: null } }, orderBy: { startedAt: 'desc' } });
  expect(closedAssignment?.endedAt).toBeTruthy();

  await lineCard(page, stopLineName).getByRole('button', { name: 'Вернуть в работу', exact: true }).click();
  await confirmLineAction(page);
  const detail = page.locator('[role="dialog"][aria-label^="Подробнее о линии"]');
  await expect(detail).toContainText('Оператор');
  await expect(detail).toContainText('Позиция свободна');
  await expect(detail).not.toContainText(stopWorkerId);
  await closeLineDetail(page);

  await openMainScreen(page, 'Смена');
  await assertShiftOrder(page);
  await expectProductionStaffingCounter(page, '1 из 5');
  await expect(page.locator('.lines-active-section')).toContainText(startLineName);
  await expect(page.locator('.lines-active-section')).toContainText(stopLineName);
  await expect(page.locator('.lines-wash-section')).toContainText(washLineName);
  await expect(page.locator('.lines-stopped-section')).toContainText(plannedStoppedName);
  await expect(page.locator('.lines-wash-section').getByText(washLineName, { exact: true })).toHaveCount(1);

  await page.reload({ waitUntil: 'networkidle' });
  await expectProductionStaffingCounter(page, '1 из 5');
  await expect(page.locator('.lines-wash-section')).toContainText(washLineName);
  await noHorizontalOverflow(page);
});

test('archived shift is complete and read-only', async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openMainScreen(page, 'Смена');
  await page.locator('.shift-selector-compact').click();
  const picker = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await picker.getByRole('button', { name: /Прошлая смена/ }).click();
  await expect(page.locator('.archive-shift-card').getByRole('heading', { name: /Прошлые смены$/ })).toBeVisible();
  await page.locator('.past-shift-card').first().click();
  const pastDetail = page.locator('.past-shift-detail');
  await expect(pastDetail).toBeVisible();
  await expect(pastDetail).toContainText('режим только для просмотра');
  await pastDetail.getByRole('button', { name: 'Линии', exact: true }).click();
  const archivedLine = pastDetail.locator('.past-line-row').filter({ hasText: archiveLineName });
  await expect(archivedLine).toBeVisible();
  await expect(archivedLine).toContainText('Состав:');
  await expect(archivedLine).toContainText('Только просмотр');
  await expect(pastDetail.getByRole('button', { name: /Запустить|Остановить|Назначить/ })).toHaveCount(0);
  await expect(pastDetail).not.toContainText(stableRunningName);
  await noHorizontalOverflow(page);
});

test('worker sees canonical state without line controls', async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 390, height: 844 });
  await login(page, workerId);
  await openMainScreen(page, 'Смена');
  const readonlyShift = page.getByTestId('shift-readonly-lines');
  await expect(readonlyShift).toBeVisible();
  await expect(readonlyShift).toContainText(stableRunningName);
  await expect(readonlyShift.getByRole('button', { name: /Простой|Остановить|Вернуть в работу/ })).toHaveCount(0);

  const navigation = page.locator('nav[aria-label="Основная навигация"]:visible');
  await expect(navigation.getByRole('button', { name: /^Линии(?:\s|$)/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test('360 and 430 layout smoke keeps groups inside viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Дополнительные mobile widths выполняются один раз');
  await login(page);
  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await openMainScreen(page, 'Смена');
    await assertShiftOrder(page);
    await noHorizontalOverflow(page);
    await openMainScreen(page, 'Линии');
    await expect(page.getByRole('heading', { name: 'Линии', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
  }
});
