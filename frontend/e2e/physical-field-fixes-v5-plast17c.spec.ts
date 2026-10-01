import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Actor = 'admin' | 'management' | 'guest';
type FactoryRef = { id: string; code?: string; name: string };
type Session = { token: string; userId: string; availableFactories: FactoryRef[] };
type ApiResult = { status: number; data: any };

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast17c');
const runtimeDir = path.join(rootDir, '.codex-runtime');
const password = '1234';
const actors: Record<Actor, { userId: string; phone: string }> = {
  admin: { userId: 'pilot-pack-admin', phone: '+79000009009' },
  management: { userId: 'pilot-pack-management', phone: '+79000009008' },
  guest: { userId: 'pilot-pack-guest', phone: '+79000009000' },
};
const sessions = new Map<Actor, Session>();
const forbiddenPublicText = /storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i;
const mojibakePattern = /Р[РЎ]|Ð|Ñ|â€|ï¿½/;

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

function factory4(session: Session) {
  const factory = session.availableFactories.find((item) => item.code === 'factory-4');
  if (!factory) throw new Error('Завод 4 недоступен целевому актору.');
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
    Object.defineProperty(window, '__p17cDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function installWsCounter(page: Page) {
  await page.addInitScript(() => {
    const attempts: string[] = [];
    Object.defineProperty(window, '__p17cWsAttempts', { value: attempts, configurable: true });
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        attempts.push(String(args[0] ?? ''));
        return Reflect.construct(target, args);
      },
    });
  });
}

async function loginUi(page: Page, actor: Actor) {
  const session = await sessionFor(actor);
  const factory = factory4(session);
  await page.goto(`${frontendUrl}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, userId, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, { token: session.token, userId: session.userId, factoryId: factory.id });
  await page.goto(`${frontendUrl}/?p17c=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  if (actor === 'guest') {
    await expect(page.getByTestId('guest-home-screen')).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible({ timeout: 30_000 });
  }
  return { session, factory };
}

async function navigate(page: Page, screen: string, heading: string) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await expect(page.getByRole('heading', { name: heading, exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(4);
}

async function expectSafeUi(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(forbiddenPublicText);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(/TypeError|ReferenceError|Internal Server Error|Failed to fetch/i);
  const dialogs = await page.evaluate(() => (window as unknown as { __p17cDialogs?: string[] }).__p17cDialogs ?? []);
  expect(dialogs).toEqual([]);
}

function isApiResponse(response: Awaited<ReturnType<Page['waitForResponse']>>, pathname: string) {
  const actualPath = new URL(response.url()).pathname;
  return (actualPath === pathname || actualPath === `/api${pathname}`)
    && response.request().method() === 'GET'
    && response.status() === 200;
}

function writeResult(projectName: string, result: Record<string, unknown>) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, `p17c-browser-${projectName}.json`),
    `${JSON.stringify({ createdAt: new Date().toISOString(), projectName, ...result }, null, 2)}\n`,
    'utf8',
  );
}

test.beforeEach(async ({ page }) => {
  await installGuards(page);
});

test('P17C desktop cross-client canonical refetch for OKK, Wash and Defrost', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Cross-client mutations run once on desktop.');
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 960 });

  const runId = Date.now();
  const marker = `__PFFV5_P17C_BROWSER_${runId}__`;
  const admin = await sessionFor('admin');
  const factory = factory4(admin);
  const proof: Record<string, unknown> = {};
  const cleanup: Record<string, boolean | number> = {
    okkArchived: true,
    washCompleted: true,
    defrostCompleted: true,
    tempBlocked: true,
    tempAccessDeactivated: true,
    physicalDeletes: 0,
  };
  let okkId = '';
  let washId = '';
  let defrostId = '';
  let defrostLineId = '';
  let tempUserId = '';
  let tempToken = '';
  let capturedError: unknown = null;
  const snapshots = {
    okk: [] as any[][],
    wash: [] as any[][],
    defrost: [] as any[][],
  };
  page.on('response', async (response) => {
    try {
      const target = isApiResponse(response, '/okk')
        ? snapshots.okk
        : isApiResponse(response, '/wash')
          ? snapshots.wash
          : isApiResponse(response, '/defrost/lines')
            ? snapshots.defrost
            : null;
      if (!target) return;
      const data = unwrap(await response.json());
      if (Array.isArray(data)) target.push(data);
    } catch {
      // Only successful JSON read-model snapshots are evidence for this test.
    }
  });

  try {
    await loginUi(page, 'management');
    const tempPhone = `+7997${String(runId).slice(-7)}`;
    const registrationResponse = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: tempPhone, password, passwordRepeat: password, operationId: `${marker}:register` }),
    });
    const registration = await registrationResponse.json().catch(() => null);
    expect(registrationResponse.status).toBe(201);
    tempUserId = registration.userId;
    tempToken = registration.token;
    const granted = await api(`/admin/users/${tempUserId}/factory-access`, {
      method: 'POST', token: admin.token, factoryId: factory.id,
      body: { factoryId: factory.id, role: 'MASTER', departmentId: null, companyId: null, isGuest: false, reason: marker },
    });
    expect(granted.status).toBe(201);
    cleanup.tempBlocked = false;
    cleanup.tempAccessDeactivated = false;

    await navigate(page, 'OKK', 'ОКК');
    const lines = await api('/lines', { token: admin.token, factoryId: factory.id });
    expect(lines.status).toBe(200);
    const line = (lines.data as any[]).find((item) => !/pilot|stage|regression|test/i.test(`${item.id} ${item.name}`));
    if (!line) throw new Error('Нет runtime-линии для browser OKK evidence.');
    const okkBeforeCreate = snapshots.okk.length;
    const createdOkk = await api('/okk', {
      method: 'POST', token: admin.token, factoryId: factory.id,
      body: { lineId: line.id, assignedMasterId: 'pilot-pack-senior-master', description: `Контроль связи ОКК ${runId}`, operationId: `${marker}:okk-create` },
    });
    expect(createdOkk.status).toBe(201);
    okkId = createdOkk.data.id;
    cleanup.okkArchived = false;
    await expect.poll(() => snapshots.okk.slice(okkBeforeCreate).some((items) => items.some((item) => item.id === okkId)), { timeout: 20_000 }).toBe(true);
    await expect(page.locator('.okk-record-card').filter({ hasText: `Контроль связи ОКК ${runId}` })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, '01-okk-live-refetch.png'), fullPage: false });
    proof.okk = 'canonical refetch contains created record';
    const okkBeforeArchive = snapshots.okk.length;
    const archivedOkk = await api(`/okk/${okkId}/archive`, { method: 'POST', token: admin.token, factoryId: factory.id });
    expect(archivedOkk.status).toBe(201);
    cleanup.okkArchived = true;
    await expect.poll(() => snapshots.okk.slice(okkBeforeArchive).some((items) => !items.some((item) => item.id === okkId)), { timeout: 20_000 }).toBe(true);
    okkId = '';

    await navigate(page, 'Wash', 'Мойка');
    const washBeforeStart = snapshots.wash.length;
    const washObjectName = `Санитарная зона ${String(runId).slice(-6)}`;
    const startedWash = await api('/wash/start', {
      method: 'POST', token: tempToken, factoryId: factory.id,
      body: { targetType: 'OTHER', objectName: washObjectName, objectDescription: 'Проверка связи рабочего экрана', operationId: `${marker}:wash-start` },
    });
    expect(startedWash.status).toBe(201);
    washId = startedWash.data.id;
    cleanup.washCompleted = false;
    await expect.poll(() => snapshots.wash.slice(washBeforeStart).some((items) => items.some((item) => item.id === washId)), { timeout: 20_000 }).toBe(true);
    const washCard = page.locator('.wash-session-card').filter({ hasText: washObjectName });
    await expect(washCard).toBeVisible();
    await washCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.wash-detail-screen')).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, '02-wash-live-refetch.png'), fullPage: false });
    proof.wash = 'canonical refetch contains active session';
    const markerMessage = await api(`/wash/${washId}/message`, {
      method: 'POST', token: tempToken, factoryId: factory.id,
      body: { message: `Regression ${marker}`, operationId: `${marker}:wash-hide` },
    });
    expect(markerMessage.status).toBe(201);
    const washBeforeComplete = snapshots.wash.length;
    const completedWash = await api(`/wash/${washId}/complete`, {
      method: 'POST', token: tempToken, factoryId: factory.id, body: { operationId: `${marker}:wash-complete` },
    });
    expect(completedWash.status).toBe(201);
    cleanup.washCompleted = completedWash.data.status === 'DONE';
    await expect.poll(() => snapshots.wash.slice(washBeforeComplete).some((items) => !items.some((item) => item.id === washId)), { timeout: 20_000 }).toBe(true);
    washId = '';

    const defrostRole = await api(`/admin/users/${tempUserId}/factory-access`, {
      method: 'PATCH', token: admin.token, factoryId: factory.id,
      body: { factoryId: factory.id, role: 'TECH_HOLOD', departmentId: null, companyId: null, reason: marker },
    });
    expect(defrostRole.status).toBe(200);
    await navigate(page, 'Defrost', 'Оттайка');
    const defrostLines = await api('/defrost/lines', { token: admin.token, factoryId: factory.id });
    expect(defrostLines.status).toBe(200);
    const defrostLine = (defrostLines.data as any[]).find((item) => item.status !== 'WORK' && !item.activeEvent && !/pilot|stage|regression|test/i.test(`${item.id} ${item.name}`));
    if (!defrostLine) throw new Error('Нет безопасной остановленной линии для browser Defrost evidence.');
    defrostLineId = defrostLine.id;
    const defrostBeforeStart = snapshots.defrost.length;
    const startedDefrost = await api(`/defrost/lines/${defrostLineId}/start-today`, {
      method: 'POST', token: tempToken, factoryId: factory.id,
      body: { comment: `Контроль связи оттайки ${runId}`, operationId: `${marker}:defrost-start` },
    });
    expect(startedDefrost.status).toBe(201);
    defrostId = startedDefrost.data.id;
    cleanup.defrostCompleted = false;
    await expect.poll(() => snapshots.defrost.slice(defrostBeforeStart).some((items) => (
      items.find((item) => item.id === defrostLineId)?.activeEvent?.id === defrostId
    )), { timeout: 20_000 }).toBe(true);
    await page.getByRole('button', { name: /На оттайке/ }).first().click();
    const lineCard = page.locator('.defrost-line-card').filter({ hasText: defrostLine.name });
    await expect(lineCard).toContainText('На оттайке');
    await page.screenshot({ path: path.join(evidenceDir, '03-defrost-live-refetch.png'), fullPage: false });
    proof.defrost = 'canonical refetch contains active event';
    const defrostBeforeComplete = snapshots.defrost.length;
    const completedDefrost = await api(`/defrost/lines/${defrostLineId}/complete-today`, {
      method: 'POST', token: tempToken, factoryId: factory.id,
      body: { comment: `Regression ${marker}`, operationId: `${marker}:defrost-complete` },
    });
    expect(completedDefrost.status).toBe(201);
    cleanup.defrostCompleted = completedDefrost.data.status === 'COMPLETED';
    await expect.poll(() => snapshots.defrost.slice(defrostBeforeComplete).some((items) => (
      items.find((item) => item.id === defrostLineId)?.activeEvent === null
    )), { timeout: 20_000 }).toBe(true);
    defrostId = '';

    await expectNoHorizontalOverflow(page);
    await expectSafeUi(page);
  } catch (error) {
    capturedError = error;
  } finally {
    if (okkId) {
      const archived = await api(`/okk/${okkId}/archive`, { method: 'POST', token: admin.token, factoryId: factory.id }).catch(() => null);
      cleanup.okkArchived = archived?.status === 201 || cleanup.okkArchived;
    }
    if (washId) {
      const lifecycleToken = tempToken || admin.token;
      await api(`/wash/${washId}/message`, { method: 'POST', token: lifecycleToken, factoryId: factory.id, body: { message: `Regression cleanup ${marker}`, operationId: `${marker}:wash-cleanup-hide` } }).catch(() => null);
      const completed = await api(`/wash/${washId}/complete`, { method: 'POST', token: lifecycleToken, factoryId: factory.id, body: { operationId: `${marker}:wash-cleanup` } }).catch(() => null);
      cleanup.washCompleted = completed?.status === 201 && completed?.data?.status === 'DONE';
    }
    if (defrostId && defrostLineId) {
      const completed = await api(`/defrost/lines/${defrostLineId}/complete-today`, { method: 'POST', token: tempToken || admin.token, factoryId: factory.id, body: { comment: `Regression cleanup ${marker}`, operationId: `${marker}:defrost-cleanup` } }).catch(() => null);
      cleanup.defrostCompleted = completed?.status === 201 && completed?.data?.status === 'COMPLETED';
    }
    if (tempUserId) {
      const blocked = await api(`/admin/users/${tempUserId}/block-status`, {
        method: 'PATCH', token: admin.token, factoryId: factory.id, body: { blocked: true, reason: marker },
      }).catch(() => null);
      cleanup.tempBlocked = blocked?.status === 200;
      const deactivated = await api(`/admin/users/${tempUserId}/factory-access`, {
        method: 'PATCH', token: admin.token, factoryId: factory.id, body: { factoryId: factory.id, isActive: false, reason: marker },
      }).catch(() => null);
      cleanup.tempAccessDeactivated = deactivated?.status === 200;
    }
    writeResult(testInfo.project.name, {
      marker,
      proof,
      cleanup,
      passed: !capturedError
        && cleanup.okkArchived
        && cleanup.washCompleted
        && cleanup.defrostCompleted
        && cleanup.tempBlocked
        && cleanup.tempAccessDeactivated,
      error: capturedError instanceof Error ? capturedError.message : capturedError ? String(capturedError) : null,
    });
  }

  expect(cleanup.okkArchived).toBe(true);
  expect(cleanup.washCompleted).toBe(true);
  expect(cleanup.defrostCompleted).toBe(true);
  expect(cleanup.tempBlocked).toBe(true);
  expect(cleanup.tempAccessDeactivated).toBe(true);
  if (capturedError) throw capturedError;
});

test('P17C mobile Guest has no operational websocket and affected screens fit 360/390/430', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360-edge', 'Mobile proof runs once in touch context.');
  test.setTimeout(120_000);
  await installWsCounter(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await loginUi(page, 'guest');
  await page.waitForTimeout(3_500);
  const guestAttempts = await page.evaluate(() => (window as unknown as { __p17cWsAttempts?: string[] }).__p17cWsAttempts ?? []);
  expect(guestAttempts).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expectSafeUi(page);
  await page.screenshot({ path: path.join(evidenceDir, '04-guest-zero-websocket-mobile.png'), fullPage: false });

  await loginUi(page, 'management');
  const screenEvidence = [
    ['OKK', 'ОКК'],
    ['Wash', 'Мойка'],
    ['Defrost', 'Оттайка'],
  ] as const;
  for (const [screen, heading] of screenEvidence) {
    await navigate(page, screen, heading);
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(evidenceDir, '05-affected-screens-mobile-fit.png'), fullPage: false });
  await expectSafeUi(page);
  writeResult(testInfo.project.name, {
    guestWebsocketAttempts: guestAttempts.length,
    widths: [360, 390, 430],
    screens: screenEvidence.map(([screen]) => screen),
    physicalDeletes: 0,
    passed: true,
  });
});
