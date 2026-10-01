import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Chat department|General chat|Messenger)\b/;
const mojibakePattern = /Рџ|РЎ|Рќ|Рґ|Рµ|СЃ|С‚/;
const marker = `Медиа Рондо ${Date.now().toString(36).slice(-5)}`;
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'stage56a-1-chat-visual-hardening-screenshots');

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
  expected?: number[];
};

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
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage56a1Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage56a1Dialogs?: string[] }).__stage56a1Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toContain('storagePath');
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
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage56a1User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButtons = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await navButtons.count()) > 0) {
    await navButtons.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
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

function writeTinyPng(pathname: string) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(pathname, png);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: false });
}

async function createVisualChat(factoryId: string) {
  return api('/chats', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: {
      title: marker,
      type: 'CUSTOM',
      isHidden: true,
      description: 'Проверка отображения фото и файлов в рабочем чате',
      members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
    },
  });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: фото в ленте, fullscreen preview и разделение медиа/файлов', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots are captured only once.');
  const filePath = testInfo.outputPath('chat-photo.png');
  writeTinyPng(filePath);

  const factoryId = await loginAs(page, 'test-management');
  await createVisualChat(factoryId);
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(marker);
  await page.locator('.messenger-chat-card').filter({ hasText: marker }).first().click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
  await screenshot(page, '01-desktop-chat-open.png');

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await expect(page.locator('.messenger-attachment-sheet')).toBeVisible();
  await page.locator('.messenger-attachment-sheet input[type="file"]').last().setInputFiles(filePath);
  await expect(page.locator('.messenger-selected-file')).toContainText('chat-photo.png');
  await page.locator('.messenger-composer textarea').fill('Фото после мойки линии прикреплено.');
  await screenshot(page, '02-desktop-compact-composer.png');
  await page.getByRole('button', { name: 'Отправить' }).click();

  await expect(page.locator('.messenger-message-list')).toContainText('Фото после мойки линии прикреплено.');
  const inlineImage = page.locator('.messenger-message-list .attachment-preview-inline .attachment-inline-media.photo img').last();
  await expect(inlineImage).toBeVisible();
  await expect(page.locator('.messenger-message-list')).not.toContainText(/Вложения:\s*1/);
  await screenshot(page, '03-desktop-inline-photo.png');

  await inlineImage.click();
  await expect(page.locator('.attachment-viewer-backdrop')).toBeVisible();
  await expect(page.locator('.attachment-modal img.attachment-large-preview')).toBeVisible();
  await screenshot(page, '04-desktop-fullscreen-photo.png');
  await page.locator('.attachment-modal').getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('button', { name: 'Участники' }).click();
  await expect(page.locator('.messenger-info-card')).toBeVisible();
  await page.locator('.messenger-info-tabs button').filter({ hasText: 'Медиа' }).click();
  await expect(page.locator('.messenger-info-card .attachment-preview-grid img')).toBeVisible();
  await screenshot(page, '05-desktop-media-grid.png');
  await page.locator('.messenger-info-tabs button').filter({ hasText: 'Файлы' }).click();
  await expect(page.locator('.messenger-info-card')).toContainText('Файлов пока нет.');
  await expect(page.locator('.messenger-info-card')).not.toContainText('chat-photo.png');
  await screenshot(page, '06-desktop-files-empty.png');
  await page.locator('.messenger-info-card').getByRole('button', { name: 'Готово' }).click();

  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360: компактный composer, solid overlay и отсутствие overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile screenshots are captured in the mobile project.');
  const factoryId = await loginAs(page, 'test-management');
  await createVisualChat(factoryId);
  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(marker);
  await screenshot(page, '07-mobile-chat-list.png');

  await page.locator('.messenger-chat-card').filter({ hasText: marker }).first().click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
  await expect(page.locator('.messenger-composer .attachment-picker')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await expect(page.locator('.messenger-attachment-sheet')).toBeVisible();
  await screenshot(page, '08-mobile-compact-composer.png');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Участники' }).click();
  await expect(page.locator('.messenger-info-card')).toBeVisible();
  const overlay = page.locator('.modal-backdrop').first();
  const zIndex = await overlay.evaluate((element) => Number(window.getComputedStyle(element).zIndex));
  expect(zIndex).toBeGreaterThanOrEqual(200);
  const background = await overlay.evaluate((element) => window.getComputedStyle(element).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  await screenshot(page, '09-mobile-solid-info-overlay.png');

  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});
