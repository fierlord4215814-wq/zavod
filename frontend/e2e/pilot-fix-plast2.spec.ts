import { Browser, expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast2');

async function factory4Id(userId: string) {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`dev-login ${userId}: ${response.status}`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? data.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 unavailable for ${userId}`);
  return factory.id as string;
}

async function login(page: Page, userId: string) {
  const factoryId = await factory4Id(userId);
  await page.goto('/');
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openScreen(page: Page, label: string) {
  const direct = page.locator('.bottom-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await page.locator('.mobile-more-button:visible').click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function pendingAssignmentRequests(factoryId: string) {
  const response = await fetch(`${apiUrl}/admin/assignment-requests?status=PENDING&factoryId=${encodeURIComponent(factoryId)}`, {
    headers: { 'x-user-id': 'test-admin', 'x-factory-id': factoryId },
  });
  if (!response.ok) throw new Error(`assignment requests: ${response.status}`);
  return response.json() as Promise<Array<{ requestedById: string }>>;
}

async function openAdminReview(browser: Browser, viewport: { width: number; height: number } | null) {
  const context = await browser.newContext({
    baseURL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
    viewport: viewport ?? { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await login(page, 'test-admin');
  await openScreen(page, 'Админка');
  await expect(page.locator('.admin-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).first().click();
  await expect(page.locator('[data-testid="assignment-request-review"]')).toBeVisible();
  return { context, page };
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('Guest request and reviewer decision update canonical access atomically', async ({ browser, page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  const guestId = mobile
    ? 'pilot-pack-guest-kipia-target'
    : 'pilot-pack-guest-worker-target';
  const expectedName = mobile
    ? 'PILOT Гость для назначения КИПиА'
    : 'PILOT Гость для назначения Работником';

  await login(page, guestId);
  await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Объявления', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подать заявку на назначение' }).click();

  const assignmentSelect = page.locator('.guest-request-form select').first();
  await expect(assignmentSelect).toBeVisible();
  const assignmentOptions = await assignmentSelect.locator('option').allTextContents();
  expect(assignmentOptions.some((item) => item.startsWith('Работник · '))).toBe(true);
  expect(assignmentOptions.some((item) => item.startsWith('Наёмный работник · '))).toBe(true);
  expect(assignmentOptions.join(' ')).not.toContain('Старший наёмных работников');
  expect(assignmentOptions.join(' ')).not.toContain('Администратор');

  const workerOption = assignmentSelect.locator('option').filter({ hasText: /^Работник · / }).first();
  const assignmentValue = await workerOption.getAttribute('value');
  const assignmentLabel = (await workerOption.textContent())?.trim();
  if (!assignmentValue || !assignmentLabel) throw new Error('No operational worker assignment is available');
  await assignmentSelect.selectOption(assignmentValue);
  const departmentName = assignmentLabel.replace(/^Работник · /, '').trim();
  await page.getByLabel('Комментарий').fill('Проверка мобильного назначения');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('На рассмотрении', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-guest-request.png`), fullPage: true });

  const { context: reviewerContext, page: reviewerPage } = await openAdminReview(browser, page.viewportSize());
  const review = reviewerPage.locator('[data-testid="assignment-request-review"]');
  await expect(review).toBeVisible();
  const requestRow = review.locator('.admin-row').filter({ hasText: expectedName });
  await expect(requestRow).toBeVisible();
  await expect(requestRow).toContainText('Работник');
  await expect(requestRow).toContainText(departmentName);

  if (mobile) {
    await requestRow.getByRole('button', { name: 'Отклонить' }).click();
    await expect(reviewerPage.getByRole('heading', { name: new RegExp(`Отклонить заявку: ${expectedName}`) })).toBeVisible();
    await reviewerPage.getByLabel('Причина отклонения').fill('Для проверки выбрано другое подразделение');
    await reviewerPage.getByRole('button', { name: 'Отклонить заявку' }).click();
    await expect(requestRow).toHaveCount(0);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
    await expect(page.locator('.guest-request-status')).toContainText('Отклонено: Для проверки выбрано другое подразделение');
  } else {
    await requestRow.getByRole('button', { name: 'Принять' }).click();
    await expect(reviewerPage.getByRole('heading', { name: `Назначить: ${expectedName}` })).toBeVisible();
    await expect(reviewerPage.locator('.modal-card')).toContainText(`Будет назначена роль «Работник» в ${departmentName}.`);
    await reviewerPage.getByRole('button', { name: 'Принять заявку' }).click();
    await expect(requestRow).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toHaveCount(0, { timeout: 12_000 });
    await expect(page.locator('body')).toContainText('Смена', { timeout: 12_000 });
    await expect(page.locator('body')).toContainText('Объявления');
  }

  const adminFactoryId = await factory4Id('test-admin');
  const pending = await pendingAssignmentRequests(adminFactoryId);
  expect(pending.some((request) => request.requestedById === guestId)).toBe(false);
  await expect(reviewerPage.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET/);
  await noOverflow(reviewerPage);
  await noOverflow(page);
  await reviewerPage.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-admin-decision.png`), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-guest-result.png`), fullPage: true });
  await reviewerContext.close();
});
