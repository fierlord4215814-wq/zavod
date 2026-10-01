const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', '@playwright', 'test'));

const appUrl = process.env.P17A_APP_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.P17A_API_URL || 'http://127.0.0.1:3000';
const artifactPath = path.join(root, 'docs', 'physical-field-fixes-v5-plast17a', 'test-artifacts.json');
const password = process.env.P17A_PILOT_PASSWORD;
let launchedBrowser = null;

const actorDefinitions = [
  { key: 'GUEST', expectedRole: 'OTHER', guest: true },
  { key: 'WORKER', expectedRole: 'WORKER' },
  { key: 'CONTRACTOR', expectedRole: 'CONTRACTOR' },
  { key: 'MASTER', expectedRole: 'MASTER' },
  { key: 'TECH_KIPIA', expectedRole: 'TECH_KIPIA' },
  { key: 'CONTRACTOR_LEAD', expectedRole: 'CONTRACTOR_LEAD' },
  { key: 'TECHNOLOG', expectedRole: 'TECHNOLOG' },
  { key: 'OTHER', expectedRole: 'OTHER' },
  { key: 'TECH_MECHANIC', expectedRole: 'TECH_MECHANIC' },
  { key: 'TECH_ELECTRIC', expectedRole: 'TECH_ELECTRIC' },
  { key: 'TECH_HOLOD', expectedRole: 'TECH_HOLOD' },
  { key: 'TECH_SANTECHNIK', expectedRole: 'TECH_SANTECHNIK' },
  { key: 'OKK', expectedRole: 'OKK' },
  { key: 'STORE', expectedRole: 'STORE' },
  { key: 'MANAGEMENT', expectedRole: 'MANAGEMENT' },
  { key: 'ADMIN', expectedRole: 'ADMIN' },
];

function loadActors() {
  if (!password || !process.env.P17A_ACTORS_JSON) {
    throw new Error('Для browser census нужны P17A_PILOT_PASSWORD и P17A_ACTORS_JSON. Значения не должны храниться в файле.');
  }

  let configured;
  try {
    configured = JSON.parse(process.env.P17A_ACTORS_JSON);
  } catch {
    throw new Error('P17A_ACTORS_JSON должен быть JSON-объектом actor key → phone.');
  }

  return actorDefinitions.map((actor) => {
    const phone = configured[actor.key];
    if (typeof phone !== 'string' || phone.trim().length === 0) {
      throw new Error(`В P17A_ACTORS_JSON отсутствует телефон для ${actor.key}.`);
    }
    return { ...actor, phone: phone.trim() };
  });
}

const actors = loadActors();

const screens = [
  { code: 'home', label: 'Главная', endpoint: null },
  { code: 'shift', label: 'Смена', endpoint: ({ permissions }) => permissions.includes('shift.current.read') ? '/shift/current' : '/shift/me' },
  { code: 'shift-history', label: 'История смен', endpoint: '/shift/past' },
  { code: 'people', label: 'Люди', endpoint: '/people' },
  { code: 'admin', label: 'Админка', endpoint: '/admin/overview' },
  { code: 'situation', label: 'Линии', endpoint: '/lines' },
  { code: 'tasks', label: 'Заявки', endpoint: '/tasks/board' },
  { code: 'wash', label: 'Мойка', endpoint: '/wash' },
  { code: 'okk', label: 'ОКК', endpoint: '/okk' },
  { code: 'stock', label: 'Некондиция', endpoint: '/stock' },
  { code: 'orders', label: 'Заказы / Остатки', endpoint: '/orders/summary' },
  { code: 'checklists', label: 'Чек-листы', endpoint: '/checklists/workspace' },
  { code: 'defrost', label: 'Оттайка', endpoint: '/defrost/lines' },
  { code: 'returns', label: 'Возвраты на производство', endpoint: '/returns' },
  { code: 'log', label: 'Пересменка / Журнал', endpoint: '/shift-log' },
  { code: 'chats', label: 'Чаты', endpoint: '/chats' },
  { code: 'announcements', label: 'Объявления', endpoint: '/announcements/current' },
  { code: 'archive', label: 'Архив', endpoint: '/archive/sections' },
  { code: 'notifications', label: 'Уведомления', endpoint: '/notifications' },
  { code: 'ops', label: 'Статистика / Аудит', endpoint: '/ops/overview' },
  { code: 'report', label: 'Сообщить об ошибке', endpoint: null },
];

function redactError(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]')
    .slice(0, 500);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data };
}

function authHeaders(session, factoryId = session.factory.id) {
  return {
    Authorization: `Bearer ${session.token}`,
    'x-user-id': session.userId,
    'x-factory-id': factoryId,
  };
}

async function login(actor) {
  const response = await jsonFetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: actor.phone, password }),
  });
  if (response.status !== 201 || !response.data?.token) {
    throw new Error(`${actor.key}: login returned ${response.status}`);
  }
  const factory = response.data.availableFactories.find((item) => item.code === 'factory-4')
    || response.data.availableFactories[0];
  if (!factory?.id) throw new Error(`${actor.key}: no available factory`);
  const session = {
    token: response.data.token,
    userId: response.data.userId,
    factory,
    factories: response.data.availableFactories.map((item) => ({ code: item.code, name: item.name })),
  };
  const me = await jsonFetch(`${apiUrl}/auth/me`, { headers: authHeaders(session) });
  if (me.status !== 200) throw new Error(`${actor.key}: auth/me returned ${me.status}`);
  return {
    ...session,
    role: me.data.role,
    isGuest: Boolean(me.data.isGuest),
    permissions: Array.isArray(me.data.permissions) ? me.data.permissions : [],
  };
}

function endpointFor(screen, session) {
  return typeof screen.endpoint === 'function' ? screen.endpoint(session) : screen.endpoint;
}

async function apiMatrix(actor, session) {
  const rows = [];
  for (const screen of screens) {
    const endpoint = endpointFor(screen, session);
    if (!endpoint) {
      rows.push({ screen: screen.code, endpoint: null, status: 'NO_PRIMARY_READ_ENDPOINT' });
      continue;
    }
    const result = await jsonFetch(`${apiUrl}${endpoint}`, { headers: authHeaders(session) });
    rows.push({ screen: screen.code, endpoint, status: result.status });
  }
  const foreign = await jsonFetch(`${apiUrl}/lines/shift-overview`, {
    headers: authHeaders(session, '00000000-0000-0000-0000-000000000000'),
  });
  return { rows, foreignFactoryStatus: foreign.status };
}

async function injectSession(page, session) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, factoryId, token }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', userId);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
    localStorage.setItem('zavod.authToken', token);
  }, { userId: session.userId, factoryId: session.factory.id, token: session.token });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.topbar').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1_200);
}

async function visibleMenu(page) {
  const nav = page.locator('nav[aria-label="Основная навигация"]');
  const texts = await nav.getByRole('button').allInnerTexts();
  return screens.filter((screen) => texts.some((text) => text.includes(screen.label))).map((screen) => screen.code);
}

async function screenCrawl(page, actor, visibleCodes, runtimeErrors) {
  const rows = [];
  const nav = page.locator('nav[aria-label="Основная навигация"]');
  for (const screen of screens.filter((item) => visibleCodes.includes(item.code))) {
    const before = runtimeErrors.length;
    const button = nav.getByRole('button', { name: new RegExp(screen.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
    try {
      await button.click({ timeout: 8_000 });
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          textLength: text.trim().length,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
          rawUuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
          undefinedLabel: /\b(?:undefined|null)\b/i.test(text),
          technicalLeak: /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+[A-Za-z0-9]/i.test(text),
          userFacingErrors: text.split(/\n+/)
            .map((value) => value.trim())
            .filter((value) => /^(?:Нет доступа|Не удалось|Ошибка сервера)/i.test(value))
            .slice(0, 4),
        };
      });
      rows.push({
        screen: screen.code,
        status: metrics.textLength > 30 ? 'OPENED' : 'BLANK',
        ...metrics,
        runtimeErrors: runtimeErrors.slice(before),
      });
    } catch (error) {
      rows.push({ screen: screen.code, status: 'OPEN_FAILED', error: redactError(error?.message || error) });
    }
  }
  return rows;
}

async function mobileSmoke(page, actor, session, width) {
  await page.setViewportSize({ width, height: 844 });
  await injectSession(page, session);
  let moreOpened = false;
  let backClosedTopLayer = null;
  const more = page.getByRole('button', { name: /Ещё/ }).filter({ visible: true }).first();
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(120);
    moreOpened = true;
    const layerBefore = await page.getByRole('dialog').filter({ visible: true }).count();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:mobile-back-request')));
    await page.waitForTimeout(120);
    const layerAfter = await page.getByRole('dialog').filter({ visible: true }).count();
    backClosedTopLayer = layerBefore > 0 ? layerAfter < layerBefore : true;
  }
  const metrics = await page.evaluate(() => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    textLength: document.body.innerText.trim().length,
  }));
  await page.mouse.wheel(0, 650);
  await page.waitForTimeout(80);
  return { actor: actor.key, width, moreOpened, backClosedTopLayer, ...metrics };
}

function monitorPage(page, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ kind: 'console', message: redactError(message.text()) });
  });
  page.on('requestfailed', (request) => errors.push({
    kind: 'requestfailed',
    message: redactError(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`),
  }));
  page.on('response', (response) => {
    const target = new URL(response.url());
    if (response.status() >= 400 && (response.url().startsWith(apiUrl) || target.pathname.startsWith('/api/'))) {
      errors.push({ kind: response.status() >= 500 ? '5xx' : '4xx', message: `${response.status()} ${target.pathname}` });
    }
  });
}

async function main() {
  const sessions = new Map();
  const roleApi = [];
  for (const actor of actors) {
    const session = await login(actor);
    sessions.set(actor.key, session);
    const probes = await apiMatrix(actor, session);
    roleApi.push({
      actor: actor.key,
      expectedRole: actor.expectedRole,
      actualRole: session.role,
      isGuest: session.isGuest,
      permissionCount: session.permissions.length,
      factories: session.factories,
      ...probes,
    });
  }

  const browser = await chromium.launch({ headless: true });
  launchedBrowser = browser;

  const roleUi = [];
  for (const actor of actors) {
    const session = sessions.get(actor.key);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: appUrl });
    const page = await context.newPage();
    const currentErrors = [];
    monitorPage(page, currentErrors);
    await injectSession(page, session);
    const visibleCodes = await visibleMenu(page);
    const errorsBefore = currentErrors.length;
    const crawled = await screenCrawl(page, actor, visibleCodes, currentErrors);
    roleUi.push({
      actor: actor.key,
      role: session.role,
      isGuest: session.isGuest,
      visibleScreens: visibleCodes,
      crawled,
      unexpectedRuntimeErrors: currentErrors.slice(errorsBefore),
    });
    await context.close();
  }

  const mobile = [];
  const runMobile = async (actor, width) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, baseURL: appUrl });
    const page = await context.newPage();
    const errors = [];
    monitorPage(page, errors);
    const result = await mobileSmoke(page, actor, sessions.get(actor.key), width);
    await context.close();
    return { ...result, runtimeErrors: errors };
  };
  for (const actor of actors) mobile.push(await runMobile(actor, 390));
  for (const width of [360, 430]) {
    for (const key of ['GUEST', 'WORKER', 'MASTER', 'ADMIN']) {
      const actor = actors.find((item) => item.key === key);
      mobile.push(await runMobile(actor, width));
    }
  }

  const pwaContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: appUrl });
  const pwaPage = await pwaContext.newPage();
  await injectSession(pwaPage, sessions.get('ADMIN'));
  const pwa = await pwaPage.evaluate(async () => ({
    secureContext: window.isSecureContext,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    controllerPresent: Boolean(navigator.serviceWorker?.controller),
    manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
  }));
  await pwaContext.close();
  await browser.close();
  launchedBrowser = null;

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.browser = {
    capturedAt: new Date().toISOString(),
    mode: 'READ_ONLY_CURRENT_RUNTIME',
    appUrl,
    apiUrl,
    actors: actors.length,
    roleApi,
    roleUi,
    mobile,
    pwa,
    screenshots: [],
    businessMutationsPerformed: false,
    loginAuditSideEffectsExpected: true,
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const opened = roleUi.reduce((sum, item) => sum + item.crawled.filter((row) => row.status === 'OPENED').length, 0);
  const failed = roleUi.flatMap((item) => item.crawled).filter((row) => row.status !== 'OPENED');
  const overflow = mobile.filter((item) => item.overflow > 24);
  const runtimeErrors = roleUi.flatMap((item) => item.unexpectedRuntimeErrors);
  console.log(JSON.stringify({
    artifact: path.relative(root, artifactPath).replace(/\\/g, '/'),
    actors: actors.length,
    opened,
    failed: failed.length,
    mobileChecks: mobile.length,
    overflowFailures: overflow.length,
    runtimeErrors: runtimeErrors.length,
    pwa,
  }, null, 2));
}

main().catch(async (error) => {
  if (launchedBrowser) await launchedBrowser.close().catch(() => undefined);
  console.error(redactError(error?.stack || error));
  process.exitCode = 1;
});
