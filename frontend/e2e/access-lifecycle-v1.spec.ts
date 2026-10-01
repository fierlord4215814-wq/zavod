import { Browser, expect, Page, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'v1-access-lifecycle-screenshots');

const ADMIN = 'pilot-pack-admin';
const TARGET = 'pilot-pack-guest-master-target';
const MASTER_SOURCE = 'pilot-pack-master-source';
const PILOT_PASSWORD = '1234';
const PILOT_PHONES: Record<string, string> = {
  [ADMIN]: '+79000009009',
  [TARGET]: '+79000009023',
  [MASTER_SOURCE]: '+79000009014',
};
const authSessions = new Map<string, { token: string; availableFactories: Array<{ id: string; code?: string }> }>();

const MASTER_VISIBLE = [
  'Смена',
  'Люди',
  'Линии',
  'Заявки',
  'Мойка',
  'ОКК',
  'Заказы / Остатки',
  'Чек-листы',
  'Оттайка',
  'Пересменка / Журнал',
  'Чаты',
  'Объявления',
  'Архив',
  'Уведомления',
  'Сообщить об ошибке',
];

const MASTER_FORBIDDEN = ['Админка', 'Статистика / Аудит'];

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
};

type ApiResponse = {
  status: number;
  data: any;
};

function runPilotPack() {
  const command = process.platform === 'win32'
    ? 'npm.cmd run pilot-pack:v1 --workspace backend'
    : 'npm run pilot-pack:v1 --workspace backend';
  const output = execSync(command, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  authSessions.clear();
  return parsePilotPackOutput(output);
}

function parsePilotPackOutput(output: string) {
  const marker = output.indexOf('{\n  "ok"');
  const compactMarker = output.indexOf('{"ok"');
  const start = marker >= 0 ? marker : compactMarker;
  if (start < 0) throw new Error(`pilot-pack:v1 output did not contain JSON: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(start));
}

async function api(pathname: string, options: ApiOptions = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers.Authorization = `Bearer ${(await sessionFor(options.userId ?? ADMIN)).token}`;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function sessionFor(userId: string) {
  const existing = authSessions.get(userId);
  if (existing) return existing;
  const phone = PILOT_PHONES[userId];
  if (!phone) throw new Error(`Pilot phone is not configured for ${userId}`);
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: PILOT_PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) {
    throw new Error(`Bearer login failed for ${userId} (${response.status})`);
  }
  const session = {
    token: data.token as string,
    availableFactories: (data.availableFactories ?? []) as Array<{ id: string; code?: string }>,
  };
  authSessions.set(userId, session);
  return session;
}

async function expectApiStatus(name: string, expected: number | number[], responsePromise: Promise<ApiResponse>) {
  const response = await responsePromise;
  const allowed = Array.isArray(expected) ? expected : [expected];
  expect(allowed, `${name}: ${JSON.stringify(response.data)}`).toContain(response.status);
  return response;
}

async function resolveFactoryId() {
  const login = await sessionFor(ADMIN);
  const factory = login.availableFactories.find((item) => item.code === 'factory-4');
  expect(factory?.id).toBeTruthy();
  return factory.id as string;
}

async function fixtureIds(factoryId: string) {
  const pack = runPilotPack();
  const target = pack.users?.find((item: { userId: string }) => item.userId === TARGET);
  const masterSource = pack.users?.find((item: { userId: string }) => item.userId === MASTER_SOURCE);
  expect(target?.userId).toBe(TARGET);
  expect(masterSource?.jobTitleId).toBeTruthy();
  const masterMe = await api('/auth/me', { userId: MASTER_SOURCE, factoryId });
  expect(masterMe.status).toBe(200);
  expect(masterMe.data?.departmentId).toBeTruthy();
  return {
    factoryId,
    masterDepartmentId: masterMe.data.departmentId as string,
    masterTitleId: masterSource.jobTitleId as string,
  };
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__accessLifecycleDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __accessLifecycleDialogs?: string[] }).__accessLifecycleDialogs ?? []);
  expect(calls).toEqual([]);
}

async function createLoggedInPage(browser: Browser, label: string, viewport: { width: number; height: number }, isMobile: boolean, factoryId: string) {
  const auth = await sessionFor(TARGET);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();
  await installDialogGuards(page);
  await page.goto(frontendUrl);
  await page.evaluate(({ authToken, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
    localStorage.setItem('zavod.authToken', authToken);
  }, { authToken: auth.token, selectedFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('body').waitFor({ state: 'visible' });
  return { context, page, label };
}

async function refresh(page: Page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('body').waitFor({ state: 'visible' });
}

async function openMore(page: Page) {
  const more = page.getByRole('button', { name: /^Ещё$/ }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(page.locator('.mobile-nav-sheet')).toBeVisible();
  }
}

async function visibleMenuText(page: Page) {
  await openMore(page);
  const labels = await page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible, .mobile-nav-sheet button:visible')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
  return labels.join('\n');
}

async function expectMasterMenu(page: Page) {
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  const text = await visibleMenuText(page);
  for (const label of MASTER_VISIBLE) expect(text, `Expected menu item ${label}`).toContain(label);
  for (const label of MASTER_FORBIDDEN) expect(text, `Forbidden menu item ${label}`).not.toContain(label);
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function expectNoFactoryAccess(page: Page) {
  await expect(page.getByRole('heading', { name: 'Доступ ещё не назначен' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Обратитесь к мастеру, руководителю или администратору.');
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible')).toHaveCount(0);
  const storage = await page.evaluate(() => ({
    factoryId: localStorage.getItem('zavod.selectedFactoryId'),
    token: localStorage.getItem('zavod.authToken'),
  }));
  expect(storage.token).toBeTruthy();
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function selectFactoryIfPickerShown(page: Page) {
  const factoryButton = page.locator('.factory-card')
    .filter({ hasText: /Завод 4|factory-4/ })
    .getByRole('button', { name: 'Выбрать завод' })
    .first();
  if (await factoryButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await factoryButton.click();
    await page.locator('body').waitFor({ state: 'visible' });
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function screenshot(page: Page, name: string) {
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

async function promoteTarget(factoryId: string) {
  await expectApiStatus('promote target to master', 201, api(`/admin/users/${TARGET}/permission-copy-apply`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId, reason: 'access lifecycle browser: promote target' },
  }));
}

async function blockTarget(factoryId: string, blocked: boolean) {
  await expectApiStatus(blocked ? 'block target' : 'unblock target', 200, api(`/admin/users/${TARGET}/block-status`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: { blocked, reason: blocked ? 'access lifecycle browser: block target' : 'access lifecycle browser: unblock target' },
  }));
}

async function restoreFactoryAccess(factoryId: string, masterDepartmentId: string, masterTitleId: string) {
  await expectApiStatus('restore target factory access', 200, api(`/admin/users/${TARGET}/factory-access`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      isActive: true,
      role: 'MASTER',
      departmentId: masterDepartmentId,
      jobTitleId: masterTitleId,
      reason: 'access lifecycle browser: restore access',
    },
  }));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  runPilotPack();
});

test.afterAll(() => {
  runPilotPack();
});

test('open sessions refresh safely after block, unblock and factory access revoke', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'This spec opens its own desktop and mobile contexts.');

  const factoryId = await resolveFactoryId();
  const ids = await fixtureIds(factoryId);
  await promoteTarget(factoryId);

  const sessions = [
    await createLoggedInPage(browser, 'desktop', { width: 1366, height: 900 }, false, factoryId),
    await createLoggedInPage(browser, 'mobile-360', { width: 360, height: 800 }, true, factoryId),
    await createLoggedInPage(browser, 'mobile-390', { width: 390, height: 844 }, true, factoryId),
    await createLoggedInPage(browser, 'mobile-430', { width: 430, height: 932 }, true, factoryId),
  ];

  try {
    for (const session of sessions) await expectMasterMenu(session.page);
    await screenshot(sessions[0].page, '01-desktop-master-before-block.png');
    await screenshot(sessions[1].page, '02-mobile-360-master-before-block.png');

    await blockTarget(factoryId, true);
    for (const session of sessions) {
      await refresh(session.page);
      await expectNoFactoryAccess(session.page);
    }
    await screenshot(sessions[0].page, '03-desktop-blocked-no-factories.png');
    await screenshot(sessions[1].page, '04-mobile-360-blocked-no-factories.png');
    await expectApiStatus('blocked session direct chats forbidden', 403, api('/chats', { userId: TARGET, factoryId }));
    await expectApiStatus('blocked session direct notifications forbidden', 403, api('/notifications/unread-count', { userId: TARGET, factoryId }));
    const blockedMe = await expectApiStatus('blocked auth-me has no factories', 200, api('/auth/me', { userId: TARGET, factoryId }));
    expect(blockedMe.data.isGuest).toBe(true);
    expect(blockedMe.data.availableFactories).toEqual([]);

    await blockTarget(factoryId, false);
    for (const session of sessions) {
      await refresh(session.page);
      await selectFactoryIfPickerShown(session.page);
      await expectMasterMenu(session.page);
    }
    await screenshot(sessions[0].page, '05-desktop-after-unblock.png');

    await expectApiStatus('revoke target factory access', 200, api(`/admin/users/${TARGET}/factory-access`, {
      method: 'PATCH',
      userId: ADMIN,
      factoryId,
      body: { factoryId, isActive: false, reason: 'access lifecycle browser: revoke factory access' },
    }));
    for (const session of sessions) {
      await refresh(session.page);
      await expectNoFactoryAccess(session.page);
    }
    await screenshot(sessions[1].page, '06-mobile-360-after-factory-revoke.png');
    await expectApiStatus('revoked factory direct shift forbidden', 403, api('/shift/current', { userId: TARGET, factoryId }));
    await expectApiStatus('revoked factory direct chats forbidden', 403, api('/chats', { userId: TARGET, factoryId }));

    await restoreFactoryAccess(factoryId, ids.masterDepartmentId, ids.masterTitleId);
    for (const session of sessions) {
      await refresh(session.page);
      await selectFactoryIfPickerShown(session.page);
      await expectMasterMenu(session.page);
    }
    await screenshot(sessions[2].page, '07-mobile-390-restored.png');
    await screenshot(sessions[3].page, '08-mobile-430-restored.png');
  } finally {
    await restoreFactoryAccess(factoryId, ids.masterDepartmentId, ids.masterTitleId).catch(() => undefined);
    runPilotPack();
    for (const session of sessions) await session.context.close();
  }
});
