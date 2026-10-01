import { Browser, BrowserContext, expect, Page, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const cleanupScript = path.join(rootDir, 'backend', 'scripts', 'stage34-e2e-fixture-cleanup.js');
const marker = 'Stage34 E2E';
const operationPrefix = 'stage34-e2e';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
  expectedStatuses?: number[];
};

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stageOperation(name: string) {
  return `${operationPrefix}-${name}-${uniqueSuffix()}`;
}

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const expected = options.expectedStatuses ?? [200, 201];
  if (!expected.includes(response.status)) {
    throw new Error(`API ${options.method ?? 'GET'} ${pathname} returned ${response.status}: ${text}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runCleanup() {
  const result = spawnSync(process.execPath, [cleanupScript, '--apply'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`Stage34 cleanup failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage34Dialogs', {
      value: calls,
      configurable: true,
    });
    window.alert = (message?: unknown) => {
      calls.push(`alert:${String(message ?? '')}`);
    };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage34Dialogs?: string[] }).__stage34Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function loginAs(page: Page, userId: string) {
  await page.goto(`${frontendUrl}/`);
  await expect(page.locator('#login-phone')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#dev-user-id')).toBeVisible();
  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await expectStableRussianPage(page);
}

async function logout(page: Page) {
  const button = page.getByRole('button', { name: 'Выйти' });
  if ((await button.count()) > 0) {
    await button.first().click();
    await expect(page.locator('#dev-user-id')).toBeVisible();
  }
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const directItem = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await directItem.count()) > 0) {
    await directItem.first().click();
  } else {
    const moreButton = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
    if ((await moreButton.count()) > 0) {
      await moreButton.first().click();
      await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    } else {
      await page.getByRole('button', { name: label }).first().click();
    }
  }
  await expectStableRussianPage(page);
}

async function openMenuItemIfVisible(page: Page, label: RegExp | string) {
  const item = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await item.count()) === 0) return false;
  await item.first().click();
  await expectStableRussianPage(page);
  return true;
}

async function clickIfVisible(page: Page, label: RegExp | string) {
  const target = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await target.count()) === 0) return false;
  if (!(await target.first().isEnabled())) return false;
  await target.first().click();
  await expectStableRussianPage(page);
  return true;
}

async function visibleMenuText(page: Page) {
  return (await page.locator('.bottom-nav button').allInnerTexts()).join('\n');
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function makeRolePage(browser: Browser, contexts: BrowserContext[], userId: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await installDialogGuards(page);
  await loginAs(page, userId);
  return page;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', {
    method: 'POST',
    userId: null,
    body: { userId: 'test-admin' },
  });
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function expectAudit(action: string, entityId: string, factoryId: string) {
  const logs = await api(`/ops/audit?${new URLSearchParams({ action, entityId, limit: '20' }).toString()}`, {
    userId: 'test-admin',
    factoryId,
  });
  expect(Array.isArray(logs)).toBeTruthy();
  expect(logs.some((item: any) => item.action === action && item.entityId === entityId)).toBeTruthy();
}

async function notificationsFor(userId: string, factoryId: string) {
  return api('/notifications', { userId, factoryId });
}

function expectOneNotification(notifications: any[], predicate: (item: any) => boolean, label: string) {
  const matches = notifications.filter(predicate);
  expect(matches.length, label).toBeGreaterThanOrEqual(1);
  const duplicateKeys = new Set<string>();
  for (const item of matches) {
    const key = `${item.type}:${item.entityType ?? ''}:${item.entityId ?? ''}`;
    expect(duplicateKeys.has(key), `${label}: дубль ${key}`).toBeFalsy();
    duplicateKeys.add(key);
  }
}

test.describe.configure({ mode: 'serial' });

test('Stage34 full-day multi-role E2E: роли, записи, уведомления и мягкая очистка', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный многоролевой день выполняется в desktop-проекте; mobile smoke идёт отдельным тестом.');
  test.setTimeout(180_000);

  runCleanup();
  const factoryId = await resolveFactoryId();
  expect(factoryId).toBeTruthy();

  const contexts: BrowserContext[] = [];
  const suffix = uniqueSuffix();
  const created: Record<string, any> = {};

  try {
    const [adminPage, managementPage, masterPage, workerPage, storePage, okkPage, techPage, contractorLeadPage] = await Promise.all([
      makeRolePage(browser, contexts, 'test-admin'),
      makeRolePage(browser, contexts, 'test-management'),
      makeRolePage(browser, contexts, 'test-master'),
      makeRolePage(browser, contexts, 'worker-1'),
      makeRolePage(browser, contexts, 'test-store'),
      makeRolePage(browser, contexts, 'test-okk'),
      makeRolePage(browser, contexts, 'test-tech-holod'),
      makeRolePage(browser, contexts, 'contractor-lead-1'),
    ]);

    await openMenuItem(adminPage, /Администрирование/);
    await openMenuItem(adminPage, /Уведомления/);
    await openMenuItem(adminPage, /Статистика \/ Аудит/);

    await openMenuItem(managementPage, /Заявки/);
    await openMenuItem(managementPage, /Чек-листы/);
    await openMenuItem(managementPage, /Заказы \/ Остатки/);
    await openMenuItem(managementPage, /Объявления/);

    await openMenuItem(masterPage, /Смена/);
    await expect(masterPage.locator('body')).toContainText(/Повременщики|Люди|На смене/);
    await openMenuItem(masterPage, /Линии/);
    await openMenuItem(masterPage, /Мойка/);
    await openMenuItem(masterPage, /Пересменка \/ Журнал/);

    await openMenuItem(workerPage, /Смена/);
    const workerMenu = await visibleMenuText(workerPage);
    expect(workerMenu).not.toMatch(/Администрирование|Статистика \/ Аудит|ОКК|Линии/);

    await openMenuItem(storePage, /Возвраты на производство/);
    await openMenuItem(storePage, /Заказы \/ Остатки/);
    await openMenuItemIfVisible(storePage, /Некондиция/);

    await openMenuItem(okkPage, /ОКК/);
    await openMenuItem(techPage, /Заявки/);
    await openMenuItemIfVisible(techPage, /Оттайка/);

    await openMenuItem(contractorLeadPage, /Смена/);
    const contractorMenu = await visibleMenuText(contractorLeadPage);
    expect(contractorMenu).not.toMatch(/Администрирование|Линии|Статистика \/ Аудит/);

    const lines = await api('/directory/lines', { userId: 'test-admin', factoryId });
    const line = lines[0];
    expect(line?.id).toBeTruthy();

    const masterMe = await api('/auth/me', { userId: 'test-master', factoryId });
    const techMe = await api('/auth/me', { userId: 'test-tech-holod', factoryId });
    const recipientDepartments = await api('/tasks/recipient-departments', { userId: 'test-master', factoryId });
    const techDepartment = recipientDepartments.find((item: any) => item.id === techMe.departmentId) ?? recipientDepartments[0];
    expect(techDepartment?.id).toBeTruthy();

    await api('/tasks', {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      expectedStatuses: [400, 409],
      body: { operationId: stageOperation('task-invalid') },
    });

    const urgentTask = await api('/tasks', {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: {
        operationId: stageOperation('task-urgent'),
        type: 'URGENT',
        lineId: line.id,
        description: `${marker}: срочная заявка в техотдел ${suffix}`,
        departmentRecipientIds: [techDepartment.id],
        assigneeUserIds: ['test-tech-holod'],
      },
    });
    created.urgentTask = urgentTask;

    const longTask = await api('/tasks', {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: {
        operationId: stageOperation('task-long'),
        type: 'LONG',
        description: `${marker}: долгая заявка с дедлайном ${suffix}`,
        departmentRecipientIds: [techDepartment.id],
        assigneeUserIds: ['test-tech-holod'],
        deadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    created.longTask = longTask;

    await openMenuItem(techPage, /Заявки/);
    await expect(techPage.locator('body')).toContainText(marker);
    await api(`/tasks/${urgentTask.id}/take`, {
      method: 'POST',
      userId: 'test-tech-holod',
      factoryId,
      body: { operationId: stageOperation('task-take') },
    });
    await api(`/tasks/${urgentTask.id}/comment`, {
      method: 'POST',
      userId: 'test-tech-holod',
      factoryId,
      body: { operationId: stageOperation('task-comment'), message: `${marker}: комментарий техника ${suffix}` },
    });
    await api(`/tasks/${urgentTask.id}/complete`, {
      method: 'POST',
      userId: 'test-tech-holod',
      factoryId,
      body: { operationId: stageOperation('task-done'), comment: `${marker}: выполнено` },
    });
    const workerTaskAccess = await api(`/tasks/${urgentTask.id}`, {
      userId: 'worker-1',
      factoryId,
      expectedStatuses: [403, 404, 409],
    });
    expect(workerTaskAccess).toBeTruthy();

    const workAreas = await api('/work-areas', { userId: 'test-master', factoryId });
    const timeArea = workAreas.find((item: any) => /Повременщики/.test(item.name)) ?? workAreas[0];
    if (timeArea?.id) {
      const board = await api(`/work-areas/${timeArea.id}/board`, { userId: 'test-master', factoryId });
      expect((board.candidates ?? []).every((candidate: any) => ['WORKER', 'CONTRACTOR'].includes(candidate.role))).toBeTruthy();
      expect(board.slots?.length ?? 0).toBeGreaterThan(0);
    }

    await api('/returns', {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      expectedStatuses: [400, 409],
      body: { photoUrl: 'attachment-pending' },
    });
    const returnRecord = await api('/returns', {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      body: {
        photoUrl: 'attachment-pending',
        receivedAt: today(),
        productionDate: today(),
        article: `STAGE34-${suffix}`,
        productName: `Продукт ${marker}`,
        mismatchReason: `${marker}: складская причина`,
        quantity: 1,
        decision: `${marker}: вернуть на производство`,
      },
    });
    created.returnRecord = returnRecord;
    await api(`/returns/${returnRecord.id}/mark-completion`, {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      expectedStatuses: [400, 409],
      body: { completionMark: '' },
    });
    await api(`/returns/${returnRecord.id}/mark-completion`, {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      body: {
        completionMark: `${marker}: выполнено`,
        completedByUserId: 'test-store',
        correctiveActionsComment: `${marker}: корректирующее действие`,
      },
    });
    await api(`/returns/${returnRecord.id}/complete`, { method: 'POST', userId: 'test-store', factoryId, body: {} });
    await openMenuItem(storePage, /Возвраты на производство/);
    await expect(storePage.locator('body')).toContainText(/Активные|Архив/);
    if (await clickIfVisible(storePage, /Новая запись/)) {
      await expect(storePage.locator('body')).toContainText(/Дата поступления|Артикул|Количество|Принятое решение/);
      await clickIfVisible(storePage, /Отмена|Закрыть/);
    }

    await api('/okk', {
      method: 'POST',
      userId: 'test-okk',
      factoryId,
      expectedStatuses: [400, 409],
      body: { description: `${marker}: невалидная запись` },
    });
    const okkRecord = await api('/okk', {
      method: 'POST',
      userId: 'test-okk',
      factoryId,
      body: {
        lineId: line.id,
        assignedMasterId: 'test-master',
        defectDate: today(),
        productionDate: today(),
        shiftLabel: `Смена ${marker}`,
        article: `STAGE34-OKK-${suffix}`,
        productName: `Продукт ОКК ${marker}`,
        mismatchReason: `${marker}: несоответствие`,
        defectQuantity: '1 короб',
        decision: `${marker}: решение ОКК`,
        temperatureAfterExtraFreeze: '-18',
      },
    });
    created.okkRecord = okkRecord;
    await api(`/okk/${okkRecord.id}/completion`, {
      method: 'POST',
      userId: 'test-okk',
      factoryId,
      expectedStatuses: [400, 409],
      body: { completionMark: '' },
    });
    await api(`/okk/${okkRecord.id}/completion`, {
      method: 'POST',
      userId: 'test-okk',
      factoryId,
      body: {
        completionMark: `${marker}: выполнение отмечено`,
        unblockDate: today(),
        completedByUserId: 'test-okk',
        blockedByUserId: 'test-okk',
        correctiveActions: `${marker}: корректирующие действия`,
      },
    });
    await api(`/okk/${okkRecord.id}/full-complete`, { method: 'POST', userId: 'test-okk', factoryId, body: {} });
    await openMenuItem(okkPage, /ОКК/);
    await expect(okkPage.locator('body')).toContainText(/Активные|Архив|Новый брак/);

    const departments = await api('/directory/departments', { userId: 'test-admin', factoryId });
    const checklistDepartmentId = masterMe.departmentId ?? departments[0]?.id;
    expect(checklistDepartmentId).toBeTruthy();
    const template = await api('/checklists/templates', {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: {
        name: `${marker}: чек-лист ${suffix}`,
        description: `${marker}: шаблон для полного дня`,
        departmentId: checklistDepartmentId,
      },
    });
    created.checklistTemplate = template;
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { title: `${marker}: обязательная строка`, requiresComment: true, isRequired: true },
    });
    const run = await api('/checklists/runs', {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { templateId: template.id },
    });
    created.checklistRun = run;
    const row = run.rows[0];
    await api(`/checklists/runs/${run.id}/rows/${row.id}/complete`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      expectedStatuses: [400, 409],
      body: { status: 'OK' },
    });
    await api(`/checklists/runs/${run.id}/rows/${row.id}/complete`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { status: 'OK', comment: `${marker}: строка выполнена` },
    });
    await api(`/checklists/runs/${run.id}/pause`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { reason: `${marker}: пауза` },
    });
    await api(`/checklists/runs/${run.id}/resume`, { method: 'POST', userId: 'test-master', factoryId, body: {} });
    await api(`/checklists/runs/${run.id}/close`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { comment: `${marker}: закрыт` },
    });
    await openMenuItem(masterPage, /Чек-листы/);
    await expect(masterPage.locator('body')).toContainText(/Мои активные|Библиотека|Чек-листы/);

    const orderItem = await api('/orders/items', {
      method: 'POST',
      userId: 'test-management',
      factoryId,
      body: {
        name: `Ремни ${marker} ${suffix}`,
        description: `${marker}: проверка минимального остатка`,
        minThreshold: 5,
        initialQuantity: 6,
        referenceQuantity: 6,
        unit: 'шт',
      },
    });
    created.orderItem = orderItem;
    await api(`/orders/items/${orderItem.id}/take`, {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      body: { quantity: 2, comment: `${marker}: взято в работу` },
    });
    const orderRequest = await api(`/orders/items/${orderItem.id}/order`, {
      method: 'POST',
      userId: 'test-store',
      factoryId,
      body: { requestedQuantity: 10, reasonComment: `${marker}: заказать ремни` },
    });
    created.orderRequest = orderRequest;
    await api(`/orders/requests/${orderRequest.id}/close`, {
      method: 'POST',
      userId: 'test-management',
      factoryId,
      body: { closeStatus: 'ORDERED', comment: `${marker}: заказано` },
    });
    await openMenuItem(storePage, /Заказы \/ Остатки/);
    await expect(storePage.locator('body')).toContainText(/Остатки|Заявки на заказ|Ремни|Архив/);

    await openMenuItem(masterPage, /Чаты/);
    const firstChat = masterPage.locator('.chat-layout .section-stack button.card').first();
    if ((await firstChat.count()) > 0) {
      await firstChat.click();
      await expectStableRussianPage(masterPage);
      const chatMessage = `${marker}: сообщение в чат ${suffix}`;
      const input = masterPage.locator('.chat-composer textarea').first();
      const send = masterPage.getByRole('button', { name: 'Отправить' }).first();
      if ((await input.count()) > 0 && (await send.count()) > 0 && (await send.isEnabled().catch(() => false))) {
        await input.fill(chatMessage);
        await expect(send).toBeEnabled();
        await send.click();
        await expect(masterPage.locator('body')).toContainText(chatMessage);
      }
    }

    const announcement = await api('/announcements', {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: {
        title: `${marker}: важное объявление ${suffix}`,
        text: `${marker}: текст важного объявления`,
        priority: 'IMPORTANT',
      },
    });
    created.announcement = announcement;
    await api(`/announcements/${announcement.id}/read`, { method: 'POST', userId: 'worker-1', factoryId, body: {} });
    await openMenuItem(adminPage, /Объявления/);
    await expect(adminPage.locator('body')).toContainText(/Активные|Важные|Архив/);

    const overview = await api('/ops/overview', { userId: 'test-admin', factoryId });
    expect(overview).toBeTruthy();

    await expectAudit('TASK_CREATED', urgentTask.id, factoryId);
    await expectAudit('TASK_DONE', urgentTask.id, factoryId);
    await expectAudit('OKK_RECORD_CREATED', okkRecord.id, factoryId);
    await expectAudit('OKK_RECORD_FULLY_COMPLETED', okkRecord.id, factoryId);
    await expectAudit('RETURN_RECORD_CREATED', returnRecord.id, factoryId);
    await expectAudit('RETURN_RECORD_FULLY_COMPLETED', returnRecord.id, factoryId);
    await expectAudit('CHECKLIST_RUN_CLOSED', run.id, factoryId);

    const techNotifications = await notificationsFor('test-tech-holod', factoryId);
    expectOneNotification(
      techNotifications,
      (item) => item.entityId === urgentTask.id || `${item.title} ${item.message}`.includes(marker),
      'техник видит уведомление по заявке',
    );

    const managementNotifications = await notificationsFor('test-management', factoryId);
    expectOneNotification(
      managementNotifications,
      (item) => item.entityId === orderItem.id || `${item.title} ${item.message}`.includes('Ремни'),
      'руководство видит уведомление по снижению остатка',
    );
    expectOneNotification(
      managementNotifications,
      (item) => item.entityId === orderRequest.id || `${item.title} ${item.message}`.includes('заказ'),
      'руководство видит уведомление по заказу',
    );

    const workerNotifications = await notificationsFor('worker-1', factoryId);
    expect(workerNotifications.some((item: any) => item.entityId === orderItem.id)).toBeFalsy();

    await api('/notifications/read-all', { method: 'POST', userId: 'test-management', factoryId, body: {} });
    const countAfterRead = await api('/notifications/unread-count', { userId: 'test-management', factoryId });
    expect(Number(countAfterRead.count)).toBeGreaterThanOrEqual(0);

    for (const page of [adminPage, managementPage, masterPage, workerPage, storePage, okkPage, techPage, contractorLeadPage]) {
      await expectStableRussianPage(page);
      await expectNoDialogs(page);
    }
  } finally {
    for (const context of contexts.reverse()) {
      await context.close().catch(() => undefined);
    }
    runCleanup();
  }
});

test('Stage34 mobile 360px smoke: ключевые длинные экраны не ломают вёрстку', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка выполняется только в mobile-проекте.');
  test.setTimeout(90_000);

  await installDialogGuards(page);
  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  await expectNoHorizontalOverflow(page);
  await openMenuItemIfVisible(page, /Линии/);
  await expectNoHorizontalOverflow(page);
  await openMenuItemIfVisible(page, /Чаты/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты на производство/);
  await expectNoHorizontalOverflow(page);
  await openMenuItemIfVisible(page, /Заказы \/ Остатки/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);
  await expectNoHorizontalOverflow(page);
  await logout(page);

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Люди/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Уведомления/);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});
