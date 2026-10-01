import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown } = {}) {
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
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__delegationDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __delegationDialogs?: string[] }).__delegationDialogs ?? []);
  expect(calls).toEqual([]);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?roleHierarchyLogin=${Date.now()}`);
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function openAdminSection(page: Page, name: string) {
  const button = page.locator('.admin-section-nav button').filter({ hasText: name }).first();
  await expect(button).toBeVisible();
  await button.click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectHelpTooltip(page: Page, label: RegExp | string, expectedText: RegExp | string) {
  const button = page.getByRole('button', { name: label }).first();
  await expect(button).toBeVisible();
  await button.click();
  const tooltip = page.locator('.help-tooltip__popover:visible').filter({ hasText: expectedText }).first();
  await expect(tooltip).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await button.click();
}

async function expectDelegationPanel(page: Page) {
  await openMenuItem(page, /Админ|Администрирование/);
  await openAdminSection(page, 'Пользователи и доступы');
  const panel = page.locator('.delegation-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Дать права как у сотрудника');
  await expect(panel).toContainText('Выбрать сотрудника-образец');
  await expect(panel).toContainText('Назначить в мой отдел');
  await expect(panel).toContainText('подчинённую должность');
  await expectHelpTooltip(page, /Подсказка: Делегирование прав/, /Права администратора/);
  await expectHelpTooltip(page, /Подсказка: Выбрать сотрудника-образец/, /лишние права/);

  const personTriggers = panel.locator('.delegation-person-trigger');
  await expect(personTriggers).toHaveCount(2);
  await personTriggers.nth(0).click();
  const sourcePicker = page.getByRole('dialog', { name: 'Выбрать сотрудника-образец' });
  await expect(sourcePicker).toBeVisible();
  await expect(sourcePicker.locator('.compact-person-choice')).not.toHaveCount(0);
  await sourcePicker.getByRole('button', { name: 'Выбрать', exact: true }).first().click();

  await personTriggers.nth(1).click();
  const targetPicker = page.getByRole('dialog', { name: 'Кому выдать права' });
  await expect(targetPicker).toBeVisible();
  await expect(targetPicker.locator('.compact-person-choice')).not.toHaveCount(0);
  await targetPicker.getByRole('button', { name: 'Выбрать', exact: true }).first().click();
  await panel.getByRole('button', { name: 'Проверить права' }).click();

  await expect(panel).toContainText('Итоговый набор прав');
  await expect(panel).toContainText('Недоступно для выдачи');
  await expectHelpTooltip(page, /Подсказка: Что будет выдано/, /точный набор прав/);

  const text = await panel.innerText();
  expect(text).not.toMatch(/\b(admin|users|manage|permissions|factoryId|departmentId|camelCase)\b/i);
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function expectJobTitleTree(page: Page) {
  await openMenuItem(page, /Админ|Администрирование/);
  await openAdminSection(page, 'Должности и роли');
  await expect(page.getByText('Кому подчиняется').first()).toBeVisible();
  await expect(page.getByText('Руководитель может назначать только подчинённые должности внутри своего отдела')).toBeVisible();
  await expectHelpTooltip(page, /Подсказка: Должность и права/, /Реальные права/);
  await expectHelpTooltip(page, /Подсказка: Уровень должности/, /ниже своей ветки/);
  await expect(page.locator('[data-testid="job-title-tree"]').first()).toBeVisible();
  await expect(page.getByText('Дерево должностей выбранного завода')).toBeVisible();
  const text = await page.locator('.admin-card').filter({ hasText: 'Должности и роли' }).first().innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: admin sees readable universal delegation panel', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop smoke only.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsAdmin(page);
  await expectDelegationPanel(page);
  await expectJobTitleTree(page);
});

test('mobile 360/390/430: delegation panel has no horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile smoke only.');
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await loginAsAdmin(page);
    await expectDelegationPanel(page);
    await expectJobTitleTree(page);
  }
});
