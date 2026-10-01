import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const runId = `${Date.now()}_${process.pid}`;
const marker = `__PFFV5_P5_${runId}__`;
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast5', 'screenshots');

type Session = { token: string; factoryId: string; userId: string };
type CreatedArtifacts = { announcementId?: string; chatId?: string };

const artifacts: CreatedArtifacts = {};

async function login(phone: string): Promise<Session> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: '1234' }),
  });
  if (!response.ok) throw new Error(`login ${phone} failed (${response.status})`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4')
    ?? data.availableFactories?.[0];
  const token = data.accessToken ?? data.token;
  if (!token || !factory?.id || !data.userId) throw new Error(`session ${phone} is incomplete`);
  return { token, factoryId: factory.id, userId: data.userId };
}

async function api<T = any>(session: Session, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      'x-factory-id': session.factoryId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function upload(session: Session, entityType: string, entityId: string, name: string, type: string, contents: Buffer) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', type.startsWith('image/') ? 'PHOTO' : 'FILE');
  form.append('operationId', `${marker}:${entityId}:${name}`);
  form.append('file', new Blob([contents], { type }), name);
  const response = await fetch(`${apiUrl}/attachments/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'x-factory-id': session.factoryId,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`upload ${name} failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

async function openSession(page: Page, session: Session, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${frontendUrl}/pwa-icon.svg`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, session);
  await page.goto(`${frontendUrl}/?pffv5p5=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 20_000 });
}

async function openScreen(page: Page, screen: 'Announcements' | 'Chats') {
  await page.evaluate((next) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: next } }));
  }, screen);
  await page.waitForTimeout(250);
}

async function horizontalSwipe(page: Page, selector: string, fromX: number, toX: number) {
  await page.locator(selector).evaluate((element, points) => {
    const event = (type: string, x: number) => {
      const value = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(value, type === 'touchend' ? 'changedTouches' : 'touches', {
        value: [{ clientX: x, clientY: 220 }],
      });
      element.dispatchEvent(value);
    };
    event('touchstart', points.fromX);
    event('touchend', points.toX);
  }, { fromX, toX });
}

async function expectNoOverflow(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(geometry.body, geometry.document) - geometry.viewport, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(2);
}

async function expectCleanUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
  expect(text).not.toMatch(/\u0420\u00A0\u0421\u045F|\u0420\u00A0\u0420\u040B|\u0420\u00A0\u0412\u00B5|\u0420\u040E\u0432\u0402\u045A|\u043F\u0457\u0405/);
  expect(text).not.toMatch(/TypeError|ReferenceError|Unhandled|internal server error/i);
}

test('PFFV5 Plast 5 announcement pages and chat media remain compact and contextual', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const admin = await login('+79000009009');
  const worker = await login('+79000004701');
  const management = await login('+79000009008');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABFaP0WAAAADUlEQVR42mNk+M/wHwAF/gL+lnv1AAAAAElFTkSuQmCC', 'base64');

  try {
    const announcement = await api(admin, 'POST', '/announcements', {
      title: `${marker} Важная инструкция`,
      text: `${'Прочитайте порядок действий перед началом смены. '.repeat(36)}\nПоследний абзац должен оставаться доступным над нижней панелью.`,
      priority: 'IMPORTANT',
      audienceType: 'FACTORY',
      recurrence: 'WEEKLY',
      visibleUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    artifacts.announcementId = announcement.id;
    for (let index = 1; index <= 3; index += 1) {
      await upload(admin, 'ANNOUNCEMENT', announcement.id, `${marker}-announcement-${index}.png`, 'image/png', png);
    }
    await upload(admin, 'ANNOUNCEMENT', announcement.id, `${marker}-instruction.txt`, 'text/plain', Buffer.from('Инструкция', 'utf8'));

    const chat = await api(admin, 'POST', '/chats', {
      title: `${marker} Медиа`,
      type: 'CUSTOM',
      description: 'Проверка компактной галереи',
      isHidden: true,
      members: [
        { userId: worker.userId, canRead: true, canWrite: true },
        { userId: management.userId, canRead: true, canWrite: true },
      ],
    });
    artifacts.chatId = chat.id;
    const mediaMessage = await api(admin, 'POST', `/chats/${chat.id}/messages`, {
      text: `${marker} Пять фотографий в одном сообщении`,
      operationId: `${marker}:chat-media`,
    });
    for (let index = 1; index <= 5; index += 1) {
      await upload(admin, 'CHAT_MESSAGE', mediaMessage.id, `${marker}-chat-${index}.png`, 'image/png', png);
    }
    await api(admin, 'POST', `/chats/${chat.id}/messages`, { text: `${marker} Продолжение 1`, operationId: `${marker}:group-1` });
    await api(admin, 'POST', `/chats/${chat.id}/messages`, { text: `${marker} Продолжение 2`, operationId: `${marker}:group-2` });
    await api(management, 'POST', `/chats/${chat.id}/messages`, { text: `${marker} Другой участник`, operationId: `${marker}:manager` });
    await api(worker, 'POST', `/chats/${chat.id}/messages`, { text: `${marker} Моё сообщение`, operationId: `${marker}:worker` });

    const isDesktop = testInfo.project.name.includes('desktop');
    await openSession(page, worker, isDesktop ? 1366 : 390, isDesktop ? 900 : 844);
    await openScreen(page, 'Announcements');
    const viewer = page.locator('.announcement-page-viewer').filter({ hasText: marker }).first();
    await expect(viewer).toBeVisible({ timeout: 20_000 });
    await expect(viewer.locator('.announcement-viewer-header')).toBeVisible();
    await expect(viewer.locator('.announcement-sticky-actions')).toBeVisible();
    await expect(viewer.locator('.announcement-page-navigation')).toContainText('1 из 4');
    const cardGeometry = await viewer.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    expect(cardGeometry.scroll - cardGeometry.client).toBeLessThanOrEqual(2);

    await horizontalSwipe(page, '.announcement-page-viewer .announcement-page-stage', 330, 70);
    await expect(viewer.locator('.announcement-page-navigation')).toContainText('2 из 4');
    await viewer.locator('.attachment-focus-media').click();
    const fullscreen = page.locator('.attachment-modal');
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen.locator('.attachment-viewer-counter')).toContainText('2 из 3');
    await fullscreen.getByRole('button', { name: 'Следующее фото' }).click();
    await expect(fullscreen.locator('.attachment-viewer-counter')).toContainText('3 из 3');
    await fullscreen.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(viewer.locator('.announcement-page-navigation')).toContainText('2 из 4');

    await viewer.getByRole('button', { name: 'Следующая страница' }).click();
    await viewer.getByRole('button', { name: 'Следующая страница' }).click();
    await expect(viewer.locator('.announcement-page-navigation')).toContainText('4 из 4');
    const textPage = viewer.locator('.announcement-text-page');
    await expect(textPage).toBeVisible();
    await expect(textPage).toContainText('Напоминание: Раз в неделю');
    await expect(textPage).toContainText(`${marker}-instruction.txt`);
    await textPage.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await textPage.evaluate((element) => element.scrollTop > 0)).toBe(true);
    await expect(viewer.getByRole('button', { name: 'Ознакомлен', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-announcement-text.png`), fullPage: false });
    await viewer.getByRole('button', { name: 'Ознакомлен', exact: true }).click();
    await expect(viewer.getByRole('button', { name: '✓ Ознакомлен', exact: true })).toBeDisabled();
    await expect(viewer).toBeHidden({ timeout: 10_000 });

    await openScreen(page, 'Chats');
    const chatCard = page.locator('.messenger-chat-card').filter({ hasText: marker }).first();
    await expect(chatCard).toBeVisible({ timeout: 20_000 });
    await chatCard.click();
    const mediaBubble = page.locator('.messenger-message').filter({ hasText: 'Пять фотографий в одном сообщении' });
    await expect(mediaBubble).toBeVisible();
    await expect(mediaBubble.locator('.attachment-message-gallery-item')).toHaveCount(4);
    await expect(mediaBubble.locator('.attachment-message-gallery-more')).toHaveText('+1');
    await expect(mediaBubble.locator('.messenger-message-head')).toHaveCount(1);
    const messageHeight = await mediaBubble.evaluate((element) => element.getBoundingClientRect().height);
    expect(messageHeight).toBeLessThan(520);

    const list = page.locator('.messenger-message-list');
    await mediaBubble.locator('.attachment-message-gallery-item').nth(1).click();
    await expect(fullscreen.locator('.attachment-viewer-counter')).toContainText('2 из 5');
    const scrollBefore = await list.evaluate((element) => element.scrollTop);
    await fullscreen.getByRole('button', { name: 'Закрыть', exact: true }).click();
    const scrollAfter = await list.evaluate((element) => element.scrollTop);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);

    const groupedMessages = page.locator('.messenger-message.grouped').filter({ hasText: marker });
    expect(await groupedMessages.count()).toBeGreaterThanOrEqual(1);
    const foreignAccents = await page.locator('.messenger-message[data-participant-accent]').evaluateAll((elements) =>
      [...new Set(elements.map((element) => element.getAttribute('data-participant-accent')).filter(Boolean))],
    );
    expect(foreignAccents.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.messenger-message.own[data-participant-accent]')).toHaveCount(0);
    await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-chat-gallery.png`), fullPage: false });

    if (!isDesktop) {
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await expectNoOverflow(page, `mobile ${width}`);
      }
    } else {
      await expectNoOverflow(page, 'desktop');
    }
    await expectCleanUi(page);
  } finally {
    if (artifacts.announcementId) {
      await api(admin, 'POST', `/announcements/${artifacts.announcementId}/archive`, {}).catch(() => undefined);
    }
    if (artifacts.chatId) {
      await api(admin, 'PATCH', `/chats/${artifacts.chatId}`, {
        isActive: false,
        reason: 'Завершение целевой браузерной проверки Пласта 5',
      }).catch(() => undefined);
    }
  }
});
