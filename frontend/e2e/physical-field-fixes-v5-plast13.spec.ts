import { expect, Page, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { factoryShiftDate, factoryShiftTarget } = require('../../backend/dist/common/shift-time');
const db = new PrismaClient();

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5174';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3100';
const clockFile = process.env.P13_CLOCK_FILE ?? '';
const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast13');
const startedAtMs = Date.now();
const runId = `${startedAtMs}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P13_${runId}__`;
const suffix = String(startedAtMs).slice(-8);

type FixtureState = {
  mainFactoryId: string;
  unauthorizedFactoryId: string;
  factoryIds: string[];
  adminId: string;
  masterId: string;
  managementId: string;
  workerIds: string[];
  userIds: string[];
  lineIds: string[];
  positionIds: string[];
  templateIds: string[];
  emptyLineId: string;
  populatedLineId: string;
  mainFactoryName: string;
  unauthorizedFactoryName: string;
};

const state: FixtureState = {
  mainFactoryId: '',
  unauthorizedFactoryId: '',
  factoryIds: [],
  adminId: '',
  masterId: '',
  managementId: '',
  workerIds: [],
  userIds: [],
  lineIds: [],
  positionIds: [],
  templateIds: [],
  emptyLineId: '',
  populatedLineId: '',
  mainFactoryName: `Площадка Север ${suffix}`,
  unauthorizedFactoryName: `Закрытая площадка ${suffix}`,
};

const evidence = {
  marker,
  runId,
  startedAt: new Date().toISOString(),
  status: 'FAIL',
  before: {} as Record<string, unknown>,
  r1: { screens: [] as Array<Record<string, unknown>>, nestedSheet: {} as Record<string, unknown> },
  r2: {} as Record<string, unknown>,
  r3: {} as Record<string, unknown>,
  cleanup: {} as Record<string, unknown>,
  postCleanup: {} as Record<string, unknown>,
  screenshots: [] as string[],
  factory4HashBefore: '',
  factory4HashAfter: '',
  physicalDeletes: 0,
  migration: 'NOT_REQUIRED',
};

function writeClock(iso: string) {
  if (!clockFile) throw new Error('P13_CLOCK_FILE не задан');
  fs.writeFileSync(clockFile, `${iso}\n`, 'utf8');
}

function screenshotPath(fileName: string) {
  evidence.screenshots.push(fileName);
  return path.join(evidenceDir, fileName);
}

async function factory4OperationalHash() {
  const factory = await db.factory.findFirst({ where: { code: 'factory-4' }, select: { id: true } });
  if (!factory) return 'factory-4-absent';
  const [lines, assignments] = await Promise.all([
    db.line.findMany({
      where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, version: true },
    }),
    db.assignment.findMany({
      where: { factoryId: factory.id, endedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, kind: true, lineId: true, positionId: true, slotIndex: true, startedAt: true },
    }),
  ]);
  return createHash('sha256').update(JSON.stringify({ lines, assignments })).digest('hex');
}

async function createUser(factoryId: string, role: string, employeeState = 'AVAILABLE') {
  const user = await db.user.create({ data: { factoryId, role, employeeState } });
  await db.userFactoryAccess.create({
    data: { userId: user.id, factoryId, role, isActive: true, isGuest: false },
  });
  state.userIds.push(user.id);
  return user;
}

async function createLine(name: string, requiredCount: number) {
  const line = await db.line.create({ data: { factoryId: state.mainFactoryId, name, status: 'WORK' } });
  const position = await db.linePosition.create({
    data: {
      factoryId: state.mainFactoryId,
      lineId: line.id,
      name: 'Оператор',
      displayName: 'Оператор линии',
      normalizedName: 'оператор линии',
      sortOrder: 1,
    },
  });
  const template = await db.lineStaffingTemplate.create({
    data: {
      factoryId: state.mainFactoryId,
      lineId: line.id,
      name: `Состав ${requiredCount} места`,
      items: {
        create: {
          positionId: position.id,
          requiredCount,
          minRequired: requiredCount,
          maxRequired: requiredCount,
          defaultPlanned: requiredCount,
          plannedCount: requiredCount,
          sortOrder: 1,
        },
      },
    },
  });
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: template.id } });
  await db.lineEvent.create({
    data: {
      factoryId: state.mainFactoryId,
      lineId: line.id,
      createdById: state.masterId,
      status: 'WORK',
      comment: marker,
      createdAt: new Date('2026-08-13T19:30:00+03:00'),
    },
  });
  state.lineIds.push(line.id);
  state.positionIds.push(position.id);
  state.templateIds.push(template.id);
  return { line, position, template };
}

async function setupFixtures() {
  evidence.factory4HashBefore = await factory4OperationalHash();

  const main = await db.factory.create({
    data: { name: state.mainFactoryName, code: `p13-north-${suffix}-${Math.random().toString(16).slice(2, 7)}` },
  });
  state.mainFactoryId = main.id;
  state.factoryIds.push(main.id);

  const extraNames = [
    `Площадка с очень длинным производственным названием Северо-Запад ${suffix}`,
    ...Array.from({ length: 9 }, (_, index) => `Производственная площадка ${index + 2} ${suffix}`),
  ];
  for (const [index, name] of extraNames.entries()) {
    const factory = await db.factory.create({
      data: { name, code: `p13-area-${index + 2}-${suffix}-${Math.random().toString(16).slice(2, 7)}` },
    });
    state.factoryIds.push(factory.id);
  }
  const unauthorized = await db.factory.create({
    data: { name: state.unauthorizedFactoryName, code: `p13-closed-${suffix}-${Math.random().toString(16).slice(2, 7)}` },
  });
  state.unauthorizedFactoryId = unauthorized.id;
  state.factoryIds.push(unauthorized.id);

  const admin = await db.user.create({ data: { factoryId: main.id, role: 'ADMIN', employeeState: 'AVAILABLE' } });
  state.adminId = admin.id;
  state.userIds.push(admin.id);
  for (const factoryId of state.factoryIds.filter((id) => id !== unauthorized.id)) {
    await db.userFactoryAccess.create({
      data: { userId: admin.id, factoryId, role: 'ADMIN', isActive: true, isGuest: false },
    });
  }

  const master = await createUser(main.id, 'MASTER');
  const management = await createUser(main.id, 'MANAGEMENT');
  state.masterId = master.id;
  state.managementId = management.id;
  const oldEmpty = await createUser(main.id, 'WORKER', 'ASSIGNED');
  const workerA = await createUser(main.id, 'WORKER', 'ASSIGNED');
  const workerB = await createUser(main.id, 'WORKER', 'ASSIGNED');
  const workerC = await createUser(main.id, 'WORKER', 'OFF_SHIFT');
  state.workerIds = [oldEmpty.id, workerA.id, workerB.id, workerC.id];

  const empty = await createLine(`Нулевая ночная смена ${suffix}`, 2);
  const populated = await createLine(`Плановая ночная смена ${suffix}`, 3);
  state.emptyLineId = empty.line.id;
  state.populatedLineId = populated.line.id;

  for (let index = 0; index < 10; index += 1) {
    const line = await db.line.create({
      data: { factoryId: main.id, name: `Рабочая линия ${index + 1} ${suffix}`, status: 'WORK' },
    });
    await db.lineEvent.create({
      data: {
        factoryId: main.id,
        lineId: line.id,
        createdById: master.id,
        status: 'WORK',
        comment: marker,
        createdAt: new Date('2026-08-13T19:30:00+03:00'),
      },
    });
    state.lineIds.push(line.id);
  }

  for (const userId of [oldEmpty.id, workerA.id, workerB.id]) {
    await db.shiftSession.create({
      data: {
        factoryId: main.id,
        userId,
        startedAt: new Date('2026-08-13T08:00:00+03:00'),
        shiftType: 'DAY',
        status: 'ACTIVE',
        durationHours: 12,
        plannedEndAt: null,
        startedById: master.id,
      },
    });
  }
  await db.assignment.createMany({
    data: [
      { factoryId: main.id, userId: oldEmpty.id, lineId: empty.line.id, kind: 'LINE', positionId: empty.position.id, staffingTemplateId: empty.template.id, slotIndex: 1, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
      { factoryId: main.id, userId: workerA.id, lineId: populated.line.id, kind: 'LINE', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 1, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
      { factoryId: main.id, userId: workerB.id, lineId: populated.line.id, kind: 'LINE', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 2, startedAt: new Date('2026-08-13T08:00:00+03:00'), startedById: master.id, comment: marker },
    ],
  });

  const nightShiftDate = factoryShiftDate(factoryShiftTarget(new Date('2026-08-13T20:01:00+03:00')));
  await db.lineShiftWorkPlan.create({
    data: {
      factoryId: main.id,
      lineId: populated.line.id,
      shiftDate: nightShiftDate,
      shiftType: 'NIGHT',
      staffingTemplateId: populated.template.id,
      createdById: master.id,
    },
  });
  await db.plannedLineAssignment.createMany({
    data: [
      { factoryId: main.id, lineId: populated.line.id, shiftDate: nightShiftDate, shiftType: 'NIGHT', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 1, userId: workerB.id, createdById: master.id, comment: marker },
      { factoryId: main.id, lineId: populated.line.id, shiftDate: nightShiftDate, shiftType: 'NIGHT', positionId: populated.position.id, staffingTemplateId: populated.template.id, slotIndex: 2, userId: workerC.id, createdById: master.id, comment: marker },
    ],
  });

  evidence.before = {
    emptyActual: await db.assignment.count({ where: { factoryId: main.id, lineId: empty.line.id, endedAt: null } }),
    populatedActual: await db.assignment.count({ where: { factoryId: main.id, lineId: populated.line.id, endedAt: null } }),
    emptyNightPlan: await db.plannedLineAssignment.count({ where: { factoryId: main.id, lineId: empty.line.id, shiftType: 'NIGHT', releasedAt: null } }),
    populatedNightPlan: await db.plannedLineAssignment.count({ where: { factoryId: main.id, lineId: populated.line.id, shiftType: 'NIGHT', releasedAt: null } }),
  };
}

async function emulateStandalonePwa(page: Page) {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        const result = nativeMatchMedia(query);
        if (query !== '(display-mode: standalone)') return result;
        return new Proxy(result, {
          get(target, property, receiver) {
            if (property === 'matches') return true;
            return Reflect.get(target, property, receiver);
          },
        });
      },
    });
  });
}

async function resetSession(page: Page) {
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('zavod.authToken');
    localStorage.removeItem('zavod.devUserId');
    localStorage.removeItem('zavod.selectedFactoryId');
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dev-user-id')).toBeVisible({ timeout: 25_000 });
}

async function loginDev(page: Page, userId: string) {
  await resetSession(page);
  const form = page.locator('form').filter({ has: page.locator('#dev-user-id') });
  await form.locator('#dev-user-id').fill(userId);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Выберите завод' })).toBeVisible({ timeout: 25_000 });
}

async function chooseFactory(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Выберите завод' });
  await dialog.locator('.factory-picker-option').filter({ hasText: name }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
}

async function apiGet(page: Page, userId: string, factoryId: string, pathname: string) {
  return page.request.get(`${apiUrl}${pathname}`, {
    headers: { 'x-user-id': userId, 'x-factory-id': factoryId },
  });
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
  ));
  expect(overflow).toBeLessThanOrEqual(tolerance);
  return overflow;
}

async function oneFingerDrag(page: Page, selector?: string) {
  const session = await page.context().newCDPSession(page);
  const target = selector ? page.locator(selector).first() : null;
  if (target) await expect(target).toBeVisible();
  const metrics = selector
    ? await target!.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollTop = 0;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height - 24, rect.height * 0.78), maxScroll: node.scrollHeight - node.clientHeight, before: node.scrollTop };
    })
    : await page.evaluate(() => {
      const node = document.scrollingElement as HTMLElement;
      node.scrollTop = 0;
      return { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 120, window.innerHeight * 0.75), maxScroll: node.scrollHeight - node.clientHeight, before: node.scrollTop };
    });
  expect(metrics.maxScroll, `${selector ?? 'root'} должен быть длинным`).toBeGreaterThan(80);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: metrics.x, y: metrics.y }] });
  for (const distance of [30, 60, 90, 120, 150, 180, 210]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: metrics.x, y: metrics.y - distance }] });
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const after = selector
    ? await target!.evaluate((element) => (element as HTMLElement).scrollTop)
    : await page.evaluate(() => document.scrollingElement?.scrollTop ?? window.scrollY);
  expect(after).toBeGreaterThan(metrics.before + 20);
  return { ...metrics, after };
}

async function openScreen(page: Page, screen: string, heading: RegExp) {
  await page.evaluate((target) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: target } }));
  }, screen);
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

function runBoundaryReconcile() {
  const program = [
    "require('reflect-metadata');",
    "const { NestFactory } = require('@nestjs/core');",
    "const { AppModule } = require('./dist/app.module');",
    "const { ShiftService } = require('./dist/modules/shift/shift.service');",
    '(async () => {',
    '  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });',
    '  try {',
    `    const result = await app.get(ShiftService).reconcileCurrentShiftAssignments(new Date('2026-08-13T20:01:00+03:00'), ['${state.mainFactoryId}']);`,
    '    process.stdout.write(JSON.stringify(result));',
    '  } finally { await app.close(); }',
    '})().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', program], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SHIFT_MAINTENANCE_ENABLED: 'false',
      ZAVOD_INTERNAL_TEST_NOW_FILE: clockFile,
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return JSON.parse(output);
}

async function activeInventory() {
  const activeFactoryIds = state.factoryIds.length
    ? (await db.factory.findMany({ where: { id: { in: state.factoryIds }, isActive: true, deactivatedAt: null, deletedAt: null }, select: { id: true } })).map((item: any) => item.id)
    : [];
  const [lines, accesses, assignments, plannedAssignments, sessions, shiftPlans] = await Promise.all([
    db.line.count({ where: { id: { in: state.lineIds }, deactivatedAt: null, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: { in: state.factoryIds }, isActive: true } }),
    db.assignment.count({ where: { factoryId: state.mainFactoryId || '__none__', endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: state.mainFactoryId || '__none__', releasedAt: null } }),
    db.shiftSession.count({ where: { factoryId: state.mainFactoryId || '__none__', status: 'ACTIVE' } }),
    activeFactoryIds.length ? db.lineShiftWorkPlan.count({ where: { factoryId: { in: activeFactoryIds } } }) : 0,
  ]);
  return { factories: activeFactoryIds.length, lines, accesses, assignments, plannedAssignments, sessions, shiftPlans };
}

async function softCleanup() {
  const at = new Date();
  if (state.mainFactoryId) {
    await db.assignment.updateMany({
      where: { factoryId: state.mainFactoryId, endedAt: null },
      data: { endedAt: at, endedById: state.masterId || null, comment: marker, version: { increment: 1 } },
    });
    await db.plannedLineAssignment.updateMany({
      where: { factoryId: state.mainFactoryId, releasedAt: null },
      data: { releasedAt: at, releasedById: state.masterId || null, comment: marker },
    });
    await db.shiftSession.updateMany({
      where: { factoryId: state.mainFactoryId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: at, endedById: state.masterId || null, autoClosed: true, version: { increment: 1 } },
    });
  }
  if (state.lineIds.length) {
    await db.line.updateMany({
      where: { id: { in: state.lineIds }, deactivatedAt: null },
      data: { deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker },
    });
  }
  if (state.positionIds.length) {
    await db.linePosition.updateMany({
      where: { id: { in: state.positionIds }, deactivatedAt: null },
      data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker },
    });
  }
  if (state.templateIds.length) {
    await db.lineStaffingTemplate.updateMany({
      where: { id: { in: state.templateIds }, deactivatedAt: null },
      data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker },
    });
  }
  if (state.factoryIds.length) {
    await db.userFactoryAccess.updateMany({
      where: { factoryId: { in: state.factoryIds }, isActive: true },
      data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker },
    });
    await db.factory.updateMany({
      where: { id: { in: state.factoryIds }, deactivatedAt: null },
      data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker },
    });
  }
  if (state.userIds.length) {
    await db.user.updateMany({ where: { id: { in: state.userIds }, blockedAt: null }, data: { blockedAt: at } });
  }
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(8 * 60_000);

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  writeClock('2026-08-13T19:59:00+03:00');
  await setupFixtures();
});

test.afterAll(async () => {
  await softCleanup().catch((error) => {
    evidence.cleanup.error = error instanceof Error ? error.message : String(error);
  });
  evidence.cleanup = { ...evidence.cleanup, inventory: await activeInventory() };
  evidence.factory4HashAfter = await factory4OperationalHash();
  evidence.cleanup.factory4Unchanged = evidence.factory4HashBefore === evidence.factory4HashAfter;
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await db.$disconnect();
});

test('P13 R1/R2/R3: mobile foundation and exact shift boundary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await emulateStandalonePwa(page);

  await loginDev(page, state.adminId);
  const picker = page.getByRole('dialog', { name: 'Выберите завод' });
  const pickerOptions = picker.locator('.factory-picker-option');
  await expect(pickerOptions).toHaveCount(11);
  await expect(picker.getByText(state.unauthorizedFactoryName)).toHaveCount(0);
  await expect(page.locator('.premium-sheet-backdrop')).toBeVisible();
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  expect(activeTag).not.toMatch(/INPUT|TEXTAREA|SELECT/);
  const pickerBox = await picker.boundingBox();
  expect(pickerBox).not.toBeNull();
  expect((pickerBox?.y ?? 0) + (pickerBox?.height ?? 0)).toBeLessThanOrEqual(845);
  const longOption = pickerOptions.filter({ hasText: 'очень длинным производственным названием' });
  await expect(longOption).toBeVisible();
  expect(await longOption.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: screenshotPath('01-factory-picker-modal-390.png'), fullPage: true });

  evidence.r1.nestedSheet = await oneFingerDrag(page, '.premium-sheet-body');
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(picker).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goBack();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать завод', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать завод', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Выберите завод' })).toBeVisible();
  await chooseFactory(page, state.mainFactoryName);

  const me = await apiGet(page, state.adminId, state.mainFactoryId, '/auth/me');
  expect(me.status()).toBe(200);
  const meBody = await me.json();
  expect(meBody.selectedFactoryId).toBe(state.mainFactoryId);
  const unauthorizedMe = await apiGet(page, state.adminId, state.unauthorizedFactoryId, '/auth/me');
  expect(unauthorizedMe.status()).toBe(200);
  const unauthorizedMeBody = await unauthorizedMe.json();
  expect(unauthorizedMeBody.isGuest).toBe(true);
  expect(unauthorizedMeBody.isAdmin).toBe(false);
  expect(unauthorizedMeBody.permissions).toEqual([]);
  const unauthorizedLines = await apiGet(page, state.adminId, state.unauthorizedFactoryId, '/lines');
  expect(unauthorizedLines.status()).toBe(403);
  evidence.r2 = {
    optionCount: 11,
    unauthorizedHidden: true,
    unauthorizedContextDowngradedToGuest: true,
    unauthorizedOperationalApiDenied: unauthorizedLines.status(),
    selectedFactoryMatchesAllowedOption: meBody.selectedFactoryId === state.mainFactoryId,
    androidBackClosesTopLayer: true,
    keyboardSafe: true,
    viewports: ['360x800', '390x844', '430x900'],
  };

  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Нулевая ночная смена ${suffix}`)).toBeVisible({ timeout: 30_000 });
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }, { width: 430, height: 900 }]) {
    await page.setViewportSize(viewport);
    await noHorizontalOverflow(page);
    const result = await oneFingerDrag(page);
    evidence.r1.screens.push({ screen: 'Смена', viewport: `${viewport.width}x${viewport.height}`, ...result });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await oneFingerDrag(page);
  await page.screenshot({ path: screenshotPath('02-one-finger-long-screen-390.png'), fullPage: false });

  const beforeEmpty = page.locator('.current-shift-line-card').filter({ hasText: `Нулевая ночная смена ${suffix}` });
  const beforePopulated = page.locator('.current-shift-line-card').filter({ hasText: `Плановая ночная смена ${suffix}` });
  await expect(beforeEmpty).toContainText('Люди 1/2');
  await expect(beforePopulated).toContainText('Люди 2/3');

  writeClock('2026-08-13T20:01:00+03:00');
  const boundaryResult = runBoundaryReconcile();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible({ timeout: 30_000 });
  const emptyCard = page.locator('.current-shift-line-card').filter({ hasText: `Нулевая ночная смена ${suffix}` });
  const populatedCard = page.locator('.current-shift-line-card').filter({ hasText: `Плановая ночная смена ${suffix}` });
  await expect(emptyCard).toContainText('Люди 0/2', { timeout: 30_000 });
  await expect(populatedCard).toContainText('Люди 2/3', { timeout: 30_000 });
  await expect(populatedCard.getByText('Работает с прошлой смены')).toBeVisible();
  await emptyCard.screenshot({ path: screenshotPath('03-empty-boundary-0-of-2.png') });
  await populatedCard.screenshot({ path: screenshotPath('05-continuation-indicator.png') });

  await populatedCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.line-dashboard-card').filter({ hasText: `Плановая ночная смена ${suffix}` });
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator('.assignment-slot-person')).toHaveCount(2);
  await dashboard.screenshot({ path: screenshotPath('04-populated-boundary-exact-people.png') });
  await dashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();

  const activeAssignments = await db.assignment.findMany({
    where: { factoryId: state.mainFactoryId, endedAt: null, kind: 'LINE' },
    orderBy: [{ lineId: 'asc' }, { slotIndex: 'asc' }],
    select: { userId: true, lineId: true, slotIndex: true, startedAt: true },
  });
  const emptyActual = activeAssignments.filter((item: any) => item.lineId === state.emptyLineId);
  const populatedActual = activeAssignments.filter((item: any) => item.lineId === state.populatedLineId);
  expect(emptyActual).toHaveLength(0);
  expect(populatedActual.map((item: any) => item.userId).sort()).toEqual([state.workerIds[2], state.workerIds[3]].sort());
  expect(populatedActual.map((item: any) => item.slotIndex)).toEqual([1, 2]);
  expect(populatedActual.every((item: any) => item.startedAt.getTime() === new Date('2026-08-13T20:00:00+03:00').getTime())).toBe(true);
  const boundaryFactory = boundaryResult.factories?.[0] ?? {};
  evidence.r3 = {
    boundaryResult: {
      shiftDate: boundaryResult.shiftDate,
      shiftType: boundaryResult.shiftType,
      factoryCount: boundaryResult.factories?.length ?? 0,
      assignmentsClosed: boundaryFactory.assignmentsClosed ?? 0,
      sessionsClosed: boundaryFactory.sessionsClosed ?? 0,
      planned: boundaryFactory.planned ?? 0,
      activated: boundaryFactory.activated ?? 0,
      alreadyHandled: boundaryFactory.alreadyHandled ?? 0,
      skipped: boundaryFactory.skipped ?? 0,
    },
    emptyActual: emptyActual.length,
    populatedActualCount: populatedActual.length,
    populatedSlots: populatedActual.map((item: any) => item.slotIndex),
    unplannedCarryoverCount: populatedActual.filter((item: any) => item.userId === state.workerIds[1]).length,
    exactExpectedPeople: true,
    exactBoundaryStart: true,
    continuationVisibleAt2001: true,
  };

  await softCleanup();
  const inventory = await activeInventory();
  expect(Object.values(inventory).every((value) => value === 0)).toBe(true);
  evidence.cleanup = { inventory, physicalDeletes: 0 };
  evidence.factory4HashAfter = await factory4OperationalHash();
  expect(evidence.factory4HashAfter).toBe(evidence.factory4HashBefore);

  await loginDev(page, 'test-admin');
  const factory4Dialog = page.getByRole('dialog', { name: 'Выберите завод' });
  await factory4Dialog.locator('.factory-picker-option').filter({ hasText: 'Завод 4' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });

  const representativeScreens = [
    { id: 'Shift', heading: /^Смена$/ },
    { id: 'Checklists', heading: /^Чек-листы$/ },
    { id: 'Ops', heading: /Статистика\s*\/\s*Аудит/ },
    { id: 'Admin', heading: /Администрирование/ },
  ];
  for (const item of representativeScreens) {
    await openScreen(page, item.id, item.heading);
    if (item.id === 'Checklists') {
      await page.getByRole('button', { name: /Доступные/ }).first().click();
      await page.waitForTimeout(700);
    }
    if (item.id === 'Admin') {
      await expect(page.getByText('Загрузка настроек...')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).first()).toBeVisible();
    }
    await noHorizontalOverflow(page);
    const result = await oneFingerDrag(page);
    evidence.r1.screens.push({ screen: item.id, viewport: '390x844', postCleanup: true, ...result });
  }

  await page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first().click();
  const moreSheet = page.locator('.mobile-nav-sheet');
  await expect(moreSheet).toBeVisible();
  await page.goBack();
  await expect(moreSheet).toHaveCount(0);

  const factory4Me = await page.evaluate(() => ({
    userId: localStorage.getItem('zavod.devUserId') ?? '',
    factoryId: localStorage.getItem('zavod.selectedFactoryId') ?? '',
  }));
  const peopleResponse = await apiGet(page, factory4Me.userId, factory4Me.factoryId, '/shift/people?includeOffShift=true');
  expect(peopleResponse.status()).toBe(200);
  const linesResponse = await apiGet(page, factory4Me.userId, factory4Me.factoryId, '/lines');
  expect(linesResponse.status()).toBe(200);
  const lines = await linesResponse.json();
  const safeLine = Array.isArray(lines) ? lines.find((line: any) => line?.id) : null;
  let boardStatus: number | null = null;
  if (safeLine?.id) {
    const board = await apiGet(page, factory4Me.userId, factory4Me.factoryId, `/lines/${safeLine.id}/assignment-board`);
    boardStatus = board.status();
    expect(boardStatus).toBe(200);
  }
  expect(await db.factory.count({ where: { id: { in: state.factoryIds }, isActive: true, deactivatedAt: null } })).toBe(0);
  evidence.postCleanup = {
    factory4Login: true,
    shift: true,
    linesReadModel: linesResponse.status(),
    personFirstReadModel: peopleResponse.status(),
    slotFirstReadModel: boardStatus,
    androidBack: true,
    realtimeOnline: true,
    markerFactoriesVisible: 0,
  };

  evidence.status = 'PASS';
});
