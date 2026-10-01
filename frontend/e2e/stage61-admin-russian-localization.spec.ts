import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage61-admin-russian-localization-screenshots');

const visibleEnglishPattern = /\b(View|Read|Manage|Create|Update|Delete|Can|Settings|Overview|Save|Cancel|Access denied|No data|Factory|Users|Department|factory settings|defects|config|preview|runtime|source|target|audit read|skillCode|foundation|permission presets|schemaVersion|runtimeCopied|sourceFactory|localKey|AuditLog)\b|[a-z]+[A-Z][A-Za-z]+/;

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
    Object.defineProperty(window, '__stage61Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage61Dialogs?: string[] }).__stage61Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage61Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage61User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  return factoryId;
}

async function openAdmin(page: Page) {
  const direct = page.locator('button:visible').filter({ hasText: /Админка|Администрирование/ });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  const more = page.locator('button:visible').filter({ hasText: /Ещё|Еще/ });
  if (await more.count()) {
    await more.first().click();
    await page.locator('button:visible').filter({ hasText: /Админка|Администрирование/ }).first().click();
    return;
  }
  throw new Error('Админка не найдена в навигации');
}

async function openAdminSection(page: Page, title: string) {
  await page.locator('.admin-task-nav button').filter({ hasText: title }).first().click();
  await page.waitForTimeout(300);
}

async function expectNoVisibleEnglish(page: Page, scope = 'body') {
  const text = await page.locator(scope).innerText();
  const matches = Array.from(new Set(text.match(visibleEnglishPattern) ?? []));
  expect(matches, `Найдены видимые английские/technical фрагменты: ${matches.join(', ')}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: админка показывает права, настройки, health, импорт и восстановление по-русски', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots проверяются отдельно от mobile.');
  await loginAsAdmin(page);
  await openAdmin(page);

  const sections = ['Обзор', 'Заводы', 'Пользователи и доступы', 'Отделы и службы', 'Должности и роли', 'Линии и позиции', 'Позиции на линиях', 'Шаблоны состава', 'Повременщики / рабочие зоны'];
  for (const section of sections) {
    await openAdminSection(page, section);
    await expectNoVisibleEnglish(page);
  }

  await openAdminSection(page, 'Роли и права');
  const permissionGrid = page.locator('.permission-grid');
  await expect(permissionGrid).toContainText('Управление');
  await expect(permissionGrid).not.toContainText(/admin\.[a-z]/);
  await expectNoVisibleEnglish(page);
  await screenshot(page, '01-permissions-russian-desktop.png');

  await page.getByRole('button', { name: 'Расширенно' }).click();
  await expect(permissionGrid).toContainText(/admin\.[a-z]/);
  await screenshot(page, '02-permissions-advanced-codes-desktop.png');
  await page.getByRole('button', { name: 'Скрыть технические коды' }).click();
  await expectNoVisibleEnglish(page);

  await openAdminSection(page, 'Настройки модулей');
  await expect(page.locator('.settings-grid')).toContainText('Начало дневной смены');
  await expectNoVisibleEnglish(page);
  await screenshot(page, '03-module-settings-russian.png');

  await openAdminSection(page, 'Обзор');
  await expect(page.locator('.admin-health-grouped')).toContainText('Готовность завода');
  await expectNoVisibleEnglish(page);
  await screenshot(page, '04-config-health-russian.png');

  await openAdminSection(page, 'Заводы');
  await expect(page.locator('.factory-config-transfer')).toContainText('Экспорт и импорт конфигурации');
  await expect(page.locator('.factory-config-transfer')).toContainText('Версия схемы 1');
  await expect(page.locator('.factory-config-transfer')).not.toContainText(/localKey|factory-config|Stage58|config/i);
  await expectNoVisibleEnglish(page);
  await screenshot(page, '05-export-import-russian.png');

  await openAdminSection(page, 'Восстановление');
  await expect(page.locator('.recovery-center')).toContainText('Центр восстановления');
  await expectNoVisibleEnglish(page);
  await screenshot(page, '06-recovery-center-russian.png');

  await openAdminSection(page, 'Аудит действий админки');
  await expect(page.locator('body')).not.toContainText(/factoryId|includeArchive|AuditLog|storagePath|passwordHash|token/i);
  await expectNoVisibleEnglish(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360px: обзор и права админки остаются русскими без overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile сценарий запускается в mobile project.');
  await page.setViewportSize({ width: 360, height: 760 });
  await loginAsAdmin(page);
  await openAdmin(page);

  await expect(page.locator('.admin-overview')).toContainText('Что нужно настроить');
  await expectNoVisibleEnglish(page);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '07-mobile-admin-overview-russian.png');

  await openAdminSection(page, 'Роли и права');
  await expect(page.locator('.permission-grid')).toContainText('Управление');
  await expect(page.locator('.permission-grid')).not.toContainText(/admin\.[a-z]/);
  await expectNoVisibleEnglish(page);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, '08-mobile-permissions-russian.png');

  await expectNoDialogs(page);
});
