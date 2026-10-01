import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'pilot-fix-route-screenshots', 'plast1');
const pilotCredentials: Record<string, { phone: string; password: string }> = {
  'pilot-master-1': { phone: '+79000004720', password: '1234' },
  'pilot-pack-guest': { phone: '+79000009000', password: '1234' },
};

async function login(page: Page, userId: string) {
  const credentials = pilotCredentials[userId];
  if (!credentials) throw new Error(`pilot credentials are not configured for ${userId}`);
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error(`pilot login ${userId}: ${response.status}`);
  const login = await response.json();
  const accessToken = login.accessToken ?? login.token;
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? login.availableFactories?.[0];
  if (!accessToken || !factory?.id) throw new Error(`pilot token or factory-4 unavailable for ${userId}`);
  await page.goto('/');
  await page.evaluate(({ accessToken, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', accessToken);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
  }, { accessToken, nextFactoryId: factory.id });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function openScreen(page: Page, label: string) {
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true });
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

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));

test('PWA mobile primitives work at 360/390/430', async ({ page }, testInfo) => {
  await login(page, 'pilot-master-1');
  await expect(page.locator('.compact-status-label')).toContainText(/Онлайн · .+/);
  await expect(page.locator('.compact-status-label')).toContainText(/Мастер/);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await noOverflow(page);
  }

  await openScreen(page, 'Сообщить об ошибке');
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();
  const pickerInputs = page.locator('.attachment-picker input[type="file"]');
  await expect(pickerInputs).toHaveCount(4);
  await expect(pickerInputs.nth(0)).toHaveAttribute('accept', /image/);
  await expect(pickerInputs.nth(0)).toHaveAttribute('capture', 'environment');
  await expect(pickerInputs.nth(1)).toHaveAttribute('accept', /image/);
  await expect(pickerInputs.nth(2)).toHaveAttribute('accept', /video/);

  await page.evaluate(() => {
    const original = HTMLInputElement.prototype.click;
    Object.defineProperty(window, '__pickerClickCount', { value: 0, writable: true, configurable: true });
    HTMLInputElement.prototype.click = function patchedClick() {
      (window as unknown as { __pickerClickCount: number }).__pickerClickCount += 1;
      return original.call(this);
    };
  });
  await page.getByRole('button', { name: 'Добавить фото' }).click();
  expect(await page.evaluate(() => (window as unknown as { __pickerClickCount: number }).__pickerClickCount)).toBe(1);

  const file = { name: 'pilot-fix-plast1.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') };
  await pickerInputs.nth(1).setInputFiles(file);
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await pickerInputs.nth(1).setInputFiles(file);
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await page.setViewportSize({ width: 360, height: 820 });
  await expect(page.locator('.compact-status-label')).toContainText(/Онлайн · Мастер/);
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-report-picker.png`), fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(page.getByRole('heading', { name: 'Выйти из приложения?' })).toBeVisible();
  await page.getByRole('button', { name: 'Остаться' }).click();

  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-header.png`), fullPage: false });
});

test('Guest sees assignment status and error report without announcements or admin list', async ({ page }, testInfo) => {
  await login(page, 'pilot-pack-guest');
  await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Объявления', exact: true })).toHaveCount(0);
  await openScreen(page, 'Сообщить об ошибке');
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке' })).toBeVisible();
  await expect(page.getByText('Сообщения об ошибках', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET/);
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, `${testInfo.project.name}-guest-report.png`), fullPage: true });
});
