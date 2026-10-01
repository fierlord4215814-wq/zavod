import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Actor = 'admin' | 'management' | 'master' | 'technologist' | 'techKipia' | 'techHolod' | 'worker';
type FactoryRef = { id: string; code?: string; name: string };
type Session = { token: string; userId: string; availableFactories: FactoryRef[] };
type ApiResult = { status: number; data: any };

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast17b');
const runtimeResultPath = path.join(rootDir, '.codex-runtime', 'p17b-browser-result.json');
const password = '1234';
const actors: Record<Actor, { userId: string; phone: string }> = {
  admin: { userId: 'pilot-pack-admin', phone: '+79000009009' },
  management: { userId: 'pilot-pack-management', phone: '+79000009008' },
  master: { userId: 'pilot-pack-senior-master', phone: '+79000009004' },
  technologist: { userId: 'mobile-technolog', phone: '+79000009102' },
  techKipia: { userId: 'pilot-pack-kipia-lead', phone: '+79000009005' },
  techHolod: { userId: 'mobile-tech-holod', phone: '+79000009106' },
  worker: { userId: 'pilot-pack-worker-source', phone: '+79000009012' },
};
const sessions = new Map<Actor, Session>();
const forbiddenPublicText = /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i;
const mojibakePattern = /Р[РЎ]|Ð|Ñ|â€|ï¿½/;

function screenshotPath(fileName: string) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, fileName);
}

function unwrap(value: any) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

async function sessionFor(actor: Actor) {
  const cached = sessions.get(actor);
  if (cached) return cached;
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: actors[actor].phone, password }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Не выполнен целевой вход ${actor}: HTTP ${response.status}`);
  const session = {
    token: data.token as string,
    userId: data.userId as string,
    availableFactories: (data.availableFactories ?? []) as FactoryRef[],
  };
  sessions.set(actor, session);
  return session;
}

function factoryByCode(session: Session, code: string) {
  const factory = session.availableFactories.find((item) => item.code === code);
  if (!factory) throw new Error(`Завод ${code} недоступен тестовому актору.`);
  return factory;
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

async function installGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__p17bDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function loginUi(page: Page, actor: Actor, factoryId?: string) {
  const session = await sessionFor(actor);
  const selectedFactory = factoryId ?? factoryByCode(session, 'factory-4').id;
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, userId, selectedFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', selectedFactoryId);
  }, { token: session.token, userId: session.userId, selectedFactoryId: selectedFactory });
  await page.goto(`${frontendUrl}/?p17b=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  return { session, factoryId: selectedFactory };
}

async function navigate(page: Page, screen: string, heading: string | RegExp) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await expect(page.getByRole('heading', { name: heading, exact: typeof heading === 'string' }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(4);
}

async function checkMobileWidths(page: Page) {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 430, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function expectSafeUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(forbiddenPublicText);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(/TypeError|ReferenceError|Internal Server Error|Failed to fetch/i);
  const dialogs = await page.evaluate(() => (window as unknown as { __p17bDialogs?: string[] }).__p17bDialogs ?? []);
  expect(dialogs).toEqual([]);
}

async function mobileMenuText(page: Page) {
  const more = page.getByRole('button', { name: /^Ещё$/ }).filter({ visible: true }).first();
  await expect(more).toBeVisible();
  await more.click();
  const sheet = page.locator('.mobile-nav-sheet:visible');
  await expect(sheet).toBeVisible();
  const text = await sheet.innerText();
  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(sheet).toBeHidden();
  return text;
}

async function openFactorySettings(page: Page) {
  await page.getByRole('button', { name: /^Ещё$/ }).filter({ visible: true }).first().click();
  const sheet = page.locator('.mobile-nav-sheet:visible');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Настройки', exact: true }).click();
  await sheet.getByRole('button', { name: 'Сменить завод', exact: true }).click();
}

async function selectFactory(page: Page, factory: FactoryRef) {
  let picker = page.getByTestId('factory-picker');
  if (!await picker.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByRole('button', { name: 'Выбрать завод', exact: true }).click();
    picker = page.getByTestId('factory-picker');
  }
  await expect(picker).toBeVisible();
  await picker.getByRole('button').filter({ hasText: factory.name }).first().click();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId'))).toBe(factory.id);
}

test.beforeEach(async ({ page }) => {
  await installGuards(page);
});

test('P17B desktop: marker identity persists across Admin, People, Shift, Chats and Audit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Canonical identity proof runs once on desktop.');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });

  const runId = Date.now();
  const marker = `__PFFV5_P17B_${runId}__`;
  const markerPhone = `+7998${String(runId).slice(-7)}`;
  const markerPassword = 'P17b-1234';
  let markerUserId = '';
  let factoryA: FactoryRef | null = null;
  let factoryB: FactoryRef | null = null;
  let capturedError: unknown = null;
  const cleanup: Record<string, number | boolean | null> = { blocked: null, accessDeactivated: null, loginDenied: null };
  const proof: Record<string, unknown> = { marker, markerPhoneMasked: `${markerPhone.slice(0, 5)}***${markerPhone.slice(-2)}` };

  try {
    await page.route('**/auth/register', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const body = request.postDataJSON() as Record<string, unknown>;
      await route.continue({
        headers: { ...request.headers(), 'content-type': 'application/json' },
        postData: JSON.stringify({ ...body, operationId: marker }),
      });
    });
    await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await page.locator('#register-phone').fill(markerPhone);
    await page.locator('#register-password').fill(markerPassword);
    await page.locator('#register-password-repeat').fill(markerPassword);
    const registrationResponse = page.waitForResponse((response) => response.url().endsWith('/auth/register') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
    const registered = await registrationResponse;
    expect(registered.status()).toBe(201);
    const registrationData = await registered.json();
    markerUserId = registrationData.userId;
    expect(markerUserId).toBeTruthy();
    proof.markerUserId = markerUserId;

    const admin = await sessionFor('admin');
    factoryA = factoryByCode(admin, 'factory-4');
    factoryB = factoryByCode(admin, 'mobile-pilot-v1');
    await loginUi(page, 'admin', factoryA.id);
    await navigate(page, 'Admin', 'Администрирование');
    await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();

    const accessPanel = page.locator('.admin-setup-panel').filter({ hasText: 'Выдать доступ к выбранному заводу' }).first();
    await expect(accessPanel).toBeVisible();
    const accessSelects = accessPanel.locator('select');
    await expect(accessSelects.nth(0).locator(`option[value="${markerUserId}"]`)).toHaveCount(1);
    await accessSelects.nth(0).selectOption(markerUserId);
    await accessSelects.nth(2).selectOption('WORKER');
    const departmentValue = await accessSelects.nth(3).locator('option').evaluateAll((options) => (
      options.map((option) => (option as HTMLOptionElement).value).find(Boolean) ?? ''
    ));
    if (departmentValue) await accessSelects.nth(3).selectOption(departmentValue);
    const accessResponse = page.waitForResponse((response) => response.url().includes(`/admin/users/${markerUserId}/factory-access`) && response.request().method() === 'POST');
    await accessPanel.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
    expect((await accessResponse).status()).toBe(201);

    const usersSection = page.locator('section.admin-card').filter({ has: page.getByRole('heading', { name: 'Пользователи с доступом', exact: true }) }).first();
    const userSearch = usersSection.getByPlaceholder('Поиск по пользователю, роли или отделу');
    await userSearch.fill(markerUserId);
    await expect(usersSection.getByRole('button', { name: 'Профиль', exact: true })).toHaveCount(1);
    await usersSection.getByRole('button', { name: 'Профиль', exact: true }).click();
    const identity = page.getByTestId('admin-user-identity');
    await expect(identity).toBeVisible();
    await identity.getByLabel('Фамилия', { exact: true }).fill('Проверочный');
    await identity.getByLabel('Имя', { exact: true }).fill('Иван');
    await identity.getByLabel('Отчество', { exact: true }).fill('Сергеевич');
    let identityResponse = page.waitForResponse((response) => response.url().includes(`/admin/users/${markerUserId}/identity`) && response.request().method() === 'PATCH');
    await identity.getByRole('button', { name: 'Сохранить ФИО', exact: true }).click();
    expect((await identityResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: /Профиль пользователя: Проверочный Иван Сергеевич/ })).toBeVisible();
    await expect(identity.getByRole('button', { name: 'Сохранить ФИО', exact: true })).toBeEnabled();
    await identity.getByLabel('Фамилия', { exact: true }).fill('Проверочный-2');
    identityResponse = page.waitForResponse((response) => response.url().includes(`/admin/users/${markerUserId}/identity`) && response.request().method() === 'PATCH');
    await identity.getByRole('button', { name: 'Сохранить ФИО', exact: true }).click();
    expect((await identityResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: /Профиль пользователя: Проверочный-2 Иван Сергеевич/ })).toBeVisible();

    const nameSearch = await api('/directory/users?q=%D0%9F%D1%80&page=1&limit=20', { token: admin.token, factoryId: factoryA.id });
    const phoneFragment = markerPhone.slice(-4);
    const phoneSearch = await api(`/directory/users?q=${phoneFragment}&page=1&limit=20`, { token: admin.token, factoryId: factoryA.id });
    const foreignSearch = await api('/directory/users?q=%D0%9F%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BE%D1%87%D0%BD%D1%8B%D0%B9-2&page=1&limit=20', { token: admin.token, factoryId: factoryB.id });
    expect(nameSearch.status).toBe(200);
    expect(nameSearch.data.items.some((item: any) => item.userId === markerUserId)).toBe(true);
    expect(phoneSearch.status).toBe(200);
    expect(phoneSearch.data.items.some((item: any) => item.userId === markerUserId)).toBe(true);
    expect(foreignSearch.status).toBe(200);
    expect(foreignSearch.data.items.some((item: any) => item.userId === markerUserId)).toBe(false);
    proof.directory = { name: nameSearch.status, phone: phoneSearch.status, foreignFactoryAbsent: true };

    await navigate(page, 'People', 'Люди');
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const peopleSearch = page.locator('#people-search-people_directory');
    await peopleSearch.fill('Проверочный-2');
    const peopleResult = page.locator('.people-search-result-card').filter({ hasText: 'Проверочный-2 Иван Сергеевич' }).first();
    await expect(peopleResult).toBeVisible({ timeout: 20_000 });
    await peopleResult.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    const profileDialog = page.getByRole('dialog').filter({ hasText: 'Карточка сотрудника' }).first();
    await expect(profileDialog).toContainText('Проверочный-2 И. С.');
    await page.screenshot({ path: screenshotPath('01-canonical-marker-identity.png'), fullPage: false });
    await profileDialog.getByRole('button', { name: 'Закрыть окно', exact: true }).click();

    await navigate(page, 'Shift', 'Смена');
    await page.getByRole('button', { name: /Люди на смене/ }).click();
    await page.getByRole('button', { name: 'Выбрать из неотмеченных', exact: true }).click();
    const assignmentDialog = page.getByRole('dialog', { name: 'Найти сотрудника' });
    await assignmentDialog.locator('#people-search-assignment').fill('Проверочный-2');
    await expect(assignmentDialog.locator('.people-search-result-card').filter({ hasText: 'Проверочный-2 Иван Сергеевич' })).toBeVisible({ timeout: 20_000 });
    await assignmentDialog.getByRole('button', { name: 'Вернуться к назначениям', exact: true }).click();

    await navigate(page, 'Chats', 'Чаты');
    await page.getByRole('button', { name: 'Личный чат', exact: true }).filter({ visible: true }).first().click();
    const directDialog = page.getByRole('dialog').filter({ hasText: 'Личный чат' }).first();
    await directDialog.getByLabel('Фамилия, имя или телефон', { exact: true }).fill('Проверочный-2');
    await expect(directDialog.locator('.compact-person-choice').filter({ hasText: 'Проверочный-2 И. С.' })).toBeVisible({ timeout: 20_000 });
    await directDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    const audit = await api('/ops/audit?search=%D0%9F%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BE%D1%87%D0%BD%D1%8B%D0%B9-2&limit=50', { token: admin.token, factoryId: factoryA.id });
    expect(audit.status).toBe(200);
    expect((audit.data as any[]).some((row) => row.entityName === 'Проверочный-2 Иван Сергеевич')).toBe(true);
    proof.consumers = ['Admin', 'People', 'Profile', 'Shift assignment search', 'Chat people search', 'Audit'];
    proof.audit = audit.status;
    await expectSafeUi(page);
  } catch (error) {
    capturedError = error;
  } finally {
    if (markerUserId) {
      const admin = await sessionFor('admin');
      factoryA = factoryA ?? factoryByCode(admin, 'factory-4');
      const blocked = await api(`/admin/users/${markerUserId}/block-status`, {
        method: 'PATCH', token: admin.token, factoryId: factoryA.id, body: { blocked: true, reason: marker },
      });
      cleanup.blocked = blocked.status;
      const deactivated = await api(`/admin/users/${markerUserId}/factory-access`, {
        method: 'PATCH', token: admin.token, factoryId: factoryA.id, body: { factoryId: factoryA.id, isActive: false, reason: marker },
      });
      cleanup.accessDeactivated = deactivated.status;
      const deniedLogin = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: markerPhone, password: markerPassword }),
      });
      cleanup.loginDenied = deniedLogin.status !== 201;
    }
    fs.mkdirSync(path.dirname(runtimeResultPath), { recursive: true });
    fs.writeFileSync(runtimeResultPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      marker,
      markerUserId,
      markerPhone,
      factoryA: factoryA ? { id: factoryA.id, code: factoryA.code, name: factoryA.name } : null,
      factoryB: factoryB ? { id: factoryB.id, code: factoryB.code, name: factoryB.name } : null,
      proof,
      cleanup,
      physicalDeletes: 0,
      passed: !capturedError && cleanup.blocked === 200 && cleanup.accessDeactivated === 200 && cleanup.loginDenied === true,
      error: capturedError instanceof Error ? capturedError.message : capturedError ? String(capturedError) : null,
    }, null, 2)}\n`, 'utf8');
  }

  expect(cleanup.blocked).toBe(200);
  expect(cleanup.accessDeactivated).toBe(200);
  expect(cleanup.loginDenied).toBe(true);
  if (capturedError) throw capturedError;
});

test('P17B mobile 390 with 360/430 smoke: capability screens, limited Admin and live factory switch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360-edge', 'Mobile proof runs once in the touch project.');
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const requestedPaths: string[] = [];
  const responseStatuses: Array<{ path: string; status: number }> = [];
  const runtimeErrors: string[] = [];
  page.on('request', (request) => requestedPaths.push(new URL(request.url()).pathname));
  page.on('response', (response) => responseStatuses.push({ path: new URL(response.url()).pathname, status: response.status() }));
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await loginUi(page, 'techKipia');
  requestedPaths.length = 0;
  await navigate(page, 'Situation', 'Линии');
  await expect.poll(() => requestedPaths.some((item) => item.endsWith('/lines'))).toBe(true);
  await page.waitForTimeout(500);
  expect(requestedPaths.some((item) => item.endsWith('/wash'))).toBe(false);
  await expect(page.locator('.line-card, .empty-state').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Нет доступа|Не удалось загрузить линии/);
  await page.screenshot({ path: screenshotPath('02-tech-situation-mobile-390.png'), fullPage: false });
  await checkMobileWidths(page);
  const techMenu = await mobileMenuText(page);
  expect(techMenu).not.toContain('Оттайка');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Defrost' } })));
  await expect(page.getByRole('heading', { name: 'Линии', exact: true })).toBeVisible();

  await loginUi(page, 'techHolod');
  expect(await mobileMenuText(page)).toContain('Оттайка');
  await navigate(page, 'Defrost', 'Оттайка');
  await expect(page.locator('.defrost-screen, .screen-panel').first()).toBeVisible();

  await loginUi(page, 'worker');
  await navigate(page, 'Returns', 'Возвраты на производство');
  await expect(page.getByRole('button', { name: 'Опубликовать возврат', exact: true })).toHaveCount(0);
  await expect(page.locator('.returns-publication-list')).toBeVisible();
  await page.screenshot({ path: screenshotPath('03-returns-readonly-mobile-390.png'), fullPage: false });
  await checkMobileWidths(page);

  await loginUi(page, 'technologist');
  responseStatuses.length = 0;
  await navigate(page, 'Wash', 'Мойка');
  await expect.poll(() => responseStatuses.some((item) => item.path.endsWith('/wash') && item.status === 200)).toBe(true);
  await expect(page.locator('.wash-screen, .screen-panel').first()).toBeVisible();
  await page.screenshot({ path: screenshotPath('04-technologist-wash-mobile-390.png'), fullPage: false });
  await checkMobileWidths(page);

  await loginUi(page, 'master');
  requestedPaths.length = 0;
  await navigate(page, 'Admin', 'Администрирование');
  await expect(page.getByTestId('scoped-admin-control-plane')).toBeVisible({ timeout: 30_000 });
  expect(requestedPaths.some((item) => item.endsWith('/admin/overview'))).toBe(false);
  await expect(page.getByText('Пользователи и доступы своего отдела')).toBeVisible();
  await page.screenshot({ path: screenshotPath('05-limited-master-admin-mobile-390.png'), fullPage: false });
  await checkMobileWidths(page);
  const masterMenu = await mobileMenuText(page);
  expect(masterMenu).not.toContain('Статистика / Аудит');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Ops' } })));
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();

  const admin = await sessionFor('admin');
  const factoryA = factoryByCode(admin, 'factory-4');
  const factoryB = factoryByCode(admin, 'mobile-pilot-v1');
  const linesA = await api('/lines', { token: admin.token, factoryId: factoryA.id });
  const linesB = await api('/lines', { token: admin.token, factoryId: factoryB.id });
  expect(linesA.status).toBe(200);
  expect(linesB.status).toBe(200);
  const namesB = new Set((linesB.data as any[]).map((item) => item.name));
  const aOnlyName = (linesA.data as any[]).map((item) => item.name).find((name) => !namesB.has(name)) ?? '';
  const namesA = new Set((linesA.data as any[]).map((item) => item.name));
  const bOnlyName = (linesB.data as any[]).map((item) => item.name).find((name) => !namesA.has(name)) ?? '';

  await loginUi(page, 'admin', factoryA.id);
  await page.evaluate(() => {
    sessionStorage.setItem('zavod.session.filter.p17b', 'factory-a-line');
    sessionStorage.setItem('zavod.pending.p17b', 'factory-a-request');
    sessionStorage.setItem('zavod.chat.returnState', 'factory-a-chat');
  });
  await openFactorySettings(page);
  requestedPaths.length = 0;
  await selectFactory(page, factoryB);
  const staleAfterB = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('zavod.session.') || key.startsWith('zavod.pending') || key === 'zavod.chat.returnState'));
  expect(staleAfterB).toEqual([]);
  await navigate(page, 'Situation', 'Линии');
  await expect.poll(() => requestedPaths.some((item) => item.endsWith('/lines'))).toBe(true);
  if (aOnlyName) await expect(page.locator('body')).not.toContainText(aOnlyName);
  await page.screenshot({ path: screenshotPath('06-factory-a-to-b-mobile-390.png'), fullPage: false });
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => {
    sessionStorage.setItem('zavod.session.filter.p17b', 'factory-b-line');
    sessionStorage.setItem('zavod.pending.p17b', 'factory-b-request');
    sessionStorage.setItem('zavod.chat.returnState', 'factory-b-chat');
  });
  await openFactorySettings(page);
  requestedPaths.length = 0;
  await selectFactory(page, factoryA);
  const staleAfterA = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('zavod.session.') || key.startsWith('zavod.pending') || key === 'zavod.chat.returnState'));
  expect(staleAfterA).toEqual([]);
  await navigate(page, 'Situation', 'Линии');
  await expect.poll(() => requestedPaths.some((item) => item.endsWith('/lines'))).toBe(true);
  if (bOnlyName) await expect(page.locator('body')).not.toContainText(bOnlyName);
  await checkMobileWidths(page);
  await expectSafeUi(page);
  expect(runtimeErrors.filter((item) => /TypeError|ReferenceError|Internal Server Error/i.test(item))).toEqual([]);
});
