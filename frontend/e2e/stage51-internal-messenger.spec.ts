import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Chat department|General chat)\b/;
const mojibakePattern = /РїС—Р…|Р“С’|Р В РЎСџ/;
const marker = `Рабочий чат упаковки ${Date.now().toString(36)}`;

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

async function chatMemberCandidates(factoryId: string) {
  const users = await api('/directory/users', { userId: 'test-admin', factoryId });
  return (Array.isArray(users) ? users : [])
    .filter((user: { userId?: string; role?: string }) =>
      Boolean(user.userId)
      && user.userId !== 'test-admin'
      && ['WORKER', 'CONTRACTOR', 'MASTER', 'STORE', 'OKK', 'TECH_KIPIA', 'TECH_HOLOD', 'TECH_ELECTRIC'].includes(user.role ?? ''),
    );
}

async function selectFirstChatMember(factoryId: string) {
  const candidates = await chatMemberCandidates(factoryId);
  const preferred = candidates.find((user: { role?: string }) => user.role === 'WORKER')
    ?? candidates.find((user: { role?: string }) => user.role === 'CONTRACTOR')
    ?? candidates[0];
  if (!preferred?.userId) throw new Error('Не найден доступный участник для чата');
  return preferred.userId as string;
}

async function selectNonMember(factoryId: string, memberUserId: string) {
  const candidates = await chatMemberCandidates(factoryId);
  return candidates.find((user: { userId?: string }) => user.userId && user.userId !== memberUserId)?.userId
    ?? (memberUserId === 'pilot-worker-2' ? 'pilot-worker-1' : 'pilot-worker-2');
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage51Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage51Dialogs?: string[] }).__stage51Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage51User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN создаёт групповой чат, пишет сообщение, добавляет вложение и участник видит переписку', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий создания выполняется на desktop.');
  const filePath = testInfo.outputPath('chat-photo.png');
  writeTinyPng(filePath);

  const factoryId = await loginAs(page, 'test-admin');
  const memberUserId = await selectFirstChatMember(factoryId);
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Чат отдела:\s*ОККОКК|Общий чат заводаОбщий чат/);

  await page.getByRole('button', { name: 'Создать чат' }).click();
  const modal = page.locator('.modal-card').filter({ hasText: 'Создать чат' });
  await modal.locator('label').filter({ hasText: 'Название' }).locator('input').fill(marker);
  await modal.locator('label').filter({ hasText: 'Тип' }).locator('select').selectOption('CUSTOM');
  const memberSelect = modal.locator('label').filter({ hasText: 'Первый участник' }).locator('select');
  await expect.poll(async () => memberSelect.locator(`option[value="${memberUserId}"]`).count(), { timeout: 10_000 }).toBe(1);
  await memberSelect.selectOption(memberUserId);
  await modal.locator('label').filter({ hasText: 'Описание' }).locator('textarea').fill('Рабочая группа запуска упаковки');
  await modal.getByLabel(/Закрытый чат/).check();
  await modal.getByRole('button', { name: 'Сохранить' }).click();

  const storedMarker = marker.slice(0, -1);
  await expect(page.locator('.messenger-dialog-header')).toContainText(storedMarker);
  await expect(page.locator('.messenger-dialog-header')).toContainText('Закрытый чат');
  await expect(page.getByRole('button', { name: 'Участники' })).toBeVisible();

  await page.locator('.messenger-composer textarea').fill('Проверили упаковку, можно запускать.');
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.locator('.messenger-attachment-sheet input[type="file"]').last().setInputFiles(filePath);
  await expect(page.locator('.messenger-composer')).toContainText('chat-photo.png');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.locator('.messenger-message-list')).toContainText('Проверили упаковку');
  await expect(page.locator('.messenger-message-list .attachment-preview-inline img')).toBeVisible();
  await expect(page.locator('.messenger-message-list')).toContainText(/Руководство|Мастер|Админ/);

  const inlinePhoto = page.locator('.messenger-message-list .attachment-preview-inline img').last();
  if ((await inlinePhoto.count()) > 0) {
    await inlinePhoto.click();
    await expect(page.locator('.attachment-modal')).toContainText('chat-photo.png');
    await expect(page.locator('.attachment-modal')).not.toContainText('storagePath');
    await page.locator('.attachment-modal').getByRole('button', { name: 'Закрыть' }).click();
  }

  const adminChats = await api('/chats', { userId: 'test-admin', factoryId });
  const createdChat = adminChats.find((chat: { id: string; title: string }) => chat.title === marker || chat.title === storedMarker);
  if (!createdChat) throw new Error('Созданный чат не найден через API');
  await api(`/chats/${createdChat.id}/messages`, {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { text: 'Новая пометка для непрочитанных' },
  });

  await loginAs(page, memberUserId);
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(marker);
  const memberCard = page.locator('.messenger-chat-card').filter({ hasText: marker }).first();
  const unreadBadge = memberCard.locator('.messenger-unread');
  if ((await unreadBadge.count()) > 0) {
    await expect(unreadBadge.first()).toBeVisible();
  }
  await memberCard.click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
  await expect(page.locator('.messenger-message-list')).toContainText('Проверили упаковку');
  await expect(page.locator('.messenger-chat-card').filter({ hasText: marker }).locator('.messenger-unread')).toHaveCount(0);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('non-member не видит закрытый чат, mobile 360 показывает список и переписку без overflow', async ({ page }) => {
  const factoryId = await loginAs(page, 'test-management');
  const memberUserId = await selectFirstChatMember(factoryId);
  const nonMemberUserId = await selectNonMember(factoryId, memberUserId);
  const created = await api('/chats', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: {
      title: `${marker} mobile`,
      type: 'CUSTOM',
      isHidden: true,
      description: 'Проверка мобильного мессенджера',
      members: [{ userId: memberUserId, canRead: true, canWrite: true }],
    },
  });
  await api(`/chats/${created.id}/messages`, {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { text: 'Мобильная проверка сообщений' },
  });

  const nonMember = await api('/chats', { userId: nonMemberUserId, factoryId, expected: [200, 403] });
  expect(JSON.stringify(nonMember)).not.toContain(created.id);

  await page.setViewportSize({ width: 360, height: 740 });
  await loginAs(page, memberUserId);
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(`${marker} mobile`);
  await page.locator('.messenger-chat-card').filter({ hasText: `${marker} mobile` }).first().click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(`${marker} mobile`);
  await expect(page.locator('.messenger-message-list')).toContainText('Мобильная проверка сообщений');
  await page.getByRole('button', { name: 'К списку чатов' }).click();
  await expect(page.locator('.messenger-chat-list')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
