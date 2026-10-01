import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const db = new PrismaClient();
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-line-timeline-screenshots');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let factoryId = '';
let factoryName = '';
let departmentId = '';
let lineName = '';
let historyTarget: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' };

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
  let value = { ...target };
  for (let index = 0; index < Math.abs(offset); index += 1) {
    if (offset > 0) value = value.shiftType === 'DAY'
      ? { shiftDate: value.shiftDate, shiftType: 'NIGHT' }
      : { shiftDate: addDays(value.shiftDate, 1), shiftType: 'DAY' };
    else value = value.shiftType === 'NIGHT'
      ? { shiftDate: value.shiftDate, shiftType: 'DAY' }
      : { shiftDate: addDays(value.shiftDate, -1), shiftType: 'NIGHT' };
  }
  return value as { shiftDate: string; shiftType: 'DAY' | 'NIGHT' };
}

function shiftWindow(target: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' }) {
  const from = target.shiftType === 'DAY'
    ? new Date(`${target.shiftDate}T08:00:00+03:00`)
    : new Date(`${target.shiftDate}T20:00:00+03:00`);
  const to = target.shiftType === 'DAY'
    ? new Date(`${target.shiftDate}T20:00:00+03:00`)
    : new Date(`${addDays(target.shiftDate, 1)}T08:00:00+03:00`);
  return { from, to };
}

function at(from: Date, hours: number) {
  return new Date(from.getTime() + hours * 60 * 60_000);
}

async function setupFixture() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  factoryName = `Проверка истории линии ${suffix}`;
  lineName = `Линия хронологии ${suffix}`;
  const factory = await db.factory.create({ data: { code: `history-${suffix}`, name: factoryName, isActive: true } });
  factoryId = factory.id;
  const department = await db.department.create({ data: { factoryId, code: `masters-${suffix}`, name: 'Мастера истории линии' } });
  departmentId = department.id;
  await db.userFactoryAccess.create({ data: { userId: 'pilot-master-1', factoryId, departmentId, role: 'MASTER', isActive: true } });
  const line = await db.line.create({ data: { factoryId, name: lineName, status: 'WORK' } });
  historyTarget = addShift(currentTarget(), -1);
  if (historyTarget.shiftType !== 'NIGHT') historyTarget = addShift(historyTarget, -1);
  const { from } = shiftWindow(historyTarget);
  const createEvent = (data: any) => db.lineEvent.create({ data: { factoryId, lineId: line.id, createdById: 'pilot-master-1', ...data } });
  await createEvent({ status: 'WORK', comment: 'Линия работала до начала смены', createdAt: at(from, -1) });
  const downtime = await createEvent({ status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: 'Проверка привода', createdAt: at(from, 2) });
  await createEvent({ status: 'WORK', comment: 'Привод восстановлен', createdAt: at(from, 3) });
  await createEvent({ status: 'STOP', downtimeReason: 'WASH', comment: 'Передача на мойку', createdAt: at(from, 4) });
  await createEvent({ status: 'WORK', comment: 'Мойка завершена', createdAt: at(from, 5) });
  await createEvent({ status: 'STOP', downtimeReason: 'DEFROST', comment: 'Передача на оттайку', createdAt: at(from, 6) });
  await createEvent({ status: 'WORK', comment: 'Оттайка завершена', createdAt: at(from, 7) });
  const task = await db.task.create({ data: { factoryId, lineId: line.id, lineStatusEventId: downtime.id, createdById: 'pilot-master-1', type: 'URGENT', status: 'DONE', description: 'Восстановить привод', createdAt: at(from, 2.1), startedAt: at(from, 2.2), doneAt: at(from, 2.5) } });
  await db.taskDepartmentRecipient.create({ data: { taskId: task.id, departmentId, factoryId, active: true } });
  const position = await db.linePosition.create({ data: { factoryId, lineId: line.id, name: 'Оператор', displayName: 'Оператор' } });
  await db.assignment.create({ data: { factoryId, lineId: line.id, userId: 'pilot-worker-1', kind: 'LINE', positionId: position.id, startedById: 'pilot-master-1', startedAt: at(from, 1), endedAt: at(from, 3.5), endedById: 'pilot-master-1' } });
  const wash = await db.washSession.create({ data: { factoryId, lineId: line.id, targetType: 'LINE', startedById: 'pilot-master-1', status: 'DONE', createdAt: at(from, 4.1), completedAt: at(from, 5) } });
  await db.washIssue.create({ data: { factoryId, washSessionId: wash.id, createdById: 'pilot-master-1', message: 'Скрытая внутренняя проблема мойки', status: 'OPEN' } });
  await db.defrostEvent.create({ data: { factoryId, lineId: line.id, startedById: 'pilot-master-1', endedById: 'pilot-master-1', status: 'COMPLETED', eventType: 'DEFROST', startAt: at(from, 6.1), endAt: at(from, 7), comment: 'Плановая оттайка' } });
  await db.okkRecord.create({ data: { factoryId, lineId: line.id, createdById: 'pilot-master-1', assignedMasterId: 'pilot-master-1', status: 'BLOCKED', description: 'Скрытая запись ОКК' } });
  const template = await db.checklistTemplate.create({ data: { factoryId, departmentId, name: 'Скрытый чек-лист', createdById: 'pilot-master-1', assignmentRoles: ['MASTER'] } });
  await db.checklistRun.create({ data: { factoryId, departmentId, templateId: template.id, userId: 'pilot-master-1', status: 'ACTIVE', shiftDate: new Date(`${historyTarget.shiftDate}T00:00:00+03:00`), shiftType: historyTarget.shiftType } });
}

async function login(page: Page) {
  await page.goto(frontendUrl);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  const devForm = page.locator('form.dev-login-card').filter({ hasText: 'Тестовый пользователь' }).first();
  await expect(devForm).toBeVisible({ timeout: 15_000 });
  await devForm.locator('#dev-user-id').fill('pilot-master-1');
  await devForm.getByRole('button', { name: 'Войти' }).click();
  const factoryCard = page.locator('.factory-card').filter({ hasText: factoryName }).first();
  await expect(factoryCard).toBeVisible({ timeout: 15_000 });
  await factoryCard.getByRole('button', { name: 'Выбрать завод' }).click();
  const linesButton = page.getByRole('button', { name: /^Линии/ }).filter({ visible: true }).first();
  await expect(linesButton).toBeVisible({ timeout: 15_000 });
  await linesButton.click();
  const card = page.locator('.line-card').filter({ hasText: lineName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Подробнее' }).click();
  const detail = page.locator('.line-detail-inline-card').filter({ hasText: lineName }).first();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await detail.getByRole('button', { name: 'История линии' }).click();
  await expect(page.getByRole('dialog', { name: 'История линии' })).toBeVisible({ timeout: 15_000 });
}

async function openHistoryTarget(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'История линии' });
  await dialog.getByLabel('Дата смены').fill(historyTarget.shiftDate);
  await dialog.getByRole('button', { name: historyTarget.shiftType === 'NIGHT' ? 'Ночь' : 'День', exact: true }).click();
  await expect(dialog.getByText(`${historyTarget.shiftType === 'NIGHT' ? 'Ночная' : 'Дневная'} смена ·`)).toBeVisible();
  await expect(dialog.getByText('Подтверждённый простой')).toBeVisible();
  await expect(dialog.getByText('Линия на мойке')).toBeVisible();
  await expect(dialog.getByText('Линия на оттайке')).toBeVisible();
  const text = await dialog.innerText();
  expect(text).not.toMatch(/Скрытая запись ОКК|Скрытый чек-лист|Скрытая внутренняя проблема мойки|TECHNICAL|storagePath|passwordHash|DATABASE_URL|JWT_SECRET/i);
}

async function expectNoOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const dialog = document.querySelector('.line-timeline-modal');
    const sticky = document.querySelector('.line-timeline-sticky')?.getBoundingClientRect();
    return {
      pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 999,
      stickyVisible: sticky ? sticky.top < window.innerHeight && sticky.bottom <= window.innerHeight + 2 : false,
    };
  });
  expect(result.pageOverflow).toBeLessThanOrEqual(8);
  expect(result.dialogOverflow).toBeLessThanOrEqual(2);
  expect(result.stickyVisible).toBe(true);
}

test.beforeAll(async () => setupFixture());
test.afterAll(async () => {
  if (factoryId) await db.factory.update({ where: { id: factoryId }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Line timeline browser E2E completed' } });
  await db.$disconnect();
});

test('mobile line timeline', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile only');
  await page.setViewportSize({ width: 360, height: 820 });
  await login(page);
  await openHistoryTarget(page);
  const dialog = page.getByRole('dialog', { name: 'История линии' });
  await dialog.locator('.line-timeline-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-summary.png'), fullPage: false });
  await dialog.getByText('Подтверждённый простой').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-work-downtime.png'), fullPage: false });
  await dialog.getByText('Создана заявка').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-task-lifecycle.png'), fullPage: false });
  await dialog.getByText('Линия на мойке').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-work-to-wash.png'), fullPage: false });
  await dialog.getByText('Линия на оттайке').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-defrost.png'), fullPage: false });
  await dialog.locator('.line-timeline-header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-360-line-history-night-shift.png'), fullPage: false });
  await expectNoOverflow(page);

  await page.setViewportSize({ width: 390, height: 820 });
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-line-history.png'), fullPage: false });
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 430, height: 820 });
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-430-line-history.png'), fullPage: false });
  await expectNoOverflow(page);
});

test('desktop line timeline', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'desktop only');
  await page.setViewportSize({ width: 1365, height: 900 });
  await login(page);
  await openHistoryTarget(page);
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-line-history.png'), fullPage: false });
  await expectNoOverflow(page);
});
