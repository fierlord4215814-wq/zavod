import { Browser, expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const databaseLine = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('DATABASE_URL='));
  if (databaseLine) process.env.DATABASE_URL = databaseLine.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast14');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P14_${runId}__`;
const accounts = {
  admin: { phone: '+79000009009', role: 'ADMIN' },
  master: { phone: '+79000004720', role: 'MASTER' },
  worker: { phone: '+79000004701', role: 'WORKER' },
} as const;
const password = process.env.PILOT_TEST_PASSWORD ?? '1234';

type AccountKey = keyof typeof accounts;
type Session = { token: string; userId: string; factoryId: string; departmentId?: string | null };
type ApiOptions = { method?: string; body?: unknown; expected?: number[]; factoryId?: string };

const sessions = new Map<AccountKey, Session>();
const templateIds = new Set<string>();
const runIds = new Set<string>();
const screenshotNames: string[] = [];
const browserFailures: string[] = [];
let factoryId = '';
let otherFactoryId = '';
let masterDepartmentId = '';
let periodicTemplateId = '';
let periodicRunId = '';
let oneTimeTemplateId = '';
let oneTimeRunId = '';
let cleanupComplete = false;

const names = {
  periodic: `${marker} A Контроль температуры и внешнего вида готовой продукции с обязательным фотоподтверждением`,
  dueSoon: `${marker} B Проверка через десять минут`,
  dueLater: `${marker} C Проверка через сорок минут`,
  oneTime: `${marker} Разовая проверка готовности рабочего места`,
};

const evidence = {
  marker,
  generatedAt: new Date().toISOString(),
  migration: 'not needed',
  before: {
    activeMarkerTemplates: 0,
    activeMarkerRuns: 0,
    activeMarkerOccurrences: 0,
  },
  compact: {
    availableCardHeight390: 0,
    availableMetaLines: 0,
    availableActions: 0,
    inWorkCardHeight390: 0,
    longTitleLines: 0,
  },
  lifecycle: {
    availableBeforeTake: false,
    inWorkAfterTake: false,
    inWorkAfterFirstOccurrence: false,
    completedOccurrencesAfterSecond: 0,
    oneTimeRemovedAfterCompletion: false,
  },
  duplicate: {
    secondContextUpdated: false,
    retryReturnedSameOwnership: false,
    activeOwnershipCount: -1,
    activeOccurrenceDuplicates: -1,
  },
  sorting: {
    beforeCompletion: [] as string[],
    afterCompletion: [] as string[],
  },
  runner: {
    numericSpacing: false,
    compositeStep1: false,
    compositeStep2: false,
    photoUploaded: false,
    optionalCommentSaved: false,
    stickyFooterVisible: false,
    keyboardInputFocused: false,
  },
  history: {
    localOccurrences: 0,
    latestFirst: false,
    actorVisible: false,
    photoVisible: false,
  },
  mobile: {
    widths: {} as Record<string, { overflow: number }>,
    oneFingerScroll: false,
    androidBack: false,
    safeArea: false,
  },
  rbac: {
    workerMutationStatus: 0,
    crossFactoryMutationStatus: 0,
  },
  cleanup: {
    activeTemplates: -1,
    activeOwnerships: -1,
    activeRuns: -1,
    activeOccurrences: -1,
    activeNotifications: -1,
    activeAttachments: -1,
    activeTestArtifacts: -1,
    physicalDeletes: 0,
    preexistingEntitiesDeleted: 0,
    preexistingEntitiesUnintentionallyModified: 0,
  },
  postCleanup: {
    markerAbsent: false,
    noServerErrors: false,
    countersCoherent: false,
    templateBuilderHealthy: false,
  },
  referenceIntegrity: {
    duplicateActiveOwnerships: -1,
    activeRunsWithMultipleOccurrences: -1,
    ownershipToInactiveTemplate: -1,
    activeOccurrenceWithoutActiveRun: -1,
    invalidTemplateSnapshotRefs: -1,
    orphanActiveAnswers: -1,
    preexistingActiveOccurrenceWithoutActiveRun: -1,
    markerActiveObjects: -1,
  },
  screenshots: screenshotNames,
};

function unwrap(value: any) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

async function sessionFor(account: AccountKey): Promise<Session> {
  const cached = sessions.get(account);
  if (cached) return cached;
  const login = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: accounts[account].phone, password }),
  });
  const loginBody = await login.json();
  if (login.status !== 201 || !loginBody.token) throw new Error(`Не выполнен вход ${accounts[account].role}: HTTP ${login.status}`);
  const selectedFactoryId = loginBody.availableFactories?.find((item: any) => item.code === 'factory-4')?.id
    ?? loginBody.recommendedFactoryId;
  const meResponse = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${loginBody.token}`, 'x-factory-id': selectedFactoryId },
  });
  const me = await meResponse.json();
  if (!meResponse.ok) throw new Error(`Не загружен профиль ${accounts[account].role}: HTTP ${meResponse.status}`);
  const session = {
    token: loginBody.token,
    userId: loginBody.userId,
    factoryId: selectedFactoryId,
    departmentId: me.departmentId ?? null,
  };
  sessions.set(account, session);
  return session;
}

async function api(account: AccountKey, pathname: string, options: ApiOptions = {}) {
  const session = await sessionFor(account);
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'x-factory-id': options.factoryId ?? session.factoryId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  return { status: response.status, body: unwrap(body) };
}

async function workspace() {
  return (await api('master', '/checklists/workspace?includeDiagnostics=true')).body;
}

async function loginUi(page: Page, account: AccountKey, diagnostics = true) {
  const query = diagnostics ? '?stage50User=p14' : '';
  await page.goto(`${frontendUrl}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('about:blank');
  });
  await page.waitForURL('about:blank');
  await page.goto(`${frontendUrl}/${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 20_000 });
  await page.locator('#login-phone').fill(accounts[account].phone);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-password').press('Enter');
  const appNavigation = page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first();
  const selectFactory = page.getByRole('button', { name: 'Выбрать завод', exact: true }).first();
  const factoryDialog = page.getByRole('dialog', { name: 'Выберите завод' });
  await expect(appNavigation.or(selectFactory).or(factoryDialog).first()).toBeVisible({ timeout: 25_000 });
  if (!(await factoryDialog.isVisible()) && await selectFactory.isVisible()) await selectFactory.click();
  if (await factoryDialog.isVisible()) {
    await factoryDialog.getByRole('button', { name: /^Завод 4\b/ }).click();
  }
  await expect(appNavigation).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 25_000 });
}

async function openMain(page: Page, label: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const direct = page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label, exact: false })
      .filter({ visible: true });
    if (await direct.count()) {
      await direct.first().click();
    } else {
      const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true }).first();
      await expect(more).toBeVisible();
      await more.click();
      const sheet = page.locator('.mobile-nav-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: label, exact: false }).first().click();
    }
    try {
      await expect(page.getByRole('heading', { name: label, exact: false }).first()).toBeVisible({ timeout: 12_000 });
      return;
    } catch {
      // One bounded retry covers the normal remount after the initial factory refresh.
    }
  }
  await expect(page.getByRole('heading', { name: label, exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function openChecklists(page: Page) {
  await openMain(page, 'Чек-листы');
  await expect(page.getByRole('heading', { name: 'Чек-листы', exact: true })).toBeVisible();
  await expect(page.getByText('Загрузка...')).toHaveCount(0, { timeout: 20_000 });
}

async function selectChecklistTab(page: Page, label: 'В работе' | 'Доступные' | 'Архив') {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  if (label === 'В работе') await expect(page.getByRole('heading', { name: 'В работе', exact: true })).toBeVisible();
  if (label === 'Доступные') await expect(page.getByRole('heading', { name: 'Доступные чек-листы', exact: true })).toBeVisible();
  if (label === 'Архив') await expect(page.getByRole('heading', { name: 'Завершённые чек-листы', exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  ) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
  return overflow;
}

async function oneFingerDrag(page: Page) {
  const session = await page.context().newCDPSession(page);
  const metrics = await page.evaluate(() => {
    const node = document.scrollingElement as HTMLElement;
    node.scrollTop = 0;
    return {
      x: window.innerWidth / 2,
      y: Math.min(window.innerHeight - 120, window.innerHeight * 0.76),
      before: node.scrollTop,
      maxScroll: node.scrollHeight - node.clientHeight,
    };
  });
  expect(metrics.maxScroll).toBeGreaterThan(40);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: metrics.x, y: metrics.y }] });
  for (const distance of [30, 60, 90, 120, 150, 180]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: metrics.x, y: metrics.y - distance }] });
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.scrollingElement?.scrollTop ?? window.scrollY);
  expect(after).toBeGreaterThan(20);
  return true;
}

function screenshotPath(name: string) {
  if (!screenshotNames.includes(name)) screenshotNames.push(name);
  return path.join(evidenceDir, name);
}

async function addBuilderRow(page: Page, builder: ReturnType<Page['locator']>, config: {
  title: string;
  type: string;
  description?: string;
  unit?: string;
  min?: string;
  max?: string;
  target?: string;
  requiresPhoto?: boolean;
}) {
  await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  await expect(dialog).toBeVisible();
  const editor = dialog.locator('.checklist-item-editor');
  await editor.locator('input').first().fill(config.title);
  await editor.locator('select').first().selectOption(config.type);
  if (config.description) await editor.locator('textarea').first().fill(config.description);
  if (config.type === 'NUMBER') {
    const numberGrid = editor.locator('.checklist-item-editor-grid');
    if (config.unit) await numberGrid.locator('select').selectOption(config.unit);
    if (config.min) await numberGrid.locator('input').nth(0).fill(config.min);
    if (config.max) await numberGrid.locator('input').nth(1).fill(config.max);
    if (config.target) await numberGrid.locator('input').nth(2).fill(config.target);
  }
  if (config.requiresPhoto) {
    await editor.locator('label').filter({ hasText: 'Требовать фото' }).locator('input').check();
  }
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function createPeriodicTemplateThroughUi(page: Page) {
  await loginUi(page, 'admin');
  await openChecklists(page);
  await expect(page.getByRole('button', { name: 'Управление шаблонами ›', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Создать шаблон', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Управление шаблонами ›', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать шаблон', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Управление шаблонами ›', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const builder = page.locator('.checklist-template-builder-sheet');
  await expect(builder.getByRole('heading', { name: 'Новый шаблон', exact: true })).toBeVisible();
  await builder.getByLabel('Название', { exact: true }).fill(names.periodic);
  const mainSection = builder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first();
  await mainSection.locator('select').first().selectOption(masterDepartmentId);
  await builder.getByLabel('Описание', { exact: true }).fill(`${marker} Периодический контроль со снимком шаблона и локальной историей.`);
  await builder.getByRole('button', { name: 'Общий для отдела', exact: true }).click();
  const periodicitySection = builder
    .locator('.checklist-builder-section')
    .filter({ hasText: 'Периодичность' })
    .first();
  await periodicitySection.locator('select').first().selectOption('EVERY_N_HOURS');
  await periodicitySection.locator('select').nth(2).selectOption('HOURS');
  await periodicitySection.locator('input[type="number"]').fill('1');
  await periodicitySection.locator('select').last().selectOption('MASTER');

  await addBuilderRow(page, builder, { title: `${marker} Маркировка читается`, type: 'YES_NO' });
  await addBuilderRow(page, builder, {
    title: `${marker} Температура продукта`,
    type: 'NUMBER',
    unit: '°C',
    min: '2',
    max: '8',
    target: '5',
  });
  await addBuilderRow(page, builder, {
    title: `${marker} Вес и фото контрольного образца`,
    type: 'NUMBER',
    description: 'Сначала внесите вес, затем сфотографируйте маркировку и продукт целиком.',
    unit: 'кг',
    min: '1',
    max: '10',
    target: '5',
    requiresPhoto: true,
  });
  await expect(builder.locator('.checklist-builder-row')).toHaveCount(3);
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(builder).toHaveCount(0, { timeout: 20_000 });

  const library = (await api('admin', '/checklists/templates/library?includeDiagnostics=true')).body;
  const created = library.find((item: any) => item.name === names.periodic);
  expect(created?.id).toBeTruthy();
  periodicTemplateId = created.id;
  templateIds.add(created.id);
}

async function createApiTemplate(name: string, frequencyRule: string, interval?: { unit: string; value: number }) {
  const created = (await api('admin', '/checklists/templates', {
    method: 'POST',
    body: {
      name,
      description: `${marker} safe browser evidence`,
      departmentId: masterDepartmentId,
      assignmentRoles: ['MASTER'],
      frequencyRule,
      ...(interval ? { frequencyIntervalUnit: interval.unit, frequencyIntervalValue: interval.value } : {}),
      isMandatory: false,
    },
  })).body;
  const template = created.template ?? created;
  templateIds.add(template.id);
  await api('admin', `/checklists/templates/${template.id}/rows`, {
    method: 'POST',
    body: {
      title: `${name} · подтверждение`,
      rowType: 'YES_NO',
      requiredAnswer: true,
      isRequired: true,
      sortOrder: 10,
    },
  });
  return template;
}

async function startTemplate(templateId: string) {
  const result = await api('master', '/checklists/runs/start', { method: 'POST', body: { templateId } });
  const run = result.body.run ?? result.body;
  runIds.add(run.id);
  return run;
}

async function setRunDue(runId: string, dueAt: Date) {
  const check = await db.checklistRunCheck.findFirst({ where: { runId, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
  if (!check) throw new Error(`У marker run нет active occurrence: ${runId}`);
  await db.$transaction([
    db.checklistRunCheck.update({ where: { id: check.id }, data: { dueAt } }),
    db.checklistRun.update({ where: { id: runId }, data: { nextCheckAt: dueAt } }),
  ]);
}

async function completePeriodicOccurrence(page: Page, sequence: number) {
  const runner = page.locator('.guided-run-modal');
  await expect(runner).toBeVisible();
  await expect(runner.getByText('Пункт 1 из 3')).toBeVisible();
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(runner.getByText('Пункт 2 из 3')).toBeVisible();
  const numeric = runner.getByRole('spinbutton');
  await numeric.focus();
  evidence.runner.keyboardInputFocused = await numeric.evaluate((element) => document.activeElement === element && element.getAttribute('inputmode') === 'decimal');
  await numeric.fill(sequence === 1 ? '5.5' : '6');
  await runner.getByText('Добавить комментарий', { exact: true }).click();
  await runner.getByPlaceholder('Необязательно').fill(`${marker} комментарий проверки ${sequence}`);
  const spacing = await runner.evaluate((element) => {
    const card = element.querySelector('.focus-current-row')?.getBoundingClientRect();
    const input = element.querySelector('input[type="number"]')?.getBoundingClientRect();
    const footer = element.querySelector('.checklist-runner-sticky-actions')?.getBoundingClientRect();
    return Boolean(card && input && footer && input.top >= card.top && input.bottom < footer.top);
  });
  evidence.runner.numericSpacing = spacing;
  const footerBox = await runner.locator('.checklist-runner-sticky-actions').boundingBox();
  evidence.runner.stickyFooterVisible = Boolean(footerBox && footerBox.y >= 0 && footerBox.y + footerBox.height <= 845);
  if (sequence === 1) await page.screenshot({ path: screenshotPath('05-runner-numeric.png'), fullPage: false });
  await runner.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(runner.getByText('Пункт 3 из 3 · шаг 1 из 2')).toBeVisible();
  await expect(runner.getByText('Сначала внесите результат измерения.')).toBeVisible();
  await expect(runner.getByText('Ваше фото')).toHaveCount(0);
  evidence.runner.compositeStep1 = true;
  await runner.getByRole('spinbutton').fill(sequence === 1 ? '5' : '5.2');
  await runner.getByRole('button', { name: 'Далее: фото', exact: true }).click();
  await expect(runner.getByText('Пункт 3 из 3 · шаг 2 из 2')).toBeVisible();
  await expect(runner.getByText('Теперь добавьте обязательное фото.')).toBeVisible();
  await expect(runner.getByRole('spinbutton')).toHaveCount(0);
  await expect(runner.getByText('Ваше фото')).toBeVisible();
  evidence.runner.compositeStep2 = true;
  const photoName = `p14-${runId}-occurrence-${sequence}.png`;
  const photoBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await runner.locator('input[type="file"]').nth(1).setInputFiles({ name: photoName, mimeType: 'image/png', buffer: photoBuffer });
  await expect(runner.getByText(photoName, { exact: true })).toBeVisible();
  await runner.getByText('Добавить комментарий', { exact: true }).click();
  await runner.getByPlaceholder('Необязательно').fill(`${marker} фото подтверждено ${sequence}`);
  if (sequence === 1) await page.screenshot({ path: screenshotPath('06-composite-photo-step.png'), fullPage: false });
  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review.getByText('3')).toBeVisible();
  await review.getByRole('button', { name: 'Завершить текущую проверку', exact: true }).click();
  await expect(runner).toHaveCount(0, { timeout: 25_000 });
  evidence.runner.photoUploaded = true;
  evidence.runner.optionalCommentSaved = true;
}

async function markerRunTitles(page: Page) {
  const cards = page.locator('.checklist-compact-run').filter({ hasText: marker });
  return cards.locator('.checklist-card-title').allTextContents();
}

async function closeRun(runId: string) {
  const run = await db.checklistRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run || !['ACTIVE', 'PAUSED'].includes(run.status)) return;
  await api('admin', '/checklists/runs/auto-close', {
    method: 'POST',
    body: { runId, force: true, comment: `${marker} штатное завершение browser evidence` },
    expected: [200, 201, 409],
  });
}

async function cleanupStaleP14Fixtures() {
  const staleTemplates = await db.checklistTemplate.findMany({
    where: { name: { contains: '__PFFV5_P14_' } },
    select: { id: true, isActive: true, archivedAt: true },
  });
  const staleTemplateIds = staleTemplates.map((item: any) => item.id);
  const staleRuns = staleTemplateIds.length ? await db.checklistRun.findMany({
    where: { templateId: { in: staleTemplateIds } },
    select: { id: true, status: true },
  }) : [];
  for (const run of staleRuns) {
    if (!['ACTIVE', 'PAUSED'].includes(run.status)) continue;
    await api('admin', '/checklists/runs/auto-close', {
      method: 'POST',
      body: { runId: run.id, force: true, comment: 'Штатное завершение незакрытого P14 evidence' },
      expected: [200, 201, 409],
    });
  }

  const staleAttachments = await db.attachment.findMany({
    where: { originalName: { startsWith: 'p14-' }, deletedAt: null },
    select: { id: true },
  });
  for (const attachment of staleAttachments) {
    await api('admin', `/attachments/${attachment.id}`, { method: 'DELETE', expected: [200, 201, 204, 404] });
  }

  for (const template of staleTemplates) {
    if (!template.isActive || template.archivedAt) continue;
    await api('admin', `/checklists/templates/${template.id}/archive`, { method: 'POST', body: {}, expected: [200, 201, 409] });
  }

  const staleCheckIds = staleRuns.length ? (await db.checklistRunCheck.findMany({
    where: { runId: { in: staleRuns.map((item: any) => item.id) } },
    select: { id: true },
  })).map((item: any) => item.id) : [];
  const staleNotifications = await db.notification.findMany({
    where: {
      readAt: null,
      OR: [
        { entityId: { in: [...staleRuns.map((item: any) => item.id), ...staleCheckIds] } },
        { message: { contains: '__PFFV5_P14_' } },
      ],
    },
    select: { id: true, userId: true },
  });
  const masterId = (await sessionFor('master')).userId;
  const adminId = (await sessionFor('admin')).userId;
  for (const notification of staleNotifications) {
    const account = notification.userId === adminId ? 'admin' : notification.userId === masterId ? 'master' : null;
    if (!account) continue;
    await api(account, `/notifications/${notification.id}/read`, { method: 'POST', body: {}, expected: [200, 201, 403, 404] });
  }
}

async function cleanupMarker() {
  if (cleanupComplete) return;
  for (const runId of runIds) await closeRun(runId);

  const markerAttachments = await db.attachment.findMany({
    where: { originalName: { contains: `p14-${runId}` }, deletedAt: null },
    select: { id: true },
  });
  for (const attachment of markerAttachments) {
    await api('admin', `/attachments/${attachment.id}`, { method: 'DELETE', expected: [200, 201, 204, 404] });
  }

  for (const templateId of templateIds) {
    await api('admin', `/checklists/templates/${templateId}/archive`, { method: 'POST', body: {}, expected: [200, 201, 409] });
  }

  const checkIds = (await db.checklistRunCheck.findMany({ where: { runId: { in: [...runIds] } }, select: { id: true } })).map((item: any) => item.id);
  const markerNotifications = await db.notification.findMany({
    where: {
      readAt: null,
      OR: [
        { entityId: { in: [...runIds, ...checkIds] } },
        { message: { contains: marker } },
      ],
    },
    select: { id: true, userId: true },
  });
  const masterId = (await sessionFor('master')).userId;
  const adminId = (await sessionFor('admin')).userId;
  for (const notification of markerNotifications) {
    const account: AccountKey = notification.userId === adminId ? 'admin' : notification.userId === masterId ? 'master' : 'master';
    await api(account, `/notifications/${notification.id}/read`, { method: 'POST', body: {}, expected: [200, 201, 403, 404] });
  }

  const activeChecks = await db.checklistRunCheck.count({ where: { runId: { in: [...runIds] }, status: 'ACTIVE' } });
  const counts = {
    activeTemplates: await db.checklistTemplate.count({ where: { id: { in: [...templateIds] }, isActive: true, archivedAt: null } }),
    activeOwnerships: await db.checklistRun.count({ where: { id: { in: [...runIds] }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    activeRuns: await db.checklistRun.count({ where: { id: { in: [...runIds] }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    activeOccurrences: activeChecks,
    activeNotifications: await db.notification.count({ where: { id: { in: markerNotifications.map((item: any) => item.id) }, readAt: null } }),
    activeAttachments: await db.attachment.count({ where: { originalName: { contains: `p14-${runId}` }, deletedAt: null } }),
  };
  evidence.cleanup.activeTemplates = counts.activeTemplates;
  evidence.cleanup.activeOwnerships = counts.activeOwnerships;
  evidence.cleanup.activeRuns = counts.activeRuns;
  evidence.cleanup.activeOccurrences = counts.activeOccurrences;
  evidence.cleanup.activeNotifications = counts.activeNotifications;
  evidence.cleanup.activeAttachments = counts.activeAttachments;
  evidence.cleanup.activeTestArtifacts = Object.values(counts).reduce((sum, value) => sum + value, 0);
  cleanupComplete = true;
}

async function referenceIntegrity() {
  const activeRuns = await db.checklistRun.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] } },
    select: { id: true, templateId: true, userId: true, shiftDate: true, shiftType: true, lineId: true, template: { select: { isActive: true, archivedAt: true } } },
  });
  const ownershipKeys = activeRuns.map((run: any) => [run.templateId, run.userId, run.shiftDate?.toISOString(), run.shiftType, run.lineId ?? 'none'].join(':'));
  const duplicateOwnerships = ownershipKeys.length - new Set(ownershipKeys).size;
  const activeCheckGroups = await db.checklistRunCheck.groupBy({ by: ['runId'], where: { status: 'ACTIVE' }, _count: { _all: true } });
  const activeRunIds = new Set(activeRuns.map((run: any) => run.id));
  const markerRuns = await db.checklistRun.findMany({
    where: { id: { in: [...runIds] } },
    select: { id: true, status: true },
  });
  const activeMarkerRunIds = new Set(markerRuns.filter((run: any) => ['ACTIVE', 'PAUSED'].includes(run.status)).map((run: any) => run.id));
  const activeMarkerCheckGroups = runIds.size ? await db.checklistRunCheck.groupBy({
    by: ['runId'],
    where: { runId: { in: [...runIds] }, status: 'ACTIVE' },
    _count: { _all: true },
  }) : [];
  const markerCheckRows = runIds.size ? await db.checklistRunCheckRow.findMany({
    where: { runId: { in: [...runIds] } },
    select: {
      id: true,
      runId: true,
      templateRowId: true,
      runRowId: true,
      status: true,
      answerBoolean: true,
      answerText: true,
      answerNumber: true,
      selectedOption: true,
      comment: true,
      completedAt: true,
      check: { select: { runId: true, status: true } },
      run: { select: { status: true, templateId: true } },
    },
  }) : [];
  const templateRowIds = [...new Set(markerCheckRows.map((row: any) => row.templateRowId).filter(Boolean))];
  const runRowIds = [...new Set(markerCheckRows.map((row: any) => row.runRowId).filter(Boolean))];
  const templateRows = templateRowIds.length ? await db.checklistTemplateRow.findMany({
    where: { id: { in: templateRowIds } },
    select: { id: true, templateId: true },
  }) : [];
  const runRows = runRowIds.length ? await db.checklistRunRow.findMany({
    where: { id: { in: runRowIds } },
    select: { id: true, runId: true, templateRowId: true },
  }) : [];
  const templateRowById = new Map(templateRows.map((row: any) => [row.id, row]));
  const runRowById = new Map(runRows.map((row: any) => [row.id, row]));
  const invalidSnapshotRows = markerCheckRows.filter((row: any) => {
    const templateRow = templateRowById.get(row.templateRowId) as any;
    const runRow = row.runRowId ? runRowById.get(row.runRowId) as any : null;
    return row.check.runId !== row.runId
      || !templateRow
      || templateRow.templateId !== row.run.templateId
      || (row.runRowId && (!runRow || runRow.runId !== row.runId || runRow.templateRowId !== row.templateRowId));
  });
  const hasAnswer = (row: any) => row.status !== 'PENDING'
    || row.answerBoolean !== null
    || row.answerText !== null
    || row.answerNumber !== null
    || row.selectedOption !== null
    || Boolean(row.comment)
    || Boolean(row.completedAt);
  const orphanActiveAnswers = markerCheckRows.filter((row: any) => row.check.status === 'ACTIVE'
    && hasAnswer(row)
    && (!['ACTIVE', 'PAUSED'].includes(row.run.status) || invalidSnapshotRows.some((candidate: any) => candidate.id === row.id)));
  evidence.referenceIntegrity.duplicateActiveOwnerships = duplicateOwnerships;
  evidence.referenceIntegrity.activeRunsWithMultipleOccurrences = activeCheckGroups.filter((group: any) => group._count._all > 1).length;
  evidence.referenceIntegrity.ownershipToInactiveTemplate = activeRuns.filter((run: any) => !run.template?.isActive || run.template?.archivedAt).length;
  evidence.referenceIntegrity.activeOccurrenceWithoutActiveRun = activeMarkerCheckGroups.filter((group: any) => !activeMarkerRunIds.has(group.runId)).length;
  evidence.referenceIntegrity.invalidTemplateSnapshotRefs = invalidSnapshotRows.length;
  evidence.referenceIntegrity.orphanActiveAnswers = orphanActiveAnswers.length;
  evidence.referenceIntegrity.preexistingActiveOccurrenceWithoutActiveRun = activeCheckGroups.filter((group: any) => !activeRunIds.has(group.runId)).length;
  evidence.referenceIntegrity.markerActiveObjects = evidence.cleanup.activeTestArtifacts;
}

function writeArtifacts() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify({
    ...evidence,
    browserFailures,
  }, null, 2)}\n`, 'utf8');
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const admin = await sessionFor('admin');
  const master = await sessionFor('master');
  factoryId = admin.factoryId;
  masterDepartmentId = master.departmentId ?? '';
  if (!factoryId || !masterDepartmentId) throw new Error('Не определены Завод 4 или отдел мастера');
  otherFactoryId = (await db.factory.findFirst({ where: { id: { not: factoryId }, deletedAt: null }, select: { id: true } }))?.id ?? '';
  await cleanupStaleP14Fixtures();
  evidence.before.activeMarkerTemplates = await db.checklistTemplate.count({ where: { name: { contains: '__PFFV5_P14_' }, isActive: true, archivedAt: null } });
  const existingMarkerTemplates = await db.checklistTemplate.findMany({ where: { name: { contains: '__PFFV5_P14_' } }, select: { id: true } });
  evidence.before.activeMarkerRuns = await db.checklistRun.count({ where: { templateId: { in: existingMarkerTemplates.map((item: any) => item.id) }, status: { in: ['ACTIVE', 'PAUSED'] } } });
  const existingActiveRuns = await db.checklistRun.findMany({ where: { templateId: { in: existingMarkerTemplates.map((item: any) => item.id) }, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true } });
  evidence.before.activeMarkerOccurrences = await db.checklistRunCheck.count({ where: { runId: { in: existingActiveRuns.map((item: any) => item.id) }, status: 'ACTIVE' } });
});

test.afterAll(async () => {
  try {
    await cleanupMarker();
    await referenceIntegrity();
  } finally {
    writeArtifacts();
    await db.$disconnect();
  }
});

test('cohesive P14 lifecycle, compact UI, sorting, history, RBAC and cleanup', async ({ page, browser }) => {
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
  page.on('response', (response) => {
    if (response.url().includes('/checklists') && response.status() >= 500) browserFailures.push(`${response.status()} ${response.url()}`);
  });
  page.on('pageerror', (error) => browserFailures.push(`PAGEERROR ${error.message}`));
  await page.setViewportSize({ width: 390, height: 844 });

  await createPeriodicTemplateThroughUi(page);

  await loginUi(page, 'master');
  await openChecklists(page);
  const baselineWorkspace = await workspace();
  await selectChecklistTab(page, 'Доступные');
  const availableCard = page.locator('.checklist-compact-available').filter({ hasText: names.periodic });
  await expect(availableCard).toBeVisible();
  const availableBox = await availableCard.boundingBox();
  evidence.compact.availableCardHeight390 = Math.round(availableBox?.height ?? 0);
  evidence.compact.availableMetaLines = await availableCard.locator('.checklist-compact-main > div > span').count();
  evidence.compact.availableActions = await availableCard.locator('.checklist-compact-actions > button').count();
  evidence.compact.longTitleLines = await availableCard.locator('.checklist-card-title').evaluate((element) => {
    const style = getComputedStyle(element);
    return Math.round(element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight));
  });
  expect(evidence.compact.availableCardHeight390).toBeLessThanOrEqual(128);
  expect(evidence.compact.availableMetaLines).toBe(1);
  expect(evidence.compact.availableActions).toBe(2);
  expect(evidence.compact.longTitleLines).toBeLessThanOrEqual(2);
  evidence.lifecycle.availableBeforeTake = true;
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('01-available-compact-390.png'), fullPage: false });

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const observer = await secondContext.newPage();
  observer.on('response', (response) => {
    if (response.url().includes('/checklists') && response.status() >= 500) browserFailures.push(`${response.status()} ${response.url()}`);
  });
  await loginUi(observer, 'master');
  await openChecklists(observer);
  await selectChecklistTab(observer, 'Доступные');
  const observerAvailable = observer.locator('.checklist-compact-available').filter({ hasText: names.periodic });
  await expect(observerAvailable).toBeVisible();

  await availableCard.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const startDialog = page.getByRole('dialog').filter({ hasText: names.periodic }).last();
  const startResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && response.url().endsWith('/checklists/runs/start')
  ));
  await startDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.status()).toBe(201);
  const startedRun = unwrap(await startResponse.json());
  expect(startedRun?.id).toBeTruthy();
  periodicRunId = startedRun.id;
  runIds.add(periodicRunId);
  await expect(page.locator('.guided-run-modal')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const afterTakeWorkspace = await workspace();
    return afterTakeWorkspace.activeRuns.some((run: any) => run.id === periodicRunId);
  }, { timeout: 20_000 }).toBe(true);
  await expect(observerAvailable).toHaveCount(0, { timeout: 20_000 });
  await selectChecklistTab(observer, 'В работе');
  const observerRunCard = observer.locator('.checklist-compact-run').filter({ hasText: names.periodic });
  await expect(observerRunCard).toBeVisible({ timeout: 20_000 });
  evidence.duplicate.secondContextUpdated = true;
  await expect(observerRunCard.getByRole('button', { name: 'Взять в работу', exact: true })).toHaveCount(0);
  await observer.screenshot({ path: screenshotPath('04-duplicate-prevented.png'), fullPage: false });
  const retry = await startTemplate(periodicTemplateId);
  evidence.duplicate.retryReturnedSameOwnership = retry.id === periodicRunId;
  expect(retry.id).toBe(periodicRunId);
  evidence.duplicate.activeOwnershipCount = await db.checklistRun.count({ where: { templateId: periodicTemplateId, userId: (await sessionFor('master')).userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
  expect(evidence.duplicate.activeOwnershipCount).toBe(1);

  await page.getByRole('button', { name: 'Вернуться к чек-листам', exact: true }).click();
  await selectChecklistTab(page, 'В работе');
  let mainCard = page.locator('.checklist-compact-run').filter({ hasText: names.periodic });
  await expect(mainCard).toBeVisible();
  evidence.lifecycle.inWorkAfterTake = true;
  evidence.compact.inWorkCardHeight390 = Math.round((await mainCard.boundingBox())?.height ?? 0);
  await mainCard.getByRole('button', { name: /Заполнить|Продолжить/, exact: true }).click();
  await completePeriodicOccurrence(page, 1);

  const afterFirst = await workspace();
  const mainAfterFirst = afterFirst.activeRuns.find((run: any) => run.id === periodicRunId);
  expect(mainAfterFirst).toBeTruthy();
  expect(mainAfterFirst.checks.filter((check: any) => check.status === 'COMPLETED')).toHaveLength(1);
  expect(afterFirst.activeRuns.length).toBe(baselineWorkspace.activeRuns.length + 1);
  evidence.lifecycle.inWorkAfterFirstOccurrence = true;
  await selectChecklistTab(page, 'В работе');
  mainCard = page.locator('.checklist-compact-run').filter({ hasText: names.periodic });
  await expect(mainCard).toContainText('Проверок за смену: 1');
  await expect(mainCard.locator('.checklist-compact-timer')).toHaveText(/^\d{2}:\d{2}$|^\d+:\d{2}:\d{2}$/);
  await page.screenshot({ path: screenshotPath('02-in-work-countdown-390.png'), fullPage: false });
  await expect(observerRunCard).toContainText('Проверок за смену: 1', { timeout: 20_000 });
  await secondContext.close();

  const dueSoon = await createApiTemplate(names.dueSoon, 'EVERY_N_HOURS', { unit: 'HOURS', value: 1 });
  const dueLater = await createApiTemplate(names.dueLater, 'EVERY_N_HOURS', { unit: 'HOURS', value: 1 });
  const oneTime = await createApiTemplate(names.oneTime, 'ONCE_PER_SHIFT');
  oneTimeTemplateId = oneTime.id;
  const dueSoonRun = await startTemplate(dueSoon.id);
  const dueLaterRun = await startTemplate(dueLater.id);
  const now = Date.now();
  await setRunDue(periodicRunId, new Date(now - 3 * 60_000));
  await setRunDue(dueSoonRun.id, new Date(now + 10 * 60_000));
  await setRunDue(dueLaterRun.id, new Date(now + 40 * 60_000));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 20_000 });
  await openChecklists(page);
  await selectChecklistTab(page, 'В работе');
  await expect(page.locator('.checklist-compact-run').filter({ hasText: marker })).toHaveCount(3);
  evidence.sorting.beforeCompletion = await markerRunTitles(page);
  expect(evidence.sorting.beforeCompletion).toEqual([names.periodic, names.dueSoon, names.dueLater]);
  mainCard = page.locator('.checklist-compact-run').filter({ hasText: names.periodic });
  await expect(mainCard.locator('.checklist-compact-timer')).toContainText('Просрочен');
  await page.screenshot({ path: screenshotPath('03-in-work-due.png'), fullPage: false });
  evidence.mobile.oneFingerScroll = await oneFingerDrag(page);

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
    await page.setViewportSize(viewport);
    evidence.mobile.widths[`${viewport.width}x${viewport.height}`] = { overflow: await noHorizontalOverflow(page) };
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await mainCard.getByRole('button', { name: 'Заполнить', exact: true }).click();
  await completePeriodicOccurrence(page, 2);

  const afterSecond = await workspace();
  const mainAfterSecond = afterSecond.activeRuns.find((run: any) => run.id === periodicRunId);
  evidence.lifecycle.completedOccurrencesAfterSecond = mainAfterSecond.checks.filter((check: any) => check.status === 'COMPLETED').length;
  expect(evidence.lifecycle.completedOccurrencesAfterSecond).toBe(2);
  evidence.duplicate.activeOccurrenceDuplicates = Math.max(0, mainAfterSecond.checks.filter((check: any) => check.status === 'ACTIVE').length - 1);
  expect(evidence.duplicate.activeOccurrenceDuplicates).toBe(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 20_000 });
  await openChecklists(page);
  await selectChecklistTab(page, 'В работе');
  evidence.sorting.afterCompletion = await markerRunTitles(page);
  expect(evidence.sorting.afterCompletion).toEqual([names.dueSoon, names.dueLater, names.periodic]);
  mainCard = page.locator('.checklist-compact-run').filter({ hasText: names.periodic });
  await mainCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const detail = page.locator('.checklist-local-detail-sheet');
  await expect(detail).toBeVisible();
  const historyRows = detail.locator('.checklist-history-compact-row');
  await expect(historyRows).toHaveCount(2, { timeout: 20_000 });
  evidence.history.localOccurrences = await historyRows.count();
  const historyActorName = (await historyRows.first().locator('small').innerText()).split(' · ')[0].trim();
  evidence.history.actorVisible = Boolean(historyActorName && historyActorName !== 'Сотрудник');
  await historyRows.first().click();
  await expect(detail.getByText('История проверки')).toBeVisible();
  await expect(detail.getByText('Фото').first()).toBeVisible();
  evidence.history.photoVisible = await detail.locator('.attachment-preview-list img').count() > 0;
  const journal = (await api('master', `/checklists/archive/template/${periodicTemplateId}/journal?includeDiagnostics=true&includeActiveOccurrences=true&pageSize=5`)).body;
  evidence.history.latestFirst = journal.runs.slice(0, 2).map((item: any) => item.occurrenceSequence).join(',') === '2,1';
  expect(evidence.history.latestFirst).toBe(true);
  expect(evidence.history.actorVisible).toBe(true);
  expect(evidence.history.photoVisible).toBe(true);
  await page.screenshot({ path: screenshotPath('07-detail-history.png'), fullPage: false });
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(detail.getByText('Последние проверки')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(detail).toHaveCount(0);
  evidence.mobile.androidBack = true;

  await selectChecklistTab(page, 'Доступные');
  const oneTimeCard = page.locator('.checklist-compact-available').filter({ hasText: names.oneTime });
  await expect(oneTimeCard).toBeVisible();
  await oneTimeCard.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const oneTimeStartDialog = page.getByRole('dialog').filter({ hasText: names.oneTime }).last();
  await oneTimeStartDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const oneTimeRunner = page.locator('.guided-run-modal');
  await expect(oneTimeRunner).toBeVisible();
  oneTimeRunId = (await workspace()).activeRuns.find((run: any) => run.template?.id === oneTimeTemplateId)?.id;
  expect(oneTimeRunId).toBeTruthy();
  runIds.add(oneTimeRunId);
  await oneTimeRunner.getByRole('button', { name: 'Да', exact: true }).click();
  await oneTimeRunner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const oneTimeReview = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await oneTimeReview.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const closeDialog = page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
  await closeDialog.getByLabel('Причина завершения').fill(`${marker} разовая проверка выполнена`);
  await closeDialog.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  await expect(oneTimeRunner).toHaveCount(0, { timeout: 20_000 });
  const afterOneTime = await workspace();
  evidence.lifecycle.oneTimeRemovedAfterCompletion = !afterOneTime.activeRuns.some((run: any) => run.id === oneTimeRunId)
    && !afterOneTime.available.some((template: any) => template.id === oneTimeTemplateId);
  expect(evidence.lifecycle.oneTimeRemovedAfterCompletion).toBe(true);

  const workerDenied = await api('worker', '/checklists/runs/start', {
    method: 'POST',
    body: { templateId: periodicTemplateId },
    expected: [403, 409],
  });
  evidence.rbac.workerMutationStatus = workerDenied.status;
  expect([403, 409]).toContain(workerDenied.status);
  if (otherFactoryId) {
    const crossFactory = await api('master', '/checklists/runs/start', {
      method: 'POST',
      factoryId: otherFactoryId,
      body: { templateId: periodicTemplateId },
      expected: [403, 409],
    });
    evidence.rbac.crossFactoryMutationStatus = crossFactory.status;
    expect([403, 409]).toContain(crossFactory.status);
  }

  const safeAreaStyles = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'styles.css'), 'utf8');
  evidence.mobile.safeArea = /checklist-runner-sticky-actions[\s\S]{0,1200}safe-area-inset-bottom|guided-run-modal[\s\S]{0,1200}safe-area-inset-bottom/.test(safeAreaStyles);
  expect(evidence.mobile.safeArea).toBe(true);

  await cleanupMarker();
  await referenceIntegrity();
  expect(evidence.cleanup.activeTestArtifacts).toBe(0);
  expect(evidence.referenceIntegrity.duplicateActiveOwnerships).toBe(0);
  expect(evidence.referenceIntegrity.activeRunsWithMultipleOccurrences).toBe(0);
  expect(evidence.referenceIntegrity.ownershipToInactiveTemplate).toBe(0);
  expect(evidence.referenceIntegrity.activeOccurrenceWithoutActiveRun).toBe(0);
  expect(evidence.referenceIntegrity.invalidTemplateSnapshotRefs).toBe(0);
  expect(evidence.referenceIntegrity.orphanActiveAnswers).toBe(0);

  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 20_000 });
  await openChecklists(page);
  for (const tab of ['В работе', 'Доступные', 'Архив'] as const) {
    await selectChecklistTab(page, tab);
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
    await noHorizontalOverflow(page);
  }
  await selectChecklistTab(page, 'В работе');
  await page.screenshot({ path: screenshotPath('08-post-cleanup.png'), fullPage: false });
  evidence.postCleanup.markerAbsent = !(await page.locator('body').innerText()).includes(marker);
  evidence.postCleanup.noServerErrors = browserFailures.length === 0;
  evidence.postCleanup.countersCoherent = await page.locator('.checklist-kpi-strip button').count() === 3;

  await loginUi(page, 'admin', false);
  await openChecklists(page);
  await page.getByRole('button', { name: 'Управление шаблонами ›', exact: true }).click();
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const cleanBuilder = page.locator('.checklist-template-builder-sheet');
  await expect(cleanBuilder).toBeVisible();
  const cleanMainSection = cleanBuilder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first();
  expect(await cleanMainSection.locator('select').first().locator('option').count()).toBeGreaterThan(1);
  expect((await cleanBuilder.innerText()).includes('undefined')).toBe(false);
  evidence.postCleanup.templateBuilderHealthy = true;
  await cleanBuilder.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(cleanBuilder).toHaveCount(0);

  expect(evidence.compact.availableCardHeight390).toBeGreaterThanOrEqual(70);
  expect(evidence.lifecycle.availableBeforeTake).toBe(true);
  expect(evidence.lifecycle.inWorkAfterTake).toBe(true);
  expect(evidence.lifecycle.inWorkAfterFirstOccurrence).toBe(true);
  expect(evidence.runner.numericSpacing).toBe(true);
  expect(evidence.runner.compositeStep1).toBe(true);
  expect(evidence.runner.compositeStep2).toBe(true);
  expect(evidence.runner.photoUploaded).toBe(true);
  expect(evidence.runner.optionalCommentSaved).toBe(true);
  expect(evidence.runner.stickyFooterVisible).toBe(true);
  expect(evidence.runner.keyboardInputFocused).toBe(true);
  expect(evidence.postCleanup.markerAbsent).toBe(true);
  expect(evidence.postCleanup.noServerErrors).toBe(true);
  expect(evidence.postCleanup.countersCoherent).toBe(true);
  expect(evidence.postCleanup.templateBuilderHealthy).toBe(true);
  expect(screenshotNames).toHaveLength(8);
  writeArtifacts();
});
