import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const pilotPhones: Record<string, string> = {
  'pilot-pack-admin': '+79000009009',
  'pilot-tech-kipia-1': '+79000004750',
  'pilot-master-1': '+79000004720',
  'pilot-worker-1': '+79000004701',
};
const sessions = new Map<string, any>();

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers.Authorization = `Bearer ${(await sessionFor(options.userId ?? 'pilot-pack-admin')).token}`;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return data as any;
}

async function sessionFor(userId: string) {
  const existing = sessions.get(userId);
  if (existing) return existing;
  const phone = pilotPhones[userId];
  if (!phone) throw new Error(`Pilot phone is not configured for ${userId}`);
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: '1234' }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Bearer login failed for ${userId} (${response.status})`);
  sessions.set(userId, data);
  return data;
}

async function ensurePilotPack() {
  const response = await sessionFor('pilot-pack-admin');
  if (response?.userId !== 'pilot-pack-admin') throw new Error('pilot-pack-admin is unavailable');
  return response.recommendedFactoryId ?? response.availableFactories?.find((item: any) => item.code === 'factory-4')?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__prepilotDialogs', { value: calls, configurable: true });
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
    throw new Error(`Forbidden browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __prepilotDialogs?: string[] }).__prepilotDialogs ?? []);
  expect(calls).toEqual([]);
}

async function loginAs(page: Page, userId: string) {
  await installDialogGuards(page);
  await page.goto('/');
  const session = await sessionFor(userId);
  const factory = session.availableFactories?.find((item: any) => item.code === 'factory-4') ?? session.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 is unavailable for ${userId}`);
  await page.evaluate(({ nextUserId, nextFactoryId, nextToken }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.setItem('zavod.authToken', nextToken);
  }, { nextUserId: userId, nextFactoryId: factory.id, nextToken: session.token });
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible')).toBeVisible({ timeout: 15_000 });
}

async function notificationBadgeValue(page: Page) {
  const badge = page.locator('.topbar-notification-badge').first();
  if (!(await badge.count())) return 0;
  const raw = (await badge.innerText().catch(() => '')).trim();
  const value = Number(raw.replace(/\D/g, ''));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function expectNoTechnicalLeak(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function openNotifications(page: Page) {
  const direct = page.getByRole('button', { name: /Уведомления/ }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  if ((await more.count()) > 0) await more.first().click();
  await page.getByRole('button', { name: /Уведомления/ }).filter({ visible: true }).first().click();
}

test.beforeAll(async () => {
  await ensurePilotPack();
});

test('desktop: notifications are delivered to intended roles without refresh', async ({ browser }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop evidence is covered here; mobile fit is covered by pilot-pack smoke.');
  const factoryId = await ensurePilotPack();
  if (!factoryId) throw new Error('factory-4 id is unavailable');

  const kipiaMe = await api('/auth/me', { userId: 'pilot-tech-kipia-1', factoryId });
  const kipiaDepartmentId = kipiaMe.departmentId;
  if (!kipiaDepartmentId) throw new Error('pilot KIPiA department is unavailable');

  for (const userId of ['pilot-tech-kipia-1', 'pilot-master-1', 'pilot-worker-1']) {
    await api('/notifications/read-all', { method: 'POST', userId, factoryId, body: {} });
  }

  const kipiaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const masterContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const workerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const kipia = await kipiaContext.newPage();
  const master = await masterContext.newPage();
  const worker = await workerContext.newPage();

  try {
    await loginAs(kipia, 'pilot-tech-kipia-1');
    await loginAs(master, 'pilot-master-1');
    await loginAs(worker, 'pilot-worker-1');
    await expect.poll(() => notificationBadgeValue(kipia), { timeout: 3000 }).toBe(0);
    await expect.poll(() => notificationBadgeValue(master), { timeout: 3000 }).toBe(0);
    await expect.poll(() => notificationBadgeValue(worker), { timeout: 3000 }).toBe(0);

    const suffix = Date.now();
    const task = await api('/tasks', {
      method: 'POST',
      userId: 'pilot-master-1',
      factoryId,
      body: {
        operationId: `stage-prepilot-realtime-task-${suffix}`,
        type: 'LONG',
        description: `STAGE_PREPILOT_REALTIME: заявка ${suffix}`,
        departmentRecipientIds: [kipiaDepartmentId],
        assigneeUserIds: ['pilot-tech-kipia-1'],
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    await expect.poll(() => notificationBadgeValue(kipia), {
      timeout: 16_000,
      intervals: [1000, 2000, 3000],
    }).toBeGreaterThan(0);
    await expect.poll(() => notificationBadgeValue(worker), {
      timeout: 5000,
      intervals: [1000, 1000],
    }).toBe(0);

    await openNotifications(kipia);
    await expect(kipia.locator('body')).toContainText('STAGE_PREPILOT_REALTIME', { timeout: 10_000 });
    await kipia.getByRole('button', { name: 'Настройки уведомлений' }).click();
    const soundButton = kipia.getByRole('button', { name: /Звук:/ }).first();
    await expect(soundButton).toBeVisible();
    await soundButton.click();
    const testSignal = kipia.getByRole('button', { name: /Проверить сигнал/ }).first();
    if (await testSignal.isEnabled()) await testSignal.click();

    await api('/notifications/read-all', { method: 'POST', userId: 'pilot-master-1', factoryId, body: {} });
    await api(`/tasks/${task.id}/take`, {
      method: 'POST',
      userId: 'pilot-tech-kipia-1',
      factoryId,
      body: { operationId: `stage-prepilot-realtime-take-${suffix}` },
    });
    await api(`/tasks/${task.id}/complete`, {
      method: 'POST',
      userId: 'pilot-tech-kipia-1',
      factoryId,
      body: { operationId: `stage-prepilot-realtime-done-${suffix}`, comment: 'STAGE_PREPILOT_REALTIME: выполнено' },
    });

    await expect.poll(() => notificationBadgeValue(master), {
      timeout: 16_000,
      intervals: [1000, 2000, 3000],
    }).toBeGreaterThan(0);
    await openNotifications(master);
    await expect(master.locator('body')).toContainText('STAGE_PREPILOT_REALTIME', { timeout: 10_000 });

    for (const page of [kipia, master, worker]) {
      await expectNoTechnicalLeak(page);
      await expectNoHorizontalOverflow(page);
      await expectNoDialogs(page);
    }
  } finally {
    await kipiaContext.close();
    await masterContext.close();
    await workerContext.close();
  }
});
