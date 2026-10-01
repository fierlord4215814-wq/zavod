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
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const suffix = `${Date.now()}`;
const marker = `__PFFV5_P3_UI_${suffix}__`;
const screenshotDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast3', 'screenshots');
const artifactPath = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast3', 'test-artifacts.json');

const actors = {
  master: { id: 'pilot-master-1', phone: '+79000004720', role: 'MASTER' },
  worker: { id: 'pilot-worker-1', phone: '+79000004701', role: 'WORKER' },
  worker2: { id: `worker-${suffix.slice(-8)}`, phone: '', role: 'WORKER' },
  cold: { id: 'mobile-tech-holod', phone: '+79000009106', role: 'TECH_HOLOD' },
};

let factoryId = '';
let factoryCode = '';
let washSessionId = '';
let washLineName = '';
let runningLineName = '';
let defrostLineName = '';

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const existingActorIds = [actors.master.id, actors.worker.id, actors.cold.id];
  const existingActors = await db.user.count({ where: { id: { in: existingActorIds }, deletedAt: null, blockedAt: null } });
  if (existingActors !== existingActorIds.length) throw new Error('Pilot users required for the isolated browser fixture are unavailable');

  factoryCode = `pffv5-p3-ui-${suffix}`;
  const factory = await db.factory.create({ data: { code: factoryCode, name: `Учебный участок мойки ${suffix.slice(-6)}`, isActive: true } });
  factoryId = factory.id;
  await db.user.create({ data: { id: actors.worker2.id, factoryId, role: actors.worker2.role, employeeState: 'AVAILABLE' } });
  await db.userFactoryAccess.createMany({
    data: Object.values(actors).map((actor) => ({
      userId: actor.id,
      factoryId,
      role: actor.role,
      isGuest: false,
      isActive: true,
    })),
  });

  washLineName = `Линия мойки Север ${suffix.slice(-4)}`;
  runningLineName = `Линия шоковой заморозки с длинным наименованием ${suffix.slice(-4)}`;
  defrostLineName = `Холодильная линия Юг ${suffix.slice(-4)}`;
  const [washLine, runningLine, defrostLine] = await Promise.all([
    db.line.create({ data: { factoryId, name: washLineName, status: 'STOP' } }),
    db.line.create({ data: { factoryId, name: runningLineName, status: 'WORK' } }),
    db.line.create({ data: { factoryId, name: defrostLineName, status: 'STOP' } }),
  ]);

  const now = Date.now();
  await db.shiftSession.createMany({
    data: [actors.master.id, actors.worker.id, actors.worker2.id].map((userId) => ({
      factoryId,
      userId,
      startedById: actors.master.id,
      startedAt: new Date(now - 60 * 60_000),
      plannedEndAt: new Date(now + 11 * 60 * 60_000),
      durationHours: 12,
      shiftType: 'DAY',
      status: 'ACTIVE',
    })),
  });
  const wash = await db.washSession.create({
    data: {
      factoryId,
      lineId: washLine.id,
      targetType: 'LINE',
      startedById: actors.master.id,
      status: 'IN_PROGRESS',
      createdAt: new Date(now - 93 * 60_000),
    },
  });
  washSessionId = wash.id;
  await Promise.all([
    db.washSettings.create({
      data: {
        factoryId,
        washCompleteRequiresNoOpenIssues: false,
        washCompleteRequiresOkkReview: false,
      },
    }),
    db.assignment.create({
      data: {
        factoryId,
        lineId: washLine.id,
        userId: actors.worker.id,
        kind: 'WASH',
        washSessionId: wash.id,
        startedById: actors.master.id,
        startedAt: new Date(now - 81 * 60_000),
        comment: marker,
      },
    }),
    db.washEvent.create({ data: { factoryId, washSessionId: wash.id, actorId: actors.master.id, type: 'START', text: 'Мойка началась', createdAt: new Date(now - 93 * 60_000) } }),
    db.washMessage.create({ data: { washSessionId: wash.id, userId: actors.master.id, message: 'Проверена подготовка оборудования.' } }),
    db.washIssue.create({ data: { factoryId, washSessionId: wash.id, createdById: actors.master.id, title: 'Проверить труднодоступный участок', message: 'Нужно повторно проверить защитный кожух.' } }),
    db.washControlItem.create({ data: { factoryId, washSessionId: wash.id, lineId: washLine.id, createdById: actors.master.id, title: 'Промыть защитный кожух', type: 'MINI_TASK', status: 'NEW', operationId: `${marker}-task` } }),
    db.lineEvent.create({ data: { factoryId, lineId: runningLine.id, createdById: actors.cold.id, status: 'WORK', comment: 'Линия запущена', createdAt: new Date(now - 37 * 60_000) } }),
    db.defrostEvent.create({
      data: {
        factoryId,
        lineId: runningLine.id,
        startedById: actors.cold.id,
        endedById: actors.cold.id,
        status: 'COMPLETED',
        startAt: new Date(now - 8 * 86_400_000),
        endAt: new Date(now - 8 * 86_400_000 + 42 * 60_000),
        durationSeconds: 42 * 60,
        comment: 'Предыдущая оттайка',
      },
    }),
    db.defrostEvent.create({
      data: {
        factoryId,
        lineId: defrostLine.id,
        startedById: actors.cold.id,
        status: 'ACTIVE',
        startAt: new Date(now - 52 * 60_000),
        comment: 'Плановая оттайка',
      },
    }),
  ]);
}

async function cleanupFixture() {
  if (!factoryId) return;
  const now = new Date();
  await db.assignment.updateMany({ where: { factoryId, endedAt: null }, data: { endedAt: now, endedById: actors.master.id, comment: `${marker} штатное завершение` } });
  await db.washSession.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: now, version: { increment: 1 } } });
  await db.defrostEvent.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endAt: now, endedById: actors.cold.id, durationSeconds: 0 } });
  await db.shiftSession.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now, endedById: actors.master.id } });
  await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.userFactoryAccess.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.factory.update({ where: { id: factoryId }, data: { isActive: false, deactivatedAt: now, deactivationReason: `${marker} проверка завершена` } });
  await db.user.update({ where: { id: actors.worker2.id }, data: { deletedAt: now, blockedAt: now, employeeState: 'OFF_SHIFT' } });

  const remaining = {
    factories: await db.factory.count({ where: { id: factoryId, isActive: true } }),
    lines: await db.line.count({ where: { factoryId, deactivatedAt: null } }),
    washes: await db.washSession.count({ where: { factoryId, status: { not: 'DONE' } } }),
    assignments: await db.assignment.count({ where: { factoryId, endedAt: null } }),
    defrosts: await db.defrostEvent.count({ where: { factoryId, status: 'ACTIVE' } }),
    shifts: await db.shiftSession.count({ where: { factoryId, status: 'ACTIVE' } }),
    accesses: await db.userFactoryAccess.count({ where: { factoryId, isActive: true } }),
    users: await db.user.count({ where: { id: actors.worker2.id, deletedAt: null } }),
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    marker,
    washSessionRef: `${washSessionId.slice(0, 8)}...${washSessionId.slice(-4)}`,
    cleanupMode: 'soft-close/deactivate only',
    physicalDeletes: 0,
    activeArtifactsRemaining: remaining,
  }, null, 2)}\n`, 'utf8');
  if (Object.values(remaining).some((value) => value !== 0)) throw new Error(`Browser fixture cleanup failed: ${JSON.stringify(remaining)}`);
}

async function login(page: Page, phone: string) {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password: '1234' }),
  });
  if (!response.ok) throw new Error(`Pilot login failed (${response.status})`);
  const data = await response.json();
  const authToken = data.accessToken ?? data.token;
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === factoryCode);
  if (!authToken || !factory?.id) throw new Error('Isolated browser factory is unavailable after login');
  await page.goto(frontendUrl);
  await page.evaluate(({ token, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { token: authToken, selectedFactoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

async function firstVisible(page: Page, label: string) {
  const buttons = page.getByRole('button', { name: label, exact: true });
  for (let index = 0; index < await buttons.count(); index += 1) {
    if (await buttons.nth(index).isVisible()) return buttons.nth(index);
  }
  return null;
}

async function openScreen(page: Page, label: string) {
  const direct = await firstVisible(page, label);
  if (direct) return direct.click();
  await page.locator('.mobile-more-button:visible').click();
  const item = await firstVisible(page, label);
  if (!item) throw new Error(`Раздел «${label}» недоступен`);
  await item.click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(metrics.body, metrics.document) - metrics.viewport, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
}

async function expectSafeBody(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+/i);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
}

test.beforeAll(setupFixture);
test.afterAll(async () => {
  await cleanupFixture();
  await db.$disconnect();
});

test('wash and defrost remain compact, canonical and responsive', async ({ browser }) => {
  for (const width of [360, 430, 1365, 390]) {
    const mobile = width < 600;
    const context = await browser.newContext({
      baseURL: frontendUrl,
      viewport: { width, height: mobile ? 860 : 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();

    await login(page, actors.master.phone);
    await openScreen(page, 'Мойка');
    await expect(page.getByRole('heading', { name: 'Мойка', exact: true })).toBeVisible();
    const washCard = page.locator('.wash-session-card').filter({ hasText: washLineName }).first();
    await expect(washCard).toBeVisible();
    await expect(washCard.locator('.wash-card-timing')).toContainText('Длится:');
    await expect(washCard.locator('.wash-card-metrics')).toContainText('Людей 1');
    await expect(washCard.locator('.wash-card-metrics')).toContainText('Проблем 1');
    await expect(washCard.locator('.wash-card-metrics')).toContainText('Заданий 1');
    await expect(washCard.locator(':scope > .wash-card-main > .tag')).toHaveCount(1);
    await expect(washCard.getByRole('button', { name: 'Люди', exact: true })).toBeVisible();
    await expect(washCard.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectSafeBody(page);
    await page.screenshot({ path: path.join(screenshotDir, `${mobile ? 'mobile' : 'desktop'}-${width}-wash-list.png`), fullPage: true });

    if (width === 390) {
      await washCard.getByRole('button', { name: 'Открыть', exact: true }).click();
      await expect(page.locator('.wash-detail-screen')).toContainText(washLineName);
      await expect(page.locator('.wash-detail-tabs')).toBeVisible();
      await page.getByRole('tab', { name: 'Люди', exact: true }).click();
      await expect(page.locator('.wash-person-pill')).toContainText('Тестовый работник 1');
      await expect(page.getByRole('button', { name: 'Добавить человека', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Завершить мойку', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-wash-people-detail.png'), fullPage: true });
      await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
      await expect(washCard).toBeVisible();
      await washCard.getByRole('button', { name: 'Люди', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
      const peoplePanel = page.locator('#shift-people-panel');
      await expect(peoplePanel).toBeVisible();
      const secondWorkerName = `Работник ${suffix.slice(-8)}`;
      const secondWorker = peoplePanel.locator('.workforce-person-card').filter({ hasText: secondWorkerName }).first();
      await expect(secondWorker).toBeVisible();
      await secondWorker.getByRole('button', { name: 'Назначить', exact: true }).click();
      const targetSheet = page.locator('.assignment-target-sheet').filter({ hasText: 'Куда назначить?' });
      await targetSheet.locator('.target-wash').click();
      const washAssign = page.getByRole('dialog').filter({ hasText: 'Назначение на мойку' }).last();
      await expect(washAssign.locator('#wash-session-select')).toHaveValue(washSessionId);
      await washAssign.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await expect(page.locator('.wash-detail-screen')).toContainText(washLineName);
      await expect(page.locator('.wash-person-pill')).toHaveCount(2);
      await expect(page.locator('.wash-person-pill').filter({ hasText: secondWorkerName })).toBeVisible();
      await expect.poll(() => db.assignment.count({ where: { factoryId, washSessionId, userId: actors.worker2.id, endedAt: null } })).toBe(1);

      await page.locator('.wash-person-pill').filter({ hasText: secondWorkerName }).getByRole('button', { name: 'Действия', exact: true }).click();
      const activePeoplePanel = page.locator('#shift-people-panel');
      await expect(activePeoplePanel).toBeVisible();
      const assignedSecondWorker = activePeoplePanel.locator('.workforce-person-card').filter({ hasText: secondWorkerName }).first();
      await assignedSecondWorker.getByRole('button', { name: 'Переназначить', exact: true }).click();
      await page.locator('.assignment-target-sheet').filter({ hasText: 'Куда назначить?' }).locator('.target-wash').click();
      const repeatWashAssign = page.getByRole('dialog').filter({ hasText: 'Назначение на мойку' }).last();
      await repeatWashAssign.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await expect(page.locator('.wash-detail-screen')).toContainText(washLineName);
      await expect(page.locator('.wash-person-pill')).toHaveCount(2);
      await expect.poll(() => db.assignment.count({ where: { factoryId, washSessionId, userId: actors.worker2.id, endedAt: null } })).toBe(1);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-wash-assignment-context.png'), fullPage: false });

      await openScreen(page, 'Линии');
      const washLineCard = page.locator('.current-shift-line-card, .line-card').filter({ hasText: washLineName }).first();
      await expect(washLineCard).toContainText('На мойке');
      await washLineCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
      const lineDetail = page.getByRole('dialog').filter({ hasText: washLineName });
      await expect(lineDetail).toContainText('На мойке');
      await expect(lineDetail.getByRole('button', { name: 'Открыть мойку', exact: true })).toBeVisible();
      await expect(lineDetail.getByRole('button', { name: 'Вернуть в работу', exact: true })).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));

      await openScreen(page, 'Мойка');
      const refreshedWashCard = page.locator('.wash-session-card').filter({ hasText: washLineName }).first();
      await refreshedWashCard.getByRole('button', { name: 'Открыть', exact: true }).click();
      await page.getByRole('tab', { name: 'Задания', exact: true }).click();
      await page.getByRole('tabpanel').getByRole('button', { name: 'Закрыть задание', exact: true }).click();
      const finishTaskDialog = page.getByRole('dialog').filter({ hasText: 'Выполнить задание' });
      await finishTaskDialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await expect(page.getByRole('tabpanel')).toContainText('Выполнено');
      await page.getByRole('button', { name: 'Завершить мойку', exact: true }).click();
      const completeDialog = page.getByRole('dialog').filter({ hasText: 'Перед завершением проверьте' });
      await completeDialog.getByRole('button', { name: 'Завершить мойку', exact: true }).click();
      await expect(page.locator('.wash-detail-screen')).toHaveCount(0);
      await expect.poll(() => db.washSession.findUnique({ where: { id: washSessionId }, select: { status: true } }).then((row: { status: string } | null) => row?.status)).toBe('DONE');
      await expect.poll(() => db.assignment.count({ where: { factoryId, washSessionId, endedAt: null } })).toBe(0);
      await expect.poll(() => db.line.findFirst({ where: { factoryId, name: washLineName }, select: { status: true } }).then((row: { status: string } | null) => row?.status)).toBe('STOP');
    }

    await login(page, actors.cold.phone);
    await openScreen(page, 'Оттайка');
    await expect(page.getByRole('heading', { name: 'Оттайка', exact: true })).toBeVisible();
    const kpi = page.locator('.defrost-kpi-strip');
    await expect(kpi.locator('.metric-card')).toHaveCount(2);
    await expect(kpi).toContainText('В работе');
    await expect(kpi).toContainText('На оттайке');

    const runningCard = page.locator('.defrost-line-card').filter({ hasText: runningLineName }).first();
    await expect(runningCard).toBeVisible();
    await expect(runningCard).toContainText('В работе с');
    await expect(runningCard).toContainText(/В работе: (?:3[5-9]|4[0-5]) мин/);
    expect(await runningCard.locator('.defrost-line-title').evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true);

    await kpi.getByText('На оттайке', { exact: true }).click();
    const activeCard = page.locator('.defrost-line-card').filter({ hasText: defrostLineName }).first();
    await expect(activeCard).toBeVisible();
    await expect(activeCard).toContainText('На оттайке:');
    await expectNoHorizontalOverflow(page);
    await expectSafeBody(page);
    await page.screenshot({ path: path.join(screenshotDir, `${mobile ? 'mobile' : 'desktop'}-${width}-defrost.png`), fullPage: true });

    if (width === 390) {
      await activeCard.click();
      await expect(page.locator('.defrost-detail-card')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const metricValuesFit = await page.locator('.defrost-summary-card .metric-value').evaluateAll((elements) => elements.every((element) => {
        const style = window.getComputedStyle(element);
        return element.scrollWidth <= element.clientWidth + 2 && style.wordBreak !== 'break-all';
      }));
      expect(metricValuesFit).toBe(true);
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-defrost-detail.png'), fullPage: true });
      await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
      await expect(page.locator('.defrost-line-grid')).toBeVisible();
    }

    await context.close();
  }
});
