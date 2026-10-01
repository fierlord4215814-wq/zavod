import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /пїЅ|пїЅпїЅпїЅпїЅ|Гђ|Р Сџ/;

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
    Object.defineProperty(window, '__stage41Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage41Dialogs?: string[] }).__stage41Dialogs ?? []);
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
  await expect(page.locator('#dev-user-id')).toBeVisible();
  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await expectStableRussianPage(page);
}

async function logout(page: Page) {
  const logoutButton = page.getByRole('button', { name: 'Выйти' }).filter({ visible: true });
  if ((await logoutButton.count()) > 0) {
    await logoutButton.first().click();
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function ensureLineVisibleInShift(factoryId: string) {
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  const lines = await api('/lines', { userId: 'test-master', factoryId });
  const line = lines.find((item: any) => item.isActiveForShift) ?? lines[0];
  expect(line, 'line for Stage41 browser test').toBeTruthy();
  if (!line.isActiveForShift) {
    await api(`/lines/${line.id}/activate-for-shift`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { staffingTemplateId: line.activeTemplate?.id ?? line.staffingTemplates?.[0]?.id ?? null },
      expected: [200, 201, 409],
    });
  }
}

async function openFirstLineDashboard(page: Page) {
  await openMenuItem(page, /Смена/);
  const openButton = page.getByRole('button', { name: /^Открыть$/ }).filter({ visible: true });
  await expect(openButton.first()).toBeVisible();
  await openButton.first().click();
  await expect(page.getByRole('button', { name: 'Текущее задание' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('MASTER ведёт текущее задание линии через браузер', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Создание строки задания проверяется в desktop-проекте.');
  const factoryId = await resolveFactoryId();
  await ensureLineVisibleInShift(factoryId);

  await loginAs(page, 'test-master');
  await openFirstLineDashboard(page);
  await page.getByRole('button', { name: 'Текущее задание' }).click();
  const assignmentDialog = page.getByRole('dialog').filter({ hasText: 'Текущее задание' }).last();
  await expect(assignmentDialog).toContainText('Текущее задание');

  const addButton = page.getByRole('button', { name: 'Добавить строку' }).filter({ visible: true });
  if ((await addButton.count()) > 0) {
    await addButton.first().click();
    await page.locator('#assignment-article').fill(`ST41-${Date.now()}`);
    await page.locator('#assignment-product').fill('Stage41 браузерная строка');
    await page.locator('#assignment-gofr').fill('7');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(assignmentDialog).toContainText('Stage41 браузерная строка');
  } else {
    await expect(assignmentDialog).toContainText(/Максимум 10 строк|Прошлые смены и роли без права управления/);
  }

  await expect(assignmentDialog).toContainText(/Артикул|Гофр по плану|Задание не заполнено|Stage41/);
  await expectNoDialogs(page);
  await assignmentDialog.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('dialog').filter({ hasText: 'Активный шаблон' }).getByRole('button', { name: 'Закрыть' }).click();
  await logout(page);
});

test('WORKER не получает управление заданием линии', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Role visibility для worker проверяется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Смена/);
  await expect(page.locator('body')).not.toContainText('Добавить строку');
  await expect(page.locator('body')).not.toContainText('Удалить строку задания');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
  await logout(page);
});

test('mobile 360px: текущее задание линии без горизонтального overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage41 выполняется только в mobile-проекте.');
  const factoryId = await resolveFactoryId();
  await ensureLineVisibleInShift(factoryId);

  await loginAs(page, 'test-master');
  await openFirstLineDashboard(page);
  await page.getByRole('button', { name: 'Текущее задание' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Текущее задание' }).last()).toContainText('Текущее задание');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
