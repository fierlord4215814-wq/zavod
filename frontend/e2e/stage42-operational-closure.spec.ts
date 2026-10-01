import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;
const marker = `Operational closure evidence ${Date.now()}`;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] } = {}) {
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
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage42Dialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
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
  const calls = await page.evaluate(() => (window as unknown as { __stage42Dialogs?: string[] }).__stage42Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const direct = nav.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
    await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await expectStableRussianPage(page);
  }
}

async function prepareOperationalFixture(factoryId: string) {
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  const lines = await api('/lines', { userId: 'test-master', factoryId });
  const line = lines.find((item: any) => !/^Stage/i.test(item.name)) ?? lines[0];
  expect(line, 'line for Stage42 browser test').toBeTruthy();
  if (!line.isActiveForShift) {
    await api(`/lines/${line.id}/activate-for-shift`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { staffingTemplateId: line.activeTemplate?.id ?? line.staffingTemplates?.[0]?.id ?? null },
      expected: [200, 201, 409],
    });
  }
  const departments = await api('/tasks/recipient-departments', { userId: 'test-master', factoryId });
  const techMe = await api('/auth/me', { userId: 'test-tech-holod', factoryId });
  const department = departments.find((item: any) => item.id === techMe.departmentId) ?? departments[0];
  expect(department, 'recipient department for Stage42 task').toBeTruthy();
  const downtime = await api(`/lines/${line.id}/status`, {
    method: 'PATCH',
    userId: 'test-master',
    factoryId,
    body: { status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: `${marker}: простой для связки` },
  });
  const task = await api('/tasks', {
    method: 'POST',
    userId: 'test-master',
    factoryId,
    body: {
      lineId: line.id,
      lineStatusEventId: downtime.id,
      operationId: `stage42-browser-task-${Date.now()}`,
      type: 'URGENT',
      description: `${marker}: заявка из простоя`,
      departmentRecipientIds: [department.id],
    },
  });
  return { line, downtime, task };
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  const lines = await api('/lines', { userId: 'test-master', factoryId }).catch(() => []);
  for (const line of lines.filter((item: any) => item.status !== 'WORK' && !/^Stage/i.test(item.name)).slice(0, 2)) {
    await api(`/lines/${line.id}/status`, {
      method: 'PATCH',
      userId: 'test-master',
      factoryId,
      body: { status: 'WORK', comment: `${marker}: восстановление после e2e` },
      expected: [200, 201, 400, 403, 409],
    }).catch(() => undefined);
  }
});

test('MASTER связывает простой, заявку и безопасные действия на линии', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop flow проверяется отдельно от mobile overflow.');
  const factoryId = await resolveFactoryId();
  const fixture = await prepareOperationalFixture(factoryId);

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  const lineCard = page.locator('.line-summary-card').filter({ hasText: fixture.line.name }).first();
  await expect(lineCard).toBeVisible();
  await lineCard.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('button', { name: 'Вернуть в работу' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать заявку из простоя' })).toBeVisible();
  await expect(page.getByText('Простой').first()).toBeVisible();

  await page.getByRole('button', { name: 'Создать заявку из простоя' }).click();
  await expect(page.locator('#downtime-task-department')).toBeVisible();
  await expect(page.getByText('Заявка будет связана с активным простоем линии')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).last().click();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('уведомление и архив открывают исходный раздел', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop source links проверяются отдельно от mobile overflow.');
  const factoryId = await resolveFactoryId();
  const fixture = await prepareOperationalFixture(factoryId);

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Уведомления/);
  await expect(page.locator('body')).toContainText(fixture.task.description);
  await page.locator('.card').filter({ hasText: fixture.task.description }).first().getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expectStableRussianPage(page);

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  const search = page.getByPlaceholder(/линия|артикул|причина|текст/i).first();
  await search.fill(marker);
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('body')).toContainText('Открыть источник');
  await page.getByRole('button', { name: 'Открыть источник' }).first().click();
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expectNoDialogs(page);
});

test('TECH_HOLOD видит лёгкую сводку оттайки', async ({ page }) => {
  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Оттайка/);
  const lineButton = page.locator('.defrost-line-card').first();
  await expect(lineButton).toBeVisible();
  await lineButton.click();
  await expect(page.getByText('Лёгкая сводка оттайки')).toBeVisible();
  await expect(page.getByRole('button', { name: '30 дней' })).toBeVisible();
  await expect(page.getByRole('button', { name: '60 дней' })).toBeVisible();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('WORKER не видит управленческие действия линии', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Worker desktop visibility проверяется отдельно от mobile overflow.');
  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Зафиксировать простой');
  expect(text).not.toContain('Создать заявку из простоя');
  expect(text).not.toContain('Уточнить время простоя');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: линии, оттайка, уведомления и архив без горизонтального overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile проверка Stage42 выполняется только в mobile-проекте.');
  const factoryId = await resolveFactoryId();
  await prepareOperationalFixture(factoryId);

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Оттайка/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Уведомления/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Архив/);
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
