import { BrowserContext, expect, Page, test, WebSocket } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const backendEnvPath = path.join(backendDir, '.env');
for (const line of fs.readFileSync(backendEnvPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5175';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3101';
const clockFile = process.env.P16B_CLOCK_FILE ?? '';
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast16b');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P16B_${runId}__`;
const suffix = runId.slice(-8);

type FixtureState = {
  factoryId: string;
  otherFactoryId: string;
  departmentId: string;
  factoryName: string;
  adminId: string;
  masterId: string;
  managementId: string;
  workerAId: string;
  workerBId: string;
  workerCId: string;
  userIds: string[];
  lineId: string;
  operationsLineId: string;
  lineIds: string[];
  positionAId: string;
  positionBId: string;
  positionIds: string[];
  staffingTemplateId: string;
  staffingTemplateIds: string[];
  workAreaId: string;
  workAreaPositionId: string;
  checklistTemplateId: string;
  checklistRunIds: string[];
  dayRunId: string;
  nightRunId: string;
  willBeId: string;
  taskId: string;
  downtimeId: string;
  washId: string;
  washAssignmentId: string;
  handoverId: string;
  handoverText: string;
};

const state: FixtureState = {
  factoryId: '', otherFactoryId: '', departmentId: '', factoryName: `${marker} Завод`,
  adminId: '', masterId: '', managementId: '', workerAId: '', workerBId: '', workerCId: '', userIds: [],
  lineId: '', operationsLineId: '', lineIds: [], positionAId: '', positionBId: '', positionIds: [],
  staffingTemplateId: '', staffingTemplateIds: [], workAreaId: '', workAreaPositionId: '', checklistTemplateId: '',
  checklistRunIds: [], dayRunId: '', nightRunId: '', willBeId: '', taskId: '', downtimeId: '', washId: '',
  washAssignmentId: '', handoverId: '', handoverText: '',
};

const names = {
  line: `${marker} Линия перехода`,
  operationsLine: `${marker} Операционная линия`,
  checklist: `${marker} Периодический контроль`,
  task: `${marker} Устранить причину простоя`,
};

const evidence: any = {
  plast: '16B', startedAt: new Date().toISOString(), status: 'PENDING',
  timezone: {}, boundary20: {}, checklist: {}, boundary08: {}, clients: {}, multiDay: {}, cleanup: {},
  screenshots: [], factory4HashBefore: '', factory4HashAfter: '', physicalDeletes: 0, migration: 'NOT_REQUIRED',
};

let cleanupDone = false;

function unwrap(value: any) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

function sanitizeEvidence(value: any): any {
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
      ? '[тестовый идентификатор скрыт]'
      : value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'marker' && key !== 'runId' && !/(?:^|_)(?:id|ids)$/i.test(key) && !/(?:Id|Ids)$/.test(key))
    .map(([key, item]) => [key, sanitizeEvidence(item)]));
}

function writeClock(iso: string) {
  if (!clockFile) throw new Error('P16B_CLOCK_FILE не задан');
  fs.writeFileSync(clockFile, `${iso}\n`, 'utf8');
}

function screenshotPath(fileName: string) {
  if (!evidence.screenshots.includes(fileName)) evidence.screenshots.push(fileName);
  if (evidence.screenshots.length > 6) throw new Error('P16B допускает не более шести скриншотов');
  return path.join(evidenceDir, fileName);
}

async function apiRaw(
  userId: string,
  factoryId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-user-id': userId,
      'x-factory-id': factoryId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body: unwrap(body), text };
}

async function api(
  userId: string,
  factoryId: string,
  pathname: string,
  options: { method?: string; body?: unknown; expected?: number[] } = {},
) {
  const result = await apiRaw(userId, factoryId, pathname, options);
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(result.status)) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: HTTP ${result.status} ${result.text.slice(0, 600)}`);
  }
  return result.body;
}

async function createUser(factoryId: string, departmentId: string | null, role: string, employeeState = 'AVAILABLE') {
  const user = await db.user.create({ data: { factoryId, role, employeeState } });
  await db.userFactoryAccess.create({
    data: { userId: user.id, factoryId, role, departmentId, isActive: true, isGuest: false },
  });
  state.userIds.push(user.id);
  return user;
}

async function factory4Hash() {
  const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
  if (!factory) return 'factory-4-absent';
  const [lines, assignments, linePlans, shiftPlans, checklistRuns, tasks, downtimes, washes, sessions] = await Promise.all([
    db.line.findMany({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null }, select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    db.assignment.findMany({ where: { factoryId: factory.id, endedAt: null }, select: { id: true, userId: true, kind: true, lineId: true, washSessionId: true, workAreaId: true, positionId: true, slotIndex: true, startedAt: true }, orderBy: { id: 'asc' } }),
    db.plannedLineAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, lineId: true, positionId: true, slotIndex: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.plannedShiftAssignment.findMany({ where: { factoryId: factory.id, releasedAt: null }, select: { id: true, userId: true, kind: true, workAreaId: true, workAreaPositionId: true, slotIndex: true, shiftDate: true, shiftType: true }, orderBy: { id: 'asc' } }),
    db.checklistRun.findMany({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true, templateId: true, userId: true, shiftDate: true, shiftType: true, status: true }, orderBy: { id: 'asc' } }),
    db.task.findMany({ where: { factoryId: factory.id, status: { in: ['NEW', 'IN_PROGRESS'] }, deletedAt: null }, select: { id: true, status: true, lineId: true, lineStatusEventId: true, version: true }, orderBy: { id: 'asc' } }),
    db.lineEvent.findMany({ where: { factoryId: factory.id, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null }, select: { id: true, lineId: true, status: true, createdAt: true }, orderBy: { id: 'asc' } }),
    db.washSession.findMany({ where: { factoryId: factory.id, status: { not: 'DONE' }, deletedAt: null }, select: { id: true, lineId: true, status: true, version: true }, orderBy: { id: 'asc' } }),
    db.shiftSession.findMany({ where: { factoryId: factory.id, status: 'ACTIVE' }, select: { id: true, userId: true, shiftType: true, startedAt: true, plannedEndAt: true, version: true }, orderBy: { id: 'asc' } }),
  ]);
  return createHash('sha256').update(JSON.stringify({ lines, assignments, linePlans, shiftPlans, checklistRuns, tasks, downtimes, washes, sessions })).digest('hex');
}

async function setupFixtures() {
  evidence.factory4HashBefore = await factory4Hash();
  const factory = await db.factory.create({ data: { name: state.factoryName, code: `p16b-${runId}` } });
  const otherFactory = await db.factory.create({ data: { name: `${marker} Чужой завод`, code: `p16b-other-${runId}` } });
  state.factoryId = factory.id;
  state.otherFactoryId = otherFactory.id;
  const department = await db.department.create({
    data: { factoryId: factory.id, name: `${marker} Производство`, normalizedName: `p16b-production-${suffix}`, code: `P16B_${suffix}`, scope: 'LOCAL' },
  });
  state.departmentId = department.id;

  const admin = await createUser(factory.id, department.id, 'ADMIN');
  const master = await createUser(factory.id, department.id, 'MASTER');
  const management = await createUser(factory.id, department.id, 'MANAGEMENT');
  const workerA = await createUser(factory.id, department.id, 'WORKER');
  const workerB = await createUser(factory.id, department.id, 'WORKER');
  const workerC = await createUser(factory.id, department.id, 'WORKER', 'OFF_SHIFT');
  await createUser(otherFactory.id, null, 'MANAGEMENT');
  Object.assign(state, {
    adminId: admin.id, masterId: master.id, managementId: management.id,
    workerAId: workerA.id, workerBId: workerB.id, workerCId: workerC.id,
  });

  const line = await db.line.create({ data: { factoryId: factory.id, name: names.line, status: 'WORK' } });
  const positionA = await db.linePosition.create({
    data: { factoryId: factory.id, lineId: line.id, name: `Позиция А ${suffix}`, displayName: 'Позиция А', normalizedName: `position-a-${suffix}`, sortOrder: 10 },
  });
  const positionB = await db.linePosition.create({
    data: { factoryId: factory.id, lineId: line.id, name: `Позиция Б ${suffix}`, displayName: 'Позиция Б', normalizedName: `position-b-${suffix}`, sortOrder: 20 },
  });
  const staffing = await db.lineStaffingTemplate.create({
    data: {
      factoryId: factory.id, lineId: line.id, name: `${marker} Состав 2`,
      items: { create: [
        { positionId: positionA.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 10 },
        { positionId: positionB.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 20 },
      ] },
    },
  });
  await db.line.update({ where: { id: line.id }, data: { defaultStaffingTemplateId: staffing.id } });
  await db.lineEvent.create({
    data: { factoryId: factory.id, lineId: line.id, createdById: master.id, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T19:30:00+03:00') },
  });
  const operationsLine = await db.line.create({ data: { factoryId: factory.id, name: names.operationsLine, status: 'WORK' } });
  await db.lineEvent.create({
    data: { factoryId: factory.id, lineId: operationsLine.id, createdById: master.id, status: 'WORK', comment: marker, createdAt: new Date('2026-08-13T19:30:00+03:00') },
  });
  Object.assign(state, {
    lineId: line.id, operationsLineId: operationsLine.id, lineIds: [line.id, operationsLine.id],
    positionAId: positionA.id, positionBId: positionB.id, positionIds: [positionA.id, positionB.id],
    staffingTemplateId: staffing.id, staffingTemplateIds: [staffing.id],
  });

  const workArea = await db.workArea.create({
    data: { factoryId: factory.id, departmentId: department.id, name: `${marker} Повременная зона`, assignmentKind: 'TIME' },
  });
  const workAreaPosition = await db.workAreaPosition.create({
    data: { workAreaId: workArea.id, title: 'Контроль смены', minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1 },
  });
  state.workAreaId = workArea.id;
  state.workAreaPositionId = workAreaPosition.id;

  // These are real DAY-shift assignments. Creating them one minute before the
  // boundary would correctly trigger the production move-interval guard at 20:00.
  writeClock('2026-08-13T08:00:00+03:00');
  await api(master.id, factory.id, '/assignments/line', {
    method: 'POST', body: { targetUserId: workerA.id, lineId: line.id, positionId: positionA.id, slotIndex: 1, staffingTemplateId: staffing.id, operationId: `${marker}-day-a`, manualAdd: true, expectedShiftDate: '2026-08-13', expectedShiftType: 'DAY', comment: marker },
  });
  await api(master.id, factory.id, '/assignments/line', {
    method: 'POST', body: { targetUserId: workerB.id, lineId: line.id, positionId: positionB.id, slotIndex: 1, staffingTemplateId: staffing.id, operationId: `${marker}-day-b`, manualAdd: true, expectedShiftDate: '2026-08-13', expectedShiftType: 'DAY', comment: marker },
  });
  writeClock('2026-08-13T19:59:00+03:00');
  const willBe = await api(workerB.id, factory.id, '/shift/will-be', {
    method: 'POST', body: { targetShiftDate: '2026-08-13', shiftType: 'NIGHT', comment: marker },
  });
  state.willBeId = willBe.id;
  await api(master.id, factory.id, `/lines/${line.id}/shift-assignment`, {
    method: 'PUT', body: { shiftDate: '2026-08-13', shiftType: 'NIGHT', staffingTemplateId: staffing.id, rows: [{ article: 'P16B-ARTICLE', productName: 'Контрольный продукт', plannedGofrCount: 24 }] },
  });
  await api(master.id, factory.id, `/lines/${line.id}/planning-board/assign`, {
    method: 'POST', body: { shiftDate: '2026-08-13', shiftType: 'NIGHT', staffingTemplateId: staffing.id, targetUserId: workerB.id, positionId: positionB.id, slotIndex: 1, operationId: `${marker}-plan-b`, manualAssignment: true, comment: marker },
  });
  await api(master.id, factory.id, '/shift/future-assignments', {
    method: 'POST', body: { targetUserId: workerC.id, shiftDate: '2026-08-13', shiftType: 'NIGHT', kind: 'TIME', workAreaId: workArea.id, workAreaPositionId: workAreaPosition.id, slotIndex: 1, operationId: `${marker}-plan-c-time`, comment: marker },
  });

  const checklistTemplate = await api(admin.id, factory.id, '/checklists/templates', {
    method: 'POST', body: {
      name: names.checklist, description: `${marker} shift ownership`, departmentId: department.id,
      assignmentRoles: ['MASTER', 'MANAGEMENT'], frequencyRule: 'EVERY_N_HOURS', frequencyIntervalUnit: 'MINUTES',
      frequencyIntervalValue: 30, isActive: true,
      rows: [{ title: `${marker} Проверка`, rowType: 'YES_NO', requiredAnswer: true, isRequired: true }],
    },
  });
  state.checklistTemplateId = checklistTemplate.id;
  const dayRun = await api(master.id, factory.id, '/checklists/runs/start', {
    method: 'POST', body: { templateId: checklistTemplate.id, shiftDate: '2026-08-13', shiftType: 'DAY' },
  });
  state.dayRunId = dayRun.id;
  state.checklistRunIds.push(dayRun.id);
  await api(master.id, factory.id, `/checklists/runs/${dayRun.id}/rows/${dayRun.rows[0].id}/complete`, {
    method: 'POST', body: { answerBoolean: true, checkId: dayRun.currentCheck.id, operationId: `${marker}-day-row` },
  });
  await api(master.id, factory.id, `/checklists/runs/${dayRun.id}/checks/current/complete`, {
    method: 'POST', body: { checkId: dayRun.currentCheck.id, operationId: `${marker}-day-check` },
  });
  const nextCheck = await db.checklistRunCheck.findFirst({ where: { runId: dayRun.id, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
  if (!nextCheck) throw new Error('Не создан следующий occurrence дневного чек-листа');
  await db.checklistRunCheck.update({ where: { id: nextCheck.id }, data: { dueAt: new Date('2026-08-13T21:00:00+03:00') } });
  await db.checklistRun.update({ where: { id: dayRun.id }, data: { nextCheckAt: new Date('2026-08-13T21:00:00+03:00') } });
}

function runScopedMaintenance(iso: string, concurrent = false) {
  writeClock(iso);
  const program = [
    "require('reflect-metadata');",
    "const { NestFactory } = require('@nestjs/core');",
    "const { AppModule } = require('./dist/app.module');",
    "const { ShiftService } = require('./dist/modules/shift/shift.service');",
    "const { ChecklistsService } = require('./dist/modules/checklists/checklists.service');",
    '(async () => {',
    ' const app = await NestFactory.createApplicationContext(AppModule, { logger: false });',
    ' try {',
    `  const now = new Date('${iso}');`,
    `  const shift = app.get(ShiftService);`,
    `  const runs = ${concurrent ? `await Promise.all([shift.runShiftMaintenance(now, ['${state.factoryId}']), shift.runShiftMaintenance(now, ['${state.factoryId}'])])` : `[(await shift.runShiftMaintenance(now, ['${state.factoryId}']))]`};`,
    `  const checklists = await app.get(ChecklistsService).runMaintenance(now, '${state.factoryId}');`,
    "  process.stdout.write('\\n__P16B_RESULT__' + JSON.stringify({ runs, checklists }));",
    ' } finally { await app.close(); }',
    '})().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', program], {
    cwd: backendDir,
    env: {
      ...process.env, NODE_ENV: 'test', SHIFT_MAINTENANCE_ENABLED: 'false', CHECKLIST_MAINTENANCE_ENABLED: 'false',
      ANNOUNCEMENT_MAINTENANCE_ENABLED: 'false', ZAVOD_INTERNAL_TEST_NOW_FILE: clockFile,
    },
    encoding: 'utf8', timeout: 180_000,
  });
  const markerIndex = output.lastIndexOf('__P16B_RESULT__');
  if (markerIndex < 0) throw new Error(`Не получен результат maintenance: ${output.slice(-500)}`);
  return JSON.parse(output.slice(markerIndex + '__P16B_RESULT__'.length));
}

async function loginUi(page: Page, userId: string, factoryId: string, tag: string) {
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?stage50User=${encodeURIComponent(tag)}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 30_000 });
}

async function openScreen(page: Page, screen: string, heading: RegExp) {
  await page.evaluate((target) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: target } }));
  }, screen);
  await expect(page.getByRole('heading', { name: heading }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function selectShift(page: Page, label: RegExp) {
  await page.locator('.shift-selector-compact').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
  return overflow;
}

async function oneFingerDrag(page: Page) {
  const session = await page.context().newCDPSession(page);
  const metrics = await page.evaluate(() => {
    const node = document.scrollingElement as HTMLElement;
    node.scrollTop = 0;
    return { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 120, window.innerHeight * 0.75), maxScroll: node.scrollHeight - node.clientHeight, before: node.scrollTop };
  });
  expect(metrics.maxScroll).toBeGreaterThan(80);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: metrics.x, y: metrics.y }] });
  for (const distance of [30, 60, 90, 120, 150, 180, 210]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: metrics.x, y: metrics.y - distance }] });
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.scrollingElement?.scrollTop ?? window.scrollY);
  expect(after).toBeGreaterThan(metrics.before + 20);
  return { ...metrics, after };
}

async function activeInventory() {
  const [lines, positions, staffing, assignments, washAssignments, linePlans, shiftPlans, futurePlans, checklistTemplates, checklistRuns, checklistOccurrences, tasks, downtimes, washes, accesses, factories, users] = await Promise.all([
    db.line.count({ where: { id: { in: state.lineIds }, deletedAt: null, deactivatedAt: null } }),
    db.linePosition.count({ where: { id: { in: state.positionIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.lineStaffingTemplate.count({ where: { id: { in: state.staffingTemplateIds }, isActive: true, deletedAt: null, deactivatedAt: null } }),
    db.assignment.count({ where: { factoryId: state.factoryId || '__none__', endedAt: null } }),
    db.assignment.count({ where: { factoryId: state.factoryId || '__none__', kind: 'WASH', endedAt: null } }),
    db.plannedLineAssignment.count({ where: { factoryId: state.factoryId || '__none__', releasedAt: null } }),
    db.plannedShiftAssignment.count({ where: { factoryId: state.factoryId || '__none__', releasedAt: null } }),
    db.lineShiftWorkPlan.count({ where: { factoryId: state.factoryId || '__none__', line: { deactivatedAt: null, deletedAt: null } } }),
    db.checklistTemplate.count({ where: { id: state.checklistTemplateId || '__none__', isActive: true, archivedAt: null } }),
    db.checklistRun.count({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    db.checklistRunCheck.count({ where: { runId: { in: state.checklistRunIds }, status: 'ACTIVE' } }),
    db.task.count({ where: { id: state.taskId || '__none__', status: { in: ['NEW', 'IN_PROGRESS'] }, deletedAt: null } }),
    db.lineEvent.count({ where: { lineId: { in: state.lineIds }, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null, line: { deactivatedAt: null, deletedAt: null } } }),
    db.washSession.count({ where: { id: state.washId || '__none__', status: { not: 'DONE' }, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { factoryId: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true } }),
    db.factory.count({ where: { id: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true, deactivatedAt: null, deletedAt: null } }),
    db.user.count({ where: { id: { in: state.userIds }, blockedAt: null, deletedAt: null } }),
  ]);
  const values = {
    ACTIVE_P16B_LINES: lines, ACTIVE_P16B_POSITIONS: positions, ACTIVE_P16B_STAFFING_TEMPLATES: staffing,
    ACTIVE_P16B_CURRENT_ASSIGNMENTS: assignments, ACTIVE_P16B_WASH_ASSIGNMENTS: washAssignments,
    ACTIVE_P16B_PLANNED_LINE_ASSIGNMENTS: linePlans, ACTIVE_P16B_PLANNED_SHIFT_ASSIGNMENTS: shiftPlans,
    ACTIVE_P16B_FUTURE_PLANS: futurePlans, ACTIVE_P16B_CHECKLIST_TEMPLATES: checklistTemplates,
    ACTIVE_P16B_CHECKLIST_RUNS: checklistRuns, ACTIVE_P16B_CHECKLIST_OCCURRENCES: checklistOccurrences,
    ACTIVE_P16B_TASKS: tasks, ACTIVE_P16B_DOWNTIMES: downtimes, ACTIVE_P16B_WASHES: washes,
    ACTIVE_P16B_ACCESSES: accesses, ACTIVE_P16B_FACTORIES: factories, ACTIVE_P16B_USERS: users,
  };
  return { ...values, ACTIVE_P16B_TEST_ARTIFACTS: Object.values(values).reduce((sum: number, value: any) => sum + Number(value), 0) };
}

async function softCleanup() {
  if (cleanupDone || !state.factoryId) return;
  const at = new Date('2026-08-16T21:00:00+03:00');
  writeClock('2026-08-16T21:00:00+03:00');
  await db.assignment.updateMany({ where: { factoryId: state.factoryId, endedAt: null }, data: { endedAt: at, endedById: state.masterId || null, comment: marker, version: { increment: 1 } } });
  await db.plannedLineAssignment.updateMany({ where: { factoryId: state.factoryId, releasedAt: null }, data: { releasedAt: at, releasedById: state.masterId || null, comment: marker } });
  await db.plannedShiftAssignment.updateMany({ where: { factoryId: state.factoryId, releasedAt: null }, data: { releasedAt: at, releasedById: state.masterId || null, comment: marker } });
  await db.shiftSession.updateMany({ where: { factoryId: state.factoryId, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: at, endedById: state.masterId || null, autoClosed: true, version: { increment: 1 } } });
  await db.checklistRunCheck.updateMany({ where: { runId: { in: state.checklistRunIds }, status: 'ACTIVE' }, data: { status: 'AUTO_CLOSED', completedAt: at } });
  await db.checklistRun.updateMany({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'AUTO_CLOSED', closedAt: at, autoClosedAt: at, closeReason: marker, closeKind: 'SHIFT_END_INCOMPLETE' } });
  if (state.checklistTemplateId) await db.checklistTemplate.updateMany({ where: { id: state.checklistTemplateId }, data: { isActive: false, archivedAt: at } });
  if (state.taskId) await db.task.updateMany({ where: { id: state.taskId, status: { in: ['NEW', 'IN_PROGRESS'] } }, data: { status: 'DONE', doneAt: at, doneById: state.masterId || null, version: { increment: 1 } } });
  await db.lineEvent.updateMany({ where: { lineId: { in: state.lineIds }, status: { in: ['STOP', 'PAUSE'] }, confirmedEndAt: null }, data: { confirmedEndAt: at } });
  if (state.washId) await db.washSession.updateMany({ where: { id: state.washId, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: at, version: { increment: 1 } } });
  await db.notification.updateMany({ where: { readAt: null, OR: [{ entityId: { in: [...state.checklistRunIds, state.taskId, state.washId].filter(Boolean) } }, { message: { contains: marker } }] }, data: { readAt: at } });
  await db.line.updateMany({ where: { id: { in: state.lineIds }, deactivatedAt: null }, data: { status: 'STOP', deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.linePosition.updateMany({ where: { id: { in: state.positionIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.lineStaffingTemplate.updateMany({ where: { id: { in: state.staffingTemplateIds }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  if (state.workAreaPositionId) await db.workAreaPosition.updateMany({ where: { id: state.workAreaPositionId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  if (state.workAreaId) await db.workArea.updateMany({ where: { id: state.workAreaId, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  if (state.willBeId) await db.shiftWillBe.updateMany({ where: { id: state.willBeId, status: 'WILL_BE' }, data: { status: 'CANCELLED', comment: marker, cancelledAt: at } });
  await db.userFactoryAccess.updateMany({ where: { factoryId: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  if (state.departmentId) await db.department.updateMany({ where: { id: state.departmentId, isActive: true }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.factory.updateMany({ where: { id: { in: [state.factoryId, state.otherFactoryId].filter(Boolean) }, deactivatedAt: null }, data: { isActive: false, deactivatedAt: at, deactivatedById: state.masterId || null, deactivationReason: marker } });
  await db.user.updateMany({ where: { id: { in: state.userIds }, blockedAt: null }, data: { blockedAt: at } });
  cleanupDone = true;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(12 * 60_000);

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  writeClock('2026-08-13T19:59:00+03:00');
  await setupFixtures();
});

test.afterAll(async () => {
  await softCleanup().catch((error) => { evidence.cleanup.error = error instanceof Error ? error.message : String(error); });
  evidence.cleanup.inventory = await activeInventory().catch(() => ({}));
  evidence.factory4HashAfter = await factory4Hash();
  evidence.cleanup.factory4Unchanged = evidence.factory4HashBefore === evidence.factory4HashAfter;
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, 'utf8');
  await db.$disconnect();
});

test('P16B cohesive shift transition route', async ({ browser }) => {
  const mainContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
  const managementContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
  const mainPage = await mainContext.newPage();
  const managementPage = await managementContext.newPage();
  const workerPage = await workerContext.newPage();
  const sockets: WebSocket[] = [];
  mainPage.on('websocket', (socket) => sockets.push(socket));

  try {
    await Promise.all([
      loginUi(mainPage, state.masterId, state.factoryId, 'p16b-master'),
      loginUi(managementPage, state.managementId, state.factoryId, 'p16b-management'),
      loginUi(workerPage, state.workerBId, state.factoryId, 'p16b-worker-b'),
    ]);
    await Promise.all([
      openScreen(mainPage, 'Shift', /^Смена$/),
      openScreen(managementPage, 'Shift', /^Смена$/),
      openScreen(workerPage, 'Shift', /^Смена$/),
    ]);

    const mainLine = mainPage.locator('.current-shift-line-card').filter({ hasText: names.line });
    const managementLine = managementPage.locator('.current-shift-line-card').filter({ hasText: names.line });
    await expect(mainLine).toContainText('Люди 2/2', { timeout: 30_000 });
    await expect(managementLine).toContainText('Люди 2/2', { timeout: 30_000 });
    expect(await mainPage.locator('.shift-selector-compact').innerText()).toMatch(/Дневная|День/i);
    expect(await managementPage.locator('.shift-selector-compact').innerText()).toMatch(/Дневная|День/i);

    await selectShift(mainPage, /Следующая смена/);
    await expect(mainPage.getByText(names.line).first()).toBeVisible({ timeout: 30_000 });
    await expect(mainPage.getByText(/назначено 1 из 2/i).first()).toBeVisible();
    await mainPage.screenshot({ path: screenshotPath('01-day-current-future-night-plan-390.png'), fullPage: false });
    await selectShift(mainPage, /Текущая смена/);
    await expect(mainLine).toContainText('Люди 2/2');
    evidence.timezone.before = { moscow: 'DAY/2026-08-13', losAngeles: 'DAY/2026-08-13' };

    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
      await mainPage.setViewportSize(viewport);
      await noHorizontalOverflow(mainPage);
    }
    await mainPage.setViewportSize({ width: 390, height: 844 });
    evidence.clients.oneFingerScroll = await oneFingerDrag(mainPage);
    await mainPage.evaluate(() => window.scrollTo(0, 0));

    await workerContext.setOffline(true);
    const boundary20 = runScopedMaintenance('2026-08-13T20:00:00+03:00', true);
    await expect(mainLine).toContainText('Люди 1/2', { timeout: 45_000 });
    await expect(managementLine).toContainText('Люди 1/2', { timeout: 45_000 });
    await expect(mainLine.getByText('Работает с прошлой смены')).toBeVisible();
    expect(await mainPage.locator('.shift-selector-compact').innerText()).toMatch(/Ночная|Ночь/i);
    expect(await managementPage.locator('.shift-selector-compact').innerText()).toMatch(/Ночная|Ночь/i);
    await workerContext.setOffline(false);
    await workerPage.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(workerPage.getByText(names.line).first()).toBeVisible({ timeout: 45_000 });
    await expect(workerPage.locator('.shift-selector-compact')).toContainText(/Ночная|Ночь/i, { timeout: 45_000 });
    await mainPage.screenshot({ path: screenshotPath('02-night-planned-people-390.png'), fullPage: false });
    await mainLine.screenshot({ path: screenshotPath('03-continuation-indicator-390.png') });

    const activeAt20 = await db.assignment.findMany({ where: { factoryId: state.factoryId, endedAt: null }, orderBy: { id: 'asc' } });
    const currentLinePeople = activeAt20.filter((item: any) => item.kind === 'LINE' && item.lineId === state.lineId);
    expect(currentLinePeople).toHaveLength(1);
    expect(currentLinePeople[0].userId).toBe(state.workerBId);
    expect(activeAt20.some((item: any) => item.userId === state.workerAId)).toBe(false);
    expect(activeAt20.some((item: any) => item.userId === state.workerCId && item.kind === 'TIME')).toBe(true);
    const futureAfter20 = await api(state.masterId, state.factoryId, '/shift/future');
    expect(futureAfter20.shiftDate).toBe('2026-08-14');
    expect(futureAfter20.shiftType).toBe('DAY');
    expect(futureAfter20.willBe.some((item: any) => item.id === state.willBeId)).toBe(false);
    evidence.boundary20 = {
      result: boundary20, currentLinePeople: currentLinePeople.length, plannedWorkerOnly: true,
      timeWorkerActivated: true, unplannedWorkerAbsent: true, nextFuture: `${futureAfter20.shiftType}/${futureAfter20.shiftDate}`,
    };

    const masterWorkspace = await api(state.masterId, state.factoryId, '/checklists/workspace?includeDiagnostics=true');
    expect(masterWorkspace.activeRuns.some((run: any) => run.id === state.dayRunId)).toBe(false);
    const nightRun = await api(state.managementId, state.factoryId, '/checklists/runs/start', {
      method: 'POST', body: { templateId: state.checklistTemplateId, shiftDate: '2026-08-13', shiftType: 'NIGHT' },
    });
    state.nightRunId = nightRun.id;
    state.checklistRunIds.push(nightRun.id);
    expect(nightRun.id).not.toBe(state.dayRunId);
    await openScreen(managementPage, 'Checklists', /^Чек-листы$/);
    await expect(managementPage.getByText(names.checklist).first()).toBeVisible({ timeout: 30_000 });
    const managementWorkspace = await api(state.managementId, state.factoryId, '/checklists/workspace?includeDiagnostics=true');
    expect(managementWorkspace.activeRuns.some((run: any) => run.id === state.nightRunId)).toBe(true);
    expect(managementWorkspace.activeRuns.some((run: any) => run.id === state.dayRunId)).toBe(false);
    evidence.checklist.separateRuns = true;
    evidence.checklist.runCount = 2;

    writeClock('2026-08-13T20:29:59+03:00');
    await openScreen(mainPage, 'Shift', /^Смена$/);
    await expect(mainLine.getByText('Работает с прошлой смены')).toBeVisible({ timeout: 30_000 });
    writeClock('2026-08-13T20:30:00+03:00');
    await expect(mainLine.getByText('Работает с прошлой смены')).toHaveCount(0, { timeout: 45_000 });
    evidence.boundary20.continuation = { visibleThrough: '20:29:59', hiddenAt: '20:30:00' };

    runScopedMaintenance('2026-08-13T20:59:59+03:00');
    expect((await db.checklistRun.findUnique({ where: { id: state.dayRunId } }))?.status).toBe('ACTIVE');
    runScopedMaintenance('2026-08-13T21:00:00+03:00');
    const closedDay = await db.checklistRun.findUnique({ where: { id: state.dayRunId } });
    expect(closedDay?.status).toBe('AUTO_CLOSED');
    expect(closedDay?.closeKind).toBe('SHIFT_END_INCOMPLETE');
    expect(closedDay?.autoClosedAt?.getTime()).toBe(new Date('2026-08-13T21:00:00+03:00').getTime());
    evidence.checklist.dayAutoClose = '21:00:00';

    writeClock('2026-08-14T07:25:00+03:00');
    await api(state.masterId, state.factoryId, `/lines/${state.operationsLineId}/status`, {
      method: 'PATCH', body: { status: 'STOP', comment: `${marker} Простой`, downtimeReason: 'TECHNICAL' },
    });
    const downtime = await db.lineEvent.findFirst({ where: { lineId: state.operationsLineId, status: 'STOP', confirmedEndAt: null }, orderBy: { createdAt: 'desc' } });
    if (!downtime) throw new Error('Не создан канонический простой');
    state.downtimeId = downtime.id;
    const task = await api(state.masterId, state.factoryId, '/tasks', {
      method: 'POST', body: { lineId: state.operationsLineId, lineStatusEventId: downtime.id, operationId: `${marker}-task`, description: names.task, type: 'URGENT' },
    });
    state.taskId = task.id;
    const wash = await api(state.masterId, state.factoryId, '/wash/start', {
      method: 'POST', body: { lineId: state.operationsLineId, targetType: 'LINE', operationId: `${marker}-wash` },
    });
    state.washId = wash.id;
    const washAssignment = await api(state.masterId, state.factoryId, '/assignments/wash', {
      method: 'POST', body: { targetUserId: state.workerAId, lineId: state.operationsLineId, washSessionId: wash.id, operationId: `${marker}-wash-a` },
    });
    state.washAssignmentId = washAssignment.id;

    writeClock('2026-08-14T07:59:00+03:00');
    const summary = await api(state.masterId, state.factoryId, '/shift-log/handover/summary');
    expect(summary.snapshot.sections.tasks.some((item: any) => item.taskId === task.id && item.lineStatusEventId === downtime.id)).toBe(true);
    expect(summary.snapshot.sections.washes.some((item: any) => item.washSessionId === wash.id)).toBe(true);
    expect(summary.snapshot.sections.people).toHaveLength(0);
    expect(JSON.stringify(summary.snapshot)).not.toContain(state.dayRunId);
    expect(JSON.stringify(summary.snapshot)).not.toContain(state.nightRunId);
    const handover = await api(state.masterId, state.factoryId, '/shift-log/handover', {
      method: 'POST', body: { comment: `${marker} Передача` },
    });
    state.handoverId = handover.id;
    state.handoverText = (await db.shiftLog.findUnique({ where: { id: handover.id } }))?.text ?? '';
    const duplicateHandover = await api(state.masterId, state.factoryId, '/shift-log/handover', {
      method: 'POST', body: { comment: `${marker} Повтор` },
    });
    expect(duplicateHandover.id).toBe(handover.id);

    const boundary08 = runScopedMaintenance('2026-08-14T08:00:00+03:00', true);
    const deniedHandover = await apiRaw(state.masterId, state.factoryId, '/shift-log/handover', { method: 'POST', body: {} });
    expect(deniedHandover.status).toBeGreaterThanOrEqual(400);
    const [activeAt08, sameDowntime, sameTask, sameWash, closedWashAssignment, previousHandover] = await Promise.all([
      db.assignment.findMany({ where: { factoryId: state.factoryId, endedAt: null } }),
      db.lineEvent.findUnique({ where: { id: state.downtimeId } }),
      db.task.findUnique({ where: { id: state.taskId } }),
      db.washSession.findUnique({ where: { id: state.washId } }),
      db.assignment.findUnique({ where: { id: state.washAssignmentId } }),
      api(state.masterId, state.factoryId, '/shift-log/handover/previous'),
    ]);
    expect(activeAt08).toHaveLength(0);
    expect(sameDowntime?.confirmedEndAt).toBeNull();
    expect(sameTask?.status).toBe('NEW');
    expect(sameTask?.lineStatusEventId).toBe(state.downtimeId);
    expect(sameWash?.status).not.toBe('DONE');
    expect(closedWashAssignment?.endedAt?.getTime()).toBe(new Date('2026-08-14T08:00:00+03:00').getTime());
    expect(previousHandover.id).toBe(state.handoverId);
    expect(previousHandover.handover.snapshot.shiftDate).toBe('2026-08-13');
    expect(previousHandover.handover.snapshot.shiftType).toBe('NIGHT');
    const dayWorkspace = await api(state.managementId, state.factoryId, '/checklists/workspace?includeDiagnostics=true');
    expect(dayWorkspace.activeRuns.some((run: any) => run.id === state.nightRunId)).toBe(false);
    evidence.boundary08 = { result: boundary08, people: 0, sameDowntime: true, sameTask: true, sameWash: true, oldWashPersonClosed: true };

    await openScreen(mainPage, 'Log', /^Пересменка$/);
    const handoverCard = mainPage.locator('.shift-log-card').filter({ hasText: marker }).first();
    await expect(handoverCard).toBeVisible({ timeout: 30_000 });
    await handoverCard.click();
    const handoverDialog = mainPage.getByRole('dialog').filter({ hasText: 'Неизменяемый снимок' });
    await expect(handoverDialog).toContainText(names.task);
    await expect(handoverDialog).toContainText(names.operationsLine);
    await mainPage.screenshot({ path: screenshotPath('04-downtime-task-after-0800-handover-390.png'), fullPage: false });
    await handoverDialog.getByRole('button', { name: 'Закрыть окно', exact: true }).click();

    await openScreen(mainPage, 'Wash', /^Мойка$/);
    const washCard = mainPage.locator('.wash-session-card').filter({ hasText: names.operationsLine }).first();
    await expect(washCard).toBeVisible({ timeout: 30_000 });
    await washCard.screenshot({ path: screenshotPath('05-wash-across-boundary-390.png') });

    runScopedMaintenance('2026-08-14T08:59:59+03:00');
    expect((await db.checklistRun.findUnique({ where: { id: state.nightRunId } }))?.status).toBe('ACTIVE');
    runScopedMaintenance('2026-08-14T09:00:00+03:00');
    const closedNight = await db.checklistRun.findUnique({ where: { id: state.nightRunId } });
    expect(closedNight?.status).toBe('AUTO_CLOSED');
    expect(closedNight?.closeKind).toBe('SHIFT_END_INCOMPLETE');
    expect(closedNight?.autoClosedAt?.getTime()).toBe(new Date('2026-08-14T09:00:00+03:00').getTime());
    evidence.checklist.nightAutoClose = '09:00:00';

    writeClock('2026-08-14T09:05:00+03:00');
    await api(state.masterId, state.factoryId, `/wash/${state.washId}/complete`, { method: 'POST', body: { operationId: `${marker}-wash-complete` } });
    await api(state.masterId, state.factoryId, `/tasks/${state.taskId}/complete`, { method: 'POST', body: { operationId: `${marker}-task-complete`, comment: `${marker} Выполнено` } });
    expect((await db.line.findUnique({ where: { id: state.operationsLineId } }))?.status).toBe('STOP');
    await api(state.masterId, state.factoryId, `/lines/${state.operationsLineId}/status`, { method: 'PATCH', body: { status: 'WORK', comment: `${marker} Возврат в работу` } });
    expect((await db.shiftLog.findUnique({ where: { id: state.handoverId } }))?.text).toBe(state.handoverText);

    runScopedMaintenance('2026-08-16T20:31:00+03:00');
    await openScreen(mainPage, 'Shift', /^Смена$/);
    const multiDayLine = mainPage.locator('.current-shift-line-card').filter({ hasText: names.line });
    await expect(multiDayLine).toContainText('Люди 0/2', { timeout: 45_000 });
    await expect(multiDayLine.getByText('Работает с прошлой смены')).toHaveCount(0);
    const [multiDayAssignments, multiDayLineDb, oldWillBe] = await Promise.all([
      db.assignment.findMany({ where: { factoryId: state.factoryId, endedAt: null } }),
      db.line.findUnique({ where: { id: state.lineId } }),
      db.shiftWillBe.findUnique({ where: { id: state.willBeId } }),
    ]);
    expect(multiDayAssignments).toHaveLength(0);
    expect(multiDayLineDb?.status).toBe('WORK');
    const multiDayFuture = await api(state.masterId, state.factoryId, '/shift/future');
    expect(multiDayFuture.plannedLines.some((line: any) => line.lineId === state.lineId)).toBe(false);
    expect(multiDayFuture.willBe.some((item: any) => item.id === oldWillBe?.id)).toBe(false);
    expect(await db.checklistRun.count({ where: { id: { in: state.checklistRunIds }, status: { in: ['ACTIVE', 'PAUSED'] } } })).toBe(0);
    evidence.multiDay = { at: '2026-08-16T20:31:00+03:00', lineStatus: 'WORK', people: 0, required: 2, stalePlans: 0, staleChecklists: 0, continuation: false };

    await mainPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(mainPage.locator('.current-shift-line-card').filter({ hasText: names.line })).toContainText('Люди 0/2', { timeout: 30_000 });
    await loginUi(managementPage, state.managementId, state.factoryId, 'p16b-management-relogin');
    await openScreen(managementPage, 'Shift', /^Смена$/);
    await expect(managementPage.locator('.current-shift-line-card').filter({ hasText: names.line })).toContainText('Люди 0/2', { timeout: 30_000 });
    evidence.clients = {
      ...evidence.clients, moscowTimezone: true, losAngelesTimezone: true, offlineReconnectWithoutReload: true,
      refresh: true, relogin: true, secondSession: true, websocketConnected: sockets.some((socket) => !socket.isClosed()),
      convergenceMechanism: 'WebSocket invalidation proof in backend regression plus bounded polling/online refresh in browser route',
    };
    expect(evidence.clients.websocketConnected).toBe(true);

    await managementContext.close();
    await workerContext.close();
    await softCleanup();
    const inventory = await activeInventory();
    expect(Object.values(inventory).every((value) => value === 0)).toBe(true);
    evidence.cleanup.inventory = inventory;
    evidence.factory4HashAfter = await factory4Hash();
    expect(evidence.factory4HashAfter).toBe(evidence.factory4HashBefore);

    const factory4 = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
    if (!factory4) throw new Error('Завод 4 не найден для post-cleanup smoke');
    await loginUi(mainPage, 'test-admin', factory4.id, 'p16b-post-cleanup');
    await openScreen(mainPage, 'Shift', /^Смена$/);
    await mainPage.setViewportSize({ width: 430, height: 900 });
    await noHorizontalOverflow(mainPage);
    await mainPage.screenshot({ path: screenshotPath('06-post-cleanup-active-shift-430.png'), fullPage: false });
    expect(await db.line.count({ where: { id: { in: state.lineIds }, deactivatedAt: null } })).toBe(0);

    evidence.status = 'PASS';
  } finally {
    await mainContext.close().catch(() => undefined);
    await managementContext.close().catch(() => undefined);
    await workerContext.close().catch(() => undefined);
  }
});
