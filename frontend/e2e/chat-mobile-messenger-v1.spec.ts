import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const marker = `Рабочий чат Рондо ${Date.now().toString(36)}`;
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'chat-mobile-messenger-v1-screenshots');
const plast1ScreenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast1');
const mojibakePattern = /Рџ|РЎ|Рќ|Рґ|Рµ|СЃ|С‚/;
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|No data|Access denied|Messenger)\b/;

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
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?chatMobileMessengerV1=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const directNav = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await directNav.count()) {
    await directNav.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if (await more.count()) {
    await more.first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    return;
  }
  await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken/i);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectMobileWidths(page: Page) {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(page.locator('.messenger-composer textarea[placeholder="Сообщение"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__chatMobileDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __chatMobileDialogs?: string[] }).__chatMobileDialogs ?? []);
  expect(calls).toEqual([]);
}

function writeTinyPng(pathname: string) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(pathname, png);
}

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: false });
}

async function createChat(factoryId: string) {
  return api('/chats', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: {
      title: marker,
      type: 'CUSTOM',
      description: 'Проверка мобильного рабочего чата',
      isHidden: true,
      members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
    },
  });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('mobile-first chat composer, emoji, attachments and poll card', async ({ page }, testInfo) => {
  fs.mkdirSync(plast1ScreenshotsDir, { recursive: true });
  const factoryId = await resolveFactoryId();
  const chat = await createChat(factoryId);
  const photoPath = testInfo.outputPath('chat-mobile-photo.png');
  writeTinyPng(photoPath);

  await loginAs(page, 'pilot-worker-1', factoryId);
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(marker);
  await page.locator('.messenger-chat-card').filter({ hasText: marker }).first().click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
  await expect(page.locator('.messenger-composer textarea[placeholder="Сообщение"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Прикрепить' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Эмодзи' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записать голос' })).toBeVisible();
  await screenshot(page, `${testInfo.project.name}-01-chat-open.png`);

  await page.getByRole('button', { name: 'Эмодзи' }).click();
  await expect(page.locator('.messenger-emoji-panel')).toBeVisible();
  await expect(page.locator('.emoji-tabs')).toContainText('Часто');
  await expect(page.locator('.emoji-tabs')).toContainText('Работа');
  await page.locator('.emoji-grid button').filter({ hasText: '👍' }).first().click();
  await expect(page.locator('.messenger-composer textarea')).toHaveValue(/👍/);
  await screenshot(page, `${testInfo.project.name}-02-emoji-panel.png`);

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await expect(page.locator('.messenger-attachment-sheet')).toBeVisible();
  await expect(page.locator('.messenger-attachment-sheet')).toContainText('Фото');
  await expect(page.locator('.messenger-attachment-sheet')).toContainText('Видео');
  await expect(page.locator('.messenger-attachment-sheet')).toContainText('Опрос');
  await page.locator('.messenger-attachment-sheet input[type="file"]').first().setInputFiles(photoPath);
  await expect(page.locator('.messenger-selected-files')).toContainText('Фото');
  await page.locator('.messenger-composer textarea').fill('Фото в рабочем чате');
  await screenshot(page, `${testInfo.project.name}-03-attachment-sheet.png`);
  await page.locator('.icon-send-button').click();
  await expect(page.locator('.messenger-message-list')).toContainText('Фото в рабочем чате');
  await expect(page.locator('.attachment-inline-media.photo img').last()).toBeVisible();
  await page.locator('button[aria-label^="Профиль:"]').last().click();
  await expect(page.locator('.participant-profile-sheet')).toContainText('Работник');
  await expect(page.locator('.participant-profile-sheet')).toContainText('Рабочие');
  await page.screenshot({ path: path.join(plast1ScreenshotsDir, `${testInfo.project.name}-chat-profile.png`), fullPage: false });
  await page.locator('.participant-profile-sheet').getByRole('button', { name: 'Закрыть' }).click();

  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
  });
  await page.getByRole('button', { name: 'Записать голос' }).click();
  await expect(page.locator('.voice-recovery-state')).toContainText(/микрофон|разрешение/i);
  await expect(page.locator('.voice-recovery-state').getByRole('button', { name: 'Повторить' })).toBeVisible();

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.getByRole('button', { name: 'Опрос' }).click();
  await expect(page.locator('.chat-poll-modal')).toBeVisible();
  await page.locator('.chat-poll-modal input').nth(0).fill('Какой вариант запускаем?');
  await page.locator('.chat-poll-modal input').nth(1).fill('Первый');
  await page.locator('.chat-poll-modal input').nth(2).fill('Второй');
  await page.locator('.chat-poll-modal').getByRole('button', { name: 'Создать' }).click();
  await expect(page.locator('.chat-poll-card')).toContainText('Какой вариант запускаем?');
  await page.locator('.chat-poll-options button').filter({ hasText: 'Первый' }).click();
  await expect(page.locator('.chat-poll-card')).toContainText('Проголосовали: 1');
  await screenshot(page, `${testInfo.project.name}-04-poll-card.png`);

  await expectStableRussianPage(page);
  await expectMobileWidths(page);
  await expectNoDialogs(page);

  await api(`/chats/${chat.id}`, {
    method: 'PATCH',
    userId: 'test-admin',
    factoryId,
    body: { isActive: false, reason: 'Завершение UI smoke chat mobile messenger v1' },
  });
});
