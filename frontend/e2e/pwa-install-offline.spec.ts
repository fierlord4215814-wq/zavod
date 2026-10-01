import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

async function api(pathname: string, options: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveAdminSession() {
  const login = await api('/auth/login', { method: 'POST', body: { phone: '+79000009009', password: '1234' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  const factoryId = factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
  if (!factoryId || !login.token) throw new Error('Pilot ADMIN session is unavailable for PWA smoke.');
  return { factoryId, token: login.token };
}

async function loginAsAdmin(page: Page, factoryId: string, token: string) {
  await page.goto(`${frontendUrl}/?pwaLogin=${Date.now()}`);
  await page.evaluate(({ nextFactoryId, nextToken }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'pilot-pack-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.setItem('zavod.authToken', nextToken);
  }, { nextFactoryId: factoryId, nextToken: token });
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

test('desktop: PWA manifest, service worker, update and offline fallback are usable', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop smoke only.');
  await page.goto(frontendUrl);
  await expect(page.getByRole('heading', { name: 'Завод' }).first()).toBeVisible();

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const response = await fetch(link?.href ?? '/manifest.webmanifest');
    return response.json();
  });
  expect(manifest.name).toBe('Завод');
  expect(manifest.short_name).toBe('Завод');
  expect(manifest.display).toMatch(/standalone|fullscreen/);
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(JSON.stringify(manifest)).not.toMatch(/localhost|storagePath|passwordHash|accessToken|refreshToken/i);
  expect(manifest.icons.some((icon: { sizes?: string; type?: string }) => icon.sizes === '192x192' && icon.type === 'image/png')).toBeTruthy();
  expect(manifest.icons.some((icon: { sizes?: string; purpose?: string }) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBeTruthy();

  await expect.poll(async () => page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration('/')))).toBeTruthy();
  const cacheKeys = await page.evaluate(async () => caches.keys());
  expect(cacheKeys.some((key) => key.startsWith('zavod-shell-v6'))).toBeTruthy();

  const { factoryId, token } = await resolveAdminSession();
  await loginAsAdmin(page, factoryId, token);
  await page.evaluate(() => {
    const worker = { postMessage: (message: unknown) => { (window as unknown as { __pwaUpdateMessage?: unknown }).__pwaUpdateMessage = message; } };
    window.dispatchEvent(new CustomEvent('zavod:pwa-update', { detail: { worker } }));
  });
  await expect(page.getByText('Доступна новая версия')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/Завод|Нет связи|Сервер недоступен/);
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
});

test('mobile 360/390/430: standalone-like shell keeps session, menu and offline message readable', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile smoke only.');
  const { factoryId, token } = await resolveAdminSession();

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await loginAsAdmin(page, factoryId, token);
    await expect(page.locator('.mobile-quick-nav')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ещё' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Ещё' }).click();
    await expect(page.getByRole('heading', { name: 'Ещё', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Закрыть' }).click();

    await context.setOffline(true);
    await expect(page.locator('.pwa-status-banner.warning')).toContainText(/Нет связи|Офлайн/);
    await expectNoHorizontalOverflow(page);
    await context.setOffline(false);
  }
});
