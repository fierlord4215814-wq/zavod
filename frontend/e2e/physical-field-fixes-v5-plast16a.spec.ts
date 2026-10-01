import { expect, Page, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5174';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3100';
const rootDir = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast16a');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const artifactPath = path.join(evidenceDir, 'test-artifacts.json');
const workbookPath = path.join(evidenceDir, 'marker-checklist-and-line.xlsx');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P16A_${runId}__`;
const suffix = String(Date.now()).slice(-6);

const actors = {
  admin: 'test-admin',
  master: 'test-master',
  tech: 'test-tech-kipia',
  worker: 'worker-1',
  normalAdmin: 'pilot-pack-admin',
} as const;
type Actor = keyof typeof actors;
type Session = { userId: string; factoryId: string; departmentId: string | null };
const sessions = new Map<Actor, Session>();

const names = {
  line: `${marker} Динамическая линия`,
  positions: [`${marker} Позиция A`, `${marker} Позиция B`],
  staffing: `${marker} Утверждённый состав`,
  checklist: `${marker} Контроль линии`,
  yesNo: `${marker} Готовность подтверждена`,
  number: `${marker} Температура`,
  text: `${marker} Комментарий оператора`,
  task: `${marker} Устранить контролируемый простой`,
};

const state = {
  factoryId: '',
  otherFactoryId: '',
  masterDepartmentId: '',
  techDepartmentId: '',
  lineId: '',
  positionIds: [] as string[],
  staffingTemplateId: '',
  checklistTemplateId: '',
  checklistRunId: '',
  downtimeEventId: '',
  taskId: '',
  baselineHash: '',
  afterHash: '',
  cleanupCompleted: false,
};

const evidence: any = {
  plast: '16A', marker, runId, startedAt: new Date().toISOString(), status: 'PENDING',
  discovery: { migrations: 'not-needed', canonicalModels: ['Line', 'LinePosition', 'LineStaffingTemplate', 'Assignment', 'PlannedLineAssignment', 'ChecklistTemplate', 'ChecklistRun', 'Task', 'AuditLog'] },
  baseline: {}, consumers: {}, idempotency: {}, rbac: {}, checklist: {}, downtimeTask: {}, archive: {}, statistics: {}, audit: {}, cleanup: {},
  widths: {}, screenshots: [], errors: [],
  directDatabaseWrites: 0, physicalDeletes: 0, migrationCreated: false,
};

let diagnosticMode = false;

function unwrap(value: any) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

function screenshotPath(name: string) {
  if (!evidence.screenshots.includes(name)) evidence.screenshots.push(name);
  return path.join(screenshotDir, name);
}

function dateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function sessionFor(actor: Actor): Promise<Session> {
  const cached = sessions.get(actor);
  if (cached) return cached;
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: actors[actor] }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`dev-login ${actors[actor]}: HTTP ${response.status}`);
  const factoryId = body.availableFactories?.find((item: any) => item.code === 'factory-4')?.id ?? body.recommendedFactoryId;
  if (!factoryId) throw new Error(`${actors[actor]}: Завод 4 недоступен`);
  const meResponse = await fetch(`${apiUrl}/auth/me`, { headers: { 'x-user-id': actors[actor], 'x-factory-id': factoryId } });
  const me = await meResponse.json();
  if (!meResponse.ok) throw new Error(`auth/me ${actors[actor]}: HTTP ${meResponse.status}`);
  const session = { userId: body.userId ?? actors[actor], factoryId, departmentId: me.departmentId ?? null };
  sessions.set(actor, session);
  return session;
}

async function api(actor: Actor, pathname: string, options: { method?: string; body?: unknown; factoryId?: string; expected?: number[] } = {}) {
  const session = await sessionFor(actor);
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-user-id': session.userId,
      'x-factory-id': options.factoryId ?? session.factoryId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${options.method ?? 'GET'} ${pathname}: HTTP ${response.status} ${text.slice(0, 600)}`);
  return { status: response.status, body: unwrap(body), text };
}

async function loginUi(page: Page, actor: Actor) {
  const session = await sessionFor(actor);
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
    localStorage.removeItem('zavod.authToken');
  }, { userId: actors[actor], factoryId: session.factoryId });
  await page.goto(`${frontendUrl}/?stage50User=p16a-${encodeURIComponent(actor)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
}

async function openMain(page: Page, label: string | RegExp) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const direct = page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label, exact: false }).filter({ visible: true }).first();
    if (await direct.count()) await direct.click();
    else {
      const more = page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first();
      await expect(more).toBeVisible();
      await more.click();
      const sheet = page.locator('.mobile-nav-sheet:visible');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: label, exact: false }).first().click();
    }
    await page.waitForTimeout(500);
    if (await page.getByRole('heading', { name: label, exact: false }).filter({ visible: true }).first().isVisible().catch(() => false)) return;
  }
  throw new Error(`Не открыт раздел: ${String(label)}`);
}

async function openAdmin(page: Page) {
  await openMain(page, /Админ|Администрирование/);
  await expect(page.getByRole('heading', { name: /Администрирование/ }).first()).toBeVisible({ timeout: 25_000 });
}

async function openAdminSection(page: Page, label: string) {
  const button = page.locator('.admin-task-nav, .admin-section-nav').getByRole('button', { name: label, exact: true }).filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: 25_000 });
  await button.click();
  await expect(button).toHaveClass(/active/, { timeout: 20_000 });
}

async function confirmAdmin(page: Page, reason = `${marker} штатное завершение`) {
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  const confirmation = dialog.locator('#admin-confirm-text');
  if (await confirmation.count()) {
    const required = (await dialog.locator('label[for="admin-confirm-text"]').textContent())?.replace(/^\s*Введите:\s*/u, '').trim() ?? '';
    await confirmation.fill(required);
  }
  const reasonField = dialog.locator('#admin-confirm-reason');
  if (await reasonField.count()) await reasonField.fill(reason);
  await dialog.getByRole('button', { name: /Подтвердить|Сделать основным|Отключить|Деактивировать/ }).last().click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(4);
  evidence.widths[String((await page.viewportSize())?.width ?? 0)] = overflow;
}

async function expectHumanUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
  expect(text).not.toMatch(/Р С|РЎРѓ|Гђ|Г‘/);
}

async function stablePreexistingSnapshot() {
  const prefix = '__PFFV5_P16A_';
  const [lines, positions, staffing, assignments, planned, tasks, checklistTemplates, checklistRuns, washes, openDowntimes] = await Promise.all([
    db.line.findMany({ where: { factoryId: state.factoryId, name: { not: { contains: prefix } } }, orderBy: { id: 'asc' }, select: { id: true, name: true, status: true, version: true, defaultStaffingTemplateId: true, deletedAt: true, deactivatedAt: true } }),
    db.linePosition.findMany({ where: { factoryId: state.factoryId, line: { name: { not: { contains: prefix } } } }, orderBy: { id: 'asc' }, select: { id: true, lineId: true, name: true, displayName: true, isActive: true, deletedAt: true, deactivatedAt: true, sortOrder: true } }),
    db.lineStaffingTemplate.findMany({ where: { factoryId: state.factoryId, line: { name: { not: { contains: prefix } } } }, orderBy: { id: 'asc' }, include: { items: { orderBy: { id: 'asc' }, select: { id: true, positionId: true, requiredCount: true, plannedCount: true, minRequired: true, maxRequired: true } } } }),
    db.assignment.findMany({ where: { factoryId: state.factoryId, endedAt: null, OR: [{ lineId: null }, { line: { name: { not: { contains: prefix } } } }] }, orderBy: { id: 'asc' }, select: { id: true, userId: true, lineId: true, kind: true, positionId: true, slotIndex: true, endedAt: true, version: true } }),
    db.plannedLineAssignment.findMany({ where: { factoryId: state.factoryId, releasedAt: null, line: { name: { not: { contains: prefix } } } }, orderBy: { id: 'asc' }, select: { id: true, userId: true, lineId: true, shiftDate: true, shiftType: true, positionId: true, slotIndex: true, releasedAt: true } }),
    db.task.findMany({ where: { factoryId: state.factoryId, deletedAt: null, status: { not: 'DONE' }, OR: [{ lineId: null }, { line: { name: { not: { contains: prefix } } } }] }, orderBy: { id: 'asc' }, select: { id: true, lineId: true, lineStatusEventId: true, status: true, version: true, assignedToId: true, takenById: true } }),
    db.checklistTemplate.findMany({ where: { factoryId: state.factoryId, name: { not: { contains: prefix } }, isActive: true, archivedAt: null }, orderBy: { id: 'asc' }, select: { id: true, departmentId: true, lineId: true, frequencyRule: true, frequencyIntervalUnit: true, frequencyIntervalValue: true, isActive: true, archivedAt: true } }),
    db.checklistRun.findMany({ where: { factoryId: state.factoryId, status: { in: ['ACTIVE', 'PAUSED'] }, template: { name: { not: { contains: prefix } } } }, orderBy: { id: 'asc' }, select: { id: true, templateId: true, userId: true, lineId: true, status: true, nextCheckAt: true } }),
    db.washSession.findMany({
      where: {
        factoryId: state.factoryId,
        status: { not: 'DONE' },
        deletedAt: null,
        OR: [{ lineId: null }, { line: { name: { not: { contains: prefix } } } }],
      },
      orderBy: { id: 'asc' },
      select: { id: true, lineId: true, status: true },
    }),
    db.lineEvent.findMany({ where: { factoryId: state.factoryId, status: { in: ['PAUSE', 'STOP'] }, confirmedEndAt: null, line: { name: { not: { contains: prefix } } } }, orderBy: { id: 'asc' }, select: { id: true, lineId: true, status: true, confirmedEndAt: true } }),
  ]);
  return { lines, positions, staffing, assignments, planned, tasks, checklistTemplates, checklistRuns, washes, openDowntimes };
}

async function stableHash() {
  return createHash('sha256').update(JSON.stringify(await stablePreexistingSnapshot())).digest('hex');
}

async function activeMarkerInventory() {
  const lineIds = state.lineId ? [state.lineId] : (await db.line.findMany({ where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P16A_' } }, select: { id: true } })).map((item: any) => item.id);
  const templateIds = state.checklistTemplateId ? [state.checklistTemplateId] : (await db.checklistTemplate.findMany({ where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P16A_' } }, select: { id: true } })).map((item: any) => item.id);
  const runIds = templateIds.length ? (await db.checklistRun.findMany({ where: { templateId: { in: templateIds } }, select: { id: true } })).map((item: any) => item.id) : [];
  const values = {
    ACTIVE_P16A_LINES: await db.line.count({ where: { id: { in: lineIds }, deletedAt: null, deactivatedAt: null } }),
    ACTIVE_P16A_POSITIONS: await db.linePosition.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    ACTIVE_P16A_STAFFING_TEMPLATES: await db.lineStaffingTemplate.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    ACTIVE_P16A_ASSIGNMENTS: await db.assignment.count({ where: { lineId: { in: lineIds }, endedAt: null } }),
    ACTIVE_P16A_FUTURE_PLAN_REFS: await db.plannedLineAssignment.count({ where: { lineId: { in: lineIds }, releasedAt: null } }),
    ACTIVE_P16A_DOWNTIMES: await db.lineEvent.count({ where: { lineId: { in: lineIds }, status: 'PAUSE', confirmedEndAt: null } }),
    ACTIVE_P16A_TASKS: await db.task.count({ where: { lineId: { in: lineIds }, status: { not: 'DONE' }, deletedAt: null } }),
    ACTIVE_P16A_CHECKLIST_TEMPLATES: await db.checklistTemplate.count({ where: { id: { in: templateIds }, isActive: true, archivedAt: null } }),
    ACTIVE_P16A_CHECKLIST_OWNERSHIPS: await db.checklistRun.count({ where: { id: { in: runIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    ACTIVE_P16A_CHECKLIST_OCCURRENCES: await db.checklistRunCheck.count({ where: { runId: { in: runIds }, status: 'ACTIVE' } }),
  };
  return { ...values, ACTIVE_P16A_TEST_ARTIFACTS: Object.values(values).reduce((sum, value) => sum + value, 0) };
}

async function createLineConfiguration(page: Page) {
  await loginUi(page, 'admin');
  await openAdmin(page);
  await openAdminSection(page, 'Линии и позиции');
  let panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать линию' }).first();
  await panel.getByLabel('Название линии', { exact: true }).fill(names.line);
  const lineResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/lines'));
  await panel.getByRole('button', { name: 'Создать линию', exact: true }).click();
  expect((await lineResponse).status()).toBeLessThan(300);
  await expect(page.locator('article.admin-line-row').filter({ hasText: names.line }).first()).toBeVisible({ timeout: 25_000 });
  state.lineId = (await db.line.findFirst({ where: { factoryId: state.factoryId, name: names.line }, select: { id: true } }))?.id ?? '';
  expect(state.lineId).not.toBe('');

  await openAdminSection(page, 'Позиции на линиях');
  const section = page.locator('section.admin-card.wide').filter({ has: page.locator('h3').filter({ hasText: 'Позиции на линиях' }) }).first();
  panel = section.locator('.admin-setup-panel').filter({ hasText: 'Добавить позицию' }).first();
  for (let index = 0; index < names.positions.length; index += 1) {
    await panel.locator('select').first().selectOption(state.lineId);
    await panel.locator('input:not([type])').nth(0).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(1).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(2).fill(`p16a_${suffix}_${index + 1}`);
    await panel.locator('input[type="number"]').first().fill(String((index + 1) * 10));
    const response = page.waitForResponse((item) => item.request().method() === 'POST' && new URL(item.url()).pathname.endsWith(`/admin/lines/${state.lineId}/positions`));
    await panel.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    expect((await response).status()).toBeLessThan(300);
  }
  state.positionIds = (await db.linePosition.findMany({ where: { lineId: state.lineId, displayName: { in: names.positions } }, orderBy: { sortOrder: 'asc' }, select: { id: true } })).map((item: any) => item.id);
  expect(state.positionIds).toHaveLength(2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 25_000 });
  await openAdmin(page);
  await openAdminSection(page, 'Шаблоны состава');
  await page.locator('#admin-template-line').selectOption(state.lineId);
  await page.locator('#admin-template-name').fill(names.staffing);
  for (const positionId of state.positionIds) {
    const row = page.getByTestId(`admin-template-row-${positionId}`);
    await expect(row).toBeVisible();
    await row.locator('input[type="checkbox"]').check();
    await row.locator('input[type="number"]').nth(0).fill('1');
    await row.locator('input[type="number"]').nth(1).fill('1');
    await row.locator('input[type="number"]').nth(2).fill('1');
  }
  await expect(page.getByTestId('admin-template-total')).toContainText('2 чел.');
  const templateResponse = page.waitForResponse((response) => response.request().method() === 'POST' && /\/admin\/(?:staffing-control\/)?lines\/[^/]+\/templates$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  expect((await templateResponse).status()).toBeLessThan(300);
  state.staffingTemplateId = (await db.lineStaffingTemplate.findFirst({ where: { lineId: state.lineId, name: names.staffing }, select: { id: true } }))?.id ?? '';
  expect(state.staffingTemplateId).not.toBe('');
  let templateCard = page.locator('article.admin-row').filter({ hasText: names.staffing }).first();
  await expect(templateCard).toBeVisible({ timeout: 25_000 });
  const makeDefault = templateCard.getByRole('button', { name: 'Сделать основным', exact: true });
  if (await makeDefault.isVisible().catch(() => false)) {
    await makeDefault.click();
    await confirmAdmin(page);
  }
  await expect(templateCard).toContainText('Основной состав');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 25_000 });
  await openAdmin(page);
  await openAdminSection(page, 'Шаблоны состава');
  templateCard = page.locator('article.admin-row').filter({ hasText: names.staffing }).first();
  await expect(templateCard).toContainText('Основной состав', { timeout: 25_000 });
  evidence.consumers.admin = true;
}

async function setLineStatus(page: Page, action: 'Вернуть в работу' | 'Зафиксировать простой' | 'Остановить', comment: string) {
  await openMain(page, 'Линии');
  let card = page.locator('.line-card').filter({ hasText: names.line }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const actionButton = action === 'Зафиксировать простой'
    ? card.getByRole('button', { name: /Зафиксировать простой|Простой/, exact: false }).first()
    : card.getByRole('button', { name: action, exact: true }).first();
  await expect(actionButton).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith(`/lines/${state.lineId}/status`));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/lines/${state.lineId}/status`));
  await actionButton.click();
  const dialog = page.getByRole('dialog').filter({ hasText: names.line }).filter({ has: page.getByRole('button', { name: 'Подтвердить', exact: true }) }).last();
  await expect(dialog).toBeVisible();
  if (action !== 'Вернуть в работу') {
    const field = dialog.getByPlaceholder('Комментарий к событию').or(dialog.getByLabel('Комментарий', { exact: true })).first();
    await field.fill(comment);
  }
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  card = page.locator('.line-card').filter({ hasText: names.line }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  return request.postDataJSON();
}

async function openShiftLine(page: Page) {
  const existingDashboard = page.locator('.compact-line-dashboard, .line-detail-inline-card').filter({ hasText: names.line }).first();
  if (await existingDashboard.isVisible().catch(() => false)) {
    await existingDashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(existingDashboard).toBeHidden({ timeout: 20_000 });
  }
  await openMain(page, 'Смена');
  const card = page.locator('.current-shift-line-card').filter({ hasText: names.line }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.line });
  await expect(dashboard).toBeVisible({ timeout: 25_000 });
  return dashboard;
}

async function assertAssignmentConsumers(page: Page) {
  const dashboard = await openShiftLine(page);
  await expect(dashboard.locator('.slot-row')).toHaveCount(2, { timeout: 25_000 });
  const kpis = dashboard.getByLabel(`Состояние линии ${names.line}`);
  await expect(kpis.locator('.premium-kpi-card').filter({ hasText: 'Людей' }).locator('.metric-value')).toHaveText('0');
  await expect(kpis.locator('.premium-kpi-card').filter({ hasText: 'По плану' }).locator('.metric-value')).toHaveText('2');
  evidence.consumers.shiftDetail = '0/2';
  evidence.consumers.slotFirst = 2;
  await page.screenshot({ path: screenshotPath('01-new-line-shift-390.png'), fullPage: false });
  await dashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();

  const peopleButton = page.getByRole('button', { name: /Люди на смене/ }).filter({ visible: true }).first();
  await peopleButton.click();
  const panel = page.locator('#shift-people-panel');
  await expect(panel).toBeVisible();
  const assignable = panel.locator('.workforce-person-card').filter({ has: page.getByRole('button', { name: /Назначить|Переназначить/ }) }).first();
  await expect(assignable).toBeVisible({ timeout: 25_000 });
  await assignable.getByRole('button', { name: /Назначить|Переназначить/ }).click();
  await page.locator('.assignment-target-sheet').locator('.target-line').click();
  const currentPicker = page.locator('.current-line-picker-sheet');
  await expect(currentPicker).toContainText(names.line);
  evidence.consumers.personFirst = true;
  await currentPicker.getByRole('button', { name: 'Назад', exact: true }).click();
  const assignmentTarget = page.locator('.assignment-target-sheet:visible');
  if (await assignmentTarget.isVisible().catch(() => false)) {
    await assignmentTarget.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(assignmentTarget).toBeHidden({ timeout: 20_000 });
  }
  if (await panel.isVisible().catch(() => false)) await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await page.locator('.shift-selector-compact').click();
  const shiftPicker = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await shiftPicker.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();
  const futurePicker = page.locator('.future-plan-line-picker');
  await expect(futurePicker.locator('.future-plan-line-row').filter({ hasText: names.line })).toBeVisible();
  evidence.consumers.futurePicker = true;
  await futurePicker.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
}

async function assertRequestPicker(page: Page) {
  diagnosticMode = true;
  await loginUi(page, 'admin');
  await openMain(page, 'Заявки');
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать заявку' }).last();
  const lineSelect = dialog.getByLabel('Линия', { exact: true });
  await expect(lineSelect.locator(`option[value="${state.lineId}"]`)).toHaveText(names.line);
  evidence.consumers.requestPicker = true;
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  diagnosticMode = false;
}

async function addBuilderRow(page: Page, builder: ReturnType<Page['locator']>, title: string, type: string) {
  await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  const editor = dialog.locator('.checklist-item-editor');
  await editor.locator('input').first().fill(title);
  await editor.locator('select').first().selectOption(type);
  if (type === 'NUMBER') {
    const grid = editor.locator('.checklist-item-editor-grid');
    await grid.locator('select').selectOption('°C');
    await grid.locator('input').nth(0).fill('0');
    await grid.locator('input').nth(1).fill('10');
    await grid.locator('input').nth(2).fill('5');
  }
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function createChecklistTemplate(page: Page) {
  await loginUi(page, 'admin');
  await openMain(page, 'Чек-листы');
  await page.getByRole('button', { name: 'Управление шаблонами ›', exact: true }).click();
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const builder = page.locator('.checklist-template-builder-sheet');
  await expect(builder).toBeVisible();
  await builder.getByLabel('Название', { exact: true }).fill(names.checklist);
  await builder.locator('label').filter({ hasText: 'Отдел или служба' }).locator('select').selectOption(state.masterDepartmentId);
  await builder.getByLabel('Описание', { exact: true }).fill(`${marker} Периодический контроль новой линии`);
  await builder.getByRole('button', { name: 'На линии', exact: true }).click();
  const lineSelect = builder.locator('label').filter({ hasText: /^Линия/ }).locator('select').first();
  await expect(lineSelect.locator(`option[value="${state.lineId}"]`)).toContainText(names.line);
  evidence.consumers.checklistPicker = true;
  await lineSelect.selectOption(state.lineId);
  await builder.locator('label').filter({ hasText: /^Периодичность/ }).locator('select').selectOption('EVERY_N_HOURS');
  await builder.locator('label').filter({ hasText: /^Единица интервала/ }).locator('select').selectOption('HOURS');
  await builder.locator('label').filter({ hasText: /^Значение интервала/ }).locator('input').fill('1');
  await builder.locator('label').filter({ hasText: /^Кто может взять в работу/ }).locator('select').selectOption('MASTER');
  await addBuilderRow(page, builder, names.yesNo, 'YES_NO');
  await addBuilderRow(page, builder, names.number, 'NUMBER');
  await addBuilderRow(page, builder, names.text, 'TEXT');
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/checklists/templates'));
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  expect((await responsePromise).status()).toBeLessThan(300);
  await expect(builder).toHaveCount(0, { timeout: 25_000 });
  state.checklistTemplateId = (await db.checklistTemplate.findFirst({ where: { factoryId: state.factoryId, name: names.checklist }, select: { id: true } }))?.id ?? '';
  expect(state.checklistTemplateId).not.toBe('');
}

async function completeChecklist(page: Page) {
  await loginUi(page, 'master');
  await openMain(page, 'Чек-листы');
  const availableTab = page.getByRole('button', { name: /Доступные/ }).filter({ visible: true }).first();
  if (await availableTab.count()) await availableTab.click();
  const card = page.locator('.checklist-compact-available').filter({ hasText: names.checklist });
  await expect(card).toBeVisible({ timeout: 25_000 });
  await expect(card).toContainText(names.line);
  await page.screenshot({ path: screenshotPath('02-new-checklist-available-390.png'), fullPage: false });
  await card.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const startDialog = page.getByRole('dialog').filter({ hasText: names.checklist }).last();
  const startResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/checklists/runs/start'));
  await startDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const started = await startResponse;
  expect(started.status()).toBe(201);
  state.checklistRunId = unwrap(await started.json()).id;
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible({ timeout: 25_000 });
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await runner.getByRole('spinbutton').fill('5.5');
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  const textInput = runner.locator('textarea, input[type="text"]').filter({ visible: true }).first();
  await textInput.fill(`${marker} Проверка выполнена`);
  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await review.getByRole('button', { name: 'Завершить текущую проверку', exact: true }).click();
  await expect(runner).toHaveCount(0, { timeout: 25_000 });

  const completed = await db.checklistRunCheck.findFirst({ where: { runId: state.checklistRunId, status: 'COMPLETED' }, include: { rows: true } });
  expect(completed).toBeTruthy();
  expect(completed.rows.find((row: any) => row.title === names.number)?.answerNumber).toBe(5.5);
  expect(completed.rows.find((row: any) => row.title === names.text)?.answerText).toContain(marker);
  evidence.checklist = { completedOccurrences: 1, numericAnswer: 5.5, textAnswer: true };

  const inWorkTab = page.getByRole('button', { name: /В работе/ }).filter({ visible: true }).first();
  if (await inWorkTab.count()) await inWorkTab.click();
  const runCard = page.locator('.checklist-compact-run').filter({ hasText: names.checklist });
  await expect(runCard).toContainText('Проверок за смену: 1');
  await runCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const detail = page.getByRole('dialog').filter({ hasText: names.checklist }).last();
  await expect(detail).toContainText(names.line);
  await detail.getByRole('button', { name: 'Завершить вручную', exact: true }).click();
  const closeDialog = page.getByRole('dialog').filter({ hasText: 'Завершить чек-лист полностью' }).last();
  await closeDialog.locator('textarea').fill(`${marker} Контролируемая проверка завершена`);
  await closeDialog.getByRole('button', { name: 'Завершить чек-лист полностью', exact: true }).click();
  await expect(closeDialog).toBeHidden({ timeout: 25_000 });
  await expect.poll(async () => (await db.checklistRun.findUnique({ where: { id: state.checklistRunId }, select: { status: true } }))?.status).toBe('CLOSED');
}

async function createAndCompleteDowntimeTask(page: Page) {
  await loginUi(page, 'master');
  const dashboard = await openShiftLine(page);
  await dashboard.getByRole('button', { name: 'Зафиксировать простой', exact: true }).click();
  let dialog = page.getByRole('dialog').filter({ hasText: names.line }).last();
  await dialog.getByPlaceholder('Комментарий к событию').fill(`${marker} Контролируемый простой`);
  const pauseResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/lines/${state.lineId}/status`));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const pause = unwrap(await (await pauseResponse).json());
  state.downtimeEventId = pause.id;
  await expect.poll(async () => (await db.line.findUnique({ where: { id: state.lineId }, select: { status: true } }))?.status).toBe('PAUSE');

  const refreshed = page.locator('.compact-line-dashboard').filter({ hasText: names.line });
  await refreshed.getByRole('button', { name: 'Все действия', exact: true }).click();
  await page.locator('.line-actions-premium-sheet').locator('.premium-action-item').filter({ hasText: 'Заявка из простоя' }).click();
  dialog = page.getByRole('dialog').filter({ hasText: names.line }).last();
  await dialog.locator('#downtime-task-department').selectOption(state.techDepartmentId);
  await dialog.getByPlaceholder('Что нужно срочно сделать').fill(names.task);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/tasks'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/tasks'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(201);
  const task = unwrap(await response.json());
  state.taskId = task.id;
  const requestBody = request.postDataJSON();
  const duplicate = await api('master', '/tasks', { method: 'POST', body: requestBody });
  expect(duplicate.body.id).toBe(state.taskId);
  expect(await db.task.count({ where: { createdById: (await sessionFor('master')).userId, operationId: requestBody.operationId } })).toBe(1);
  const persistedTask = await db.task.findUnique({ where: { id: state.taskId }, select: { lineId: true, lineStatusEventId: true, type: true } });
  expect(persistedTask).toEqual({ lineId: state.lineId, lineStatusEventId: state.downtimeEventId, type: 'URGENT' });
  evidence.idempotency.taskSameId = true;

  const normalAdminAttempt = await api('normalAdmin', `/tasks?includeDone=true&includeFixtures=true&search=${encodeURIComponent(marker)}`);
  expect(normalAdminAttempt.body.some((item: any) => item.id === state.taskId)).toBe(false);
  evidence.rbac.normalAdminFixtureTaskVisible = false;

  await loginUi(page, 'tech');
  await openMain(page, 'Заявки');
  const taskCard = page.locator('.task-card').filter({ hasText: names.task }).first();
  await expect(taskCard).toBeVisible({ timeout: 30_000 });
  await taskCard.getByRole('button', { name: 'Открыть', exact: true }).click();
  let detail = page.getByRole('dialog').filter({ hasText: names.task }).last();
  await detail.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled({ timeout: 25_000 });
  await detail.getByRole('button', { name: 'Завершить заявку', exact: true }).click();
  dialog = page.getByRole('dialog').filter({ hasText: 'Завершить заявку' }).last();
  const comment = dialog.getByLabel(/Комментарий/);
  if (await comment.count()) await comment.fill(`${marker} Устранено КИПиА`);
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect.poll(async () => (await db.task.findUnique({ where: { id: state.taskId }, select: { status: true } }))?.status).toBe('DONE');

  await loginUi(page, 'master');
  const lineDashboard = await openShiftLine(page);
  await lineDashboard.getByRole('button', { name: 'Вернуть в работу', exact: true }).click();
  dialog = page.getByRole('dialog').filter({ hasText: names.line }).last();
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect.poll(async () => (await db.line.findUnique({ where: { id: state.lineId }, select: { status: true } }))?.status).toBe('WORK');
  const downtime = await db.lineEvent.findUnique({ where: { id: state.downtimeEventId }, select: { confirmedEndAt: true } });
  expect(downtime?.confirmedEndAt).toBeTruthy();
  evidence.downtimeTask = { linked: true, type: 'URGENT', completed: true, downtimeClosed: true };
}

async function statisticsEvidence(page: Page, baseline: any) {
  diagnosticMode = true;
  await loginUi(page, 'admin');
  await page.setViewportSize({ width: 1366, height: 900 });
  await openMain(page, /Статистика/);
  const lineSelect = page.locator('.ops-filter-card').getByText('Линия', { exact: true }).locator('..').locator('select');
  await expect(lineSelect.locator(`option[value="${state.lineId}"]`)).toHaveText(names.line);
  await lineSelect.selectOption(state.lineId);
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.locator('.ops-row-card').filter({ hasText: names.line }).first()).toBeVisible({ timeout: 25_000 });
  const after = (await api('admin', `/ops/operations/overview?dateFrom=${dateKey()}&dateTo=${dateKey()}&includeDiagnostics=true`)).body;
  expect(after.checklists.started).toBeGreaterThanOrEqual(baseline.checklists.started + 1);
  expect(after.checklists.checksCompleted).toBeGreaterThanOrEqual(baseline.checklists.checksCompleted + 1);
  expect(after.checklists.manuallyClosed).toBeGreaterThanOrEqual(baseline.checklists.manuallyClosed + 1);
  evidence.statistics = { lineFilter: true, checklistDelta: { started: after.checklists.started - baseline.checklists.started, checksCompleted: after.checklists.checksCompleted - baseline.checklists.checksCompleted, manuallyClosed: after.checklists.manuallyClosed - baseline.checklists.manuallyClosed } };
  await page.screenshot({ path: screenshotPath('04-statistics-dynamic-line.png'), fullPage: false });
}

async function archiveTemplateThroughUi(page: Page) {
  await loginUi(page, 'admin');
  await openMain(page, 'Чек-листы');
  await page.getByRole('button', { name: 'Управление шаблонами ›', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: names.checklist }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.getByRole('button', { name: 'В архив', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Архивировать шаблон' }).last();
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
}

async function cleanupConfigurationThroughUi(page: Page) {
  await loginUi(page, 'master');
  await setLineStatus(page, 'Остановить', `${marker} Финальная остановка`);
  await archiveTemplateThroughUi(page);

  await loginUi(page, 'admin');
  await openAdmin(page);
  await openAdminSection(page, 'Шаблоны состава');
  const template = page.locator('article.admin-row').filter({ hasText: names.staffing }).first();
  await template.getByRole('button', { name: 'Отключить', exact: true }).click();
  await confirmAdmin(page);
  await openAdminSection(page, 'Позиции на линиях');
  for (const name of names.positions) {
    const position = page.locator('.admin-mini-row').filter({ hasText: name }).first();
    await position.getByRole('button', { name: 'Отключить', exact: true }).click();
    await confirmAdmin(page);
  }
  await openAdminSection(page, 'Линии и позиции');
  const line = page.locator('article.admin-line-row').filter({ hasText: names.line }).first();
  await line.getByRole('button', { name: 'Управление', exact: true }).click();
  await line.getByRole('button', { name: 'Отключить линию', exact: true }).click();
  await confirmAdmin(page);
  state.cleanupCompleted = true;
}

async function installDiagnosticRouting(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (diagnosticMode && request.method() === 'GET' && (url.pathname.includes('/archive/') || url.pathname.includes('/ops/'))) {
      url.searchParams.set('includeDiagnostics', 'true');
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
}

async function openArchive(page: Page) {
  await openMain(page, 'Архив');
  await expect(page.locator('.archive-category-list')).toBeVisible({ timeout: 25_000 });
}

async function openArchiveCategory(page: Page, key: string) {
  const response = page.waitForResponse((item) => item.request().method() === 'GET' && item.url().includes('/archive/items?') && item.url().includes(`section=${key}`));
  await page.locator(`[data-archive-category="${key}"]`).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.archive-category-view')).toBeVisible();
}

async function filterArchive(page: Page, options: { line?: boolean; template?: boolean }) {
  await page.getByRole('button', { name: /^Фильтры/ }).click();
  const sheet = page.locator('.archive-filter-sheet:visible');
  if (options.line) {
    const select = sheet.getByLabel('Линия');
    await expect(select.locator(`option[value="${state.lineId}"]`)).toHaveText(names.line);
    await select.selectOption(state.lineId);
  }
  if (options.template) {
    const select = sheet.getByLabel('Чек-лист');
    await expect(select.locator(`option[value="${state.checklistTemplateId}"]`)).toHaveText(names.checklist);
    await select.selectOption(state.checklistTemplateId);
  }
  const response = page.waitForResponse((item) => item.url().includes('/archive/items?') && (!options.line || item.url().includes(`lineId=${encodeURIComponent(state.lineId)}`)) && (!options.template || item.url().includes(`templateId=${encodeURIComponent(state.checklistTemplateId)}`)));
  await sheet.getByRole('button', { name: 'Показать записи', exact: true }).click();
  expect((await response).status()).toBe(200);
}

function workbookText(workbook: ExcelJS.Workbook) {
  const values: string[] = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    const value: any = cell.value;
    values.push(String(value && typeof value === 'object' && 'text' in value ? value.text : value ?? ''));
  })));
  return values.join('\n');
}

async function archiveAndWorkbookEvidence(page: Page) {
  diagnosticMode = true;
  await loginUi(page, 'admin');
  await page.setViewportSize({ width: 1366, height: 900 });
  await openArchive(page);
  await openArchiveCategory(page, 'tasks');
  await filterArchive(page, { line: true });
  const taskRow = page.locator('.archive-record-row').filter({ hasText: names.task }).first();
  await expect(taskRow).toBeVisible({ timeout: 25_000 });
  await taskRow.locator('.archive-record-open').click();
  let detail = page.locator('.archive-detail-sheet');
  await expect(detail).toContainText(names.line);
  await expect(detail).toContainText(names.task);
  await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Назад к разделам архива' }).click();

  await openArchiveCategory(page, 'checklists');
  await filterArchive(page, { line: true, template: true });
  const checklistRow = page.locator('.archive-record-row').filter({ hasText: names.checklist }).first();
  await expect(checklistRow).toBeVisible({ timeout: 25_000 });
  await checklistRow.locator('.archive-record-open').click();
  detail = page.locator('.archive-detail-sheet');
  await expect(detail).toContainText(names.line);
  await expect(detail).toContainText(names.number);
  await expect(detail).toContainText('5,5');
  await page.screenshot({ path: screenshotPath('03-marker-archive-detail.png'), fullPage: false });
  await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await page.getByRole('button', { name: 'Экспорт архива' }).click();
  const exportSheet = page.locator('.archive-export-sheet:visible');
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/archive/export/xlsx?'));
  const downloadPromise = page.waitForEvent('download');
  await exportSheet.getByRole('button', { name: /Excel \(\.xlsx\)/ }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const text = workbookText(workbook);
  expect(text).toContain(names.checklist);
  expect(text).toContain(names.line);
  expect(text).toContain(names.number);
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
  expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  const first = workbook.worksheets.find((sheet) => sheet.name !== 'Параметры');
  expect(first).toBeTruthy();
  const headers = Array.from(first!.getRow(1).values, (value) => String(value ?? ''));
  const numberColumn = headers.findIndex((value) => value.includes(names.number));
  expect(numberColumn).toBeGreaterThan(0);
  expect(typeof first!.getCell(2, numberColumn).value).toBe('number');
  evidence.archive = { taskDetail: true, checklistDetail: true, historicalLabelsAfterCleanup: true };
  evidence.xlsx = { path: workbookPath, sheets: workbook.worksheets.map((sheet) => sheet.name), numericCell: true, filteredByLineAndTemplate: true };
}

async function auditEvidence(page: Page) {
  diagnosticMode = true;
  await loginUi(page, 'admin');
  await openMain(page, /Статистика/);
  await page.getByRole('button', { name: 'Аудит', exact: true }).click();
  const labels = ['Линия создана', 'Позиция линии создана', 'Штатный шаблон создан', 'Шаблон чек-листа создан', 'Шаблон чек-листа перенесён в архив', 'Штатный шаблон отключён', 'Позиция линии отключена', 'Линия отключена'];
  const audit = (await api('admin', '/ops/audit?limit=100&includeDiagnostics=true')).body;
  const markerRows = audit.filter((item: any) => JSON.stringify(item).includes(marker));
  expect(markerRows.length).toBeGreaterThanOrEqual(8);
  for (const label of labels) expect(audit.some((item: any) => item.actionLabel === label && JSON.stringify(item).includes(marker))).toBeTruthy();
  await expect(page.getByText('Линия отключена', { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await page.screenshot({ path: screenshotPath('05-audit-create-cleanup.png'), fullPage: false });
  evidence.audit = { markerRows: markerRows.length, labels };
}

async function postCleanupActiveUi(page: Page) {
  diagnosticMode = false;
  await loginUi(page, 'normalAdmin');
  await page.setViewportSize({ width: 390, height: 844 });
  await openMain(page, 'Линии');
  await expect(page.locator('.line-card').filter({ hasText: names.line })).toHaveCount(0);
  await openMain(page, 'Смена');
  await expect(page.locator('.current-shift-line-card').filter({ hasText: names.line })).toHaveCount(0);
  await openMain(page, 'Чек-листы');
  await expect(page.locator('.checklist-compact-available, .checklist-compact-run').filter({ hasText: names.checklist })).toHaveCount(0);
  await openMain(page, /Статистика/);
  const lineOptions = await page.locator('.ops-filter-card select').first().locator('option').allTextContents();
  expect(lineOptions).not.toContain(names.line);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('06-post-cleanup-active-ui-390.png'), fullPage: false });
  evidence.cleanup.activeUi = true;
}

async function bestEffortCanonicalCleanup() {
  if (!state.factoryId || state.cleanupCompleted) return;
  const reason = `${marker} аварийное штатное завершение E2E`;
  try {
    if (state.taskId) {
      const task = await db.task.findUnique({ where: { id: state.taskId }, select: { status: true } });
      if (task && task.status !== 'DONE') await api('admin', `/tasks/${state.taskId}/complete`, { method: 'POST', body: { operationId: `${marker}:cleanup-task`, comment: reason }, expected: [200, 201, 409] });
    }
    if (state.checklistRunId) {
      const run = await db.checklistRun.findUnique({ where: { id: state.checklistRunId }, select: { status: true } });
      if (run && ['ACTIVE', 'PAUSED'].includes(run.status)) await api('admin', '/checklists/runs/auto-close', { method: 'POST', body: { runId: state.checklistRunId, force: true, comment: reason }, expected: [200, 201, 409] });
    }
    if (state.checklistTemplateId) await api('admin', `/checklists/templates/${state.checklistTemplateId}/archive`, { method: 'POST', body: {}, expected: [200, 201, 409] });
    if (state.lineId) {
      const line = await db.line.findUnique({ where: { id: state.lineId }, select: { status: true, deactivatedAt: true } });
      if (line && !line.deactivatedAt) {
        if (line.status !== 'WORK') await api('admin', `/lines/${state.lineId}/status`, { method: 'PATCH', body: { status: 'WORK' }, expected: [200, 201, 409] });
        await api('admin', `/lines/${state.lineId}/status`, { method: 'PATCH', body: { status: 'STOP', comment: reason }, expected: [200, 201, 409] });
      }
      if (state.staffingTemplateId) await api('admin', `/admin/lines/${state.lineId}/staffing-templates/${state.staffingTemplateId}`, { method: 'PATCH', body: { isActive: false, reason }, expected: [200, 201, 409] });
      for (const positionId of state.positionIds) await api('admin', `/admin/lines/${state.lineId}/positions/${positionId}`, { method: 'PATCH', body: { isActive: false, reason }, expected: [200, 201, 409] });
      await api('admin', `/admin/lines/${state.lineId}`, { method: 'PATCH', body: { isActive: false, reason }, expected: [200, 201, 409] });
    }
  } catch (error) {
    evidence.errors.push(`Emergency cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeArtifacts() {
  evidence.finishedAt = new Date().toISOString();
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(720_000);

test.beforeAll(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  if (fs.existsSync(workbookPath)) fs.rmSync(workbookPath);
  const admin = await sessionFor('admin');
  const master = await sessionFor('master');
  const tech = await sessionFor('tech');
  state.factoryId = admin.factoryId;
  state.masterDepartmentId = master.departmentId ?? '';
  state.techDepartmentId = tech.departmentId ?? '';
  state.otherFactoryId = (await db.factory.findFirst({ where: { id: { not: state.factoryId }, deletedAt: null }, select: { id: true } }))?.id ?? '';
  if (!state.masterDepartmentId || !state.techDepartmentId || !state.otherFactoryId) throw new Error('Не определены canonical department/factory scopes');
  const before = await activeMarkerInventory();
  expect(before.ACTIVE_P16A_TEST_ARTIFACTS).toBe(0);
  state.baselineHash = await stableHash();
  evidence.baseline = { hash: state.baselineHash, activeMarkerInventory: before };
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    evidence.errors.push(`Playwright: ${testInfo.status}; ожидалось ${testInfo.expectedStatus}`);
  }
});

test.afterAll(async () => {
  try {
    await bestEffortCanonicalCleanup();
    const inventory = await activeMarkerInventory();
    evidence.cleanup.inventory = inventory;
    if (state.baselineHash) {
      state.afterHash = await stableHash();
      evidence.cleanup.preexisting = {
        beforeHash: state.baselineHash,
        afterHash: state.afterHash,
        PREEXISTING_ENTITIES_DELETED: state.baselineHash === state.afterHash ? 0 : -1,
        PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: state.baselineHash === state.afterHash ? 0 : -1,
      };
    }
  } finally {
    evidence.status = evidence.errors.length || evidence.cleanup.inventory?.ACTIVE_P16A_TEST_ARTIFACTS !== 0 || state.baselineHash !== state.afterHash ? 'FAIL' : 'PASS';
    writeArtifacts();
    await db.$disconnect();
  }
});

test('P16A cohesive dynamic configuration integration and dependency-aware cleanup', async ({ page }) => {
  await installDiagnosticRouting(page);
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
  page.on('pageerror', (error) => evidence.errors.push(`PAGEERROR ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) evidence.errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });

  const statsBaseline = (await api('admin', `/ops/operations/overview?dateFrom=${dateKey()}&dateTo=${dateKey()}&includeDiagnostics=true`)).body;
  await createLineConfiguration(page);

  await loginUi(page, 'worker');
  const workerMutation = await api('worker', '/admin/lines', { method: 'POST', body: { factoryId: state.factoryId, name: `${marker} forbidden` }, expected: [403] });
  const crossFactory = await api('master', `/lines/${state.lineId}/dashboard`, { factoryId: state.otherFactoryId, expected: [403, 409] });
  evidence.rbac = { workerAdminMutationStatus: workerMutation.status, crossFactoryStatus: crossFactory.status };

  await loginUi(page, 'master');
  const startBody = await setLineStatus(page, 'Вернуть в работу', `${marker} Запуск`);
  const firstWorkEvents = await db.lineEvent.count({ where: { lineId: state.lineId, status: 'WORK' } });
  await api('master', `/lines/${state.lineId}/status`, { method: 'PATCH', body: startBody });
  const afterRepeat = await db.lineEvent.count({ where: { lineId: state.lineId, status: 'WORK' } });
  expect(afterRepeat).toBe(firstWorkEvents);
  evidence.idempotency.duplicateStartEvents = afterRepeat - firstWorkEvents;

  await assertAssignmentConsumers(page);
  await assertRequestPicker(page);
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
    await page.setViewportSize(viewport);
    await openMain(page, 'Линии');
    await expect(page.locator('.line-card').filter({ hasText: names.line })).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await createChecklistTemplate(page);
  await completeChecklist(page);
  await createAndCompleteDowntimeTask(page);
  await statisticsEvidence(page, statsBaseline);
  await cleanupConfigurationThroughUi(page);

  const zeroInventory = await activeMarkerInventory();
  expect(zeroInventory.ACTIVE_P16A_TEST_ARTIFACTS).toBe(0);
  evidence.cleanup.inventory = zeroInventory;
  await archiveAndWorkbookEvidence(page);
  await auditEvidence(page);
  await postCleanupActiveUi(page);
  await expectHumanUi(page);

  state.afterHash = await stableHash();
  expect(state.afterHash).toBe(state.baselineHash);
  evidence.cleanup.preexisting = { beforeHash: state.baselineHash, afterHash: state.afterHash, PREEXISTING_ENTITIES_DELETED: 0, PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: 0 };
  evidence.cleanup.PHYSICAL_DELETES = 0;
  evidence.status = 'PASS';
});
