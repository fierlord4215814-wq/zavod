import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const marker = `UX чат ${Date.now().toString(36)}`;
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-chat-telegram-ux-screenshots');

type ApiOptions = { method?: string; userId?: string | null; factoryId?: string; body?: unknown; expected?: number[] };

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function factoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  return login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4')?.id ?? login.recommendedFactoryId;
}

async function login(page: Page, userId: string, selectedFactoryId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(({ nextUserId, factory }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', factory);
  }, { nextUserId: userId, factory: selectedFactoryId });
  await page.goto(`${frontendUrl}/?chatTelegramUx=${Date.now()}`);
}

async function openChats(page: Page) {
  const quick = page.locator('.mobile-quick-nav button:visible, .bottom-nav button:visible').filter({ hasText: 'Чаты' });
  if (await quick.count()) await quick.first().click();
  else {
    await page.getByRole('button', { name: /Ещё|Еще/ }).click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: 'Чаты' }).first().click();
  }
  await expect(page.locator('.messenger-chat-list')).toBeVisible();
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: false });
}

function writeTinyPng(pathname: string) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(pathname, png);
}

test('Telegram-style UX keeps drafts, actions and scroll stable', async ({ page }, testInfo) => {
  const factory = await factoryId();
  const chat = await api('/chats', {
    method: 'POST', userId: 'test-management', factoryId: factory,
    body: { title: marker, type: 'CUSTOM', isHidden: true, members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }] },
  });
  const createdIds: string[] = [];
  try {
    for (const text of Array.from({ length: 24 }, (_value, index) => `Сообщение истории ${index + 1}: проверка статуса линии`)) {
      const created = await api(`/chats/${chat.id}/messages`, { method: 'POST', userId: 'test-management', factoryId: factory, body: { text, operationId: `telegram-ux-${Date.now()}-${text}` } });
      createdIds.push(created.id);
    }
    await login(page, 'pilot-worker-1', factory);
    await openChats(page);
    await expect(page.locator('.messenger-chat-card').filter({ hasText: marker })).toBeVisible();
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-list.png');

    await page.locator('.messenger-chat-card').filter({ hasText: marker }).click();
    await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
    await expect(page.locator('.messenger-composer textarea')).toBeVisible();
    if (testInfo.project.name.includes('mobile')) {
      await expect(page.locator('.mobile-quick-nav:visible, .bottom-nav:visible')).toHaveCount(0);
    }
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-open.png');
    else await shot(page, 'desktop-chat.png');

    const textarea = page.locator('.messenger-composer textarea');
    await textarea.fill('Моё сообщение для действия');
    await page.route(`${apiUrl}/chats/${chat.id}/messages`, (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.locator('.error-state')).toContainText('Черновик сохранён');
    await expect(textarea).toHaveValue('Моё сообщение для действия');
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-network-error.png');
    await page.unroute(`${apiUrl}/chats/${chat.id}/messages`);
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.locator('.messenger-message.own')).toContainText('Моё сообщение для действия');
    await textarea.fill('Черновик не должен потеряться');
    if (testInfo.project.name.includes('mobile')) await page.locator('.messenger-message.own .messenger-bubble').last().click();
    else await page.locator('.messenger-message.own .message-more-button').last().click();
    await expect(page.locator('.messenger-action-sheet')).toBeVisible();
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-actions-sheet.png');
    await page.locator('.messenger-action-sheet').getByRole('button', { name: 'Изменить' }).click();
    await expect(page.getByRole('heading', { name: 'Редактирование сообщения' })).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).last().click();
    await expect(textarea).toHaveValue('Черновик не должен потеряться');

    if (testInfo.project.name.includes('mobile')) await page.locator('.messenger-message.own .messenger-bubble').last().click();
    else await page.locator('.messenger-message.own .message-more-button').last().click();
    await page.locator('.messenger-action-reactions').getByRole('button', { name: '👍' }).click();
    await expect(page.locator('.messenger-message.own .message-reactions')).toContainText('👍');
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-reactions.png');

    await page.getByRole('button', { name: 'Эмодзи' }).click();
    await expect(page.locator('.messenger-emoji-panel')).toBeVisible();
    await page.locator('.emoji-grid button').filter({ hasText: '✅' }).first().click();
    await expect(textarea).toHaveValue(/Черновик не должен потеряться✅/);
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-composer.png');
    await page.getByRole('button', { name: 'Эмодзи' }).click();
    await expect(page.locator('.messenger-emoji-panel')).toHaveCount(0);

    await textarea.fill('Первая строка\nВторая строка\nТретья строка');
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-composer-multiline.png');

    await page.locator('.messenger-message-list').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await api(`/chats/${chat.id}/messages`, { method: 'POST', userId: 'test-management', factoryId: factory, body: { text: 'Новое сообщение после прокрутки', operationId: `telegram-ux-new-${Date.now()}` } });
    await page.waitForTimeout(5_600);
    await expect(page.getByRole('button', { name: /Новые сообщения.*вниз/ })).toBeVisible();
    if (testInfo.project.name.includes('mobile')) await shot(page, 'mobile-360-chat-unread-marker.png');
    await page.getByRole('button', { name: /Новые сообщения.*вниз/ }).click();
    await expect(page.locator('.messenger-message-list')).toContainText('Новое сообщение после прокрутки');

    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(24);
      if (testInfo.project.name.includes('mobile') && width !== 360) await shot(page, `mobile-${width}-chat-open.png`);
    }
  } finally {
    await api(`/chats/${chat.id}`, { method: 'PATCH', userId: 'test-admin', factoryId: factory, body: { isActive: false, reason: 'Завершение Telegram-style UX E2E' }, expected: [200, 201] });
  }
});

test('mobile photo attachment is preserved in Telegram-style evidence', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'This evidence is captured at the mobile viewport only.');

  const factory = await factoryId();
  const chat = await api('/chats', {
    method: 'POST', userId: 'test-management', factoryId: factory,
    body: { title: `Chat photo ${Date.now().toString(36)}`, type: 'CUSTOM', isHidden: true, members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }] },
  });
  const photoPath = testInfo.outputPath('telegram-ux-photo.png');
  writeTinyPng(photoPath);

  try {
    await login(page, 'pilot-worker-1', factory);
    await openChats(page);
    await page.locator('.messenger-chat-card').filter({ hasText: chat.title }).click();
    await page.getByRole('button', { name: 'Прикрепить' }).click();
    await page.locator('.messenger-attachment-sheet input[type="file"]').first().setInputFiles(photoPath);
    await expect(page.locator('.messenger-selected-files')).toContainText('Фото');
    await shot(page, 'mobile-360-chat-photo-preview.png');

    await page.locator('.messenger-composer textarea').fill('Фото в рабочем чате');
    await page.locator('.icon-send-button').click();
    await expect(page.locator('.messenger-message-list')).toContainText('Фото в рабочем чате');
    await expect(page.locator('.attachment-inline-media.photo img').last()).toBeVisible();
    await shot(page, 'mobile-360-chat-photo-message.png');
  } finally {
    await api(`/chats/${chat.id}`, { method: 'PATCH', userId: 'test-admin', factoryId: factory, body: { isActive: false, reason: 'Завершение evidence фото чата' }, expected: [200, 201] });
  }
});
