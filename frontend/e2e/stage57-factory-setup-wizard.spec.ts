import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage57-factory-setup-wizard-screenshots');
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Factory|Users|Department|Create line|Edit|Preview|Dry-run)\b/;
const mojibakePattern = /Р |Р’|РЎ|Рњ|Рџ|Ð|Ñ/;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}\b/i;

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
    Object.defineProperty(window, '__stage57Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage57Dialogs?: string[] }).__stage57Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('storagePath');
  expect(text).not.toContain('passwordHash');
  expect(text).not.toContain('DATABASE_URL');
  expect(text).not.toContain('JWT_SECRET');
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage57Login=${Date.now()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage57User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const globalButton = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await globalButton.count()) > 0) {
    await globalButton.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function clickAdminSection(page: Page, name: string) {
  await page.locator('.admin-section-nav button').filter({ hasText: name }).first().click();
  await expectStableRussianPage(page);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN создаёт завод через мастер настройки и видит health нового контекста', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий создания выполняется на desktop.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);
  await clickAdminSection(page, 'Заводы');

  const wizard = page.locator('.factory-setup-wizard');
  await expect(wizard).toContainText('Создать завод');
  await expect(wizard).toContainText('Пустой завод');
  await expect(wizard).toContainText('Скопировать с завода');
  await expect(wizard).toContainText('История смен, заявки, чаты, вложения и архивы не копируются');
  await screenshot(page, '01-wizard-start.png');

  await wizard.getByRole('button', { name: /Пустой завод/ }).click();
  await expect(wizard).toContainText('Пустой завод создаётся без структуры');
  await screenshot(page, '02-empty-factory-mode.png');

  await wizard.getByRole('button', { name: /Скопировать с завода/ }).click();
  const code = `stage57-ui-${Date.now().toString(36)}`;
  await wizard.getByLabel('Название завода').fill(`Stage57 UI завод ${code}`);
  await wizard.getByLabel('Короткий код').fill(code);
  await wizard.getByLabel('Площадка / комментарий').fill('Playwright проверка мастера настройки завода');
  await wizard.getByLabel('Статус').selectOption('active');
  await wizard.getByLabel('Завод-источник').selectOption({ label: 'Завод 4' }).catch(async () => {
    await wizard.getByLabel('Завод-источник').selectOption({ index: 0 });
  });
  await wizard.getByRole('button', { name: /Показать предпросмотр/ }).click();
  await expect(wizard).toContainText('Проверка: без записи в БД');
  await expect(wizard).toContainText('История работы: не копируется');
  await expect(wizard).toContainText('Пользователи, доступы');
  await screenshot(page, '03-copy-preview.png');

  await wizard.getByRole('button', { name: /^Создать завод$/ }).click();
  const dialog = page.locator('.modal-card').filter({ hasText: 'Создать завод' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Действие пишется в аудит');
  await dialog.locator('#admin-confirm-text').fill('ЗАВОД');
  await dialog.getByRole('button', { name: /Создать завод|Подтвердить/ }).click();

  await expect(page.locator('.factory-context-card')).toContainText(`Stage57 UI завод ${code}`, { timeout: 30_000 });
  await expect(page.locator('.factory-setup-result')).toContainText('История работы не копировалась');
  await expect(page.locator('.config-health-panel')).toContainText(/Проверка конфигурации|Готовность завода|Что требует внимания|Что уже настроено/);
  await expect(page.locator('.factory-context-card')).toContainText('Выбран завод');
  await screenshot(page, '04-config-health-after-create.png');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(uuidPattern);
  expect(bodyText).not.toContain('storagePath');
  expect(bodyText).not.toContain('passwordHash');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: мастер настройки завода и health не ломают ширину', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);
  await clickAdminSection(page, 'Заводы');

  await expect(page.locator('.factory-setup-wizard')).toContainText('Создать завод');
  await expect(page.locator('.factory-setup-wizard')).toContainText('Скопировать с завода');
  await expect(page.locator('.factory-context-card')).toContainText('Выбран завод');
  await expect(page.locator('.config-health-panel')).toContainText(/Проверка конфигурации|Готовность завода|Что требует внимания|Что уже настроено/);
  await screenshot(page, '05-mobile-factory-setup.png');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
