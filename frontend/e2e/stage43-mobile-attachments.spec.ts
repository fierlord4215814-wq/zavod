import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|пїЅ|Гђ|Р Сџ/;
const marker = `Stage43 browser ${Date.now()}`;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] } = {}) {
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
    Object.defineProperty(window, '__stage43Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage43Dialogs?: string[] }).__stage43Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
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
  await page.goto(`${frontendUrl}/?stage43User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const nav = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await nav.count()) > 0) {
    await nav.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
    await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
  }
}

function writeTinyPng(pathname: string) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(pathname, png);
}

async function chooseFileAndRemove(page: Page, filePath: string) {
  const picker = page.locator('input[type="file"]').last();
  await picker.setInputFiles(filePath);
  await expect(page.getByText('stage43-photo.png')).toBeVisible();
  await expect(page.locator('.messenger-selected-file')).toContainText('Фото');
  await page.getByRole('button', { name: 'Убрать' }).click();
  await expect(page.getByText('stage43-photo.png')).toHaveCount(0);
}

async function createArchiveAttachment(factoryId: string) {
  const departments = await api('/tasks/recipient-departments', { userId: 'test-master', factoryId });
  const department = departments[0];
  const task = await api('/tasks', {
    method: 'POST',
    userId: 'test-master',
    factoryId,
    body: {
      type: 'URGENT',
      description: `${marker}: вложение для архива`,
      departmentRecipientIds: department ? [department.id] : [],
      operationId: `stage43-browser-task-${Date.now()}`,
    },
  });
  const form = new FormData();
  form.append('entityType', 'TASK');
  form.append('entityId', task.id);
  form.append('kind', 'FILE');
  form.append('operationId', `stage43-browser-attachment-${Date.now()}`);
  form.append('file', new Blob([marker], { type: 'text/plain' }), 'stage43-archive.txt');
  const upload = await fetch(`${apiUrl}/attachments/upload`, {
    method: 'POST',
    headers: { 'x-user-id': 'test-master', 'x-factory-id': factoryId },
    body: form,
  });
  if (![200, 201].includes(upload.status)) throw new Error(`attachment upload failed: ${upload.status} ${await upload.text()}`);
  return task;
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('mobile 360px: picker показывает preview и позволяет убрать файл до загрузки', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий Stage43 выполняется только в mobile-проекте.');
  const filePath = testInfo.outputPath('stage43-photo.png');
  writeTinyPng(filePath);

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Чаты/);
  const firstChat = page.locator('.messenger-chat-card').first();
  await expect(firstChat).toBeVisible();
  await firstChat.click();
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await expect(page.locator('.messenger-attachment-sheet')).toContainText('Фото');
  await expect(page.locator('.messenger-attachment-sheet')).toContainText('Файл');
  await chooseFileAndRemove(page, filePath);
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: рабочие формы с вложениями не дают горизонтальный overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий Stage43 выполняется только в mobile-проекте.');

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Заявки/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Чек-листы/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Смена/);
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: ОКК и возвраты с файловыми карточками не расползаются', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий Stage43 выполняется только в mobile-проекте.');
  await loginAs(page, 'test-admin');
  await openMenuItem(page, /ОКК/);
  await expectNoHorizontalOverflow(page);
  await openMenuItem(page, /Возвраты на производство/);
  await expectNoHorizontalOverflow(page);

  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('Архив открывает папку файлов и не показывает технических полей', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop archive source проверяется отдельно от mobile picker.');
  const factoryId = await resolveFactoryId();
  await createArchiveAttachment(factoryId);

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  await page.getByRole('button', { name: /Вложения/ }).click();
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible();
  await expect(page.locator('body')).toContainText('stage43-archive.txt');
  await expect(page.locator('body')).not.toContainText('storagePath');
  await expect(page.getByRole('link', { name: 'Скачать файл' }).first()).toBeVisible();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
