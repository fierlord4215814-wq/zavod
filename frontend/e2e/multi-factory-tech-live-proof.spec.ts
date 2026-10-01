import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type FactoryRef = { id: string; code?: string; name: string };
type Session = { token: string; userId: string; availableFactories: FactoryRef[] };
type ApiResult = { status: number; data: any };

const rootDir = path.resolve(__dirname, '..', '..');
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const fixtureScript = path.join(rootDir, 'backend', 'scripts', 'multi-factory-tech-live-proof-regression.js');
const evidenceDir = path.join(rootDir, 'docs', 'multi-factory-tech-live-proof-screenshots');
const runtimeDir = path.join(rootDir, '.codex-runtime', 'multi-factory-tech-live-proof');
const password = 'MfProof-1234';

const F = {
  A: 'mf-live-factory-a',
  B: 'mf-live-factory-b',
  C: 'mf-live-factory-c',
  D: 'mf-live-factory-d',
} as const;
const factoryNames = {
  [F.A]: 'МФ Сервис А',
  [F.B]: 'МФ Сервис Б',
  [F.C]: 'МФ Сервис В',
  [F.D]: 'МФ Сервис Г',
};
const users = {
  admin: { id: 'mf-live-admin', phone: '+79995550101' },
  tech: { id: 'mf-live-tech', phone: '+79995550102' },
};
const departmentId = 'mf-live-global-tech-department';
const protectedText = /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i;
const mojibakePattern = /Р[РЎ]|Ð|Ñ|â€|ï¿½/;

function runFixtureMode(mode: '--prepare-browser' | '--cleanup-browser') {
  return execFileSync(process.execPath, [fixtureScript, mode], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function screenshotPath(projectName: string, fileName: string) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, `${projectName}-${fileName}`);
}

function unwrap(value: any) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

async function login(actor: keyof typeof users): Promise<Session> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: users[actor].phone, password }),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 201 || !body?.token) throw new Error(`Не выполнен вход ${actor}: HTTP ${response.status}`);
  return {
    token: body.token,
    userId: body.userId,
    availableFactories: body.availableFactories ?? [],
  };
}

async function api(
  pathname: string,
  options: { method?: string; token: string; factoryId?: string; body?: unknown },
): Promise<ApiResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${options.token}` };
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data: unwrap(data) };
}

async function installBrowserGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__mfTechDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function bootstrap(page: Page, session: Session, factoryId: string) {
  await page.goto('/manifest.webmanifest', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, userId, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { token: session.token, userId: session.userId, selectedFactoryId: factoryId });
  await page.goto(`/?multiFactoryTech=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.brand-name')).toHaveText(factoryNames[factoryId as keyof typeof factoryNames], { timeout: 30_000 });
  await expect(page.getByText('Онлайн', { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function navigate(page: Page, screen: string, heading: string | RegExp) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await expect(page.getByRole('heading', { name: heading, exact: typeof heading === 'string' }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 30_000 });
}

async function openFactoryPicker(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  const settings = page.locator('.mobile-nav-sheet:visible');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Сменить завод', exact: true }).click();
  await expect(page.getByTestId('factory-picker')).toBeVisible();
}

async function selectFactory(page: Page, factoryId: keyof typeof factoryNames) {
  const picker = page.getByTestId('factory-picker');
  await picker.locator('.factory-picker-option').filter({ hasText: factoryNames[factoryId] }).click();
  await expect(page.locator('.brand-name')).toHaveText(factoryNames[factoryId], { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId'))).toBe(factoryId);
}

async function grantThroughAdminUi(page: Page, admin: Session, factoryId: typeof F.C | typeof F.D) {
  await bootstrap(page, admin, factoryId);
  await navigate(page, 'Admin', 'Администрирование');
  await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
  const panel = page.locator('.admin-setup-panel').filter({ hasText: 'Выдать доступ к выбранному заводу' }).first();
  await expect(panel).toBeVisible();
  const selects = panel.locator('select');
  await expect(selects.nth(0).locator(`option[value="${users.tech.id}"]`)).toHaveCount(1);
  await expect(selects.nth(1)).toBeDisabled();
  await expect(selects.nth(1)).toHaveValue(factoryId);
  await selects.nth(0).selectOption(users.tech.id);
  await selects.nth(2).selectOption('TECH_KIPIA');
  await selects.nth(3).selectOption(departmentId);
  const saved = page.waitForResponse((response) => (
    response.url().includes(`/admin/users/${users.tech.id}/factory-access`)
    && response.request().method() === 'POST'
  ));
  await panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(selects.nth(0).locator(`option[value="${users.tech.id}"]`)).toHaveCount(1);
}

async function expectSafeUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(protectedText);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(/TypeError|ReferenceError|Internal Server Error|Failed to fetch/i);
  const dialogs = await page.evaluate(() => (window as unknown as { __mfTechDialogs?: string[] }).__mfTechDialogs ?? []);
  expect(dialogs).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
  ));
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  runFixtureMode('--prepare-browser');
  await installBrowserGuards(page);
  await page.setViewportSize(testInfo.project.name.includes('mobile')
    ? { width: 390, height: 844 }
    : { width: 1440, height: 960 });
});

test.afterEach(async ({}, testInfo) => {
  const cleanupOutput = runFixtureMode('--cleanup-browser');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, `${testInfo.project.name}-cleanup.txt`), cleanupOutput, 'utf8');
});

test('Admin configures A/C/D and TECH proves remote task, navigation and live revoke without B access', async ({ page }, testInfo) => {
  const proof: Record<string, unknown> = { project: testInfo.project.name };
  let capturedError: unknown = null;

  try {
    const admin = await login('admin');
    expect(admin.availableFactories.map((factory) => factory.id).sort()).toEqual(Object.values(F).sort());

    await grantThroughAdminUi(page, admin, F.C);
    await page.screenshot({ path: screenshotPath(testInfo.project.name, '01-admin-grant-c.png'), fullPage: true });
    await grantThroughAdminUi(page, admin, F.D);
    await page.screenshot({ path: screenshotPath(testInfo.project.name, '02-admin-grant-d.png'), fullPage: true });

    const tech = await login('tech');
    const allowedIds = tech.availableFactories.map((factory) => factory.id).sort();
    expect(allowedIds).toEqual([F.A, F.C, F.D].sort());
    expect(allowedIds).not.toContain(F.B);
    proof.allowedFactories = allowedIds;

    await bootstrap(page, tech, F.A);
    await openFactoryPicker(page);
    const picker = page.getByTestId('factory-picker');
    await expect(picker).toContainText(factoryNames[F.A]);
    await expect(picker).toContainText(factoryNames[F.C]);
    await expect(picker).toContainText(factoryNames[F.D]);
    await expect(picker).not.toContainText(factoryNames[F.B]);
    await page.screenshot({ path: screenshotPath(testInfo.project.name, '03-tech-picker-a-c-d.png'), fullPage: true });
    await selectFactory(page, F.C);
    await openFactoryPicker(page);
    await selectFactory(page, F.D);
    await openFactoryPicker(page);
    await selectFactory(page, F.A);

    const urgentDescription = `Срочно проверить силовой шкаф ${Date.now()}`;
    const longDescription = `Плановая проверка автоматики ${Date.now()}`;
    const urgent = await api('/tasks', {
      method: 'POST', token: admin.token, factoryId: F.C,
      body: {
        operationId: `mf-live-ui-urgent-${Date.now()}`,
        description: urgentDescription,
        type: 'URGENT',
        departmentRecipientIds: [departmentId],
      },
    });
    expect(urgent.status).toBe(201);
    await expect(page.locator('.realtime-toast')).toContainText('Новая заявка', { timeout: 20_000 });

    const long = await api('/tasks', {
      method: 'POST', token: admin.token, factoryId: F.C,
      body: {
        operationId: `mf-live-ui-long-${Date.now()}`,
        description: longDescription,
        type: 'LONG',
        deadlineAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
        departmentRecipientIds: [departmentId],
      },
    });
    expect(long.status).toBe(201);

    await navigate(page, 'Notifications', 'Уведомления');
    const urgentCard = page.locator('.notification-card').filter({ hasText: urgentDescription });
    const longCard = page.locator('.notification-card').filter({ hasText: longDescription });
    await expect(urgentCard).toBeVisible();
    await expect(longCard).toBeVisible();
    await expect(urgentCard).toContainText(`Источник: ${factoryNames[F.C]}`);
    await expect(longCard).toContainText(`Источник: ${factoryNames[F.C]}`);
    await page.screenshot({ path: screenshotPath(testInfo.project.name, '04-remote-c-notifications-at-a.png'), fullPage: true });

    await urgentCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.brand-name')).toHaveText(factoryNames[F.C], { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Заявки', exact: true })).toBeVisible();
    await expect(page.getByText(urgentDescription, { exact: false }).first()).toBeVisible();

    await openFactoryPicker(page);
    await selectFactory(page, F.A);
    await page.goto(`/?notificationFactory=${encodeURIComponent(F.B)}&notificationRoute=tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.brand-name')).toHaveText(factoryNames[F.A], { timeout: 30_000 });
    await expect(page.locator('.realtime-toast')).toContainText(/Нет доступа|больше не действует/, { timeout: 20_000 });
    await expect.poll(() => new URL(page.url()).search).toBe('');

    const browserAuthRefresh = page.waitForResponse((response) => (
      response.url().endsWith('/auth/me') && response.request().headers()['x-factory-id'] === F.A
    ));
    const revoke = await api(`/admin/users/${users.tech.id}/factory-access`, {
      method: 'PATCH', token: admin.token, factoryId: F.C,
      body: { factoryId: F.C, isActive: false, reason: 'Проверка live-отзыва межзаводского доступа' },
    });
    expect(revoke.status).toBe(200);
    expect((await browserAuthRefresh).status()).toBe(200);

    await openFactoryPicker(page);
    const pickerAfterRevoke = page.getByTestId('factory-picker');
    await expect(pickerAfterRevoke).toContainText(factoryNames[F.A]);
    await expect(pickerAfterRevoke).toContainText(factoryNames[F.D]);
    await expect(pickerAfterRevoke).not.toContainText(factoryNames[F.C]);
    await expect(pickerAfterRevoke).not.toContainText(factoryNames[F.B]);
    await page.screenshot({ path: screenshotPath(testInfo.project.name, '05-live-revoke-c-picker.png'), fullPage: true });

    const [cDenied, dAllowed, bDenied] = await Promise.all([
      api('/tasks', { token: tech.token, factoryId: F.C }),
      api('/tasks', { token: tech.token, factoryId: F.D }),
      api('/tasks', { token: tech.token, factoryId: F.B }),
    ]);
    expect(cDenied.status).toBe(403);
    expect(dAllowed.status).toBe(200);
    expect(bDenied.status).toBe(403);
    proof.afterRevoke = { C: cDenied.status, D: dAllowed.status, B: bDenied.status };

    await expectNoHorizontalOverflow(page);
    await expectSafeUi(page);
  } catch (error) {
    capturedError = error;
  } finally {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, `${testInfo.project.name}-browser-result.json`), JSON.stringify({
      createdAt: new Date().toISOString(),
      ...proof,
      error: capturedError instanceof Error ? capturedError.message : capturedError ? String(capturedError) : null,
    }, null, 2), 'utf8');
  }

  if (capturedError) throw capturedError;
});
