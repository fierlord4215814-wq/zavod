import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const factoryId = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const runId = 'PFFV4_20260727T075200Z';
const marker = '__PFFV4_PFFV4_20260727T075200Z__';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-screenshots', 'stage5');
const manifestPath = path.resolve(process.cwd(), '..', 'docs', 'physical-fixes-v4-test-artifacts.json');

type ArtifactState = {
  announcementId: string | null;
  announcementTitle: string;
  returnId: string | null;
  returnAttachmentId: string | null;
  returnTitle: string;
};

let state: ArtifactState = {
  announcementId: null,
  announcementTitle: '',
  returnId: null,
  returnAttachmentId: null,
  returnTitle: '',
};

async function apiResponse(
  userId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
) {
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
  return {
    status: response.status,
    payload: text ? JSON.parse(text) : null,
  };
}

async function api<T>(
  userId: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await apiResponse(userId, pathname, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${options.method || 'GET'} ${pathname}: ${response.status} ${JSON.stringify(response.payload)}`);
  }
  return response.payload as T;
}

async function loginAs(page: Page, userId: string) {
  await page.goto(frontendUrl);
  await page.evaluate(({ selectedFactoryId, selectedUserId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', selectedUserId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { selectedFactoryId: factoryId, selectedUserId: userId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.app-shell .screen-panel').first()).toBeVisible();
}

async function navigate(page: Page, screen: 'Admin' | 'Announcements' | 'Returns') {
  await page.evaluate((target) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: target } }));
  }, screen);
  const selector = {
    Admin: '.admin-screen',
    Announcements: '.announcements-screen',
    Returns: '.returns-screen',
  }[screen];
  await expect(page.locator(selector)).toBeVisible();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

function persistArtifact(model: string, id: string, businessKey: string, cleanupStatus = 'ARCHIVED') {
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!artifacts.some((item: { model?: string; id?: string }) => item.model === model && item.id === id)) {
    artifacts.push({
      model,
      id,
      businessKey,
      marker,
      createdByRun: runId,
      cleanupStatus,
    });
    manifest.artifacts = artifacts;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

async function findAnnouncementId() {
  const items = await api<Array<{ id: string; title: string }>>('test-admin', '/announcements?activeOnly=false');
  return items.find((item) => item.title === state.announcementTitle)?.id ?? null;
}

async function findReturn() {
  const items = await api<Array<{
    id: string;
    productName?: string | null;
    attachments?: Array<{ id: string }>;
  }>>('test-admin', '/returns?includeArchive=true');
  return items.find((item) => item.productName === state.returnTitle) ?? null;
}

async function archiveArtifacts() {
  state.announcementId = state.announcementId ?? await findAnnouncementId().catch(() => null);
  const foundReturn = await findReturn().catch(() => null);
  state.returnId = state.returnId ?? foundReturn?.id ?? null;
  state.returnAttachmentId = state.returnAttachmentId ?? foundReturn?.attachments?.[0]?.id ?? null;
  if (state.announcementId) {
    await apiResponse('test-admin', `/announcements/${state.announcementId}/archive`, { method: 'POST', body: {} }).catch(() => undefined);
    persistArtifact('Announcement', state.announcementId, `${marker}:stage5-browser-announcement`);
  }
  if (state.returnId) {
    await apiResponse('test-admin', `/returns/${state.returnId}/archive`, { method: 'POST', body: {} }).catch(() => undefined);
    persistArtifact('ReturnRecord', state.returnId, `${marker}:stage5-browser-return`);
  }
  if (state.returnAttachmentId) {
    persistArtifact('Attachment', state.returnAttachmentId, `${marker}:stage5-browser-return-photo`, 'PRESERVED_IN_ARCHIVE');
  }
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test.beforeEach(async ({}, testInfo) => {
  const suffix = `PF4-${testInfo.project.name}-${Date.now()}`;
  state = {
    announcementId: null,
    announcementTitle: `Производственная информация ${suffix}`,
    returnId: null,
    returnAttachmentId: null,
    returnTitle: `Повреждение упаковки ${suffix}`,
  };
});

test.afterEach(async () => {
  await archiveArtifacts();
});

test('delegation candidates are visible before search', async ({ page }, testInfo) => {
  const viewportName = testInfo.project.name.toLocaleLowerCase().includes('mobile') ? 'mobile-360' : 'desktop';

  await loginAs(page, 'pilot-pack-senior-master');
  await navigate(page, 'Admin');
  await expect(page.getByRole('heading', { name: /Дать права как у сотрудника/ })).toBeVisible();
  await page.locator('.delegation-person-trigger').first().click();
  const delegationDialog = page.getByRole('dialog', { name: 'Выбрать сотрудника-образец' });
  await expect(delegationDialog).toBeVisible();
  await expect(delegationDialog.getByLabel('Фамилия, имя или телефон')).toHaveValue('');
  await expect.poll(() => delegationDialog.locator('.compact-person-choice').count()).toBeGreaterThan(0);
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${viewportName}-delegation-initial-list.png`),
    fullPage: true,
  });
  await delegationDialog.getByRole('button', { name: 'Закрыть' }).click();
});

test('management publishes for two selected departments', async ({ page }, testInfo) => {
  const viewportName = testInfo.project.name.toLocaleLowerCase().includes('mobile') ? 'mobile-360' : 'desktop';

  await loginAs(page, 'test-management');
  await navigate(page, 'Announcements');
  await expect(page.getByRole('button', { name: 'Создать объявление', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Создать объявление', exact: true }).first().click();
  await page.getByLabel('Заголовок').fill(state.announcementTitle);
  await page.getByLabel('Текст').fill('Информация для двух выбранных подразделений текущего завода.');
  await page.getByRole('button', { name: 'Выбранные отделы' }).click();
  const departmentButtons = page.locator('.announcement-department-grid button');
  await expect.poll(() => departmentButtons.count()).toBeGreaterThanOrEqual(2);
  await departmentButtons.filter({ hasText: 'Руководство' }).first().click();
  await departmentButtons.filter({ hasText: 'ОКК' }).first().click();
  await expect(page.locator('.announcement-audience-chips .tag')).toHaveCount(2);
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${viewportName}-announcement-multi-audience.png`),
    fullPage: true,
  });
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/announcements'),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createdAnnouncement = await createResponse.json() as {
    id: string;
    departmentIds?: string[];
    scopeLabel?: string;
    storagePath?: unknown;
  };
  state.announcementId = createdAnnouncement.id;
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeHidden();
  expect(state.announcementId).not.toBeNull();
  expect(createdAnnouncement.departmentIds).toHaveLength(2);
  expect(createdAnnouncement.scopeLabel).toMatch(/^Отделы:/);
  expect(createdAnnouncement.storagePath).toBeUndefined();
  await noOverflow(page);
});

test('store publishes a photo return feed card', async ({ page }, testInfo) => {
  const viewportName = testInfo.project.name.toLocaleLowerCase().includes('mobile') ? 'mobile-360' : 'desktop';

  await loginAs(page, 'test-store');
  await navigate(page, 'Returns');
  await page.getByRole('button', { name: 'Опубликовать возврат' }).click();
  const returnDialog = page.getByRole('dialog', { name: 'Возврат на производство' });
  await returnDialog.getByLabel('Заголовок').fill(state.returnTitle);
  await returnDialog.getByLabel('Краткая причина').fill('Нарушена целостность транспортной упаковки.');
  await returnDialog.getByLabel('Артикул').fill('1050');
  await returnDialog.getByLabel('Количество').fill('30');
  await returnDialog.getByLabel('Единица').selectOption('гофр');
  await returnDialog.locator('input[type="file"]').nth(1).setInputFiles({
    name: 'return-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4gAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(returnDialog.getByAltText('return-photo.png')).toBeVisible();
  const returnResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/returns'),
  );
  const attachmentResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/attachments/upload'),
  );
  await returnDialog.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const returnResponse = await returnResponsePromise;
  const attachmentResponse = await attachmentResponsePromise;
  expect(returnResponse.status()).toBe(201);
  expect(attachmentResponse.status()).toBe(201);
  state.returnId = (await returnResponse.json() as { id: string }).id;
  state.returnAttachmentId = (await attachmentResponse.json() as { id: string }).id;
  const returnCard = page.locator('.returns-publication-card').filter({ hasText: state.returnTitle });
  await expect(returnCard).toBeVisible();
  await expect(returnCard.getByText('Артикул:')).toBeVisible();
  await expect(returnCard.getByText(/30 гофр/)).toBeVisible();
  await expect(returnCard.getByText(/Автор:/)).toBeVisible();
  await expect(returnCard.getByText('Фотография недоступна')).toHaveCount(0);
  expect(state.returnId).not.toBeNull();
  expect(state.returnAttachmentId).not.toBeNull();
  await noOverflow(page);
  await page.screenshot({
    path: path.join(screenshotsDir, `${viewportName}-return-publication-feed.png`),
    fullPage: true,
  });

  await returnCard
    .locator('.returns-publication-content')
    .getByRole('button', { name: 'Открыть', exact: true })
    .click();
  const returnDetail = page.getByRole('dialog', { name: state.returnTitle });
  await expect(returnDetail).toBeVisible();
  await expect(returnDetail.getByText('Артикул:')).toBeVisible();
  await expect(returnDetail.getByText(/30 гофр/)).toBeVisible();
  await noOverflow(page);

  if (testInfo.project.name.toLocaleLowerCase().includes('mobile')) {
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 860 });
      await noOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `mobile-${width}-return-detail.png`),
        fullPage: true,
      });
    }
  }
});
