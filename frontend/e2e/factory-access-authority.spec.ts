import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const backendUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const phone = '+79000009009';
const password = '1234';
const screenshotDir = path.resolve(__dirname, '../../.codex-runtime/factory-access-authority/screenshots');

type Session = {
  token: string;
  factoryA: { id: string; name: string };
  factoryB: { id: string; name: string };
};

async function login(): Promise<Session> {
  const response = await fetch(`${backendUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const body = await response.json();
  expect(response.status).toBe(201);
  const factoryA = body.availableFactories.find((factory: { code: string }) => factory.code === 'factory-4');
  const factoryB = body.availableFactories.find((factory: { code: string }) => factory.code === 'mobile-pilot-v1');
  expect(factoryA).toBeTruthy();
  expect(factoryB).toBeTruthy();
  return { token: body.token, factoryA, factoryB };
}

async function factoryStatus(session: Session, isActive: boolean) {
  const response = await fetch(`${backendUrl}/admin/factories/${session.factoryB.id}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      'x-factory-id': session.factoryA.id,
    },
    body: JSON.stringify({
      isActive,
      reason: isActive
        ? 'Factory authority browser proof: restore diagnostic factory'
        : 'Factory authority browser proof: deactivate diagnostic factory',
    }),
  });
  expect(response.status).toBe(200);
}

async function bootstrap(page: Page, session: Session, factoryId: string) {
  await page.goto('/');
  await page.evaluate(({ token, selectedFactoryId }) => {
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
    localStorage.removeItem('zavod.devUserId');
  }, { token: session.token, selectedFactoryId: factoryId });
  await page.reload();
}

async function openFactoryPicker(page: Page) {
  const desktopSettings = page.locator('.nav-settings-button');
  if (await desktopSettings.isVisible()) {
    await desktopSettings.click();
  } else {
    await page.locator('.mobile-more-button').click();
    await page.locator('.settings-entry').click();
  }
  await page.getByRole('button', { name: 'Сменить завод' }).click();
  await expect(page.getByRole('heading', { name: 'Выберите завод' })).toBeVisible();
}

async function selectFactory(page: Page, name: string) {
  const picker = page.getByTestId('factory-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.locator('.brand-name')).toHaveText(name);
}

test.describe('factory access authority', () => {
  test('switches normally and drops a deactivated stale factory context', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile-360-edge') await page.setViewportSize({ width: 390, height: 844 });
    const session = await login();
    await factoryStatus(session, true);

    try {
      await bootstrap(page, session, session.factoryA.id);
      await expect(page.locator('.brand-name')).toHaveText(session.factoryA.name);

      await openFactoryPicker(page);
      await selectFactory(page, session.factoryB.name);
      await openFactoryPicker(page);
      await selectFactory(page, session.factoryA.name);
      await openFactoryPicker(page);
      await selectFactory(page, session.factoryB.name);

      await expect(page.getByText('Онлайн', { exact: false }).first()).toBeVisible();
      await page.waitForTimeout(500);
      await factoryStatus(session, false);

      await expect(page.getByRole('heading', { name: 'Выберите завод' })).toBeVisible({ timeout: 10_000 });
      const picker = page.getByTestId('factory-picker');
      await expect(picker).toBeVisible();
      await expect(picker.getByText(session.factoryB.name, { exact: true })).toHaveCount(0);
      await expect(picker.getByText(session.factoryA.name, { exact: true })).toBeVisible();
      await expect(page.locator('.brand-name')).toHaveCount(0);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(/admin\.[a-z]|[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(bodyText).not.toContain('storagePath');
      expect(bodyText).not.toContain('passwordHash');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await page.screenshot({
        path: path.join(screenshotDir, `${testInfo.project.name}-inactive-factory-selector.png`),
        fullPage: true,
      });

      await factoryStatus(session, true);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Выберите завод' })).toBeVisible();
      await selectFactory(page, session.factoryB.name);
    } finally {
      await factoryStatus(session, true).catch(() => undefined);
    }
  });
});
