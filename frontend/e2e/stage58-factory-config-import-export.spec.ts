import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage58-factory-config-import-export-screenshots');

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
    Object.defineProperty(window, '__stage58Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage58Dialogs?: string[] }).__stage58Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage58Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage58User=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  return factoryId;
}

async function openAdmin(page: Page) {
  const direct = page.locator('button:visible').filter({ hasText: /Админ|Администрирование|РђРґРјРёРЅ/ });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  const more = page.locator('button:visible').filter({ hasText: /Ещё|Еще|Р•С‰/ });
  if (await more.count()) {
    await more.first().click();
    await page.locator('button:visible').filter({ hasText: /Админ|Администрирование|РђРґРјРёРЅ/ }).first().click();
    return;
  }
  throw new Error('Админка не найдена в навигации');
}

async function openFactoriesSection(page: Page) {
  await openAdmin(page);
  await page.locator('.admin-task-nav, .factory-config-transfer').first().waitFor({ state: 'visible', timeout: 8000 });
  const navButton = page.locator('.admin-task-nav').getByRole('button', { name: /^Заводы$/ }).first();
  if (await navButton.count()) {
    await navButton.click();
    await page.locator('.factory-config-transfer').waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  const legacyButton = page.locator('button:visible').filter({ hasText: 'Заводы' }).first();
  if (await legacyButton.count()) {
    await legacyButton.click();
    await page.locator('.factory-config-transfer').waitFor({ state: 'visible', timeout: 8000 });
  }
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN экспортирует конфигурацию, проверяет JSON и создаёт новый завод из файла', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный импорт выполняется на desktop.');
  const factoryId = await loginAsAdmin(page);
  const exported = await api(`/admin/factories/${factoryId}/config-export`, { userId: 'test-admin', factoryId });
  const validFile = path.join(screenshotDir, 'stage58-valid-config.json');
  const invalidFile = path.join(screenshotDir, 'stage58-invalid-config.json');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(validFile, JSON.stringify(exported, null, 2), 'utf8');
  fs.writeFileSync(invalidFile, JSON.stringify({ schemaVersion: 'factory-config-v1', config: { tasks: [{ id: 'bad' }] } }, null, 2), 'utf8');

  await openFactoriesSection(page);
  await expect(page.locator('.factory-config-transfer')).toContainText('Экспорт и импорт конфигурации');
  await screenshot(page, '01-export-config-block.png');

  await page.locator('.factory-config-transfer').getByRole('button', { name: /Сформировать экспорт/ }).click();
  await expect(page.locator('.factory-config-transfer')).toContainText('Источник:');
  await expect(page.locator('.factory-config-transfer')).toContainText('Без путей хранения и секретов');
  await screenshot(page, '02-export-preview.png');

  const importPanel = page.locator('.factory-config-transfer .admin-setup-panel').filter({ hasText: 'Импорт конфигурации' });
  await importPanel.locator('input[type="file"]').setInputFiles(validFile);
  await expect(importPanel).toContainText('stage58-valid-config.json');
  await screenshot(page, '03-import-file-step.png');

  const code = `stage58-ui-${Date.now().toString(36)}`;
  await importPanel.getByLabel('Название нового завода').fill(`Stage58 UI импорт ${code}`);
  await importPanel.getByLabel('Код нового завода').fill(code);
  await importPanel.getByRole('button', { name: /Проверить файл/ }).click();
  await expect(importPanel).toContainText('Файл подходит');
  await expect(importPanel).toContainText('История работы: не импортируется');
  await screenshot(page, '04-import-preview-valid.png');

  await importPanel.locator('input[type="file"]').setInputFiles(invalidFile);
  await importPanel.getByRole('button', { name: /Проверить файл/ }).click();
  await expect(importPanel).toContainText('Есть ошибки');
  await screenshot(page, '05-import-preview-invalid.png');

  await importPanel.locator('input[type="file"]').setInputFiles(validFile);
  await importPanel.getByLabel('Название нового завода').fill(`Stage58 UI импорт ${code}`);
  await importPanel.getByLabel('Код нового завода').fill(code);
  await importPanel.getByRole('button', { name: /Проверить файл/ }).click();
  await expect(importPanel).toContainText('Файл подходит');
  await importPanel.getByRole('button', { name: /Создать завод из файла/ }).click();
  const dialog = page.locator('.modal-card').filter({ hasText: 'Импортировать конфигурацию' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#admin-confirm-text').fill('ИМПОРТ');
  await dialog.getByRole('button', { name: /Подтвердить|Создать|Импорт/ }).click();

  await expect(page.locator('.factory-setup-result')).toContainText(`Stage58 UI импорт ${code}`, { timeout: 30_000 });
  await expect(page.locator('.factory-context-card')).toContainText(`Stage58 UI импорт ${code}`);
  await screenshot(page, '06-import-create-result.png');
  await screenshot(page, '07-imported-factory-health.png');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('storagePath');
  expect(bodyText).not.toContain('passwordHash');
  expect(bodyText).not.toContain('DATABASE_URL');
  expect(bodyText).not.toContain('JWT_SECRET');
  await expectNoDialogs(page);
});

test('mobile 360px: блок экспорта и импорта не ломает ширину', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  await loginAsAdmin(page);
  await openFactoriesSection(page);
  await expect(page.locator('.factory-config-transfer')).toContainText('Экспорт и импорт конфигурации');
  await expect(page.locator('.factory-config-transfer')).toContainText('Импорт конфигурации');
  await screenshot(page, '08-mobile-export-import.png');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});
