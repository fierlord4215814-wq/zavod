import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__notificationDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
    Object.defineProperty(window, 'Notification', {
      value: class MockNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        title: string;
        onclick: (() => void) | null = null;
        constructor(title: string) { this.title = title; }
      },
      configurable: true,
    });
    Object.defineProperty(navigator, 'vibrate', {
      value: () => true,
      configurable: true,
    });
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Forbidden browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __notificationDialogs?: string[] }).__notificationDialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAs(page: Page) {
  await installDialogGuards(page);
  await page.goto('/');
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+79000004701', password: '1234' }),
  });
  const session = await response.json().catch(() => null);
  const factory = session?.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4') ?? session?.availableFactories?.[0];
  if (response.status !== 201 || !session?.token || !factory?.id) throw new Error(`Pilot WORKER login failed (${response.status})`);
  await page.evaluate(({ nextFactoryId, nextToken }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', 'pilot-worker-1');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.setItem('zavod.authToken', nextToken);
  }, { nextFactoryId: factory.id, nextToken: session.token });
  await page.reload();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible')).toBeVisible({ timeout: 15_000 });
}

async function openNotifications(page: Page) {
  const direct = page.getByRole('button', { name: /Уведомления/ }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    return;
  }
  await page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: /Уведомления/ }).filter({ visible: true }).first().click();
}

test('notification controls are readable and safe on desktop and mobile widths', async ({ page }, testInfo) => {
  await loginAs(page);
  await openNotifications(page);
  await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки уведомлений' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByText('Уведомления устройства')).toBeVisible();
  await expect(page.getByRole('button', { name: /Звук:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Вибрация:/ })).toBeVisible();

  await page.getByRole('button', { name: /Звук:/ }).click();
  await page.getByRole('button', { name: /Вибрация:/ }).click();
  const signalButton = page.getByRole('button', { name: /Проверить сигнал/ }).first();
  if (await signalButton.isEnabled()) await signalButton.click();

  const pushButton = page.getByRole('button', { name: /Включить на устройстве|Отключить на устройстве/ }).first();
  await expect(pushButton).toBeVisible();
  await expectNoDialogs(page);
  await expectNoOverflow(page);

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/storagePath|passwordHash|DATABASE_URL|VAPID_PRIVATE_KEY|token|secret/i);
  expect(body).not.toMatch(/push-subscription|camelCase|undefined|null/i);

  if (testInfo.project.name.includes('mobile')) {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      await expectNoOverflow(page);
      await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible();
    }
  }
});
