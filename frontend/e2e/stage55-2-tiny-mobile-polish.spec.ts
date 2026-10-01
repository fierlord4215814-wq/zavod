import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'stage55-2-tiny-mobile-polish-screenshots');
const mojibakePattern = /Р С—РЎвЂ”Р |Р В Р’|РІР‚|Г‚|Р вЂњРЎвЂ™/;
const visibleEnglishPattern = /\b(Loading|No data|Internal server error|Access denied|storagePath|passwordHash|admin\.|announcements\.|assignments\.|checklists\.|orders\.|tasks\.)\b/;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string; body?: unknown } = {}) {
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

async function ensureAnnouncement(factoryId: string) {
  await api('/announcements', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      title: `Stage55.2 мобильное объявление ${Date.now()}`,
      text: 'Проверка полноэкранного чтения: нижняя кнопка «Ещё» не должна перекрывать текст и кнопку ознакомления.',
      priority: 'IMPORTANT',
      visibleUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    },
  });
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage552Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage552Dialogs?: string[] }).__stage552Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectHumanPage(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('апра');
  expect(text).not.toContain('50 22');
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareStage552Login=${Date.now()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?stage552User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectHumanPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectHumanPage(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  await expect(more.first()).toBeVisible();
  await more.first().click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
  await expectHumanPage(page);
}

async function capture(page: Page, fileName: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  await expectHumanPage(page);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await installDialogGuards(page);
});

test('mobile Stage55.2: overlays, readable cards, Russian permissions and clean stock', async ({ page }) => {
  const factoryId = await loginAs(page, 'test-admin');
  await ensureAnnouncement(factoryId);

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('.announcement-fullscreen-card')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ещё|Еще/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ознакомлен' })).toBeVisible();
  await capture(page, '01-mobile-announcements-fullscreen.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Люди');
  const firstPerson = page.locator('.list-row').first();
  if (await firstPerson.isVisible().catch(() => false)) {
    await firstPerson.click();
    await expect(page.locator('.profile-card')).toBeVisible();
    const modalBackground = await page.locator('.profile-card').evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(modalBackground).not.toBe('rgba(0, 0, 0, 0)');
    await capture(page, '02-mobile-profile-solid.png');
    await page.locator('.profile-card').getByRole('button', { name: 'Закрыть' }).click();
  }

  await openMenuItem(page, 'Чек-листы');
  await expect(page.locator('.checklist-template-card').first()).toBeVisible();
  await expect(page.locator('.checklist-card-meta .tag').first()).toBeVisible();
  await capture(page, '03-mobile-checklists-cards.png');

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Заказы|Остатки/);
  await expect(page.locator('body')).not.toContainText('апра');
  await expect(page.locator('body')).not.toContainText('50 22');
  await capture(page, '04-mobile-stock-clean.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Админка|Администрирование/);
  await page.locator('button:visible').filter({ hasText: 'Роли и права' }).first().click();
  await expect(page.locator('body')).toContainText('Управление отделами');
  await expect(page.locator('body')).not.toContainText('admin.departments.manage');
  await expect(page.locator('body')).not.toContainText('announcements.archive.read');
  await capture(page, '05-mobile-admin-permissions-russian.png');

  await openMenuItem(page, 'Линии');
  await capture(page, '06-mobile-lines-bottom-safe.png');
});
