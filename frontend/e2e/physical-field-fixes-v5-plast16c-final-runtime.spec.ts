import { expect, test } from '@playwright/test';

const baseUrl = (process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const password = '1234';
const forbiddenPayload = /passwordHash|storagePath|DATABASE_URL|accessToken|refreshToken|JWT_SECRET/i;
const localTarget = /^https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)|^ws:\/\//i;

test('P16C final runtime is read-only, same-origin and physical-ready', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const localNetworkTargets: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (pending) => failedRequests.push(`${pending.url()} ${pending.failure()?.errorText ?? ''}`));
  page.on('request', (pending) => {
    if (baseUrl.startsWith('https://') && localTarget.test(pending.url())) localNetworkTargets.push(pending.url());
  });

  const health = await request.get(`${baseUrl}/api/health`);
  const manifest = await request.get(`${baseUrl}/manifest.webmanifest`);
  const serviceWorker = await request.get(`${baseUrl}/sw.js`);
  const offline = await request.get(`${baseUrl}/offline.html`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', service: 'zavod-backend' });
  expect(manifest.status()).toBe(200);
  expect(serviceWorker.status()).toBe(200);
  expect(offline.status()).toBe(200);

  const loginResponse = await request.post(`${baseUrl}/api/auth/login`, {
    data: { phone: '+79000009009', password },
  });
  expect(loginResponse.status()).toBe(201);
  const login = await loginResponse.json();
  const factory = login.availableFactories.find((item: any) => item.code === 'factory-4' || item.name === 'Завод 4');
  expect(factory).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${login.token}`,
    'x-user-id': login.userId,
    'x-factory-id': factory.id,
  };

  const routes = [
    '/api/auth/me',
    '/api/shift/current',
    '/api/lines',
    '/api/tasks',
    '/api/checklists/workspace',
    '/api/archive/sections',
    '/api/archive/items?section=tasks&page=1&pageSize=1',
    '/api/ops/operations/overview',
    '/api/ops/audit?limit=1',
    '/api/ops/module-summary',
  ];
  for (const route of routes) {
    const response = await request.get(`${baseUrl}${route}`, { headers });
    expect(response.status(), route).toBe(200);
    const contentType = response.headers()['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      expect(JSON.stringify(await response.json()), route).not.toMatch(forbiddenPayload);
    }
  }

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const xlsx = await request.get(`${baseUrl}/api/archive/export/xlsx`, {
    headers,
    params: { section: 'tasks', search: '__P16C_NO_ROWS__', dateFrom: day, dateTo: day },
  });
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-phone').fill('+79000009009');
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const factoryButton = page.getByRole('button', { name: /Завод 4/ }).first();
  await expect(factoryButton).toBeVisible({ timeout: 10_000 });
  await factoryButton.click();
  await expect(page.getByText(/Онлайн · Администратор/).first()).toBeVisible({ timeout: 20_000 });
  const statisticsButton = page.getByRole('button', { name: 'Статистика / Аудит', exact: true });
  if (!(await statisticsButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  }
  await expect(statisticsButton).toBeVisible();
  await statisticsButton.click();
  await expect(page.getByRole('heading', { name: 'Статистика / Аудит' })).toBeVisible();

  const runtime = await page.evaluate(async ({ token, factoryId }) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const websocket = await new Promise<string>((resolve) => {
      const socket = new WebSocket(
        `${protocol}//${location.host}/ws?factoryId=${encodeURIComponent(factoryId)}`,
        ['zavod-v1', `auth.${token}`],
      );
      const timer = window.setTimeout(() => { socket.close(); resolve('TIMEOUT'); }, 12_000);
      socket.onopen = () => { window.clearTimeout(timer); socket.close(); resolve('PASS'); };
      socket.onerror = () => { window.clearTimeout(timer); resolve('ERROR'); };
    });
    let serviceWorkerState = 'UNAVAILABLE';
    if ('serviceWorker' in navigator) {
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 12_000)),
        ]);
        serviceWorkerState = 'READY';
      } catch {
        serviceWorkerState = 'TIMEOUT';
      }
    }
    return {
      websocket,
      secureContext: window.isSecureContext,
      serviceWorker: serviceWorkerState,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, { token: login.token, factoryId: factory.id });

  expect(runtime.websocket).toBe('PASS');
  expect(runtime.secureContext).toBe(true);
  expect(runtime.serviceWorker).toBe('READY');
  expect(runtime.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(localNetworkTargets).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);

  console.log(JSON.stringify({
    status: 'PASS',
    origin: baseUrl,
    routeCount: routes.length,
    websocket: runtime.websocket,
    secureContext: runtime.secureContext,
    serviceWorker: runtime.serviceWorker,
    horizontalOverflow: runtime.horizontalOverflow,
    consoleErrors: consoleErrors.length,
    failedRequests: failedRequests.length,
    localNetworkTargets: localNetworkTargets.length,
  }));
});
