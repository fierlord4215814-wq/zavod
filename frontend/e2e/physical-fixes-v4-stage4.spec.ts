import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-screenshots', 'stage4');
const adminUserId = 'test-admin';
const factoryId = '537cbb48-7fba-48b6-80af-659f82cdaeb3';

type CreatedState = {
  groupId: string | null;
  directId: string | null;
  title: string;
};

let state: CreatedState = { groupId: null, directId: null, title: '' };

async function api<T>(
  userId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Connection: 'close',
      'x-user-id': userId,
      'x-factory-id': factoryId,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function login(page: Page) {
  await page.goto(frontendUrl);
  await page.evaluate(({ selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { selectedFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Смена', exact: true })).toBeVisible();
}

async function openChats(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Chats' } }));
  });
  await expect(page.getByRole('textbox', { name: 'Поиск по чатам' })).toBeVisible();
}

async function clickVisible(page: Page, name: string | RegExp) {
  const buttons = page.getByRole('button', { name });
  await expect(buttons.first()).toBeAttached();
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      return;
    }
  }
  throw new Error(`Visible button not found: ${String(name)}`);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function archiveArtifacts() {
  for (const id of [state.groupId, state.directId]) {
    if (!id) continue;
    await api(adminUserId, `/chats/${id}`, {
      method: 'PATCH',
      body: {
        isActive: false,
        reason: 'Physical Fixes V4 Stage 4 browser evidence complete',
        operationId: `pffv4-stage4-browser-archive-${id}-${Date.now()}`,
      },
    }).catch(() => undefined);
  }
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test.beforeEach(async ({}, testInfo) => {
  const suffix = `${testInfo.project.name.replace(/\W+/g, '-')}-${Date.now()}`;
  state = { groupId: null, directId: null, title: `Группа ролей ${suffix}` };
  const created = await api<{ id: string; title: string }>(adminUserId, '/chats', {
    method: 'POST',
    body: {
      title: state.title,
      type: 'CUSTOM',
      description: 'Проверка управления участниками',
      members: [
        { userId: 'worker-3', canRead: true, canWrite: true },
        { userId: 'worker-4', canRead: true, canWrite: true },
      ],
      operationId: `pffv4-stage4-browser-group-${suffix}`,
    },
  });
  state.groupId = created.id;
  state.title = created.title;
});

test.afterEach(async () => {
  await archiveArtifacts();
});

test('group roles, canonical profile, personal block and responsive layout', async ({ page }, testInfo) => {
  await login(page);
  await openChats(page);

  const groupCard = page.getByRole('button').filter({ hasText: state.title }).first();
  await expect(groupCard).toBeVisible();
  await groupCard.click();
  await expect(page.getByRole('heading', { name: state.title, exact: true })).toBeVisible();
  await clickVisible(page, 'Участники');

  const info = page.getByRole('dialog').filter({ hasText: state.title }).last();
  await expect(info.getByText('Главный администратор', { exact: true })).toBeVisible();
  const worker3 = info.locator('.chat-member-row').filter({ hasText: 'Работник 3' });
  await expect(worker3.getByText('Участник', { exact: true })).toBeVisible();
  await worker3.getByRole('button', { name: 'Назначить администратором' }).click();
  await expect(info.locator('.chat-member-row').filter({ hasText: 'Работник 3' }).getByText('Администратор', { exact: true })).toBeVisible();

  const worker4 = info.locator('.chat-member-row').filter({ hasText: 'Работник 4' });
  await worker4.getByRole('button', { name: 'Профиль' }).click();
  const miniProfile = page.getByRole('dialog', { name: 'Работник 4', exact: true });
  await expect(miniProfile.getByRole('button', { name: 'Перейти в профиль' })).toBeVisible();
  await miniProfile.getByRole('button', { name: 'Перейти в профиль' }).click();
  await expect(page.getByText('Карточка сотрудника', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Работник 4', { exact: true }).first()).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('zavod:mobile-back-request'));
  });
  await expect(page.getByRole('heading', { name: state.title, exact: true })).toBeVisible();

  const directTarget = testInfo.project.name.toLocaleLowerCase().includes('mobile') ? 'worker-2' : 'worker-1';
  const direct = await api<{ id: string }>(adminUserId, `/chats/direct/${directTarget}`, {
    method: 'POST',
    body: { operationId: `pffv4-stage4-browser-direct-${testInfo.project.name}-${Date.now()}` },
  });
  state.directId = direct.id;
  await page.evaluate((chatId) => {
    window.dispatchEvent(new CustomEvent('zavod:chat-updated', { detail: { chatId } }));
    window.dispatchEvent(new CustomEvent('zavod:mobile-back-request'));
  }, direct.id);
  await expect(page.getByRole('textbox', { name: 'Поиск по чатам' })).toBeVisible();
  const directName = directTarget === 'worker-2' ? 'Работник 2' : 'Работник 1';
  const directCard = page.getByRole('button').filter({ hasText: directName }).first();
  await expect(directCard).toBeVisible();
  await directCard.click();
  await clickVisible(page, 'Участники');
  const directInfo = page.getByRole('dialog').filter({ hasText: directName }).last();
  await directInfo.getByRole('button', { name: 'Блокировать общение' }).click();
  await expect(directInfo.getByRole('button', { name: 'Разблокировать общение' })).toBeVisible();
  await directInfo.getByRole('button', { name: 'Разблокировать общение' }).click();
  await expect(directInfo.getByRole('button', { name: 'Блокировать общение' })).toBeVisible();

  await noOverflow(page);
  const viewportName = testInfo.project.name.toLocaleLowerCase().includes('mobile') ? 'mobile-360' : 'desktop';
  await page.screenshot({ path: path.join(screenshotsDir, `${viewportName}-group-and-direct.png`), fullPage: true });

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await noOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `mobile-${width}-chat-info.png`), fullPage: true });
  }
});
