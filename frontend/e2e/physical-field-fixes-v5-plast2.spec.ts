import { expect, Locator, Page, test } from '@playwright/test';
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
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const numericSuffix = `${Date.now()}`.slice(-8);
const marker = `__PFFV5_P2_${runId}__`;
const screenshotDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast2', 'screenshots');
const artifactPath = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast2', 'test-artifacts.json');

let factoryId = '';
let otherFactoryId = '';
let departmentId = '';
let masterId = '';
let workerIds: string[] = [];
let currentLineId = '';
let currentLineName = '';
let templateAId = '';
let templateBId = '';
let washSessionId = '';
let washLineName = '';
let workAreaId = '';
let workAreaName = '';

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

function nextTarget(target = currentTarget()) {
  return target.shiftType === 'DAY'
    ? { shiftDate: target.shiftDate, shiftType: 'NIGHT' as const }
    : { shiftDate: addDays(target.shiftDate, 1), shiftType: 'DAY' as const };
}

function shiftWindow(target: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' }) {
  return target.shiftType === 'DAY'
    ? { from: new Date(`${target.shiftDate}T08:00:00+03:00`), to: new Date(`${target.shiftDate}T20:00:00+03:00`) }
    : { from: new Date(`${target.shiftDate}T20:00:00+03:00`), to: new Date(`${addDays(target.shiftDate, 1)}T08:00:00+03:00`) };
}

function workerLabel(index: number) {
  return `Работник ${numericSuffix}${index}`;
}

async function createUser(role: string, label: string, index?: number) {
  const id = index === undefined ? `pffv5p2-${label}-${numericSuffix}` : `worker-${numericSuffix}${index}`;
  await db.user.create({ data: { id, factoryId, role, employeeState: 'AVAILABLE' } });
  await db.userFactoryAccess.create({ data: { userId: id, factoryId, departmentId, role, isActive: true, isGuest: false } });
  return id;
}

async function createTemplate(lineId: string, name: string, items: Array<{ positionId: string; count: number }>) {
  const template = await db.lineStaffingTemplate.create({ data: { factoryId, lineId, name: `${marker} ${name}` } });
  for (const [index, item] of items.entries()) {
    await db.lineStaffingTemplateItem.create({
      data: {
        templateId: template.id,
        positionId: item.positionId,
        requiredCount: item.count,
        plannedCount: item.count,
        minRequired: item.count,
        maxRequired: item.count,
        sortOrder: index + 1,
      },
    });
  }
  return template;
}

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const factory = await db.factory.create({ data: { code: `pffv5-p2-ui-${numericSuffix}`, name: `${marker} Назначения`, isActive: true } });
  factoryId = factory.id;
  const otherFactory = await db.factory.create({ data: { code: `pffv5-p2-ui-other-${numericSuffix}`, name: `${marker} Другой завод`, isActive: true } });
  otherFactoryId = otherFactory.id;
  const department = await db.department.create({ data: { factoryId, code: `staff-${numericSuffix}`, name: `${marker} Производство` } });
  departmentId = department.id;
  await db.shiftSettings.create({ data: { factoryId, minAssignmentMoveIntervalMinutes: 0 } });
  masterId = await createUser('MASTER', 'master');
  workerIds = [];
  for (let index = 1; index <= 9; index += 1) workerIds.push(await createUser('WORKER', 'worker', index));

  const current = currentTarget();
  const future = nextTarget(current);
  const window = shiftWindow(current);
  await db.shiftSession.create({
    data: {
      factoryId,
      userId: masterId,
      startedById: masterId,
      startedAt: new Date(Math.max(window.from.getTime(), Date.now() - 60_000)),
      plannedEndAt: window.to,
      durationHours: 12,
      shiftType: current.shiftType,
      status: 'ACTIVE',
    },
  });
  await db.shiftSession.createMany({
    data: workerIds.map((userId) => ({
      factoryId,
      userId,
      startedById: masterId,
      startedAt: new Date(Math.max(window.from.getTime(), Date.now() - 60_000)),
      plannedEndAt: window.to,
      durationHours: 12,
      shiftType: current.shiftType,
      status: 'ACTIVE',
    })),
  });

  const line = await db.line.create({ data: { factoryId, name: `${marker} Линия состава`, status: 'WORK' } });
  currentLineId = line.id;
  currentLineName = line.name;
  const operator = await db.linePosition.create({ data: { factoryId, lineId: line.id, name: 'Оператор', displayName: 'Оператор', normalizedName: 'оператор', skillFamilyKey: 'operator', sortOrder: 1 } });
  const controller = await db.linePosition.create({ data: { factoryId, lineId: line.id, name: 'Контролёр', displayName: 'Контролёр', normalizedName: 'контролёр', skillFamilyKey: 'controller', sortOrder: 2 } });
  const templateA = await createTemplate(line.id, 'Состав А', [{ positionId: operator.id, count: 6 }]);
  const templateB = await createTemplate(line.id, 'Состав Б', [{ positionId: operator.id, count: 2 }, { positionId: controller.id, count: 1 }]);
  templateAId = templateA.id;
  templateBId = templateB.id;
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: templateA.id } });
  await db.lineShiftWorkPlan.create({
    data: {
      factoryId,
      lineId: line.id,
      staffingTemplateId: templateA.id,
      shiftDate: new Date(`${current.shiftDate}T00:00:00+03:00`),
      shiftType: current.shiftType,
      createdById: masterId,
    },
  });

  const washLine = await db.line.create({ data: { factoryId, name: `${marker} Линия мойки`, status: 'STOP' } });
  washLineName = washLine.name;
  const wash = await db.washSession.create({ data: { factoryId, lineId: washLine.id, targetType: 'LINE', startedById: masterId, status: 'IN_PROGRESS' } });
  washSessionId = wash.id;

  const area = await db.workArea.create({ data: { factoryId, departmentId, name: `${marker} Повременщики`, assignmentKind: 'TIME' } });
  workAreaId = area.id;
  workAreaName = area.name;
  await db.workAreaPosition.create({
    data: { workAreaId: area.id, title: 'Грузчик длинной производственной зоны', minRequired: 1, maxRequired: 3, defaultPlanned: 3, plannedCount: 3, isFlexible: true },
  });

  for (const userId of workerIds.slice(5, 8)) {
    await db.shiftWillBe.create({
      data: {
        factoryId,
        userId,
        targetShiftDate: new Date(`${future.shiftDate}T00:00:00+03:00`),
        shiftType: future.shiftType,
        status: 'WILL_BE',
        comment: marker,
      },
    });
  }
}

async function cleanupFixture() {
  if (!factoryId) return;
  const now = new Date();
  await db.assignment.updateMany({ where: { factoryId, endedAt: null }, data: { endedAt: now, comment: `${marker} штатное завершение` } });
  await db.plannedLineAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now, releasedById: masterId } });
  await db.plannedShiftAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now, releasedById: masterId } });
  await db.washSession.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: now } });
  await db.shiftSession.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now, endedById: masterId } });
  await db.workArea.updateMany({ where: { factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.department.updateMany({ where: { factoryId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.userFactoryAccess.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.factory.updateMany({ where: { id: { in: [factoryId, otherFactoryId] }, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.user.updateMany({ where: { id: { in: [masterId, ...workerIds] }, deletedAt: null }, data: { blockedAt: now, deletedAt: now, employeeState: 'OFF_SHIFT' } });

  const [factories, lines, workAreas, washes, assignments, plannedLine, plannedShift, accesses] = await Promise.all([
    db.factory.count({ where: { id: { in: [factoryId, otherFactoryId] }, isActive: true } }),
    db.line.count({ where: { factoryId, deactivatedAt: null } }),
    db.workArea.count({ where: { factoryId, isActive: true, deactivatedAt: null } }),
    db.washSession.count({ where: { factoryId, status: { not: 'DONE' } } }),
    db.assignment.count({ where: { factoryId, endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId, releasedAt: null } }),
    db.plannedShiftAssignment.count({ where: { factoryId, releasedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId, isActive: true } }),
  ]);
  const browserArtifacts = { factories, lines, workAreas, washes, assignments, plannedLine, plannedShift, accesses };
  const existing = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : {};
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    ...existing,
    browserRunMarker: marker,
    browserCleanupMode: 'soft-close/deactivate only',
    browserActiveArtifactsRemaining: browserArtifacts,
    browserPreexistingEntitiesDeleted: 0,
  }, null, 2)}\n`, 'utf8');
  if (Object.values(browserArtifacts).some((value) => value !== 0)) throw new Error(`PFFV5 P2 browser cleanup failed: ${JSON.stringify(browserArtifacts)}`);
}

async function login(page: Page, userId = masterId) {
  await page.goto(frontendUrl);
  await page.evaluate(({ currentUserId, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', currentUserId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { currentUserId: userId, selectedFactoryId: factoryId });
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
  await page.locator('.mobile-more-button:visible').click();
  await page.locator('.mobile-sheet-item').filter({ hasText: name }).first().click();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function surfaceFitsViewport(page: Page, surface: Locator) {
  const metrics = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const offenders = Array.from(element.querySelectorAll<HTMLElement>('*'))
      .map((child) => {
        const childRect = child.getBoundingClientRect();
        return {
          tag: child.tagName,
          className: child.className,
          left: Math.round(childRect.left - rect.left),
          right: Math.round(childRect.right - rect.right),
          overflow: child.scrollWidth - child.clientWidth,
        };
      })
      .filter((child) => child.left < -2 || child.right > 2 || child.overflow > 2)
      .slice(0, 8);
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      scrollLeft: element.scrollLeft,
      offenders,
    };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.horizontalOverflow, JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(2);
  expect(metrics.scrollLeft).toBe(0);
}

async function stickyFooterLeavesLastItemVisible(surface: Locator, item: Locator, footer: Locator) {
  const maxScroll = await surface.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollHeight - element.clientHeight;
  });
  if (maxScroll > 1) await expect.poll(async () => surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const boxes = await Promise.all([item.boundingBox(), footer.boundingBox()]);
  expect(boxes[0]).toBeTruthy();
  expect(boxes[1]).toBeTruthy();
  expect((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0)).toBeLessThanOrEqual((boxes[1]?.y ?? 0) + 2);
}

async function openShiftLine(page: Page) {
  await openMainScreen(page, 'Смена');
  const card = page.locator('.current-shift-line-card').filter({ hasText: currentLineName }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: currentLineName });
  await expect(dashboard).toBeVisible();
  return dashboard;
}

async function assignFreeSlot(page: Page, workerIndex: number, slotIndex: number) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: currentLineName });
  const slot = dashboard.locator('.compact-line-slot-list .slot-row').filter({ hasText: `Оператор #${slotIndex}` });
  await slot.getByRole('button', { name: 'Назначить', exact: true }).click();
  const picker = page.getByTestId('slot-first-person-picker');
  await expect(picker).toBeVisible();
  const candidate = picker.locator('.candidate-card').filter({ hasText: workerLabel(workerIndex) });
  await expect(candidate).toBeVisible();
  await candidate.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(dashboard).toContainText(workerLabel(workerIndex));
}

async function closeDashboard(page: Page) {
  const dashboard = page.locator('.compact-line-dashboard');
  if (await dashboard.count()) await dashboard.locator('.line-dashboard-footer').getByRole('button', { name: 'Закрыть', exact: true }).click();
}

async function oneFingerScroll(page: Page, locatorSelector: string) {
  const locator = page.locator(locatorSelector).first();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { touchAction: computed.touchAction, overflowY: computed.overflowY, before: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  });
  expect(style.touchAction).toMatch(/pan-y|auto/);
  expect(style.max).toBeGreaterThan(20);
  const session = await page.context().newCDPSession(page);
  const x = Math.round((box?.x ?? 0) + (box?.width ?? 1) / 2);
  const startY = Math.round((box?.y ?? 0) + Math.min((box?.height ?? 400) - 60, 500));
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  for (const delta of [30, 60, 90, 120, 150]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - delta }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const after = await locator.evaluate((element) => element.scrollTop);
  expect(after).toBeGreaterThan(style.before);
}

test.beforeAll(async () => setupFixture());
test.afterAll(async () => {
  await cleanupFixture();
  await db.$disconnect();
});

test('master completes canonical current, wash, work-area and future routes at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const dashboard = await openShiftLine(page);
  await expect(page.locator('body')).toHaveClass(/app-scroll-locked/);
  const firstSlot = dashboard.locator('.compact-line-slot-list .slot-row').filter({ hasText: 'Оператор #1' });
  await firstSlot.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(page.getByTestId('slot-first-person-picker')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(page.getByTestId('slot-first-person-picker')).toHaveCount(0);
  await expect(dashboard).toBeVisible();

  await assignFreeSlot(page, 1, 1);
  const secondSlot = dashboard.locator('.compact-line-slot-list .slot-row').filter({ hasText: 'Оператор #2' });
  await secondSlot.getByRole('button', { name: 'Назначить', exact: true }).click();
  const parentScrollBefore = await dashboard.evaluate((element) => {
    element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  const secondCandidate = page.getByTestId('slot-first-person-picker').locator('.candidate-card').filter({ hasText: workerLabel(2) });
  await secondCandidate.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(page.getByTestId('slot-first-person-picker')).toHaveCount(0);
  await expect(dashboard).toContainText(workerLabel(2));
  await expect.poll(() => dashboard.evaluate((element) => element.scrollTop)).toBe(parentScrollBefore);
  await oneFingerScroll(page, '.compact-line-dashboard');
  await surfaceFitsViewport(page, dashboard);
  await page.screenshot({ path: path.join(screenshotDir, '01-current-line-context-390.png'), fullPage: false });

  await closeDashboard(page);
  await openMainScreen(page, 'Линии');
  const lineCard = page.locator('.line-card').filter({ hasText: currentLineName }).first();
  await lineCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const lineDetail = page.getByRole('dialog', { name: new RegExp(`Подробнее о линии ${currentLineName}`) });
  await expect(lineDetail).toContainText(workerLabel(1));
  await lineDetail.getByRole('button', { name: 'Состав и люди', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  await expect(page.locator('.compact-line-dashboard').filter({ hasText: currentLineName })).toBeVisible();
  await assignFreeSlot(page, 3, 3);

  await closeDashboard(page);
  await page.getByRole('button', { name: 'Люди на смене', exact: false }).first().click();
  const peopleSheet = page.locator('#shift-people-panel');
  const personCard = peopleSheet.locator('.workforce-person-card').filter({ hasText: workerLabel(4) });
  await personCard.getByRole('button', { name: 'Назначить', exact: true }).click();
  const targetSheet = page.locator('.assignment-target-sheet').filter({ hasText: 'Куда назначить?' });
  await targetSheet.getByRole('button', { name: /Линия/ }).first().click();
  const linePicker = page.getByRole('dialog').filter({ hasText: 'Выберите линию' });
  await linePicker.locator('.shift-picker-option').filter({ hasText: currentLineName }).click();
  const personFirst = page.getByTestId('person-first-slot-picker');
  await expect(personFirst).toContainText(workerLabel(4));
  await personFirst.locator('.slot-row').filter({ hasText: 'Оператор #4' }).getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(personFirst).toHaveCount(0);
  await expect(page.locator('.compact-line-dashboard')).toContainText(workerLabel(4));

  const currentDashboard = page.locator('.compact-line-dashboard');
  await currentDashboard.locator('#line-runtime-stats').evaluate((element: HTMLDetailsElement) => { element.open = true; });
  await currentDashboard.locator('#active-template').selectOption(templateBId);
  const remapDialog = page.getByRole('dialog').filter({ hasText: 'Проверка смены шаблона' });
  await expect(remapDialog).toBeVisible();
  const releasedMetric = remapDialog.locator('.work-area-slot-summary > span').filter({ hasText: 'Освободятся' });
  await expect(releasedMetric).toContainText('2');
  await expect(remapDialog).toContainText(workerLabel(3));
  await expect(remapDialog).toContainText(workerLabel(4));
  await remapDialog.getByRole('button', { name: 'Применить шаблон', exact: true }).click();
  await expect(remapDialog).toHaveCount(0);
  await expect(currentDashboard).toContainText(`${marker} Состав Б`);
  await expect.poll(async () => (await db.line.findUnique({ where: { id: currentLineId }, select: { defaultStaffingTemplateId: true } }))?.defaultStaffingTemplateId).toBe(templateBId);
  expect(await db.assignment.count({ where: { factoryId, lineId: currentLineId, endedAt: null } })).toBe(2);
  await surfaceFitsViewport(page, currentDashboard);
  await page.screenshot({ path: path.join(screenshotDir, '02-template-remap-390.png'), fullPage: false });

  await closeDashboard(page);
  await expect(peopleSheet).toBeVisible();
  await peopleSheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(peopleSheet).toHaveCount(0);
  const areaCard = page.locator('.work-area-card').filter({ hasText: workAreaName });
  await areaCard.getByRole('button', { name: 'Открыть повременщиков', exact: true }).click();
  const areaBoard = page.locator('.work-area-assignment-board');
  await expect(areaBoard).toContainText('Требуется');
  await expect(areaBoard).toContainText('Свободных мест');
  const areaSlot = areaBoard.locator('.slot-row').first();
  await areaSlot.getByRole('button', { name: 'Выбрать сотрудника', exact: true }).click();
  const areaPicker = page.getByRole('dialog').filter({ hasText: 'Выберите сотрудника' });
  const areaCandidate = areaPicker.locator('.candidate-card').filter({ hasText: workerLabel(3) });
  await areaCandidate.getByRole('button', { name: /Назначить|Переставить/ }).click();
  if (await areaPicker.getByRole('button', { name: 'Подтвердить перестановку', exact: true }).count()) {
    await areaPicker.getByRole('button', { name: 'Подтвердить перестановку', exact: true }).click();
  }
  await expect(areaBoard).toContainText(workerLabel(3));
  await surfaceFitsViewport(page, areaBoard);
  await stickyFooterLeavesLastItemVisible(areaBoard, areaBoard.locator('.slot-row').last(), areaBoard.locator('.modal-actions').last());
  await areaBoard.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
  await page.screenshot({ path: path.join(screenshotDir, '03-work-area-390.png'), fullPage: false });

  await areaBoard.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await openMainScreen(page, 'Мойка');
  const washCard = page.locator('.wash-session-card').filter({ hasText: washLineName }).first();
  await washCard.getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.getByRole('tab', { name: 'Люди', exact: true }).click();
  await page.getByRole('button', { name: 'Назначить сотрудника', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  const washPeople = page.locator('#shift-people-panel');
  const washCandidateCard = washPeople.locator('.workforce-person-card').filter({ hasText: workerLabel(4) });
  await washCandidateCard.getByRole('button', { name: /Назначить|Переназначить/ }).click();
  await page.locator('.assignment-target-sheet').filter({ hasText: 'Куда назначить?' }).getByRole('button', { name: /Мойка/ }).first().click();
  const washAssignDialog = page.getByRole('dialog').filter({ hasText: workerLabel(4) }).last();
  await washAssignDialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect.poll(() => db.assignment.count({ where: { factoryId, userId: workerIds[3], washSessionId, endedAt: null } })).toBe(1);
  await expect(washPeople).toBeVisible();
  await washPeople.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(washPeople).toHaveCount(0);

  await page.locator('.shift-selector-compact').click();
  await page.getByRole('dialog').filter({ hasText: 'Выбрать смену' }).getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Добавить линию в план' }).locator('.line-plan-button').filter({ hasText: currentLineName }).click();
  const planningBoard = page.getByRole('dialog').filter({ hasText: 'Плановые слоты' });
  await expect(planningBoard.locator('#planning-template')).toHaveValue(templateBId);
  await expect(planningBoard.locator('.tag').filter({ hasText: 'Запланирована' })).toBeVisible();
  await expect(planningBoard.locator('.tag.work').filter({ hasText: 'Работает' })).toHaveCount(0);
  for (const [slotIndex, workerIndex] of [[1, 6], [2, 7]] as const) {
    await planningBoard.locator('.slot-row').filter({ hasText: `Оператор #${slotIndex}` }).getByRole('button', { name: 'Выбрать слот', exact: true }).click();
    const futureCandidate = planningBoard.locator('.candidate-card').filter({ hasText: workerLabel(workerIndex) });
    await futureCandidate.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await planningBoard.locator('.sticky-actions').getByRole('button', { name: new RegExp(`Назначить: ${workerLabel(workerIndex)}`) }).click();
    await expect(planningBoard).toContainText(workerLabel(workerIndex));
  }
  const planningSurface = planningBoard.locator('.modal-card.line-dashboard-card').first();
  const planningScroll = planningSurface.locator('.planning-assignment-scroll');
  await surfaceFitsViewport(page, planningSurface);
  await surfaceFitsViewport(page, planningScroll);
  await stickyFooterLeavesLastItemVisible(planningScroll, planningSurface.locator('.candidate-card').last(), planningSurface.locator('.modal-actions').last());
  await planningScroll.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
  await page.screenshot({ path: path.join(screenshotDir, '04-future-plan-390.png'), fullPage: false });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  expect(await db.plannedLineAssignment.count({ where: { factoryId, lineId: currentLineId, releasedAt: null } })).toBe(2);
  expect(await db.assignment.count({ where: { factoryId, userId: { in: [workerIds[5], workerIds[6]] }, endedAt: null } })).toBe(0);
  await noHorizontalOverflow(page);
});

test('worker sees assignment data without mutation controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, workerIds[0]);
  await openMainScreen(page, 'Смена');
  await expect(page.getByTestId('shift-readonly-lines')).toContainText(currentLineName);
  await expect(page.getByRole('button', { name: /Назначить|Переназначить|Освободить/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test('360 and 430 layout keeps assignment surfaces inside viewport', async ({ page }) => {
  await login(page);
  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const dashboard = await openShiftLine(page);
    await noHorizontalOverflow(page);
    const longWords = await dashboard.locator('.slot-row strong').evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth + 2));
    expect(longWords).toBe(false);
    const footer = dashboard.locator('.line-dashboard-footer');
    const footerBox = await footer.boundingBox();
    expect(footerBox?.y ?? 0).toBeLessThanOrEqual(844);
    await closeDashboard(page);
  }
  await expect(page.locator('body')).not.toHaveClass(/app-scroll-locked/);
});
