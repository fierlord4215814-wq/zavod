import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const marker = `Пилотное объявление ${Date.now().toString(36)}`;
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Access denied|No data|Announcement|Acknowledgement)\b/;
const mojibakePattern = /РїС—Р…|Р“С’|Р В РЎСџ/;

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
    Object.defineProperty(window, '__stage52Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage52Dialogs?: string[] }).__stage52Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?prepareStage52Login=${Date.now()}`);
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
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage52User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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

test('ADMIN создаёт полноэкранное объявление, WORKER подтверждает, руководитель видит журнал', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Полный сценарий создания выполняется на desktop.');
  const filePath = testInfo.outputPath('announcement-photo.png');
  writeTinyPng(filePath);

  const factoryId = await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Объявления');
  await page.getByRole('button', { name: 'Управление' }).click();
  await page.getByRole('button', { name: 'Создать объявление' }).click();
  const modal = page.locator('.announcement-editor-modal');
  await modal.locator('label').filter({ hasText: 'Заголовок' }).locator('input').fill(marker);
  await modal.locator('label').filter({ hasText: 'Важность' }).locator('select').selectOption('IMPORTANT');
  await modal.locator('label').filter({ hasText: 'Текст' }).locator('textarea').fill('Обязательно прочитайте инструкцию перед запуском смены.');
  await modal.locator('input[type="file"]').last().setInputFiles(filePath);
  await expect(modal).toContainText('announcement-photo.png');
  await modal.getByRole('button', { name: 'Сохранить' }).click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.announcement-manage-card').filter({ hasText: marker })).toBeVisible();

  const created = await api('/announcements/unread', { userId: 'worker-1', factoryId });
  const createdItem = created.find((item: { title: string }) => item.title === marker);
  if (!createdItem) throw new Error('Созданное объявление не найдено в очереди worker-1');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('.announcement-fullscreen-card')).toBeVisible();
  await expect(page.locator('.announcement-fullscreen-card')).toContainText(marker);
  await expect(page.locator('.announcement-fullscreen-card')).toContainText('Ознакомлен');
  await expect(page.locator('.announcement-fullscreen-card .attachment-preview')).toBeVisible();
  const openButtons = page.locator('.announcement-fullscreen-card .attachment-preview button').filter({ hasText: 'Открыть' });
  if ((await openButtons.count()) > 0) {
    await openButtons.first().click();
    await expect(page.locator('.attachment-modal')).toBeVisible();
    await page.locator('.attachment-modal').getByRole('button', { name: 'Закрыть' }).click();
  }
  const ackButton = page.locator('.announcement-reader .announcement-sticky-actions').getByRole('button', { name: 'Ознакомлен' });
  await ackButton.scrollIntoViewIfNeeded();
  await expect(ackButton).toBeVisible();
  const ackResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/announcements/${createdItem.id}/ack`) && response.request().method() === 'POST',
  );
  await ackButton.click();
  const ackResponse = await ackResponsePromise;
  expect(ackResponse.status()).toBeGreaterThanOrEqual(200);
  expect(ackResponse.status()).toBeLessThan(300);
  await expect.poll(async () => {
    const unread = await api('/announcements/unread', { userId: 'worker-1', factoryId });
    return unread.some((item: { title: string }) => item.title === marker);
  }).toBe(false);
  await expect(page.locator('.announcement-reader')).not.toContainText(marker);
  await page.locator('.announcement-tabs').getByRole('button', { name: 'Архив' }).click();
  await expect(page.locator('.announcement-archive-card').filter({ hasText: marker })).toBeVisible();

  await loginAs(page, 'worker-2');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('.announcement-fullscreen-card')).toContainText(marker);
  const workerReport = await api(`/announcements/${createdItem.id}/ack-report`, { userId: 'worker-2', factoryId, expected: [403] });
  expect(JSON.stringify(workerReport)).toContain('FORBIDDEN');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Объявления');
  await page.getByRole('button', { name: 'Управление' }).click();
  const manageCard = page.locator('.announcement-manage-card').filter({ hasText: marker }).first();
  await expect(manageCard).toBeVisible();
  await manageCard.getByRole('button', { name: 'Журнал ознакомления' }).click();
  await expect(page.locator('.announcement-report-modal')).toContainText('Ознакомились');
  await expect(page.locator('.announcement-report-modal')).toContainText('Не ознакомились');
  await expect(page.locator('.announcement-report-modal')).toContainText(/Работник|Сотрудник/);

  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: объявление читается крупно, без overflow и технических полей', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-сценарий выполняется только в mobile-проекте.');
  const factoryId = await loginAs(page, 'test-admin');
  await api('/announcements', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      title: `${marker} mobile`,
      text: 'Мобильная проверка полноэкранного объявления.',
      priority: 'IMPORTANT',
      visibleUntil: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });

  await loginAs(page, 'worker-1');
  await openMenuItem(page, 'Объявления');
  await expect(page.locator('.announcement-fullscreen-card')).toBeVisible();
  await expect(page.locator('.announcement-sticky-actions')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
