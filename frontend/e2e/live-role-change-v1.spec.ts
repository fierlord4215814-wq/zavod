import { Browser, expect, Page, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'v1-live-role-change-screenshots');

const ADMIN = 'pilot-pack-admin';
const MANAGEMENT = 'pilot-pack-management';
const GUEST_TO_MASTER = 'pilot-pack-guest-master-target';
const SENIOR_MASTER = 'pilot-pack-senior-master';
const MASTER_SOURCE = 'pilot-pack-master-source';
const MASTER_REFERENCE = 'pilot-master-1';
const GUEST_TARGET_FOR_DELEGATION = 'pilot-pack-guest-test-target';

const PILOT_PASSWORD = '1234';
const PILOT_PHONES: Record<string, string> = {
  [ADMIN]: '+79000009009',
  [MANAGEMENT]: '+79000009008',
  [GUEST_TO_MASTER]: '+79000009023',
  [SENIOR_MASTER]: '+79000009004',
  [MASTER_SOURCE]: '+79000009014',
  [MASTER_REFERENCE]: '+79000004720',
  [GUEST_TARGET_FOR_DELEGATION]: '+79000009025',
};
const sessions = new Map<string, { token: string; availableFactories: Array<{ id: string; code?: string }> }>();

const GUEST_ALLOWED = ['Сообщить об ошибке'];
const ORDINARY_MASTER_VISIBLE = [
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
const DELEGATING_MASTER_VISIBLE = [...ORDINARY_MASTER_VISIBLE, 'Админка'];
const MASTER_FORBIDDEN = ['Статистика / Аудит'];
const GUEST_FORBIDDEN = [
  'Смена',
  'Люди',
  'Админка',
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
  'Статистика / Аудит',
];

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
  sessions.clear();
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
  const existing = sessions.get(userId);
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
  sessions.set(userId, session);
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
  const masterUser = pack.users?.find((item: { userId: string }) => item.userId === MASTER_REFERENCE);
  const seniorUser = pack.users?.find((item: { userId: string }) => item.userId === SENIOR_MASTER);
  expect(masterUser?.jobTitleId).toBeTruthy();
  expect(seniorUser?.jobTitleId).toBeTruthy();
  const masterAccess = await api(`/auth/me`, { userId: MASTER_REFERENCE, factoryId });
  expect(masterAccess.status).toBe(200);
  return {
    masterTitleId: masterUser.jobTitleId as string,
    seniorTitleId: seniorUser.jobTitleId as string,
    masterDepartmentId: masterAccess.data.departmentId as string | undefined,
  };
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__liveRoleDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __liveRoleDialogs?: string[] }).__liveRoleDialogs ?? []);
  expect(calls).toEqual([]);
}

async function waitForAppReady(page: Page) {
  await expect(page.locator('body')).toContainText(/Завод|Вы вошли как Гость|Сообщить об ошибке|Объявления|Смена|Линии|Люди/, { timeout: 15_000 });
}

async function createLoggedInPage(browser: Browser, userId: string, factoryId: string, viewport: { width: number; height: number }, isMobile: boolean) {
  const session = await sessionFor(userId);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();
  await installDialogGuards(page);
  await page.goto(frontendUrl);
  await page.evaluate(({ authToken, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.setItem('zavod.authToken', authToken);
  }, { authToken: session.token, nextFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAppReady(page);
  return { context, page };
}

async function refreshSession(page: Page) {
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAppReady(page);
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

async function expectMenu(page: Page, expected: string[], forbidden: string[]) {
  const text = await visibleMenuText(page);
  for (const label of expected) expect(text, `Expected menu item ${label}`).toContain(label);
  for (const label of forbidden) expect(text, `Forbidden menu item ${label}`).not.toContain(label);
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function openScreen(page: Page, label: string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible, .mobile-nav-sheet button:visible')
    .filter({ hasText: label })
    .first();
  if ((await direct.count()) === 0) await openMore(page);
  const button = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible, .mobile-nav-sheet button:visible')
    .filter({ hasText: label })
    .first();
  await expect(button, `Open screen ${label}`).toBeVisible();
  await button.click();
  await page.waitForTimeout(250);
}

async function promoteGuestToMaster(factoryId: string) {
  await expectApiStatus('promote guest to master', 201, api(`/admin/users/${GUEST_TO_MASTER}/permission-copy-apply`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: {
      sourceUserId: MASTER_SOURCE,
      factoryId,
      reason: 'live role-change e2e: guest to master',
    },
  }));
}

async function demoteSeniorToMaster(factoryId: string, masterDepartmentId: string, masterTitleId: string) {
  await expectApiStatus('demote senior master to ordinary master', 200, api(`/admin/users/${SENIOR_MASTER}/factory-access`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      role: 'MASTER',
      departmentId: masterDepartmentId,
      jobTitleId: masterTitleId,
      reason: 'live role-change e2e: senior master to master',
    },
  }));
}

async function demoteTargetToGuest(factoryId: string) {
  await expectApiStatus('demote target to guest', 201, api(`/admin/users/${GUEST_TO_MASTER}/factory-access`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      role: 'OTHER',
      departmentId: null,
      jobTitleId: null,
      isGuest: true,
      reason: 'live role-change e2e: master to guest',
    },
  }));
}

async function expectGuestApis(factoryId: string) {
  const me = await expectApiStatus('guest /auth/me', 200, api('/auth/me', { userId: GUEST_TO_MASTER, factoryId }));
  expect(me.data.isGuest).toBe(true);
  expect(me.data.role).toBe('OTHER');
  await expectApiStatus('guest shift forbidden', 403, api('/shift/current', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('guest lines forbidden', 403, api('/lines', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('guest chats forbidden', 403, api('/chats', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('guest notifications forbidden', 403, api('/notifications/unread-count', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('guest announcements forbidden', 403, api('/announcements/current', { userId: GUEST_TO_MASTER, factoryId }));
}

async function expectMasterApis(factoryId: string) {
  const me = await expectApiStatus('master /auth/me', 200, api('/auth/me', { userId: GUEST_TO_MASTER, factoryId }));
  expect(me.data.isGuest).toBe(false);
  expect(me.data.role).toBe('MASTER');
  await expectApiStatus('master shift allowed', 200, api('/shift/current', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('master lines allowed', 200, api('/lines', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('master tasks allowed', 200, api('/tasks/board', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('master wash allowed', 200, api('/wash', { userId: GUEST_TO_MASTER, factoryId }));
  const chats = await expectApiStatus('master chats allowed', 200, api('/chats', { userId: GUEST_TO_MASTER, factoryId }));
  expect(Array.isArray(chats.data)).toBe(true);
  expect(chats.data.length).toBeGreaterThan(0);
  await expectApiStatus('master notifications allowed', 200, api('/notifications/unread-count', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('master ops overview forbidden', 403, api('/ops/overview', { userId: GUEST_TO_MASTER, factoryId }));
  await expectApiStatus('master ops audit forbidden', 403, api('/ops/audit', { userId: GUEST_TO_MASTER, factoryId }));
}

async function expectSeniorDelegationAllowed(factoryId: string) {
  await expectApiStatus('senior master can preview ordinary master delegation before demotion', 201, api(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
}

async function expectSeniorDelegationRemoved(factoryId: string) {
  await expectApiStatus('ordinary master cannot preview equal master delegation after demotion', 403, api(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
  await expectApiStatus('demoted master still reads shift', 200, api('/shift/current', { userId: SENIOR_MASTER, factoryId }));
  await expectApiStatus('demoted master ops audit forbidden', 403, api('/ops/audit', { userId: SENIOR_MASTER, factoryId }));
}

async function checkAudit(factoryId: string) {
  const delegated = await expectApiStatus('management reads delegated audit after role changes', 200, api('/ops/audit?action=ADMIN_USER_PERMISSION_DELEGATED&limit=50&includeDiagnostics=true', { userId: MANAGEMENT, factoryId }));
  const factoryGranted = await expectApiStatus('management reads factory grant audit after role changes', 200, api('/ops/audit?action=FACTORY_ACCESS_GRANTED&limit=50&includeDiagnostics=true', { userId: MANAGEMENT, factoryId }));
  const roleChanged = await expectApiStatus('management reads factory role audit after role changes', 200, api('/ops/audit?action=USER_FACTORY_ROLE_CHANGED&limit=50&includeDiagnostics=true', { userId: MANAGEMENT, factoryId }));
  const text = JSON.stringify({ delegated: delegated.data, factoryGranted: factoryGranted.data, roleChanged: roleChanged.data });
  expect(text).toContain('ADMIN_USER_PERMISSION_DELEGATED');
  expect(text).toMatch(/FACTORY_ACCESS_GRANTED|USER_FACTORY_ROLE_CHANGED/);
  expect(text).not.toMatch(/passwordHash|DATABASE_URL|storagePath|accessToken|refreshToken/i);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  runPilotPack();
});

test.afterAll(() => {
  runPilotPack();
});

test.describe('v1 live role change audit', () => {
  test('open sessions react to guest/master/senior-master role changes after refresh/auth-me reload', async ({ browser }, testInfo) => {
    const isMobile = testInfo.project.name.includes('mobile');
    const viewport = isMobile ? { width: 360, height: 820 } : { width: 1280, height: 900 };
    const factoryId = await resolveFactoryId();
    const ids = await fixtureIds(factoryId);
    expect(ids.masterDepartmentId).toBeTruthy();

    const target = await createLoggedInPage(browser, GUEST_TO_MASTER, factoryId, viewport, isMobile);
    const admin = await createLoggedInPage(browser, ADMIN, factoryId, viewport, isMobile);
    const senior = await createLoggedInPage(browser, SENIOR_MASTER, factoryId, viewport, isMobile);

    try {
      await expectMenu(target.page, GUEST_ALLOWED, GUEST_FORBIDDEN);
      await expectGuestApis(factoryId);
      await target.page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-guest-before.png`), fullPage: true });

      await expectMenu(admin.page, ['Админка', 'Статистика / Аудит'], []);
      await promoteGuestToMaster(factoryId);
      await refreshSession(target.page);
      await expectMenu(target.page, ORDINARY_MASTER_VISIBLE, ['Админка', ...MASTER_FORBIDDEN]);
      await expectMasterApis(factoryId);
      await openScreen(target.page, 'Чаты');
      await expect(target.page.locator('body')).toContainText('Чаты');
      await openScreen(target.page, 'Смена');
      await expect(target.page.locator('body')).toContainText('Смена');
      await target.page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-master-after-promotion.png`), fullPage: true });

      await expectMenu(senior.page, DELEGATING_MASTER_VISIBLE, MASTER_FORBIDDEN);
      await expectSeniorDelegationAllowed(factoryId);
      await demoteSeniorToMaster(factoryId, ids.masterDepartmentId!, ids.masterTitleId);
      await refreshSession(senior.page);
      await expectMenu(senior.page, DELEGATING_MASTER_VISIBLE, MASTER_FORBIDDEN);
      await expectSeniorDelegationRemoved(factoryId);
      await senior.page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-senior-demoted.png`), fullPage: true });

      await demoteTargetToGuest(factoryId);
      await refreshSession(target.page);
      await expectMenu(target.page, GUEST_ALLOWED, GUEST_FORBIDDEN);
      await expectGuestApis(factoryId);
      await target.page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-guest-after-demotion.png`), fullPage: true });

      await checkAudit(factoryId);
      await expectNoDialogs(target.page);
      await expectNoDialogs(admin.page);
      await expectNoDialogs(senior.page);
    } finally {
      await target.context.close();
      await admin.context.close();
      await senior.context.close();
      runPilotPack();
    }
  });
});
