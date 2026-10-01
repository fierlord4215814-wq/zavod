import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(process.cwd(), '..', 'docs', 'stage56-admin-configurability-screenshots');
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Factory|Users|Department|Create line|Edit)\b/;
const mojibakePattern = /Р |Р’|РЎ|Рњ|Рџ|Ð|Ñ/;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

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
    Object.defineProperty(window, '__stage56Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage56Dialogs?: string[] }).__stage56Dialogs ?? []);
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
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAsAdmin(page: Page) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage56Login=${Date.now()}`);
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
  await page.goto(`${frontendUrl}/?stage56User=test-admin&t=${Date.now()}`);
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

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function clickAdminSection(page: Page, name: string) {
  await page.locator('.admin-section-nav button').filter({ hasText: name }).first().click();
  await expectStableRussianPage(page);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN настраивает структуру выбранного завода без кода', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий выполняется на desktop.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);

  await clickAdminSection(page, 'Заводы');
  await expect(page.locator('.factory-context-card')).toContainText(/Выбран завод:.*Завод 4/);
  await expect(page.locator('.factory-context-card')).toContainText('Должности');
  await screenshot(page, '01-admin-factory-context.png');

  await clickAdminSection(page, 'Линии');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать линию' })).toBeVisible();
  await expect(page.getByPlaceholder('Например: Пицца Цезарь')).toBeVisible();
  await screenshot(page, '02-create-line.png');

  await clickAdminSection(page, 'Позиции на линиях');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Добавить позицию' })).toContainText('Код навыка');
  await screenshot(page, '03-edit-line-positions.png');

  await clickAdminSection(page, 'Шаблоны состава');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать шаблон состава' })).toContainText('Минимум');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать шаблон состава' })).toContainText('План');
  await screenshot(page, '04-staffing-template-editor.png');

  await clickAdminSection(page, 'Повременщики / рабочие зоны');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать рабочую зону' })).toContainText('Добавить позицию рабочей зоны');
  await screenshot(page, '05-work-area-editor.png');

  await clickAdminSection(page, 'Отделы и службы');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать отдел' })).toContainText('Общая служба');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Общие и технические службы' })).toContainText('Не даёт автоматический доступ');
  await screenshot(page, '06-departments-services.png');

  await clickAdminSection(page, 'Должности и роли');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать должность' })).toContainText('Базовая роль');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Системные роли' })).toContainText(/Электрик|КИПиА|Холодильщик/);
  await screenshot(page, '07-job-title-foundation.png');

  await clickAdminSection(page, 'Пользователи и доступы');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Выдать доступ' })).toContainText('Общая служба сама по себе не даёт доступ');
  await screenshot(page, '08-user-factory-access.png');

  await clickAdminSection(page, 'Права');
  await expect(page.locator('.permission-grid')).toBeVisible();
  await expect(page.locator('.permission-grid')).toContainText(/Управление|Просмотр|Заявк|Смена|Администрирование/);
  await expect(page.locator('.permission-grid')).not.toContainText(/admin\.departments\.manage/);
  await screenshot(page, '09-permissions-russian.png');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(uuidPattern);
  expect(bodyText).not.toMatch(/Stage\d+.*fixture|browser regression/i);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: админ-конфигуратор не ломает ширину', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  await loginAsAdmin(page);
  await openMenuItem(page, /Админ|Администрирование/);
  await clickAdminSection(page, 'Заводы');
  await expect(page.locator('.factory-context-card')).toContainText('Выбран завод');
  await clickAdminSection(page, 'Линии');
  await expect(page.locator('.admin-card.wide').filter({ hasText: 'Создать линию' })).toBeVisible();
  await screenshot(page, '10-mobile-admin-config.png');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
