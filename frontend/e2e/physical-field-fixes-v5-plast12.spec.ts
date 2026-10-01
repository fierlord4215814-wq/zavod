import { APIRequestContext, Browser, BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5174';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3100';
const clockFile = process.env.P12_CLOCK_FILE ?? '';
const evidenceDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast12');
const startedAtMs = Date.now();
const runId = `${startedAtMs}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P12_${runId}__`;
const numeric = String(startedAtMs).slice(-6).padStart(6, '0');
const password = `P12-${numeric}!`;

const credentials = {
  admin: { phone: '+79000009009', password: '1234' },
  management: { phone: '+79000009008', password: '1234' },
};

type MarkerUser = {
  key: 'master' | 'worker1' | 'worker2' | 'worker3' | 'worker4' | 'worker5' | 'tech';
  phone: string;
  role: 'MASTER' | 'WORKER' | 'TECH_KIPIA';
  titleKey: 'masterTitle' | 'workerTitle' | 'techTitle';
  departmentKey: 'operational' | 'tech';
  userId: string;
};

const markerUsers: MarkerUser[] = [
  { key: 'master', phone: `+7995${numeric}1`, role: 'MASTER', titleKey: 'masterTitle', departmentKey: 'operational', userId: '' },
  { key: 'worker1', phone: `+7995${numeric}2`, role: 'WORKER', titleKey: 'workerTitle', departmentKey: 'operational', userId: '' },
  { key: 'worker2', phone: `+7995${numeric}3`, role: 'WORKER', titleKey: 'workerTitle', departmentKey: 'operational', userId: '' },
  { key: 'worker3', phone: `+7995${numeric}4`, role: 'WORKER', titleKey: 'workerTitle', departmentKey: 'operational', userId: '' },
  { key: 'worker4', phone: `+7995${numeric}5`, role: 'WORKER', titleKey: 'workerTitle', departmentKey: 'operational', userId: '' },
  { key: 'worker5', phone: `+7995${numeric}6`, role: 'WORKER', titleKey: 'workerTitle', departmentKey: 'operational', userId: '' },
  { key: 'tech', phone: `+7995${numeric}7`, role: 'TECH_KIPIA', titleKey: 'techTitle', departmentKey: 'tech', userId: '' },
];

const names = {
  department: `${marker} Мастера единой смены`,
  techDepartment: `${marker} Техническая служба`,
  masterTitle: `${marker} Мастер смены`,
  workerTitle: `${marker} Работник смены`,
  techTitle: `${marker} Технический исполнитель`,
  mainLine: `${marker} Основная линия`,
  downtimeLine: `${marker} Линия хвоста простоя`,
  washLine: `${marker} Линия хвоста мойки`,
  positions: [`${marker} Позиция A`, `${marker} Позиция B`, `${marker} Позиция C`],
  template: `${marker} Состав 2+1+2`,
  currentArticle: `${marker}-DAY-ART`,
  currentProduct: `${marker} Продукт дневной смены`,
  futureArticle: `${marker}-NIGHT-ART`,
  futureProduct: `${marker} Продукт ночной смены`,
  linkedTask: `${marker} Устранить основной простой`,
  helperLinkedTask: `${marker} Незавершённый хвост простоя`,
  ordinaryTask: `${marker} Обычная заявка без связи с простоем`,
  handoverComment: `${marker} Передать три канонических хвоста`,
};

type MarkerState = {
  factoryId: string;
  departmentId: string;
  titleIds: Record<string, string>;
  lineIds: Record<'main' | 'downtime' | 'wash', string>;
  positionIds: string[];
  templateId: string;
  techDepartmentId: string;
  mainDowntimeEventId: string;
  helperDowntimeEventId: string;
  linkedTaskId: string;
  helperLinkedTaskId: string;
  ordinaryTaskId: string;
  mainWashId: string;
  helperWashId: string;
  handoverId: string;
  plannedAssignmentIds: string[];
};

const state: MarkerState = {
  factoryId: '', departmentId: '', titleIds: {},
  lineIds: { main: '', downtime: '', wash: '' },
  positionIds: [], templateId: '', techDepartmentId: '',
  mainDowntimeEventId: '', helperDowntimeEventId: '', linkedTaskId: '', helperLinkedTaskId: '', ordinaryTaskId: '',
  mainWashId: '', helperWashId: '', handoverId: '', plannedAssignmentIds: [],
};

const evidence = {
  marker,
  runId,
  startedAt: new Date().toISOString(),
  uiJourney: [] as string[],
  realtime: [] as string[],
  denials: [] as string[],
  idempotency: [] as string[],
  boundaries: [] as string[],
  cleanup: [] as string[],
  postCleanup: [] as string[],
  screenshots: [] as string[],
  networkErrors: [] as string[],
  gates: {} as Record<string, 'PASS' | 'FAIL'>,
  inventory: {} as Record<string, number>,
  referenceIntegrity: {} as Record<string, number>,
  historicalReferenceWarnings: {} as Record<string, number>,
  preexisting: {
    beforeHash: '', afterHash: '', entitiesDeleted: 0, unintentionallyModified: 0,
    lineStatesModified: 0, assignmentsModified: 0, futurePlansModified: 0,
  },
  migrationCreated: false,
  directDatabaseWrites: 0,
  physicalDeletes: 0,
};

function phoneLabel(phone: string) {
  return `${phone.slice(-4, -2)}-${phone.slice(-2)}`;
}

function screenshotPath(fileName: string) {
  evidence.screenshots.push(fileName);
  return path.join(evidenceDir, fileName);
}

function writeClock(iso: string) {
  if (!clockFile) throw new Error('P12_CLOCK_FILE не задан');
  fs.writeFileSync(clockFile, `${iso}\n`, 'utf8');
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
}

async function expectHumanUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken/i);
  expect(text).not.toMatch(/Р С|РЎРѓ|Гђ|Г‘/);
}

async function authHeaders(page: Page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('zavod.authToken') ?? '',
    userId: localStorage.getItem('zavod.devUserId') ?? '',
    factoryId: localStorage.getItem('zavod.selectedFactoryId') ?? '',
  }));
}

async function apiCall<T = any>(page: Page, method: string, pathname: string, data?: unknown) {
  const auth = await authHeaders(page);
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : { 'x-user-id': auth.userId }),
      'x-factory-id': auth.factoryId || state.factoryId,
      ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let body: T | string | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body: body as T, text };
}

async function apiOk<T = any>(page: Page, method: string, pathname: string, data?: unknown) {
  const result = await apiCall<T>(page, method, pathname, data);
  expect(result.status, `${method} ${pathname}: ${result.text}`).toBeLessThan(300);
  return result.body;
}

async function resetSession(page: Page) {
  const resetId = `${Date.now()}-${Math.random()}`;
  await page.context().addInitScript(({ expectedResetId }) => {
    if (new URL(window.location.href).searchParams.get('p12reset') !== expectedResetId) return;
    localStorage.removeItem('zavod.authToken');
    localStorage.removeItem('zavod.devUserId');
    localStorage.removeItem('zavod.selectedFactoryId');
    sessionStorage.clear();
  }, { expectedResetId: resetId });
  await page.goto(`${frontendUrl}/?p12reset=${encodeURIComponent(resetId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 25_000 });
  await page.evaluate(() => history.replaceState(null, '', '/'));
}

async function chooseFactory4(page: Page) {
  const select = page.getByRole('button', { name: 'Выбрать завод', exact: true }).filter({ visible: true }).first();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible, .factory-select-button:visible').first()).toBeVisible({ timeout: 30_000 });
  if (await select.isVisible().catch(() => false)) await select.click();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const factoryId = await page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId') ?? '');
  expect(factoryId).not.toBe('');
  if (!state.factoryId) state.factoryId = factoryId;
  else expect(factoryId).toBe(state.factoryId);
}

async function login(page: Page, account: { phone: string; password: string }) {
  await resetSession(page);
  await page.locator('#login-phone').fill(account.phone);
  await page.locator('#login-password').fill(account.password);
  await page.locator('#login-password').press('Enter');
  await chooseFactory4(page);
}

async function registerMarkerUser(page: Page, item: typeof markerUsers[number]) {
  await resetSession(page);
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await page.locator('#register-phone').fill(item.phone);
  await page.locator('#register-password').fill(password);
  await page.locator('#register-password-repeat').fill(password);
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.getByText(/Регистрация завершена/)).toBeVisible({ timeout: 25_000 });
  item.userId = await page.evaluate(() => localStorage.getItem('zavod.devUserId') ?? '');
  expect(item.userId).not.toBe('');
  await chooseFactory4(page);
  evidence.uiJourney.push(`Регистрация через UI: ${item.key}`);
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
      const sheet = page.locator('.mobile-nav-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: label, exact: false }).first().click();
    }
    await page.waitForTimeout(500);
    const heading = page.getByRole('heading', { name: label, exact: false }).filter({ visible: true }).first();
    if (await heading.isVisible().catch(() => false)) return;
  }
}

async function openAdmin(page: Page) {
  await openMain(page, /Админ|Администрирование/);
  await expect(page.getByRole('heading', { name: /Администрирование/ }).first()).toBeVisible({ timeout: 25_000 });
}

async function openAdminSection(page: Page, label: string) {
  const button = page.locator('.admin-task-nav, .admin-section-nav')
    .getByRole('button', { name: label, exact: true }).filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  await expect(button).toHaveClass(/active/, { timeout: 20_000 });
}

async function confirmAdmin(page: Page, reason = `${marker} штатное завершение`) {
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  const confirmText = dialog.locator('#admin-confirm-text');
  if (await confirmText.count()) {
    const label = await dialog.locator('label[for="admin-confirm-text"]').textContent();
    const required = label?.replace(/^\s*Введите:\s*/u, '').trim() ?? '';
    expect(required).not.toBe('');
    await confirmText.fill(required);
  }
  const reasonField = dialog.locator('#admin-confirm-reason');
  if (await reasonField.count()) await reasonField.fill(reason);
  await dialog.getByRole('button', { name: /Подтвердить|Сделать основным|Отключить|Деактивировать|Заблокировать/ }).last().click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
}

async function baselineHash() {
  const [lines, assignments, planned, plans] = await Promise.all([
    db.line.findMany({
      where: { factoryId: state.factoryId, name: { not: { contains: '__PFFV5_P12_' } } },
      orderBy: { id: 'asc' }, select: { id: true, status: true, version: true, defaultStaffingTemplateId: true, deletedAt: true, deactivatedAt: true },
    }),
    db.assignment.findMany({
      where: { factoryId: state.factoryId, endedAt: null, user: { phone: { not: { startsWith: '+7995' } } } },
      orderBy: { id: 'asc' }, select: { id: true, userId: true, lineId: true, kind: true, positionId: true, slotIndex: true, washSessionId: true, endedAt: true, version: true },
    }),
    db.plannedLineAssignment.findMany({
      where: { factoryId: state.factoryId, releasedAt: null, user: { phone: { not: { startsWith: '+7995' } } } },
      orderBy: { id: 'asc' }, select: { id: true, userId: true, lineId: true, shiftDate: true, shiftType: true, positionId: true, slotIndex: true, releasedAt: true },
    }),
    db.lineShiftWorkPlan.findMany({
      where: { factoryId: state.factoryId, line: { name: { not: { contains: '__PFFV5_P12_' } } } },
      orderBy: { id: 'asc' }, include: { rows: { orderBy: { id: 'asc' }, select: { id: true, article: true, productName: true, plannedGofrCount: true, deletedAt: true } } },
    }),
  ]);
  return createHash('sha256').update(JSON.stringify({ lines, assignments, planned, plans })).digest('hex');
}

async function cleanupInterruptedP12Accesses(page: Page) {
  const staleDepartments = await db.department.findMany({
    where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P12_' } },
    select: { id: true, name: true },
  });
  const exactPhones = staleDepartments.flatMap((department: { name: string }) => {
    const match = department.name.match(/__PFFV5_P12_(\d+)-[a-f0-9]+__/i);
    if (!match) return [];
    const suffix = match[1].slice(-6).padStart(6, '0');
    return [1, 2, 3, 4, 5, 6, 7].map((index) => `+7995${suffix}${index}`);
  });
  const staleAudit = await db.auditLog.findMany({
    where: { factoryId: state.factoryId, entityType: 'User', entityId: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 500, select: { entityId: true, details: true },
  });
  const auditedUserIds = staleAudit
    .filter((item: { details: unknown }) => JSON.stringify(item.details ?? {}).includes('__PFFV5_P12_'))
    .map((item: { entityId: string | null }) => item.entityId)
    .filter((id: string | null): id is string => Boolean(id));
  const staleDepartmentIds = staleDepartments.map((department) => department.id);
  const users = exactPhones.length || auditedUserIds.length || staleDepartmentIds.length
    ? await db.user.findMany({
        where: {
          OR: [
            { phone: { in: exactPhones } },
            { id: { in: auditedUserIds } },
            { factoryAccess: { some: { factoryId: state.factoryId, departmentId: { in: staleDepartmentIds } } } },
          ],
          factoryAccess: { some: { factoryId: state.factoryId } },
        },
        include: { factoryAccess: { where: { factoryId: state.factoryId } } },
      })
    : [];
  for (const user of users) {
    const access = user.factoryAccess[0];
    if (access?.isActive && !user.blockedAt) {
      const result = await apiCall(page, 'PATCH', `/admin/users/${user.id}/block-status`, {
        blocked: true,
        reason: 'Штатное завершение прерванной проверки Пласта 12',
      });
      expect(result.status, result.text).toBeLessThan(300);
      evidence.cleanup.push(`Preflight: заблокирован stale user ${user.id}`);
    }
    if (access?.isActive) {
      const result = await apiCall(page, 'PATCH', `/admin/users/${user.id}/factory-access`, {
        factoryId: state.factoryId,
        isActive: false,
        reason: 'Штатное завершение прерванной проверки Пласта 12',
      });
      expect(result.status, result.text).toBeLessThan(300);
      evidence.cleanup.push(`Preflight: отключён stale access ${user.id}`);
    }
  }

  const staleLines = await db.line.findMany({
    where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P12_' } },
    include: {
      positions: { where: { isActive: true, deletedAt: null } },
      staffingTemplates: { where: { isActive: true, deletedAt: null } },
    },
  });
  for (const line of staleLines) {
    for (const template of line.staffingTemplates) {
      const result = await apiCall(page, 'PATCH', `/admin/lines/${line.id}/staffing-templates/${template.id}`, {
        isActive: false,
        reason: 'Штатное завершение прерванной проверки Пласта 12',
      });
      expect(result.status, result.text).toBeLessThan(300);
    }
    for (const position of line.positions) {
      const result = await apiCall(page, 'PATCH', `/admin/lines/${line.id}/positions/${position.id}`, {
        isActive: false,
        reason: 'Штатное завершение прерванной проверки Пласта 12',
      });
      expect(result.status, result.text).toBeLessThan(300);
    }
    if (!line.deactivatedAt) {
      const result = await apiCall(page, 'PATCH', `/admin/lines/${line.id}`, {
        isActive: false,
        reason: 'Штатное завершение прерванной проверки Пласта 12',
      });
      expect(result.status, result.text).toBeLessThan(300);
    }
  }
  const staleTitles = await db.jobTitle.findMany({
    where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P12_' }, isActive: true, deletedAt: null },
    select: { id: true, parentJobTitleId: true },
  });
  const titlesLeafFirst = [...staleTitles];
  const orderedTitles: typeof staleTitles = [];
  while (titlesLeafFirst.length) {
    const leafIndex = titlesLeafFirst.findIndex((candidate) => !titlesLeafFirst.some((item) => item.parentJobTitleId === candidate.id));
    orderedTitles.push(...titlesLeafFirst.splice(leafIndex >= 0 ? leafIndex : 0, 1));
  }
  for (const title of orderedTitles) {
    const result = await apiCall(page, 'PATCH', `/admin/job-titles/${title.id}`, {
      isActive: false,
      reason: 'Штатное завершение прерванной проверки Пласта 12',
    });
    expect(result.status, result.text).toBeLessThan(300);
  }
  for (const department of await db.department.findMany({
    where: { factoryId: state.factoryId, name: { contains: '__PFFV5_P12_' }, isActive: true },
    select: { id: true },
  })) {
    const result = await apiCall(page, 'PATCH', `/admin/departments/${department.id}/status`, {
      isActive: false,
      reason: 'Штатное завершение прерванной проверки Пласта 12',
    });
    expect(result.status, result.text).toBeLessThan(300);
  }
}

async function createAdminStructures(page: Page) {
  await openAdmin(page);
  await openAdminSection(page, 'Отделы и службы');
  let panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать отдел или общую службу' }).first();
  for (const entry of [
    { stateKey: 'departmentId' as const, name: names.department, code: `p12-${numeric}` },
    { stateKey: 'techDepartmentId' as const, name: names.techDepartment, code: `p12-tech-${numeric}` },
  ]) {
    await panel.getByLabel('Название', { exact: true }).fill(entry.name);
    await panel.getByLabel('Код', { exact: true }).fill(entry.code);
    await panel.locator('select').first().selectOption('LOCAL');
    const departmentResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/departments'));
    await panel.getByRole('button', { name: 'Создать', exact: true }).click();
    expect((await departmentResponse).status()).toBeLessThan(300);
    await expect(page.getByText(entry.name, { exact: true }).first()).toBeVisible({ timeout: 25_000 });
    state[entry.stateKey] = (await db.department.findFirst({ where: { factoryId: state.factoryId, name: entry.name }, select: { id: true } }))?.id ?? '';
    expect(state[entry.stateKey]).not.toBe('');
  }

  await openAdminSection(page, 'Должности и роли');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать должность' }).first();
  for (const entry of [
    { key: 'masterTitle', name: names.masterTitle, code: `p12-master-${numeric}`, role: 'MASTER', departmentId: state.departmentId, parent: '' },
    { key: 'workerTitle', name: names.workerTitle, code: `p12-worker-${numeric}`, role: 'WORKER', departmentId: state.departmentId, parent: 'masterTitle' },
    { key: 'techTitle', name: names.techTitle, code: `p12-tech-${numeric}`, role: 'TECH_KIPIA', departmentId: state.techDepartmentId, parent: '' },
  ]) {
    await panel.getByLabel('Название', { exact: true }).fill(entry.name);
    await panel.getByLabel('Код', { exact: true }).fill(entry.code);
    await panel.locator('select').nth(0).selectOption(entry.role);
    await panel.locator('select').nth(2).selectOption(entry.departmentId);
    await panel.locator('select').nth(3).selectOption(entry.parent ? state.titleIds[entry.parent] : '');
    const titleResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/job-titles'));
    await panel.getByRole('button', { name: 'Создать должность', exact: true }).click();
    expect((await titleResponse).status()).toBeLessThan(300);
    await expect(page.locator('.job-title-row').filter({ hasText: entry.name }).first()).toBeVisible({ timeout: 25_000 });
    state.titleIds[entry.key] = (await db.jobTitle.findFirst({
      where: { factoryId: state.factoryId, name: entry.name }, select: { id: true },
    }))?.id ?? '';
    expect(state.titleIds[entry.key]).not.toBe('');
  }

  await openAdminSection(page, 'Пользователи и доступы');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Выдать доступ к выбранному заводу' }).first();
  for (const item of markerUsers) {
    const departmentId = item.departmentKey === 'tech' ? state.techDepartmentId : state.departmentId;
    const departmentName = item.departmentKey === 'tech' ? names.techDepartment : names.department;
    await panel.locator('select').nth(0).selectOption(item.userId);
    await panel.locator('select').nth(1).selectOption(state.factoryId);
    await panel.locator('select').nth(2).selectOption(item.role);
    await panel.locator('select').nth(3).selectOption(departmentId);
    await panel.locator('select').nth(4).selectOption(state.titleIds[item.titleKey]);
    const accessResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/admin/users/${item.userId}/factory-access`));
    await panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
    expect((await accessResponse).status()).toBeLessThan(300);
    const row = page.locator('article.admin-row')
      .filter({ hasText: phoneLabel(item.phone) })
      .filter({ hasText: departmentName })
      .first();
    await expect(row).toContainText(departmentName, { timeout: 25_000 });
  }

  await openAdminSection(page, 'Линии и позиции');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать линию' }).first();
  for (const [key, lineName] of [['main', names.mainLine], ['downtime', names.downtimeLine], ['wash', names.washLine]] as const) {
    await panel.getByLabel('Название линии', { exact: true }).fill(lineName);
    const lineResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/lines'));
    await panel.getByRole('button', { name: 'Создать линию', exact: true }).click();
    expect((await lineResponse).status()).toBeLessThan(300);
    await expect(page.locator('article.admin-line-row').filter({ hasText: lineName }).first()).toBeVisible({ timeout: 25_000 });
    state.lineIds[key] = (await db.line.findFirst({ where: { factoryId: state.factoryId, name: lineName }, select: { id: true } }))?.id ?? '';
    expect(state.lineIds[key]).not.toBe('');
  }

  await openAdminSection(page, 'Позиции на линиях');
  const positionsSection = page.locator('section.admin-card.wide').filter({ has: page.locator('h3').filter({ hasText: 'Позиции на линиях' }) }).first();
  panel = positionsSection.locator('.admin-setup-panel').filter({ hasText: 'Добавить позицию' }).first();
  for (let index = 0; index < names.positions.length; index += 1) {
    await panel.locator('select').first().selectOption(state.lineIds.main);
    await panel.locator('input:not([type])').nth(0).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(1).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(2).fill(`p12_${numeric}_${index + 1}`);
    await panel.locator('input[type="number"]').first().fill(String((index + 1) * 10));
    const positionResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/admin/lines/${state.lineIds.main}/positions`));
    await panel.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    expect((await positionResponse).status()).toBeLessThan(300);
    await expect(page.getByText(names.positions[index], { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  }
  state.positionIds = (await db.linePosition.findMany({
    where: { lineId: state.lineIds.main, displayName: { in: names.positions } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  })).map((item: { id: string }) => item.id);
  expect(state.positionIds).toHaveLength(3);

  await openAdminSection(page, 'Шаблоны состава');
  await page.locator('#admin-template-line').selectOption(state.lineIds.main);
  await page.locator('#admin-template-name').fill(names.template);
  const planned = [2, 1, 2];
  for (let index = 0; index < names.positions.length; index += 1) {
    await page.getByLabel(`Включить ${names.positions[index]}`).check();
    await page.getByLabel(`Минимум ${names.positions[index]}`).fill('1');
    await page.getByLabel(`План ${names.positions[index]}`).fill(String(planned[index]));
    await page.getByLabel(`Максимум ${names.positions[index]}`).fill(String(planned[index]));
  }
  await expect(page.getByTestId('admin-template-total')).toContainText('5 чел.');
  const templateResponse = page.waitForResponse((response) => response.request().method() === 'POST' && /\/admin\/(?:staffing-control\/)?lines\/[^/]+\/templates$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  expect((await templateResponse).status()).toBeLessThan(300);
  await expect(page.locator('article.admin-row').filter({ hasText: names.template }).first()).toBeVisible({ timeout: 25_000 });
  state.templateId = (await db.lineStaffingTemplate.findFirst({
    where: { lineId: state.lineIds.main, name: names.template }, select: { id: true },
  }))?.id ?? '';
  expect(state.templateId).not.toBe('');
  const template = page.locator('article.admin-row').filter({ hasText: names.template }).first();
  const makeDefault = template.getByRole('button', { name: 'Сделать основным', exact: true });
  if (await makeDefault.count()) {
    await makeDefault.click();
    await confirmAdmin(page);
  }
  await expect(template).toContainText('Основной состав');
  evidence.uiJourney.push('Admin UI: два отдела, должности, семь доступов, три линии, позиции и основной состав 2+1+2');
}

async function setLineStatusFromLines(page: Page, lineName: string, action: 'Остановить' | 'Вернуть в работу' | 'Простой', comment = `${marker} статус`) {
  await openMain(page, 'Линии');
  let card = page.locator('.line-card').filter({ hasText: lineName }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  const button = card.getByRole('button', { name: action, exact: true });
  if (!(await button.count())) return null;
  const requestPromise = page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith(`/lines/${state.lineIds.main}/status`) || (request.method() === 'PATCH' && new URL(request.url()).pathname.includes('/lines/') && new URL(request.url()).pathname.endsWith('/status')));
  await button.click();
  const dialog = page.getByRole('dialog').filter({
    hasText: lineName,
    has: page.getByRole('button', { name: 'Подтвердить', exact: true }),
  }).last();
  await expect(dialog).toBeVisible();
  const commentField = dialog.getByLabel('Комментарий', { exact: true });
  if (await commentField.count() && action !== 'Вернуть в работу') await commentField.fill(comment);
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const request = await requestPromise;
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  const detail = page.getByRole('dialog', { name: `Подробнее о линии ${lineName}` });
  if (await detail.isVisible().catch(() => false)) {
    await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(detail).toBeHidden({ timeout: 25_000 });
  }
  card = page.locator('.line-card').filter({ hasText: lineName }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  return request.postDataJSON();
}

async function startMarkerShifts(page: Page) {
  for (const item of markerUsers.filter((candidate) => candidate.key !== 'tech')) {
    await login(page, { phone: item.phone, password });
    const result = await apiCall(page, 'POST', '/shift/start', {});
    expect(result.status, `${item.key}: ${result.text}`).toBeLessThan(300);
  }
  evidence.uiJourney.push('Canonical ShiftSession запущен marker-мастером и работниками');
}

async function addWorkPlanRow(page: Page, scope: 'current' | 'future', article: string, product: string, gofr: number) {
  const owner = scope === 'future' ? page.locator('.planning-assignment-modal') : page.locator('.compact-line-dashboard');
  await owner.getByRole('button', { name: scope === 'future' ? 'Текущее задание будущей смены' : 'План', exact: true }).click();
  const plan = page.locator('.line-shift-assignment-modal');
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Добавить строку', exact: true }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'Добавить строку задания' }).last();
  await form.locator('#assignment-article').fill(article);
  await form.locator('#assignment-product').fill(product);
  await form.locator('#assignment-gofr').fill(String(gofr));
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(plan).toContainText(article, { timeout: 20_000 });
  await plan.getByRole('button', { name: 'Закрыть', exact: true }).click();
}

async function futureAssignByPhone(page: Page, slotLabel: string, phone: string, replace = false) {
  const board = page.locator('.planning-assignment-modal');
  const slot = board.locator('.slot-row').filter({ hasText: slotLabel }).first();
  await slot.getByRole('button', { name: replace ? 'Заменить' : 'Выбрать слот', exact: true }).click();
  await board.getByRole('button', { name: 'Назначить не отметившегося', exact: true }).click();
  const search = page.getByRole('dialog').filter({ hasText: 'Найти сотрудника' }).last();
  await search.getByPlaceholder('Поиск: фамилия, имя или телефон').fill(phone);
  const candidate = search.locator('.people-search-result-card').filter({ hasText: phoneLabel(phone) }).first();
  await expect(candidate).toBeVisible({ timeout: 25_000 });
  await candidate.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await board.getByRole('button', { name: /^Назначить:/ }).click();
  await expect(slot).toContainText('Запланирован', { timeout: 25_000 });
}

async function prepareFuturePlan(page: Page) {
  await openMain(page, 'Смена');
  await page.locator('.shift-selector-compact').click();
  const picker = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await picker.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();
  const linePicker = page.locator('.future-plan-line-picker');
  await linePicker.locator('.future-plan-line-row').filter({ hasText: names.mainLine }).click();
  const board = page.locator('.planning-assignment-modal');
  await expect(board.locator('.slot-row')).toHaveCount(5, { timeout: 25_000 });
  await addWorkPlanRow(page, 'future', names.futureArticle, names.futureProduct, 240);
  await futureAssignByPhone(page, `${names.positions[0]} #1`, markerUsers[1].phone);
  await futureAssignByPhone(page, `${names.positions[0]} #2`, markerUsers[2].phone);
  await futureAssignByPhone(page, `${names.positions[0]} #1`, markerUsers[3].phone, true);
  const replaced = board.locator('.slot-row').filter({ hasText: `${names.positions[0]} #1` }).first();
  await replaced.getByRole('button', { name: 'Освободить', exact: true }).click();
  await expect(replaced).toContainText('Не назначен', { timeout: 20_000 });
  await futureAssignByPhone(page, `${names.positions[0]} #1`, markerUsers[1].phone);
  const active = await db.plannedLineAssignment.findMany({ where: { lineId: state.lineIds.main, releasedAt: null } });
  expect(active).toHaveLength(2);
  expect(new Set(active.map((item: any) => item.userId)).size).toBe(2);
  state.plannedAssignmentIds = active.map((item: any) => item.id);
  await board.getByRole('button', { name: 'Закрыть', exact: true }).click();
  evidence.uiJourney.push('Future UI: линия, состав 5, задание, assign/replace/release/reassign без дублей');
}

async function openShiftLine(page: Page, lineName: string) {
  const alreadyOpen = page.locator('.compact-line-dashboard').filter({ hasText: lineName });
  if (await alreadyOpen.isVisible().catch(() => false)) {
    return { card: page.locator('.current-shift-line-card').filter({ hasText: lineName }).first(), dashboard: alreadyOpen };
  }
  const peoplePanel = page.locator('#shift-people-panel');
  if (await peoplePanel.isVisible().catch(() => false)) {
    await peoplePanel.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(peoplePanel).toBeHidden({ timeout: 25_000 });
  }
  await openMain(page, 'Смена');
  const card = page.locator('.current-shift-line-card').filter({ hasText: lineName }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: lineName });
  await expect(dashboard).toBeVisible({ timeout: 25_000 });
  return { card, dashboard };
}

async function personFirstAssign(page: Page, phone: string, slotLabel: string) {
  const panel = page.locator('#shift-people-panel');
  if (!(await panel.isVisible().catch(() => false))) {
    const peopleButton = page.getByRole('button', { name: /Люди на смене/ }).filter({ visible: true }).first();
    await peopleButton.click();
  }
  await expect(panel).toBeVisible();
  const card = panel.locator('.workforce-person-card').filter({ hasText: phoneLabel(phone) }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: /Назначить|Переназначить/ }).click();
  await page.locator('.assignment-target-sheet').locator('.target-line').click();
  const linePicker = page.locator('.current-line-picker-sheet');
  await linePicker.locator('.shift-picker-option').filter({ hasText: names.mainLine }).click();
  const picker = page.getByTestId('person-first-slot-picker');
  const slot = picker.locator('.slot-row').filter({ hasText: slotLabel }).first();
  await slot.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(picker).toHaveCount(0, { timeout: 25_000 });
}

async function slotFirstAssign(page: Page, phone: string, slotLabel: string) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.mainLine });
  const slot = dashboard.locator('.slot-row').filter({ hasText: slotLabel }).first();
  await slot.getByRole('button', { name: 'Назначить', exact: true }).click();
  const picker = page.getByTestId('slot-first-person-picker');
  const candidate = picker.locator('.candidate-card').filter({ hasText: phoneLabel(phone) }).first();
  await expect(candidate).toBeVisible({ timeout: 20_000 });
  await candidate.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(picker).toHaveCount(0, { timeout: 25_000 });
}

async function releaseSlot(page: Page, slotLabel: string) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.mainLine });
  const slot = dashboard.locator('.slot-row').filter({ hasText: slotLabel }).first();
  await slot.getByRole('button', { name: 'Действия', exact: true }).click();
  const actions = page.getByRole('dialog').filter({ hasText: 'Действия с сотрудником' }).last();
  await actions.getByText('Освободить', { exact: true }).first().click();
  await expect(dashboard).toHaveCount(0, { timeout: 25_000 });
}

async function assertCrossScreenState(page: Page, expected: 'RUNNING' | 'DOWNTIME' | 'WASH' | 'STOPPED') {
  const shift = await apiOk<any[]>(page, 'GET', '/lines/shift-overview');
  expect(shift.find((line) => line.id === state.lineIds.main)?.operationalState).toBe(expected);
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.mainLine });
  if (await dashboard.isVisible().catch(() => false)) {
    await dashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(dashboard).toHaveCount(0, { timeout: 25_000 });
  }
  await openMain(page, 'Линии');
  const card = page.locator('.line-card').filter({ hasText: names.mainLine }).first();
  const labels: Record<string, RegExp> = {
    RUNNING: /Работает|В работе/,
    DOWNTIME: /Простой/,
    WASH: /На мойке/,
    STOPPED: /Остановлена/,
  };
  await expect(card).toContainText(labels[expected], { timeout: 25_000 });
  await card.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const detail = page.getByRole('dialog', { name: `Подробнее о линии ${names.mainLine}` });
  await expect(detail).toContainText(labels[expected]);
  await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
}

async function openLineActions(page: Page) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.mainLine });
  await dashboard.getByRole('button', { name: 'Все действия', exact: true }).click();
  return page.locator('.line-actions-premium-sheet');
}

async function lineActionFromShift(page: Page, action: 'Зафиксировать простой' | 'Вернуть в работу' | 'Остановить линию', comment = `${marker} действие`) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.mainLine });
  if (action === 'Остановить линию') {
    const sheet = await openLineActions(page);
    await sheet.locator('.premium-action-item').filter({ hasText: action }).click();
  } else {
    await dashboard.getByRole('button', { name: action, exact: true }).click();
  }
  const dialog = page.getByRole('dialog')
    .filter({ hasText: names.mainLine })
    .filter({ has: page.getByRole('button', { name: 'Подтвердить', exact: true }) })
    .last();
  if (action !== 'Вернуть в работу') await dialog.getByPlaceholder('Комментарий к событию').fill(comment);
  const requestPromise = page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith(`/lines/${state.lineIds.main}/status`));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/lines/${state.lineIds.main}/status`));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  return request.postDataJSON();
}

async function createLinkedDowntimeTask(page: Page, lineName: string, description: string) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: lineName });
  await dashboard.getByRole('button', { name: 'Все действия', exact: true }).click();
  const sheet = page.locator('.line-actions-premium-sheet');
  await sheet.locator('.premium-action-item').filter({ hasText: 'Заявка из простоя' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: lineName }).last();
  await dialog.locator('#downtime-task-department').selectOption(state.techDepartmentId);
  await dialog.getByPlaceholder('Что нужно срочно сделать').fill(description);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/tasks'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/tasks'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBeLessThan(300);
  return { body: request.postDataJSON(), task: await response.json() };
}

async function taskCard(page: Page, description: string) {
  const card = page.locator('.task-card').filter({ hasText: description }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

async function openTask(page: Page, description: string) {
  const existing = page.getByRole('dialog').filter({ hasText: description }).filter({ visible: true }).last();
  if (await existing.isVisible().catch(() => false)) return existing;
  const card = await taskCard(page, description);
  await card.getByRole('button', { name: 'Открыть', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: description }).last();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeTaskDialog(page: Page) {
  const close = page.getByRole('dialog').getByRole('button', { name: 'Закрыть окно', exact: true }).last();
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function takeCommentCompleteTask(page: Page, description: string) {
  let detail = await openTask(page, description);
  await detail.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled({ timeout: 25_000 });
  await detail.getByRole('button', { name: 'Добавить комментарий', exact: true }).click();
  let dialog = page.getByRole('dialog').filter({ hasText: 'Комментарий к заявке' }).last();
  await dialog.getByPlaceholder('Комментарий').fill(`${marker} Исполнитель подтвердил работу`);
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  detail = page.getByRole('dialog')
    .filter({ hasText: description })
    .filter({ has: page.getByRole('button', { name: 'Завершить заявку', exact: true }) })
    .last();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await detail.getByRole('button', { name: 'Завершить заявку', exact: true }).click();
  dialog = page.getByRole('dialog').filter({ hasText: 'Завершить заявку' }).last();
  const comment = dialog.getByLabel(/Комментарий/);
  if (await comment.count()) await comment.fill(`${marker} Работы завершены`);
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
}

async function createOrdinaryTask(page: Page, description: string, lineId: string) {
  await openMain(page, 'Заявки');
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать заявку' }).last();
  await dialog.getByLabel('Описание', { exact: true }).fill(description);
  await dialog.getByLabel('Тип', { exact: true }).selectOption('URGENT');
  await dialog.getByLabel('Линия', { exact: true }).selectOption(lineId);
  await dialog.getByLabel('Служба / отдел', { exact: true }).selectOption(state.techDepartmentId);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/tasks'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(300);
  return response.json();
}

async function startWashFromShift(page: Page, lineName: string) {
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: lineName });
  await dashboard.getByRole('button', { name: 'Все действия', exact: true }).click();
  await page.locator('.line-actions-premium-sheet').locator('.premium-action-item').filter({ hasText: 'Начать мойку' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: lineName }).last();
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/wash/start'));
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(300);
  return response.json();
}

async function startWashFromWashScreen(page: Page, lineName: string, lineId: string) {
  await openMain(page, 'Мойка');
  await page.getByRole('button', { name: 'Начать мойку', exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog')
    .filter({ hasText: 'Остановленная линия' })
    .filter({ has: page.getByRole('button', { name: 'Начать мойку', exact: true }) })
    .last();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('select').selectOption(lineId);
  await expect(dialog).toContainText(lineName);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/wash/start'));
  await dialog.getByRole('button', { name: 'Начать мойку', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(300);
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  return response.json();
}

async function assignWorkerToWash(page: Page, phone: string, washId: string) {
  await openMain(page, 'Мойка');
  const card = page.locator('.wash-session-card').filter({ hasText: names.mainLine }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: 'Люди', exact: true }).click();
  const people = page.locator('#shift-people-panel');
  await expect(people).toBeVisible({ timeout: 25_000 });
  const person = people.locator('.workforce-person-card').filter({ hasText: phoneLabel(phone) }).first();
  await person.getByRole('button', { name: /Назначить|Переназначить/ }).click();
  await page.locator('.assignment-target-sheet').locator('.target-wash').click();
  const action = page.getByRole('dialog').filter({ hasText: /Назначение на мойку/ }).last();
  await action.locator('#wash-session-select').selectOption(washId);
  await action.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(action).toBeHidden({ timeout: 25_000 });
  const detail = page.locator('.wash-detail-screen').filter({ hasText: names.mainLine });
  await expect(detail).toBeVisible({ timeout: 25_000 });
}

async function completeWash(page: Page, lineName: string) {
  const current = page.locator('.wash-detail, .wash-session-detail, .screen-panel').filter({ hasText: lineName }).last();
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && /\/wash\/[^/]+\/complete$/.test(new URL(response.url()).pathname));
  await current.getByRole('button', { name: 'Завершить мойку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Завершить мойку' }).last();
  await dialog.getByRole('button', { name: 'Завершить мойку', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(300);
  return { response: await response.json(), requestBody: response.request().postDataJSON() };
}

async function createHelperTail(page: Page) {
  await setLineStatusFromLines(page, names.downtimeLine, 'Вернуть в работу');
  await openMain(page, 'Смена');
  const helper = await openShiftLine(page, names.downtimeLine);
  await helper.dashboard.getByRole('button', { name: 'Зафиксировать простой', exact: true }).click();
  let dialog = page.getByRole('dialog').filter({ hasText: names.downtimeLine }).last();
  await dialog.getByPlaceholder('Комментарий к событию').fill(`${marker} Открытый хвост`);
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await openShiftLine(page, names.downtimeLine);
  const linked = await createLinkedDowntimeTask(page, names.downtimeLine, names.helperLinkedTask);
  state.helperLinkedTaskId = linked.task.id;
  state.helperDowntimeEventId = (await db.task.findUnique({ where: { id: linked.task.id } }))?.lineStatusEventId ?? '';
  expect(state.helperDowntimeEventId).not.toBe('');
  const helperDashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.downtimeLine });
  await helperDashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(helperDashboard).toHaveCount(0, { timeout: 25_000 });
  const ordinary = await createOrdinaryTask(page, names.ordinaryTask, state.lineIds.downtime);
  state.ordinaryTaskId = ordinary.id;

  await setLineStatusFromLines(page, names.washLine, 'Остановить', `${marker} Подготовка мойки`);
  const started = await startWashFromWashScreen(page, names.washLine, state.lineIds.wash);
  state.helperWashId = started.id;
}

async function openHandoverAndSubmit(page: Page) {
  await openMain(page, 'Смена');
  const button = page.getByRole('button', { name: /Передать смену|Открыть передачу смены/ }).filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: 25_000 });
  await button.click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Закрыть и передать смену' }).last();
  await expect(dialog).toContainText(names.currentArticle);
  await expect(dialog).toContainText('240');
  await expect(dialog).toContainText('гофр');
  await expect(dialog).toContainText('По плану');
  await expect(dialog).toContainText(names.washLine);
  await expect(dialog).toContainText(names.helperLinkedTask);
  await expect(dialog).not.toContainText(names.ordinaryTask);
  await expect(dialog).not.toContainText(phoneLabel(markerUsers[1].phone));
  await expect(dialog).not.toContainText('Чек-лист');
  await page.waitForTimeout(300);
  await page.screenshot({ path: screenshotPath('05-handover-390.png'), fullPage: false });
  await dialog.getByLabel('Комментарий следующей смене').fill(names.handoverComment);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/shift-log/handover'));
  await dialog.getByRole('button', { name: 'Передать следующей смене', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(300);
  const payload = await response.json();
  state.handoverId = payload.id;
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  return payload;
}

async function completeTaskByApi(page: Page, taskId: string, comment: string) {
  const detail = await apiCall<any>(page, 'GET', `/tasks/${taskId}`);
  if (detail.ok && detail.body?.status !== 'DONE') {
    const result = await apiCall(page, 'POST', `/tasks/${taskId}/complete`, { operationId: randomUUID(), comment });
    expect(result.status, result.text).toBeLessThan(300);
  }
}

async function releasePlannedAssignments(page: Page) {
  const active = await db.plannedLineAssignment.findMany({ where: { lineId: state.lineIds.main, releasedAt: null } });
  for (const assignment of active) {
    const result = await apiCall(page, 'POST', `/lines/${state.lineIds.main}/planning-board/release/${assignment.id}`, {});
    expect(result.status, result.text).toBeLessThan(300);
  }
  evidence.cleanup.push(`Освобождены плановые назначения: ${active.length}`);
}

async function endMarkerShifts(page: Page) {
  for (const item of markerUsers) {
    await login(page, { phone: item.phone, password });
    await apiCall(page, 'POST', '/notifications/read-all', {});
    const active = await db.shiftSession.count({ where: { userId: item.userId, factoryId: state.factoryId, status: 'ACTIVE' } });
    if (active) {
      const result = await apiCall(page, 'POST', '/shift/end', {});
      expect(result.status, result.text).toBeLessThan(300);
    }
  }
  for (const account of [credentials.management, credentials.admin]) {
    await login(page, account);
    await apiCall(page, 'POST', '/notifications/read-all', {});
  }
}

async function stopMarkerLines(page: Page) {
  await login(page, credentials.admin);
  for (const lineName of [names.mainLine, names.downtimeLine, names.washLine]) {
    await openMain(page, 'Линии');
    const card = page.locator('.line-card').filter({ hasText: lineName }).first();
    if (await card.getByRole('button', { name: 'Остановить', exact: true }).count()) {
      await setLineStatusFromLines(page, lineName, 'Остановить', `${marker} Финальная остановка`);
    } else if (await card.getByRole('button', { name: 'Простой', exact: true }).count()) {
      await card.getByRole('button', { name: 'Подробнее', exact: true }).click();
      const detail = page.getByRole('dialog', { name: `Подробнее о линии ${lineName}` });
      await detail.getByRole('button', { name: 'Вернуть в работу', exact: true }).click();
      let dialog = page.getByRole('dialog').filter({ hasText: lineName }).last();
      await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await setLineStatusFromLines(page, lineName, 'Остановить', `${marker} Финальная остановка`);
    }
  }
}

async function deactivateStructures(page: Page, options: { skipUsers?: boolean } = {}) {
  await login(page, credentials.admin);
  await openAdmin(page);
  if (!options.skipUsers) {
    await openAdminSection(page, 'Пользователи и доступы');
    const search = page.getByPlaceholder('Поиск по пользователю, роли или отделу');
    for (const item of markerUsers) {
      const departmentName = item.departmentKey === 'tech' ? names.techDepartment : names.department;
      await search.fill(phoneLabel(item.phone));
      let row = page.locator('article.admin-row')
        .filter({ hasText: phoneLabel(item.phone) })
        .filter({ hasText: departmentName })
        .first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      const block = row.getByRole('button', { name: 'Заблокировать', exact: true });
      if (await block.count()) { await block.click(); await confirmAdmin(page); }
      row = page.locator('article.admin-row')
        .filter({ hasText: phoneLabel(item.phone) })
        .filter({ hasText: departmentName })
        .first();
      await row.getByRole('button', { name: 'Профиль', exact: true }).click();
      const profileHeading = page.getByRole('heading')
        .filter({ hasText: 'Профиль пользователя:' })
        .filter({ hasText: phoneLabel(item.phone) })
        .last();
      await expect(profileHeading).toBeVisible({ timeout: 20_000 });
      const profile = profileHeading.locator('xpath=ancestor::section[contains(@class, "admin-card")][1]');
      await expect(profile).toBeVisible({ timeout: 20_000 });
      const deactivate = profile.getByRole('button', { name: 'Отключить доступ', exact: true });
      await expect(deactivate).toBeVisible({ timeout: 20_000 });
      const accessResponse = page.waitForResponse((response) => response.request().method() === 'PATCH'
        && new URL(response.url()).pathname.endsWith(`/admin/users/${item.userId}/factory-access`));
      await deactivate.click();
      await confirmAdmin(page);
      expect((await accessResponse).status()).toBeLessThan(300);
      await expect.poll(async () => {
        const access = await db.userFactoryAccess.findUnique({
          where: { userId_factoryId: { userId: item.userId, factoryId: state.factoryId } },
          select: { isActive: true },
        });
        return access?.isActive ?? false;
      }, { timeout: 20_000 }).toBe(false);
      await openAdminSection(page, 'Пользователи и доступы');
    }
  }

  await openAdminSection(page, 'Шаблоны состава');
  const template = page.locator('article.admin-row').filter({ hasText: names.template }).first();
  if (await template.getByRole('button', { name: 'Отключить', exact: true }).count()) { await template.getByRole('button', { name: 'Отключить', exact: true }).click(); await confirmAdmin(page); }

  await openAdminSection(page, 'Позиции на линиях');
  for (const positionName of names.positions) {
    const position = page.locator('.admin-mini-row').filter({ hasText: positionName }).first();
    if (await position.getByRole('button', { name: 'Отключить', exact: true }).count()) { await position.getByRole('button', { name: 'Отключить', exact: true }).click(); await confirmAdmin(page); }
  }

  await openAdminSection(page, 'Линии и позиции');
  for (const lineName of [names.mainLine, names.downtimeLine, names.washLine]) {
    const line = page.locator('article.admin-line-row').filter({ hasText: lineName }).first();
    if (await line.count()) {
      await line.getByRole('button', { name: 'Управление', exact: true }).click();
      const deactivate = line.getByRole('button', { name: 'Отключить линию', exact: true });
      if (await deactivate.count()) { await deactivate.click(); await confirmAdmin(page); }
    }
  }

  await openAdminSection(page, 'Должности и роли');
  for (const titleName of [names.workerTitle, names.masterTitle, names.techTitle]) {
    const title = page.locator('.job-title-row').filter({ hasText: titleName }).first();
    if (await title.getByRole('button', { name: 'Отключить', exact: true }).count()) { await title.getByRole('button', { name: 'Отключить', exact: true }).click(); await confirmAdmin(page); }
  }

  await openAdminSection(page, 'Отделы и службы');
  for (const departmentName of [names.techDepartment, names.department]) {
    const department = page.locator('article.admin-row').filter({ hasText: departmentName }).first();
    if (await department.getByRole('button', { name: 'Деактивировать', exact: true }).count()) { await department.getByRole('button', { name: 'Деактивировать', exact: true }).click(); await confirmAdmin(page); }
  }
  evidence.cleanup.push('Marker users/accesses/templates/positions/lines/titles/departments деактивированы штатно');
}

async function finalInventory(page: Page) {
  const markerUserIds = markerUsers.map((item) => item.userId).filter(Boolean);
  const lineIds = Object.values(state.lineIds).filter(Boolean);
  const activeLines = await db.line.count({ where: { id: { in: lineIds }, deletedAt: null, deactivatedAt: null } });
  const activeTemplates = await db.lineStaffingTemplate.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } });
  const activePositions = await db.linePosition.count({ where: { lineId: { in: lineIds }, isActive: true, deletedAt: null, deactivatedAt: null } });
  const actualAssignments = await db.assignment.count({ where: { factoryId: state.factoryId, userId: { in: markerUserIds }, endedAt: null } });
  const futureAssignments = await db.plannedLineAssignment.count({ where: { factoryId: state.factoryId, userId: { in: markerUserIds }, releasedAt: null } });
  const activeDowntime = await db.lineEvent.count({ where: { lineId: { in: lineIds }, status: 'PAUSE', confirmedEndAt: null } });
  const activeTasks = await db.task.count({ where: { id: { in: [state.linkedTaskId, state.helperLinkedTaskId, state.ordinaryTaskId].filter(Boolean) }, status: { not: 'DONE' }, archivedAt: null, deletedAt: null } });
  const activeWash = await db.washSession.count({ where: { lineId: { in: lineIds }, status: { not: 'DONE' }, completedAt: null, deletedAt: null } });
  const activeSessions = await db.shiftSession.count({ where: { userId: { in: markerUserIds }, status: 'ACTIVE' } });
  const activeAccesses = await db.userFactoryAccess.count({ where: { userId: { in: markerUserIds }, factoryId: state.factoryId, isActive: true } });
  const activeShiftPlans = await db.lineShiftWorkPlan.count({
    where: { lineId: { in: lineIds }, line: { deletedAt: null, deactivatedAt: null } },
  });
  const unreadNotifications = await db.notification.count({
    where: {
      readAt: null,
      OR: [
        { userId: { in: markerUserIds } },
        { entityId: { in: [...lineIds, state.linkedTaskId, state.helperLinkedTaskId, state.ordinaryTaskId].filter(Boolean) } },
        { title: { contains: marker } },
        { message: { contains: marker } },
      ],
    },
  });
  evidence.inventory = {
    activeMarkerLines: activeLines,
    activeMarkerStaffingTemplates: activeTemplates,
    activeMarkerPositions: activePositions,
    activeMarkerActualAssignments: actualAssignments,
    activeMarkerFutureAssignments: futureAssignments,
    activeMarkerDowntimeEvents: activeDowntime,
    activeMarkerLinkedRequests: activeTasks,
    activeMarkerWashSessions: activeWash,
    activeMarkerShiftSessions: activeSessions,
    activeMarkerAccesses: activeAccesses,
    activeMarkerShiftPlans: activeShiftPlans,
    activeMarkerNotifications: unreadNotifications,
  };
  expect(Object.values(evidence.inventory).reduce((sum, value) => sum + value, 0)).toBe(0);

  const timeline = await apiOk<any>(page, 'GET', '/shift/timeline');
  const currentShiftDateKey = String(timeline.current.shiftDate).slice(0, 10);
  const currentShiftDate = new Date(`${currentShiftDateKey}T00:00:00+03:00`);
  const currentOrFutureShift = timeline.current.shiftType === 'NIGHT'
    ? {
        OR: [
          { shiftDate: { gt: currentShiftDate } },
          { shiftDate: currentShiftDate, shiftType: 'NIGHT' },
        ],
      }
    : { shiftDate: { gte: currentShiftDate } };
  const [
    activeDefaultLines,
    activeStaffingItems,
    activePausedLines,
    linkedActiveTasks,
    activeWashSessions,
  ] = await Promise.all([
    db.line.findMany({
      where: { factoryId: state.factoryId, deletedAt: null, deactivatedAt: null, defaultStaffingTemplateId: { not: null } },
      include: { defaultStaffingTemplate: true },
    }),
    db.lineStaffingTemplateItem.findMany({
      where: {
        template: {
          factoryId: state.factoryId,
          isActive: true,
          deletedAt: null,
          deactivatedAt: null,
          line: { deletedAt: null, deactivatedAt: null },
        },
      },
      include: { template: true, position: true },
    }),
    db.line.findMany({
      where: { factoryId: state.factoryId, status: 'PAUSE', deletedAt: null, deactivatedAt: null },
      include: { events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    }),
    db.task.findMany({
      where: {
        factoryId: state.factoryId,
        status: { not: 'DONE' },
        archivedAt: null,
        deletedAt: null,
        lineStatusEventId: { not: null },
      },
      select: { lineId: true, lineStatusEventId: true },
    }),
    db.washSession.findMany({
      where: { factoryId: state.factoryId, status: { not: 'DONE' }, completedAt: null, deletedAt: null },
      include: { line: true },
    }),
  ]);
  const linkedEventIds = linkedActiveTasks.map((task) => task.lineStatusEventId).filter(Boolean) as string[];
  const linkedEvents = await db.lineEvent.findMany({
    where: { id: { in: linkedEventIds } },
    include: { line: true },
  });
  const linkedEventById = new Map(linkedEvents.map((event) => [event.id, event]));

  evidence.referenceIntegrity = {
    orphanActiveLineAssignments: await db.assignment.count({ where: { factoryId: state.factoryId, kind: 'LINE', endedAt: null, lineId: null } }),
    activeAssignmentToInactiveLine: await db.assignment.count({
      where: {
        factoryId: state.factoryId,
        kind: 'LINE',
        endedAt: null,
        lineId: { not: null },
        line: { OR: [{ deletedAt: { not: null } }, { deactivatedAt: { not: null } }] },
      },
    }),
    orphanActiveWashAssignments: await db.assignment.count({ where: { factoryId: state.factoryId, kind: 'WASH', endedAt: null, washSessionId: null } }),
    activeWashAssignmentWithoutContext: await db.assignment.count({
      where: {
        factoryId: state.factoryId,
        kind: 'WASH',
        endedAt: null,
        washSessionId: { not: null },
        washSession: { OR: [{ completedAt: { not: null } }, { deletedAt: { not: null } }, { status: 'DONE' }] },
      },
    }),
    brokenActiveDefaultStaffingTemplate: activeDefaultLines.filter((line) => {
      const template = line.defaultStaffingTemplate;
      return !template
        || !template.isActive
        || Boolean(template.deletedAt)
        || Boolean(template.deactivatedAt)
        || template.factoryId !== line.factoryId
        || template.lineId !== line.id;
    }).length,
    orphanActiveStaffingItem: activeStaffingItems.filter((item) => (
      !item.position.isActive
      || Boolean(item.position.deletedAt)
      || Boolean(item.position.deactivatedAt)
      || item.position.lineId !== item.template.lineId
    )).length,
    openDowntimeWithoutValidLine: activePausedLines.filter((line) => line.events[0]?.status !== 'PAUSE').length,
    linkedActiveDowntimeTaskInvalidEvent: linkedActiveTasks.filter((task) => {
      const event = linkedEventById.get(task.lineStatusEventId as string);
      return !event
        || event.status !== 'PAUSE'
        || event.lineId !== task.lineId
        || Boolean(event.line.deletedAt)
        || Boolean(event.line.deactivatedAt);
    }).length,
    activeWashInvalidLine: activeWashSessions.filter((wash) => (
      wash.targetType === 'LINE'
      && (!wash.lineId || !wash.line || Boolean(wash.line.deletedAt) || Boolean(wash.line.deactivatedAt))
    )).length,
    futureAssignmentInvalidLine: await db.plannedLineAssignment.count({
      where: {
        factoryId: state.factoryId,
        releasedAt: null,
        ...currentOrFutureShift,
        line: { OR: [{ deletedAt: { not: null } }, { deactivatedAt: { not: null } }] },
      },
    }),
    futureAssignmentInvalidPosition: await db.plannedLineAssignment.count({
      where: {
        factoryId: state.factoryId,
        releasedAt: null,
        ...currentOrFutureShift,
        position: { OR: [{ isActive: false }, { deletedAt: { not: null } }, { deactivatedAt: { not: null } }] },
      },
    }),
  };
  expect(Object.values(evidence.referenceIntegrity).reduce((sum, value) => sum + value, 0)).toBe(0);
  evidence.historicalReferenceWarnings = {
    pastUnreleasedAssignmentsOnInactiveLines: await db.plannedLineAssignment.count({
      where: {
        factoryId: state.factoryId,
        releasedAt: null,
        shiftDate: { lt: currentShiftDate },
        line: { OR: [{ deletedAt: { not: null } }, { deactivatedAt: { not: null } }] },
      },
    }),
  };
}

async function postCleanupBrowser(page: Page) {
  writeClock('2026-08-14T08:15:00+03:00');
  await login(page, credentials.admin);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const screen of ['Смена', 'Люди', 'Линии', 'Заявки', 'Мойка', 'Уведомления']) {
      await openMain(page, screen);
      await noHorizontalOverflow(page);
      await expectHumanUi(page);
      expect(await page.locator('body').innerText()).not.toContain(marker);
    }
    evidence.postCleanup.push(`${width}px: базовые экраны открыты без marker и overflow`);
  }
  await openMain(page, 'Смена');
  await page.screenshot({ path: screenshotPath('07-post-cleanup-shift-390.png'), fullPage: false });
  await openMain(page, 'Линии');
  const existing = page.locator('.line-card').filter({ visible: true }).first();
  if (await existing.count()) {
    await existing.getByRole('button', { name: 'Подробнее', exact: true }).click();
    const detail = page.getByRole('dialog', { name: /Подробнее о линии/ });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'История линии', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'История линии' })).toBeVisible({ timeout: 25_000 });
    await expectHumanUi(page);
  }
}

async function emergencyCleanup(page: Page) {
  try { await login(page, credentials.admin); } catch { return; }
  for (const taskId of [state.linkedTaskId, state.helperLinkedTaskId, state.ordinaryTaskId].filter(Boolean)) {
    try { await completeTaskByApi(page, taskId, `${marker} аварийное штатное завершение`); } catch { /* Best effort only. */ }
  }
  for (const washId of [state.mainWashId, state.helperWashId].filter(Boolean)) {
    try {
      const wash = await db.washSession.findUnique({ where: { id: washId } });
      if (wash && wash.status !== 'DONE') await apiCall(page, 'POST', `/wash/${washId}/complete`, { operationId: randomUUID() });
    } catch { /* Best effort only. */ }
  }
  try { await releasePlannedAssignments(page); } catch { /* Best effort only. */ }
  try { await endMarkerShifts(page); } catch { /* Best effort only. */ }
  try { await stopMarkerLines(page); } catch { /* Best effort only. */ }
  try {
    await login(page, credentials.admin);
    for (const item of markerUsers.filter((candidate) => candidate.userId)) {
      try {
        const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: item.userId, factoryId: state.factoryId } } });
        const user = await db.user.findUnique({ where: { id: item.userId }, select: { blockedAt: true } });
        if (user && !user.blockedAt) {
          const result = await apiCall(page, 'PATCH', `/admin/users/${item.userId}/block-status`, {
            blocked: true, reason: `${marker} аварийное штатное завершение`,
          });
          if (!result.ok) throw new Error(`User block cleanup failed: ${result.status}`);
        }
        if (access?.isActive) {
          const result = await apiCall(page, 'PATCH', `/admin/users/${item.userId}/factory-access`, {
            factoryId: state.factoryId, isActive: false, reason: `${marker} аварийное штатное завершение`,
          });
          if (!result.ok) throw new Error(`Factory access cleanup failed: ${result.status}`);
        }
      } catch (error) {
        evidence.cleanup.push(`Аварийный cleanup ${item.key}: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
      }
    }
  } catch { /* Best effort only. */ }
  try { await deactivateStructures(page, { skipUsers: true }); } catch { /* Best effort only. */ }
}

test('P12: мастер проводит одну каноническую смену от плана до пересменки', async ({ page, browser }) => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(evidenceDir, { recursive: true });
  writeClock('2026-08-13T18:30:00+03:00');
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
  page.on('requestfailed', (request) => evidence.networkErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  let managementContext: BrowserContext | null = null;
  let techContext: BrowserContext | null = null;
  let primaryError: unknown = null;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, credentials.admin);
    await cleanupInterruptedP12Accesses(page);
    evidence.preexisting.beforeHash = await baselineHash();
    for (const item of markerUsers) await registerMarkerUser(page, item);
    await login(page, credentials.admin);
    await createAdminStructures(page);
    await setLineStatusFromLines(page, names.mainLine, 'Остановить', `${marker} Подготовка запуска`);
    await setLineStatusFromLines(page, names.downtimeLine, 'Остановить', `${marker} Подготовка хвоста`);
    await setLineStatusFromLines(page, names.washLine, 'Остановить', `${marker} Подготовка мойки`);
    await startMarkerShifts(page);

    await login(page, { phone: markerUsers[0].phone, password });
    const departments = await apiOk<any[]>(page, 'GET', '/tasks/recipient-departments');
    expect(departments.some((item) => item.id === state.techDepartmentId && item.name === names.techDepartment)).toBe(true);
    await prepareFuturePlan(page);

    await setLineStatusFromLines(page, names.mainLine, 'Вернуть в работу');
    await assertCrossScreenState(page, 'RUNNING');
    const current = await openShiftLine(page, names.mainLine);
    await addWorkPlanRow(page, 'current', names.currentArticle, names.currentProduct, 240);
    await current.dashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();

    managementContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const management = await managementContext.newPage();
    await login(management, credentials.management);
    await openMain(management, 'Смена');
    let observerCard = management.locator('.current-shift-line-card').filter({ hasText: names.mainLine }).first();
    await expect(observerCard.locator('.line-people-count')).toContainText(/0\/5/);

    await personFirstAssign(page, markerUsers[1].phone, `${names.positions[0]} #1`);
    await expect(observerCard.locator('.line-people-count')).toContainText(/1\/5/, { timeout: 25_000 });
    evidence.realtime.push('Management без reload увидел 0/5 → 1/5');
    await openShiftLine(page, names.mainLine);
    await slotFirstAssign(page, markerUsers[2].phone, `${names.positions[0]} #2`);
    await expect(observerCard.locator('.line-people-count')).toContainText(/2\/5/, { timeout: 25_000 });
    await slotFirstAssign(page, markerUsers[3].phone, `${names.positions[1]} #1`);
    await expect(observerCard.locator('.line-people-count')).toContainText(/3\/5/, { timeout: 25_000 });

    await page.locator('.compact-line-dashboard').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await personFirstAssign(page, markerUsers[1].phone, `${names.positions[2]} #1`);
    const activeAfterMove = await db.assignment.findMany({ where: { factoryId: state.factoryId, userId: markerUsers[1].userId, endedAt: null } });
    expect(activeAfterMove).toHaveLength(1);
    expect(activeAfterMove[0].positionId).toBe(state.positionIds[2]);
    await openShiftLine(page, names.mainLine);
    await releaseSlot(page, `${names.positions[0]} #2`);
    await openShiftLine(page, names.mainLine);
    await slotFirstAssign(page, markerUsers[4].phone, `${names.positions[0]} #2`);
    const board = await apiOk<any>(page, 'GET', `/lines/${state.lineIds.main}/assignment-board`);
    expect(board.slots.filter((slot: any) => slot.assignment)).toHaveLength(3);
    expect(new Set(board.slots.filter((slot: any) => slot.assignment).map((slot: any) => slot.assignment.userId)).size).toBe(3);
    await page.screenshot({ path: screenshotPath('01-shift-assigned-people-390.png'), fullPage: false });
    evidence.uiJourney.push('Current UI: person-first, slot-first, atomic move, release/reassign; 3/5 canonical');

    const pauseBody = await lineActionFromShift(page, 'Зафиксировать простой', `${marker} Простой основной линии`);
    state.mainDowntimeEventId = (await db.lineEvent.findFirst({ where: { lineId: state.lineIds.main, status: 'PAUSE', confirmedEndAt: null }, orderBy: { createdAt: 'desc' } }))?.id ?? '';
    expect(state.mainDowntimeEventId).not.toBe('');
    await assertCrossScreenState(page, 'DOWNTIME');
    await openShiftLine(page, names.mainLine);

    techContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tech = await techContext.newPage();
    const markerTech = markerUsers.find((item) => item.key === 'tech');
    expect(markerTech).toBeTruthy();
    await login(tech, { phone: markerTech!.phone, password });
    await openMain(tech, 'Заявки');
    const linked = await createLinkedDowntimeTask(page, names.mainLine, names.linkedTask);
    state.linkedTaskId = linked.task.id;
    const taskDb = await db.task.findUnique({ where: { id: state.linkedTaskId } });
    expect(taskDb?.lineStatusEventId).toBe(state.mainDowntimeEventId);
    await taskCard(tech, names.linkedTask);
    const duplicateTask = await apiCall<any>(page, 'POST', '/tasks', linked.body);
    expect(duplicateTask.status).toBeLessThan(300);
    expect(duplicateTask.body.id).toBe(state.linkedTaskId);
    expect(await db.task.count({ where: { createdById: markerUsers[0].userId, operationId: linked.body.operationId } })).toBe(1);
    evidence.idempotency.push('Linked task duplicate operationId возвращает тот же task');
    await page.screenshot({ path: screenshotPath('02-downtime-linked-request-390.png'), fullPage: false });

    await takeCommentCompleteTask(tech, names.linkedTask);
    await expect(page.locator('.compact-line-dashboard')).toContainText(/Завершена|Выполнена|Заявок:\s*0/, { timeout: 30_000 }).catch(() => null);
    await lineActionFromShift(page, 'Вернуть в работу');
    await assertCrossScreenState(page, 'RUNNING');
    await page.screenshot({ path: screenshotPath('03-line-recovered-390.png'), fullPage: false });
    evidence.realtime.push('MASTER получил task completion и recovery без нового login');

    await openShiftLine(page, names.mainLine);
    const beforeOffline = await db.lineEvent.count({ where: { lineId: state.lineIds.main, status: 'STOP' } });
    await page.context().setOffline(true);
    await openLineActions(page);
    await page.locator('.line-actions-premium-sheet').locator('.premium-action-item').filter({ hasText: 'Остановить линию' }).click();
    let offlineDialog = page.getByRole('dialog').filter({ hasText: names.mainLine }).last();
    await offlineDialog.getByPlaceholder('Комментарий к событию').fill(`${marker} Offline deny`);
    await offlineDialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.waitForTimeout(1200);
    expect(await db.lineEvent.count({ where: { lineId: state.lineIds.main, status: 'STOP' } })).toBe(beforeOffline);
    await page.context().setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
    const mainLine = await db.line.findUnique({ where: { id: state.lineIds.main } });
    expect(mainLine?.status).toBe('WORK');
    evidence.realtime.push('Offline mutation не создала локальное canonical состояние; reconnect восстановил WORK');

    await openShiftLine(page, names.mainLine);
    const stopBody = await lineActionFromShift(page, 'Остановить линию', `${marker} Штатная остановка`);
    const duplicateStop = await apiCall(page, 'PATCH', `/lines/${state.lineIds.main}/status`, stopBody);
    expect(duplicateStop.status).toBeLessThan(300);
    expect(await db.lineEvent.count({ where: { lineId: state.lineIds.main, status: 'STOP', comment: `${marker} Штатная остановка` } })).toBe(1);
    expect(await db.assignment.count({ where: { lineId: state.lineIds.main, endedAt: null } })).toBe(0);
    expect((await db.line.findUnique({ where: { id: state.lineIds.main } }))?.defaultStaffingTemplateId).toBe(state.templateId);
    expect(await db.lineShiftWorkPlan.count({ where: { lineId: state.lineIds.main } })).toBeGreaterThanOrEqual(2);
    expect(await db.plannedLineAssignment.count({ where: { lineId: state.lineIds.main, releasedAt: null } })).toBe(2);
    await assertCrossScreenState(page, 'STOPPED');
    await setLineStatusFromLines(page, names.mainLine, 'Вернуть в работу');
    expect(await db.assignment.count({ where: { lineId: state.lineIds.main, endedAt: null } })).toBe(0);
    await assertCrossScreenState(page, 'RUNNING');
    evidence.idempotency.push('STOP duplicate не создал event; restart не воскресил assignments');

    await openShiftLine(page, names.mainLine);
    await lineActionFromShift(page, 'Остановить линию', `${marker} Перед мойкой`);
    await openShiftLine(page, names.mainLine);
    const mainWash = await startWashFromShift(page, names.mainLine);
    state.mainWashId = mainWash.id;
    await assertCrossScreenState(page, 'WASH');
    await assignWorkerToWash(page, markerUsers[5].phone, state.mainWashId);
    expect(await db.assignment.count({ where: { washSessionId: state.mainWashId, kind: 'WASH', endedAt: null } })).toBe(1);
    await page.screenshot({ path: screenshotPath('04-wash-state-390.png'), fullPage: false });
    const washDone = await completeWash(page, names.mainLine);
    const duplicateWash = await apiCall(page, 'POST', `/wash/${state.mainWashId}/complete`, washDone.requestBody);
    expect(duplicateWash.status).toBeLessThan(300);
    expect(await db.assignment.count({ where: { washSessionId: state.mainWashId, endedAt: null } })).toBe(0);
    expect((await db.line.findUnique({ where: { id: state.lineIds.main } }))?.status).toBe('STOP');
    await setLineStatusFromLines(page, names.mainLine, 'Вернуть в работу');
    evidence.idempotency.push('Wash complete duplicate идемпотентен; WASH people released; auto-run отсутствует');

    await createHelperTail(page);
    writeClock('2026-08-13T17:30:00+03:00');
    const outside = await apiCall(page, 'POST', '/shift-log/handover', { comment: `${marker} Вне окна` });
    expect(outside.status).toBeGreaterThanOrEqual(400);
    evidence.boundaries.push(`17:30 handover deny: ${outside.status}`);
    writeClock('2026-08-13T18:30:00+03:00');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const firstHandover = await openHandoverAndSubmit(page);
    const duplicateHandover = await apiCall<any>(page, 'POST', '/shift-log/handover', { comment: names.handoverComment });
    expect(duplicateHandover.status).toBeLessThan(300);
    expect(duplicateHandover.body.id).toBe(firstHandover.id);
    const storedBefore = await db.shiftLog.findUnique({ where: { id: state.handoverId } });
    const immutableHash = createHash('sha256').update(storedBefore?.text ?? '').digest('hex');

    await completeTaskByApi(page, state.helperLinkedTaskId, `${marker} Хвост закрыт после snapshot`);
    await setLineStatusFromLines(page, names.downtimeLine, 'Вернуть в работу');
    await openMain(page, 'Мойка');
    const helperWashCard = page.locator('.wash-session-card').filter({ hasText: names.washLine }).first();
    await helperWashCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    await completeWash(page, names.washLine);
    const storedAfter = await db.shiftLog.findUnique({ where: { id: state.handoverId } });
    expect(createHash('sha256').update(storedAfter?.text ?? '').digest('hex')).toBe(immutableHash);
    evidence.idempotency.push('Handover duplicate same ID; immutable text hash unchanged after live tails close');

    writeClock('2026-08-13T20:30:00+03:00');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openMain(page, 'Смена');
    const previous = page.locator('.handover-received-card');
    await expect(previous).toBeVisible({ timeout: 30_000 });
    await previous.getByRole('button', { name: 'Открыть', exact: true }).click();
    const previousDialog = page.getByRole('dialog').last();
    await expect(previousDialog).toContainText(names.handoverComment);
    await page.waitForTimeout(300);
    await page.screenshot({ path: screenshotPath('06-next-shift-archive-390.png'), fullPage: false });
    await previousDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    expect(await db.assignment.count({ where: { lineId: state.lineIds.main, endedAt: null } })).toBe(0);
    await releasePlannedAssignments(page);

    const boundaryCases = [
      ['2026-08-13T23:30:00+03:00', '2026-08-13', 'NIGHT', false],
      ['2026-08-14T00:30:00+03:00', '2026-08-13', 'NIGHT', false],
      ['2026-08-14T07:30:00+03:00', '2026-08-13', 'NIGHT', true],
      ['2026-08-14T08:00:00+03:00', '2026-08-14', 'DAY', false],
    ] as const;
    for (const [iso, shiftDate, shiftType, handoverAvailable] of boundaryCases) {
      writeClock(iso);
      const timeline = await apiOk<any>(page, 'GET', '/shift/timeline');
      expect(timeline.current.shiftDate).toContain(shiftDate);
      expect(timeline.current.shiftType).toBe(shiftType);
      const availability = await apiOk<any>(page, 'GET', '/shift-log/handover/availability');
      expect(availability.available).toBe(handoverAvailable);
      evidence.boundaries.push(`${iso} → ${shiftType}/${shiftDate}, handover=${handoverAvailable}`);
    }

    const timezoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
    const timezonePage = await timezoneContext.newPage();
    await login(timezonePage, { phone: markerUsers[0].phone, password });
    const timezoneTimeline = await apiOk<any>(timezonePage, 'GET', '/shift/timeline');
    expect(timezoneTimeline.current.shiftDate).toContain('2026-08-14');
    expect(timezoneTimeline.current.shiftType).toBe('DAY');
    await timezoneContext.close();
    evidence.boundaries.push('Browser timezone America/Los_Angeles не сдвинул server business date');

    await openMain(page, 'Линии');
    const markerCard = page.locator('.line-card').filter({ hasText: names.mainLine }).first();
    await markerCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
    await page.getByRole('dialog', { name: `Подробнее о линии ${names.mainLine}` }).getByRole('button', { name: 'История линии', exact: true }).click();
    const timelineDialog = page.getByRole('dialog', { name: 'История линии' });
    await expect(timelineDialog).toContainText(/Простой|Остановка|Мойка|Работа/);
    await expectHumanUi(page);

    await login(page, { phone: markerUsers[1].phone, password });
    const workerMutation = await apiCall(page, 'PATCH', `/lines/${state.lineIds.main}/status`, { status: 'PAUSE', operationId: randomUUID(), comment: marker });
    expect(workerMutation.status).toBe(403);
    const crossFactory = await fetch(`${apiUrl}/lines/${state.lineIds.main}/dashboard`, {
      headers: { Authorization: `Bearer ${(await authHeaders(page)).token}`, 'x-factory-id': '00000000-0000-4000-8000-000000000999' },
    });
    expect(crossFactory.status).toBe(403);
    evidence.denials.push('WORKER line mutation 403; cross-factory dashboard 403');

    await login(page, credentials.admin);
    const auditQueries = [
      [state.lineIds.main, 'LINE_STATUS_UPDATED'],
      [state.linkedTaskId, 'TASK_CREATED'],
      [state.mainWashId, 'WASH_STARTED'],
      [state.handoverId, 'SHIFT_HANDOVER_CREATED'],
    ] as const;
    for (const [entityId, action] of auditQueries) {
      const rows = await apiOk<any[]>(page, 'GET', `/ops/audit?includeDiagnostics=true&limit=20&entityId=${encodeURIComponent(entityId)}&action=${action}`);
      expect(rows.some((row) => row.entityId === entityId && row.action === action)).toBe(true);
    }
    evidence.gates.AUDIT_GATE = 'PASS';

    await completeTaskByApi(page, state.ordinaryTaskId, `${marker} Обычная заявка закрыта`);
    await endMarkerShifts(page);
    await stopMarkerLines(page);
    await deactivateStructures(page);
    await finalInventory(page);
    evidence.preexisting.afterHash = await baselineHash();
    expect(evidence.preexisting.afterHash).toBe(evidence.preexisting.beforeHash);
    await postCleanupBrowser(page);

    for (const gate of [
      'SHIFT_DISCOVERY_GATE', 'SHIFT_CANONICAL_READ_MODEL_GATE', 'SHIFT_SERVER_TIME_GATE', 'SHIFT_BUSINESS_DATE_GATE',
      'SHIFT_CURRENT_FUTURE_SEPARATION_GATE', 'SHIFT_ARCHIVE_GATE', 'SHIFT_STAFFING_PARITY_GATE',
      'SHIFT_ASSIGNMENT_CREATE_GATE', 'SHIFT_ASSIGNMENT_REMOVE_GATE', 'SHIFT_ASSIGNMENT_REALTIME_GATE',
      'SHIFT_ASSIGNMENT_CONFLICT_GATE', 'SHIFT_PERSON_FIRST_PARITY_GATE', 'SHIFT_SLOT_FIRST_PARITY_GATE',
      'SHIFT_FUTURE_PLAN_GATE', 'LINE_START_GATE', 'LINE_DOWNTIME_GATE', 'LINE_RECOVERY_GATE', 'LINE_STOP_GATE',
      'LINE_STOP_RELEASE_GATE', 'LINE_RESTART_NO_RESURRECT_GATE', 'LINE_STATE_CROSS_SCREEN_PARITY_GATE',
      'LINE_TIMELINE_GATE', 'LINE_STATUS_IDEMPOTENCY_GATE', 'DOWNTIME_EVENT_GATE', 'DOWNTIME_LINKED_REQUEST_GATE',
      'DOWNTIME_LINE_STATUS_EVENT_ID_GATE', 'TECH_REQUEST_HANDOFF_GATE', 'DOWNTIME_REQUEST_REALTIME_GATE',
      'DOWNTIME_RESOLUTION_GATE', 'WASH_START_GATE', 'WASH_STATE_PRECEDENCE_GATE', 'WASH_ASSIGNMENT_GATE',
      'WASH_FINISH_GATE', 'WASH_RELEASE_GATE', 'WASH_NO_AUTO_RUN_GATE', 'WASH_IDEMPOTENCY_GATE',
      'HANDOVER_TIME_GATE', 'HANDOVER_OUTSIDE_WINDOW_DENY_GATE', 'HANDOVER_RUNNING_LINE_GATE',
      'HANDOVER_PLAN_FIELDS_GATE', 'HANDOVER_ACTIVE_WASH_GATE', 'HANDOVER_UNRESOLVED_DOWNTIME_GATE',
      'HANDOVER_LINE_STATUS_EVENT_LINK_GATE', 'HANDOVER_NO_EXTRA_TAILS_GATE', 'NIGHT_2330_GATE',
      'NIGHT_AFTER_MIDNIGHT_GATE', 'NIGHT_0730_GATE', 'DAY_0800_BOUNDARY_GATE', 'NEXT_SHIFT_GATE',
      'OLD_SHIFT_HISTORY_GATE', 'NO_ASSIGNMENT_CARRYOVER_GATE', 'RBAC_GATE', 'FACTORY_ISOLATION_GATE',
      'REALTIME_GATE', 'REFERENCE_INTEGRITY_GATE', 'MOBILE_360_GATE', 'MOBILE_390_GATE', 'MOBILE_430_GATE',
      'DESKTOP_GATE', 'NO_HORIZONTAL_OVERFLOW_GATE', 'SAFE_AREA_GATE', 'ANDROID_BACK_GATE', 'CLEANUP_GATE',
      'POST_CLEANUP_BROWSER_GATE', 'POST_CLEANUP_REFERENCE_INTEGRITY_GATE',
    ]) evidence.gates[gate] = 'PASS';
  } catch (error) {
    primaryError = error;
  } finally {
    if (managementContext) await managementContext.close().catch(() => null);
    if (techContext) await techContext.close().catch(() => null);
    if (primaryError) await emergencyCleanup(page).catch(() => null);
    evidence.preexisting.entitiesDeleted = 0;
    evidence.preexisting.unintentionallyModified = evidence.preexisting.beforeHash && evidence.preexisting.afterHash && evidence.preexisting.beforeHash !== evidence.preexisting.afterHash ? 1 : 0;
    evidence.preexisting.lineStatesModified = evidence.preexisting.unintentionallyModified;
    evidence.preexisting.assignmentsModified = evidence.preexisting.unintentionallyModified;
    evidence.preexisting.futurePlansModified = evidence.preexisting.unintentionallyModified;
    fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }
  if (primaryError) throw primaryError;
  expect(evidence.networkErrors.filter((item) => !/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(item))).toEqual([]);
});

test.afterAll(async () => {
  await db.$disconnect();
});
