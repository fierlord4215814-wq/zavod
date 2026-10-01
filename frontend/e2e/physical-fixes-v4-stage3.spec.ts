import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-screenshots', 'stage3');
const adminUserId = 'test-admin';
const workerUserId = 'worker-3';
const assignmentWorkerUserId = 'worker-4';
const workAreaWorkerUserId = 'worker-5';

type LineSummary = {
  id: string;
  name: string;
  activeTemplate?: { id: string } | null;
  staffingTemplates?: Array<{ id: string; name: string; isActive: boolean; deletedAt?: string | null }>;
};

let factoryId = '';
let line: LineSummary | null = null;
let baselineTemplateId: string | null = null;
let testTemplateId = '';

async function api<T>(
  pathname: string,
  options: { method?: string; body?: unknown; factory?: string } = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Connection: 'close',
      'x-user-id': adminUserId,
      ...(options.factory || factoryId ? { 'x-factory-id': options.factory || factoryId } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function login(page: Page) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ userId: adminUserId }),
  });
  if (!response.ok) throw new Error(`dev-login ${adminUserId}: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 недоступен администратору');
  factoryId = factory.id;

  await page.goto(frontendUrl);
  await page.evaluate(({ selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { selectedFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
  await expect(page.getByText('Онлайн', { exact: false }).first()).toBeVisible();
}

async function prepareTemplate() {
  const lines = await api<LineSummary[]>('/lines');
  const currentLine = lines.find((item) => item.name === 'Пицца Цезарь') ?? null;
  if (!currentLine) throw new Error('Линия Пицца Цезарь не найдена');
  if (!line) {
    line = currentLine;
    baselineTemplateId = currentLine.activeTemplate?.id ?? null;
  }
  const template = currentLine.staffingTemplates?.find((item) => item.isActive && !item.deletedAt);
  if (!template) throw new Error('Для линии Пицца Цезарь нет активного шаблона состава');
  testTemplateId = template.id;
  if (!currentLine.activeTemplate?.id) {
    await api(`/lines/${currentLine.id}/activate-template`, {
      method: 'POST',
      body: {
        staffingTemplateId: testTemplateId,
        operationId: `pffv4-stage3-template-${Date.now()}`,
      },
    });
  }
}

async function releaseWorker(userId = workerUserId) {
  if (!factoryId) return;
  const people = await api<Array<{ userId: string; currentAssignment?: { id: string } | null }>>('/shift/people?includeAll=true');
  const worker = people.find((item) => item.userId === userId);
  if (worker?.currentAssignment) {
    await api('/assignments/release', {
      method: 'POST',
      body: { targetUserId: userId },
    });
  }
}

async function restoreTemplate() {
  if (!line) return;
  await api(`/lines/${line.id}/activate-template`, {
    method: 'POST',
    body: {
      staffingTemplateId: baselineTemplateId,
      operationId: `pffv4-stage3-template-restore-${Date.now()}`,
    },
  });
}

async function cleanup() {
  await releaseWorker();
  await releaseWorker(assignmentWorkerUserId);
  await releaseWorker(workAreaWorkerUserId);
  await restoreTemplate();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function openPeople(page: Page) {
  await page.getByRole('button', { name: /^Люди 3$/ }).click();
  await expect(page.getByRole('dialog', { name: 'На смене' })).toBeVisible();
}

async function openPersonFirstSlots(page: Page) {
  const people = page.getByRole('dialog', { name: 'На смене' });
  const worker = people.locator('article').filter({ hasText: 'Работник 3' }).first();
  await worker.getByRole('button', { name: 'Назначить', exact: true }).click();
  const target = page.getByRole('dialog').filter({ hasText: 'Куда назначить?' }).last();
  await target.getByRole('button', { name: /Линия 6 работают/ }).click();
  const linePicker = page.getByRole('dialog', { name: 'Выберите линию' });
  await linePicker.getByRole('button', { name: /Пицца Цезарь/ }).click();
  await expect(page.getByTestId('person-first-slot-picker')).toBeVisible();
}

async function assignFirstFreePersonFirst(page: Page) {
  const picker = page.getByTestId('person-first-slot-picker');
  await picker.getByRole('button', { name: 'Назначить', exact: true }).first().click();
  await expect(page.getByText(/Работник 3 назначен: Пицца Цезарь/).first()).toBeVisible();
}

async function openLineDashboard(page: Page) {
  const lineCard = page.locator('article.current-shift-line-card').filter({ hasText: 'Пицца Цезарь' }).first();
  await lineCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.getByRole('dialog').filter({ hasText: 'Пицца Цезарь' }).last();
  await expect(dashboard.getByRole('heading', { name: 'Позиции', exact: true })).toBeVisible();
  return dashboard;
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test.beforeEach(() => {
  line = null;
  baselineTemplateId = null;
  testTemplateId = '';
});

test.afterEach(async () => {
  await cleanup();
});

test('person-first and slot-first assignment share one idempotent command', async ({ page }, testInfo) => {
  await login(page);
  await prepareTemplate();
  await releaseWorker();
  await releaseWorker(assignmentWorkerUserId);
  await releaseWorker(workAreaWorkerUserId);
  await page.reload({ waitUntil: 'networkidle' });

  try {
    await openPeople(page);
    await openPersonFirstSlots(page);
    await noOverflow(page);
    await expect(page.getByTestId('person-first-slot-picker')
      .getByRole('button', { name: 'Назначить', exact: true }).first()).toBeEnabled();
    if (testInfo.project.name === 'desktop-edge') {
      await assignFirstFreePersonFirst(page);
      const peopleAfterPersonFirst = await api<Array<{
        userId: string;
        currentAssignment?: {
          id: string;
          lineId: string;
          positionId: string;
          slotIndex: number;
          staffingTemplateId?: string | null;
        } | null;
      }>>('/shift/people?includeAll=true');
      const personFirstAssignment = peopleAfterPersonFirst.find((item) => item.userId === workerUserId)?.currentAssignment;
      expect(personFirstAssignment?.id).toBeTruthy();
      const personFirstRepeated = await api<{ id: string }>('/assignments/line', {
        method: 'POST',
        body: {
          targetUserId: workerUserId,
          lineId: personFirstAssignment?.lineId,
          positionId: personFirstAssignment?.positionId,
          slotIndex: personFirstAssignment?.slotIndex,
          staffingTemplateId: personFirstAssignment?.staffingTemplateId ?? testTemplateId,
        },
      });
      expect(personFirstRepeated.id).toBe(personFirstAssignment?.id);
      await releaseWorker();
    }

    await page.reload({ waitUntil: 'networkidle' });
    const dashboard = await openLineDashboard(page);
    await dashboard.getByRole('button', { name: 'Назначить', exact: true }).first().click();
    const personPicker = page.getByTestId('slot-first-person-picker');
    await expect(personPicker).toBeVisible();
    await expect(personPicker.locator('.assignment-person-row')).toHaveCount(7);
    const worker = personPicker.locator('.assignment-person-row').filter({ hasText: 'Работник 4' }).first();
    if (testInfo.project.name === 'mobile-360-edge') {
      await expect(worker.getByRole('button', { name: 'Назначить', exact: true })).toBeEnabled();
      await noOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `${testInfo.project.name}-assignment-routes.png`),
        fullPage: false,
      });
      return;
    }
    await worker.getByRole('button', { name: 'Назначить', exact: true }).click();
    await expect(page.getByText(/Работник 4 назначен: Пицца Цезарь/).first()).toBeVisible();

    const peopleAfterSlotFirst = await api<Array<{
      userId: string;
      currentAssignment?: {
        id: string;
        lineId: string;
        positionId: string;
        slotIndex: number;
        staffingTemplateId?: string | null;
      } | null;
    }>>('/shift/people?includeAll=true');
    const assignment = peopleAfterSlotFirst.find((item) => item.userId === assignmentWorkerUserId)?.currentAssignment;
    expect(assignment?.id).toBeTruthy();
    const repeated = await api<{ id: string }>('/assignments/line', {
      method: 'POST',
      body: {
        targetUserId: assignmentWorkerUserId,
        lineId: assignment?.lineId,
        positionId: assignment?.positionId,
        slotIndex: assignment?.slotIndex,
        staffingTemplateId: assignment?.staffingTemplateId ?? testTemplateId,
      },
    });
    expect(repeated.id).toBe(assignment?.id);
    await noOverflow(page);
    await page.screenshot({
      path: path.join(screenshotsDir, `${testInfo.project.name}-assignment-routes.png`),
      fullPage: false,
    });
  } finally {
    await releaseWorker();
    await releaseWorker(assignmentWorkerUserId);
    await releaseWorker(workAreaWorkerUserId);
  }
});

test('Back closes one assignment layer and scroll lock restores the page', async ({ page }, testInfo) => {
  await login(page);
  await prepareTemplate();
  await page.reload({ waitUntil: 'networkidle' });

  const scrollBefore = await page.evaluate(() => {
    window.scrollTo(0, Math.min(420, document.documentElement.scrollHeight - window.innerHeight));
    return window.scrollY;
  });
  await page.getByRole('button', { name: /^Люди 3$/ }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog', { name: 'На смене' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('fixed');

  const people = page.getByRole('dialog', { name: 'На смене' });
  await people.locator('article').filter({ hasText: 'Работник 3' }).first()
    .getByRole('button', { name: 'Назначить', exact: true }).click();
  const target = page.getByRole('dialog').filter({ hasText: 'Куда назначить?' }).last();
  await target.getByRole('button', { name: /Линия 6 работают/ }).click();
  await expect(page.getByRole('dialog', { name: 'Выберите линию' })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(page.getByRole('dialog', { name: 'Выберите линию' })).toHaveCount(0);
  await expect(target).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
  await expect(target).toHaveCount(0);
  await expect(people).toBeVisible();
  await people.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-back-scroll.png`),
    fullPage: false,
  });
});

test('work area uses explicit slots and a separate requirement editor', async ({ page }, testInfo) => {
  await login(page);
  await releaseWorker(workAreaWorkerUserId);
  await page.getByRole('button', { name: 'Открыть повременщиков', exact: true }).click();
  const area = page.getByRole('dialog').filter({ hasText: 'Повременщики' }).last();
  await expect(area.getByLabel('Сводка по рабочей зоне')).toContainText('Требуется');
  await expect(area.getByLabel('Сводка по рабочей зоне')).toContainText('Назначено');
  await expect(area.getByLabel('Сводка по рабочей зоне')).toContainText('Свободно');
  await expect(area.getByRole('heading', { name: 'Позиции и слоты', exact: true })).toBeVisible();
  await expect(area.locator('.compact-slot-row').first()).toBeVisible();

  const requirementAction = area.getByRole('button', { name: 'Изменить потребность', exact: true }).first();
  await expect(requirementAction).toBeVisible();
  await requirementAction.click();
  const editor = page.getByRole('dialog', { name: 'Изменить потребность' });
  await expect(editor.getByText(/Занятые текущие и будущие слоты защищены backend/)).toBeVisible();
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(editor).toHaveCount(0);

  await area.getByRole('button', { name: 'Выбрать сотрудника', exact: true }).first().click();
  const personPicker = page.getByRole('dialog', { name: 'Выберите сотрудника' });
  await expect(personPicker).toBeVisible();
  const worker = personPicker.locator('.assignment-person-row').filter({ hasText: 'Работник 5' }).first();
  await expect(worker.getByRole('button', { name: 'Назначить', exact: true })).toBeEnabled();
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${testInfo.project.name}-work-area.png`),
    fullPage: false,
  });
  if (testInfo.project.name === 'desktop-edge') {
    await worker.getByRole('button', { name: 'Назначить', exact: true }).click();
    await expect(page.getByText(/Работник 5 назначен: Повременщики/).first()).toBeVisible();
    const people = await api<Array<{
      userId: string;
      currentAssignment?: { id: string; kind: string; workAreaPositionId?: string | null; slotIndex?: number | null } | null;
    }>>('/shift/people?includeAll=true');
    const assignment = people.find((item) => item.userId === workAreaWorkerUserId)?.currentAssignment;
    expect(assignment?.id).toBeTruthy();
    expect(assignment?.kind).toBe('TIME');
    expect(assignment?.workAreaPositionId).toBeTruthy();
    expect(assignment?.slotIndex).toBeGreaterThan(0);
    await releaseWorker(workAreaWorkerUserId);
  } else {
    await personPicker.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(personPicker).toHaveCount(0);
  }
});

test('390 and 430 widths keep assignment surfaces inside viewport', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Дополнительные ширины проверяются один раз');

  for (const width of [390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page);
    await prepareTemplate();
    await page.reload({ waitUntil: 'networkidle' });
    await openPeople(page);
    await openPersonFirstSlots(page);
    await noOverflow(page);
    await page.screenshot({
      path: path.join(screenshotsDir, `mobile-${width}-person-first.png`),
      fullPage: false,
    });
    await context.close();
  }
});
