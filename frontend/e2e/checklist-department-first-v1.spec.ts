import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|storagePath)\b/;
const mojibakePattern = /Р С—РЎ|Р В |РЎРѓ|Р вЂњ|Р Сњ|Р Р€|Гђ|Г‘/;

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
  expected?: number[];
};

const createdTemplates: string[] = [];
const createdRuns: string[] = [];
const createdItems: string[] = [];

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
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function loginAs(page: Page, userId: string, factoryId: string) {
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
  await page.goto(`${frontendUrl}/?departmentFirstUser=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButtons = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await navButtons.count()) > 0) {
    await navButtons.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error|storagePath/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(8);
}

async function currentUser(userId: string, factoryId: string) {
  return api('/auth/me', { userId, factoryId });
}

async function createChecklistTemplate(factoryId: string) {
  const me = await currentUser('pilot-technolog-1', factoryId);
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: `Отделовой контроль UI ${Date.now()}`,
      description: 'Проверка department-first интерфейса',
      departmentId: me.departmentId,
      assignmentRoles: ['TECHNOLOG'],
      frequencyRule: 'MANUAL',
      isMandatory: true,
    },
  });
  createdTemplates.push(template.id);
  await api(`/checklists/templates/${template.id}/rows`, {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { title: 'Проверить внешний вид', rowType: 'YES_NO_NA', sortOrder: 10, requiredAnswer: true },
  });
  await api(`/checklists/templates/${template.id}/rows`, {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { title: 'Комментарий при отклонении', rowType: 'TEXT', sortOrder: 20 },
  });
  return template;
}

async function createStockItem(factoryId: string, name: string, departmentId: string | null) {
  const item = await api('/orders/items', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name,
      category: 'Проверка отделов',
      storageLocation: 'Пилотная зона',
      description: 'Временная позиция для проверки интерфейса',
      minThreshold: 1,
      initialQuantity: 5,
      unit: 'шт',
      departmentId,
    },
  });
  createdItems.push(item.id);
  return item;
}

function shortMarker() {
  const letters = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 5);
  return letters || 'alpha';
}

test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  for (const runId of createdRuns.splice(0).reverse()) {
    await api(`/checklists/runs/${runId}/close`, {
      method: 'POST',
      userId: 'pilot-technolog-1',
      factoryId,
      body: { reason: 'Завершение browser smoke' },
      expected: [200, 201, 409],
    });
  }
  for (const [index, templateId] of createdTemplates.splice(0).reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH', userId: 'test-admin', factoryId,
      body: { name: `Department-first browser cleanup ${Date.now()}-${index + 1}` },
      expected: [200, 201, 409],
    });
    await api(`/checklists/templates/${templateId}/archive`, { method: 'POST', userId: 'test-admin', factoryId, expected: [200, 201, 409] });
  }
  for (const itemId of createdItems.splice(0).reverse()) {
    await api(`/orders/items/${itemId}/archive`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { comment: 'Архив browser smoke позиции' },
      expected: [200, 201, 409],
    });
  }
});

test('чек-листы показывают department-first рабочий экран на mobile', async ({ page }) => {
  const factoryId = await resolveFactoryId();
  const template = await createChecklistTemplate(factoryId);
  await page.setViewportSize({ width: 360, height: 780 });
  await loginAs(page, 'pilot-technolog-1', factoryId);
  await openMenuItem(page, /Чек-листы/);

  await expect(page.getByRole('heading', { name: 'В работе' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы' })).toHaveCount(0);
  await expect(page.locator('.checklist-kpi-strip .premium-kpi-card')).toHaveCount(4);
  await expect(page.locator('.checklist-kpi-strip .premium-kpi-card').filter({ hasText: 'Архив' })).toBeVisible();
  await page.locator('.checklist-kpi-strip .premium-kpi-card').filter({ hasText: 'Доступные' }).click();
  await expect(page.getByRole('heading', { name: 'Доступные чек-листы' })).toBeVisible();
  await expect(page.getByText(template.name)).toBeVisible();

  const card = page.locator('.checklist-work-card').filter({ hasText: template.name }).first();
  await expect(card).toContainText(/Отдел:/);
  await card.getByRole('button', { name: 'Взять в работу' }).click();
  await page.getByRole('button', { name: 'Взять в работу' }).last().click();

  const runs = await api('/checklists/runs/my', { userId: 'pilot-technolog-1', factoryId });
  const run = runs.find((item: { templateId?: string }) => item.templateId === template.id);
  if (run?.id) createdRuns.push(run.id);

  await expect(page.locator('.guided-run-modal')).toBeVisible();
  await expect(page.getByText(/Пункт 1 из/)).toBeVisible();
  await expect(page.locator('.guided-run-modal')).toContainText(/Завод/);
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
});

test('остатки показывают свой и общий отдел без чужого отдела', async ({ page }) => {
  const factoryId = await resolveFactoryId();
  const kipia = await currentUser('test-tech-kipia', factoryId);
  const electric = await currentUser('pilot-tech-electric-1', factoryId);
  const suffix = shortMarker();
  const ownItem = await createStockItem(factoryId, `Отделовой расходник КИПиА ${suffix}`, kipia.departmentId);
  const otherItem = await createStockItem(factoryId, `Отделовой расходник электриков ${suffix}`, electric.departmentId);
  const sharedItem = await createStockItem(factoryId, `Общий расходник интерфейса ${suffix}`, null);

  await page.setViewportSize({ width: 390, height: 780 });
  await loginAs(page, 'test-tech-kipia', factoryId);
  await openMenuItem(page, /Заказы|Остатки/);

  await expect(page.getByText(ownItem.name)).toBeVisible();
  await expect(page.getByText(sharedItem.name)).toBeVisible();
  await expect(page.getByText(otherItem.name)).toHaveCount(0);
  const ownCard = page.locator('article.compact-record-card').filter({ hasText: ownItem.name }).first();
  const sharedCard = page.locator('article.compact-record-card').filter({ hasText: sharedItem.name }).first();
  await expect(ownCard).toContainText(ownItem.departmentLabel || kipia.departmentName || 'КИПиА');
  await expect(sharedCard).toContainText(sharedItem.departmentLabel || 'Общее');
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
});
