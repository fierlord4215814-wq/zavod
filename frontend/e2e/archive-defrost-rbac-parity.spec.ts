import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Session = {
  token: string;
  userId: string;
  availableFactories: Array<{ id: string; code?: string; name: string }>;
};

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(process.cwd(), '..', '.codex-runtime', 'f05-browser');
const password = '1234';
const actors = {
  denied: { phone: '+79000009005' },
  allowed: { phone: '+79000009106' },
};
const sessions = new Map<keyof typeof actors, Session>();
const forbiddenTechnicalText = /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey|defrost\.read/i;
const mojibake = /Р[РЎ]|Ð|Ñ|â€|ï¿½/;

async function sessionFor(actor: keyof typeof actors) {
  const cached = sessions.get(actor);
  if (cached) return cached;
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: actors[actor].phone, password }),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 201 || !body?.token) throw new Error(`Не выполнен вход ${actor}: HTTP ${response.status}`);
  const session = body as Session;
  sessions.set(actor, session);
  return session;
}

async function login(page: Page, actor: keyof typeof actors) {
  const session = await sessionFor(actor);
  const factory = session.availableFactories.find((item) => item.code === 'factory-4');
  if (!factory) throw new Error(`Завод 4 недоступен актору ${actor}.`);
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, userId, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { token: session.token, userId: session.userId, factoryId: factory.id });
  await page.goto(`${frontendUrl}/?f05=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  return { session, factoryId: factory.id };
}

async function openArchive(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Archive' } }));
  });
  await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible({ timeout: 30_000 });
}

async function expectSafeLayout(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    text: document.body.innerText,
  }));
  expect(metrics.scroll - metrics.viewport).toBeLessThanOrEqual(4);
  expect(metrics.text).not.toMatch(forbiddenTechnicalText);
  expect(metrics.text).not.toMatch(mojibake);
  expect(metrics.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'desktop-edge'
    ? { width: 1440, height: 960 }
    : { width: 390, height: 844 });
});

test('F-05 denied actor keeps Archive but cannot see or fetch Defrost history', async ({ page }, testInfo) => {
  const { session, factoryId } = await login(page, 'denied');
  await openArchive(page);

  await expect(page.locator('[data-archive-category="tasks"]')).toBeVisible();
  await expect(page.locator('[data-archive-category="defrost"]')).toHaveCount(0);

  const staleAttempt = await page.evaluate(async ({ endpoint, token, selectedFactoryId }) => {
    const response = await fetch(`${endpoint}/archive/items?section=defrost`, {
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': selectedFactoryId },
    });
    return { status: response.status, body: await response.text() };
  }, { endpoint: apiUrl, token: session.token, selectedFactoryId: factoryId });
  expect(staleAttempt.status).toBe(403);
  expect(staleAttempt.body).toContain('У вас нет доступа к этому архиву');
  expect(staleAttempt.body).not.toMatch(forbiddenTechnicalText);

  await expectSafeLayout(page);
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, `${testInfo.project.name}-denied.png`), fullPage: true });
});

test('F-05 authorized actor sees and opens Defrost Archive history', async ({ page }, testInfo) => {
  await login(page, 'allowed');
  await openArchive(page);

  const defrost = page.locator('[data-archive-category="defrost"]');
  await expect(defrost).toBeVisible();
  await defrost.click();
  await expect(page.getByRole('heading', { name: 'Оттайка', exact: true })).toBeVisible();
  const list = page.locator('[data-archive-record-list]');
  await expect(list).toBeVisible();
  await expect(list.locator('.archive-record-row').first()).toBeVisible();
  await list.locator('.archive-record-open').first().click();
  await expect(page.locator('.archive-detail-sheet:visible')).toBeVisible();

  await expectSafeLayout(page);
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, `${testInfo.project.name}-allowed.png`), fullPage: true });
});
