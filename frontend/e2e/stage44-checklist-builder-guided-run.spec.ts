import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;
const marker = `Пилот прохождение чек-листа ${Date.now()}`;
const createdTemplateIds: string[] = [];

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
    Object.defineProperty(window, '__stage44Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage44Dialogs?: string[] }).__stage44Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage44User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
  }
}

function writeTinyPng(pathname: string) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(pathname, png);
}

async function createMixedTemplate(factoryId: string) {
  const me = await api('/auth/me', { userId: 'test-management', factoryId });
  const departmentId = me.departmentId;
  const template = await api('/checklists/templates', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      name: `${marker}: контроль пунктов`,
      description: 'Пилотная проверка прохождения чек-листа',
      departmentId,
      operationId: `stage44-browser-template-${Date.now()}`,
    },
  });
  createdTemplateIds.push(template.id);
  const rows = [
    { title: 'Проверить отметку', rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
    { title: 'Вес контрольный', rowType: 'NUMBER', sortOrder: 20, unit: 'кг', minValue: 1, maxValue: 10, requiredAnswer: true },
    { title: 'Комментарий мастера', rowType: 'REQUIRED_COMMENT', sortOrder: 30, requiredAnswer: true },
    { title: 'Фото результата', rowType: 'REQUIRED_PHOTO', sortOrder: 40, requiresPhoto: true },
    { title: 'Итоговая оценка', rowType: 'SELECT', sortOrder: 50, optionsText: 'Норма\nТребует внимания', requiredAnswer: true },
  ];
  for (const row of rows) {
    await api(`/checklists/templates/${template.id}/rows`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { ...row, operationId: `stage44-browser-row-${Date.now()}-${row.sortOrder}` },
    });
  }
  return template;
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test.afterEach(async () => {
  const factoryId = await resolveFactoryId();
  for (const [index, templateId] of createdTemplateIds.splice(0).reverse().entries()) {
    await api(`/checklists/templates/${templateId}`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { name: `Stage44 browser cleanup ${Date.now()}-${index + 1}` },
      expected: [200, 201, 409],
    }).catch(() => null);
    await api(`/checklists/templates/${templateId}/archive`, {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: {},
      expected: [200, 201, 409],
    }).catch(() => null);
  }
});

test('ADMIN проходит Stage44 guided run с typed-пунктами и фото', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий создания и прохождения выполняется на desktop.');
  const filePath = testInfo.outputPath('stage44-photo.png');
  writeTinyPng(filePath);
  const factoryId = await resolveFactoryId();
  const template = await createMixedTemplate(factoryId);
  await loginAs(page, 'test-admin');

  await openMenuItem(page, /Чек-листы/);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.panel-card').filter({ hasText: template.name }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Взять в работу' }).click();

  await expect(page.getByText('Пункт 1 из 5')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(page.getByText(/Выберите/)).toBeVisible();
  await page.getByRole('button', { name: 'Да', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 2 из 5')).toBeVisible();
  await page.getByLabel(/Значение/).fill('5');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 3 из 5')).toBeVisible();
  await page.getByLabel('Ответ').fill('Комментарий Stage44');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 4 из 5')).toBeVisible();
  await page.locator('input[type="file"]').last().setInputFiles(filePath);
  await expect(page.getByText('stage44-photo.png')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();

  await expect(page.getByText('Пункт 5 из 5')).toBeVisible();
  await page.getByLabel('Вариант').selectOption('Норма');
  await page.getByRole('button', { name: 'Проверить и завершить' }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте результат' })).toBeVisible();
  await page.locator('.checklist-final-review').getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const closeDialog = page.getByRole('dialog').last();
  await closeDialog.getByLabel('Причина завершения').fill('Stage44 guided run завершён');
  await closeDialog.getByRole('button', { name: 'Завершить' }).click();

  await expect(page.locator('body')).toContainText(template.name);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('WORKER не получает конструктор чек-листов', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Проверка роли выполняется на desktop.');
  await loginAs(page, 'worker-1');
  await expect(page.getByRole('button', { name: /Чек-листы/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Конструктор');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: чек-листы и guided shell не дают горизонтальный overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  const factoryId = await resolveFactoryId();
  await createMixedTemplate(factoryId);
  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Чек-листы/);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
