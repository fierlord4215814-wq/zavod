import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Chat department|General chat|Messenger)\b/;
const mojibakePattern = /Рџ|РЎ|Рќ|Рґ|Рµ/;
const marker = `Чат смены Рондо ${Date.now().toString(36).slice(-5)}`;
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'stage56a-internal-messenger-ux-screenshots');

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
    Object.defineProperty(window, '__stage56aDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage56aDialogs?: string[] }).__stage56aDialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage56aUser=${encodeURIComponent(userId)}&t=${Date.now()}`);
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

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: мессенджер, группа, личный чат, медиа и инфо-панель', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop screenshots are captured only once.');
  const filePath = testInfo.outputPath('chat-photo.png');
  writeTinyPng(filePath);

  const factoryId = await loginAs(page, 'test-management');
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Чат отдела:\s*ОККОКК|Общий чат заводаОбщий чат/);
  await screenshot(page, '01-desktop-chat-list.png');

  await page.getByRole('button', { name: 'Создать чат' }).click();
  const modal = page.locator('.modal-card').filter({ hasText: 'Создать чат' });
  await modal.locator('label').filter({ hasText: 'Название' }).locator('input').fill(marker);
  await modal.locator('label').filter({ hasText: 'Тип' }).locator('select').selectOption('CUSTOM');
  await modal.locator('label').filter({ hasText: 'Описание' }).locator('textarea').fill('Группа для быстрого запуска линии');
  await modal.getByLabel(/Закрытый чат/).check();
  await modal.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.locator('.messenger-dialog-header')).toContainText('Чат смены Рондо');
  const createdChat = (await api('/chats', { userId: 'test-management', factoryId })).find((chat: { id: string; title: string }) => chat.title === marker);
  if (!createdChat) throw new Error('Созданный чат не найден через API');
  await api(`/chats/${createdChat.id}/members`, {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { userId: 'pilot-worker-1', canRead: true, canWrite: true },
  });
  await page.getByRole('button', { name: 'Обновить' }).click();
  await page.locator('.messenger-chat-card').filter({ hasText: marker }).click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(marker);
  await screenshot(page, '02-desktop-chat-detail.png');

  await page.locator('.messenger-composer textarea').fill('Проверили упаковку, можно запускать.');
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.locator('.messenger-attachment-sheet input[type="file"]').last().setInputFiles(filePath);
  await expect(page.locator('.messenger-composer')).toContainText('chat-photo.png');
  await screenshot(page, '03-desktop-composer-attachments.png');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.locator('.messenger-message-list')).toContainText('Проверили упаковку');
  await expect(page.locator('.messenger-message-list .attachment-preview-inline img')).toBeVisible();

  const actionButtons = page.getByRole('button', { name: 'Действия сообщения' });
  await actionButtons.first().click();
  await expect(page.locator('.messenger-action-sheet')).toContainText('Копировать');
  await screenshot(page, '04-desktop-message-actions.png');
  await page.locator('.messenger-action-sheet').getByRole('button', { name: 'Отмена' }).click();

  await page.getByRole('button', { name: 'Участники' }).click();
  await expect(page.locator('.messenger-info-card')).toContainText('Участники');
  await screenshot(page, '05-desktop-info-members.png');
  await page.locator('.messenger-info-tabs button').filter({ hasText: 'Медиа' }).click();
  await expect(page.locator('.messenger-info-card')).toContainText('chat-photo.png');
  await screenshot(page, '06-desktop-info-media.png');
  await page.locator('.messenger-info-tabs button').filter({ hasText: 'Файлы' }).click();
  await screenshot(page, '07-desktop-info-files.png');
  await page.locator('.messenger-info-card').getByRole('button', { name: 'Закрыть' }).click();

  await page.locator('.messenger-top-actions').getByRole('button', { name: 'Личный чат' }).click();
  await expect(page.locator('.modal-card')).toContainText('С кем начать переписку');
  await screenshot(page, '08-desktop-direct-chat-modal.png');
  await api('/chats/direct/pilot-worker-2', { method: 'POST', userId: 'test-management', factoryId, body: {} });
  await page.locator('.modal-card').getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Обновить' }).click();
  await page.locator('.messenger-filter-row button').filter({ hasText: 'Личные' }).click();
  await page.locator('.messenger-chat-card').filter({ hasText: /Тестовый работник 2|Работник 2/ }).click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(/Тестовый работник 2|Работник 2/);
  await expect(page.locator('.messenger-chat-card')).toContainText(/Тестовый работник 2|Работник 2/);

  const nonMember = await api('/chats', { userId: 'pilot-worker-2', factoryId, expected: [200, 403] });
  expect(JSON.stringify(nonMember)).not.toContain(createdChat?.id ?? 'missing-chat-id');
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

test('mobile 360: список, переписка и инфо-панель без горизонтального overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile screenshots are captured in the mobile project.');
  const factoryId = await loginAs(page, 'test-management');
  const chat = await api('/chats', {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: {
      title: `${marker} mobile`,
      type: 'CUSTOM',
      isHidden: true,
      description: 'Мобильная проверка мессенджера',
      members: [{ userId: 'pilot-worker-1', canRead: true, canWrite: true }],
    },
  });
  await api(`/chats/${chat.id}/messages`, {
    method: 'POST',
    userId: 'test-management',
    factoryId,
    body: { text: 'Мобильная проверка сообщений' },
  });

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Чаты');
  await expect(page.locator('.messenger-chat-list')).toContainText(`${marker} mobile`);
  await screenshot(page, '09-mobile-chat-list.png');
  await page.locator('.messenger-chat-card').filter({ hasText: `${marker} mobile` }).click();
  await expect(page.locator('.messenger-dialog-header')).toContainText(`${marker} mobile`);
  await expect(page.locator('.messenger-message-list')).toContainText('Мобильная проверка сообщений');
  await screenshot(page, '10-mobile-chat-detail.png');
  await page.getByRole('button', { name: 'Участники' }).click();
  await expect(page.locator('.messenger-info-card')).toContainText('Участники');
  await screenshot(page, '11-mobile-info-panel.png');
  await expectStableRussianPage(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
});

