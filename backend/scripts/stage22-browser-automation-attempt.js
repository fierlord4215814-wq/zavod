const http = require('node:http');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';

const state = {
  browserAutomation: 'UNKNOWN',
  appStartup: [],
  roles: [],
  mobile: [],
  pwa: [],
  issues: [],
};

function add(list, item) {
  state[list].push(item);
}

function issue(message, detail) {
  state.issues.push({ message, ...(detail ? { detail } : {}) });
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    return { status: response.status, data: text ? JSON.parse(text) : null, text };
  } catch {
    return { status: response.status, data: null, text };
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(JSON.stringify(payload.error)));
        else resolve(payload.result);
        return;
      }
      const listeners = this.events.get(payload.method) ?? [];
      for (const listener of listeners) listener(payload.params);
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) ?? [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }

  close() {
    this.ws?.close();
  }
}

async function waitFor(client, expression, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(client, expression);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitFor(client, 'document.readyState === "complete"', 15000);
}

const domHelpers = `
  (() => {
    window.__stage22 = {
      text: () => document.body?.innerText || '',
      clickText: (text) => {
        const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const node = nodes.find((item) => (item.innerText || item.textContent || '').includes(text));
        if (!node) return false;
        node.click();
        return true;
      },
      devLogin: (userId) => {
        const input = document.querySelector('#dev-user-id');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, userId);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const button = input.closest('form')?.querySelector('button[type="submit"]');
        if (!button) return false;
        button.click();
        return true;
      },
      selectFactory: () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find((item) => (item.innerText || '').includes('Выбрать завод'));
        if (!button) return false;
        button.click();
        return true;
      },
      navLabels: () => Array.from(document.querySelectorAll('.bottom-nav button')).map((item) => item.innerText || ''),
      noRawCrash: () => {
        const text = document.body?.innerText || '';
        return text.length > 20 && !/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i.test(text);
      },
      noHorizontalOverflow: () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    };
    return true;
  })()
`;

async function ensureHelpers(client) {
  await evaluate(client, domHelpers);
}

async function loginAs(client, userId) {
  await navigate(client, FRONTEND_URL);
  await ensureHelpers(client);
  const loginVisible = await waitFor(client, `Boolean(document.querySelector('#dev-user-id'))`, 10000);
  if (!loginVisible) throw new Error('dev login field not visible');
  await evaluate(client, `window.__stage22.devLogin(${JSON.stringify(userId)})`);
  await waitFor(client, `Boolean(Array.from(document.querySelectorAll('button')).find((item) => item.innerText.includes('Выбрать завод')))`, 10000);
  await evaluate(client, 'window.__stage22.selectFactory()');
  await waitFor(client, `Boolean(document.querySelector('.bottom-nav'))`, 12000);
  await ensureHelpers(client);
}

async function logout(client) {
  await evaluate(client, `window.__stage22.clickText('Выйти')`);
  await waitFor(client, `Boolean(document.querySelector('#dev-user-id'))`, 10000);
}

async function openScreen(client, label) {
  const clicked = await evaluate(client, `window.__stage22.clickText(${JSON.stringify(label)})`);
  if (!clicked) return false;
  await new Promise((resolve) => setTimeout(resolve, 600));
  await ensureHelpers(client);
  return Boolean(await evaluate(client, 'window.__stage22.noRawCrash()'));
}

async function smokeRole(client, role, userId, screens, forbiddenLabels = []) {
  const result = { role, userId, status: 'PASS', screens: [], forbidden: [] };
  try {
    await loginAs(client, userId);
    const labels = await evaluate(client, 'window.__stage22.navLabels()');
    for (const label of forbiddenLabels) {
      result.forbidden.push({ label, hidden: !labels.some((item) => item.includes(label)) });
    }
    for (const screen of screens) {
      const ok = await openScreen(client, screen);
      result.screens.push({ screen, status: ok ? 'PASS' : 'FAIL' });
      if (!ok) result.status = 'FAIL';
    }
    const stable = await evaluate(client, 'window.__stage22.noRawCrash()');
    if (!stable) result.status = 'FAIL';
    await logout(client);
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.message;
    try { await navigate(client, FRONTEND_URL); } catch {}
  }
  add('roles', result);
}

async function main() {
  const version = await httpJson(`${DEBUG_URL}/json/version`).catch((error) => ({ error }));
  if (version.error || version.status !== 200) {
    state.browserAutomation = 'BLOCKED_BY_ENVIRONMENT';
    issue('Chrome remote debugging endpoint is unavailable', { error: version.error?.message, status: version.status });
    console.log(JSON.stringify(state, null, 2));
    process.exit(2);
  }

  let target = (await httpJson(`${DEBUG_URL}/json/list`)).data?.find((item) => item.type === 'page');
  if (!target) {
    await httpJson(`${DEBUG_URL}/json/new?${encodeURIComponent(FRONTEND_URL)}`, { method: 'PUT' }).catch(() => null);
    target = (await httpJson(`${DEBUG_URL}/json/list`)).data?.find((item) => item.type === 'page');
  }
  if (!target?.webSocketDebuggerUrl) {
    state.browserAutomation = 'BLOCKED_BY_ENVIRONMENT';
    issue('No debuggable Chrome page target found');
    console.log(JSON.stringify(state, null, 2));
    process.exit(2);
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  state.browserAutomation = 'AVAILABLE';

  await navigate(client, FRONTEND_URL);
  await ensureHelpers(client);
  const startup = {
    loginScreen: Boolean(await waitFor(client, `Boolean(document.querySelector('#login-phone') && document.querySelector('#login-password'))`, 10000)),
    devLoginPanel: Boolean(await evaluate(client, `Boolean(document.querySelector('#dev-user-id'))`)),
    loginButton: Boolean(await evaluate(client, `Array.from(document.querySelectorAll('button')).some((item) => item.innerText.includes('Войти'))`)),
    noRawCrash: Boolean(await evaluate(client, 'window.__stage22.noRawCrash()')),
  };
  add('appStartup', startup);
  if (!startup.loginScreen || !startup.devLoginPanel || !startup.loginButton || !startup.noRawCrash) {
    issue('Startup screen smoke failed', startup);
  }

  await smokeRole(client, 'ADMIN', 'test-admin', ['Админ', 'Уведомления', 'Аудит']);
  await smokeRole(client, 'MASTER', 'test-master', ['Смена', 'Ситуация', 'Заявки', 'Мойка', 'Журнал']);
  await smokeRole(client, 'WORKER', 'worker-1', ['Смена'], ['Админ', 'Заявки', 'Мойка', 'Аудит']);
  await smokeRole(client, 'OKK', 'test-okk', ['ОКК', 'Мойка'], ['Админ']);
  await smokeRole(client, 'STORE', 'test-store', ['Склад', 'Заказы'], ['Админ']);
  await smokeRole(client, 'TECH_HOLOD', 'test-tech-holod', ['Оттайка'], ['Админ']);
  await smokeRole(client, 'MANAGEMENT', 'test-management', ['Заявки', 'Чек-листы', 'Заказы', 'Журнал', 'Аудит']);

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
  });
  for (const [role, userId, screens] of [
    ['ADMIN', 'test-admin', ['Админ', 'Уведомления']],
    ['MASTER', 'test-master', ['Смена', 'Ситуация']],
    ['WORKER', 'worker-1', ['Смена']],
  ]) {
    const mobileResult = { role, viewport: '360x800', status: 'PASS', overflow: false, screens: [] };
    try {
      await loginAs(client, userId);
      for (const screen of screens) {
        const ok = await openScreen(client, screen);
        const noOverflow = await evaluate(client, 'window.__stage22.noHorizontalOverflow()');
        mobileResult.screens.push({ screen, status: ok && noOverflow ? 'PASS' : 'FAIL', noOverflow });
        if (!ok || !noOverflow) {
          mobileResult.status = 'FAIL';
          mobileResult.overflow = mobileResult.overflow || !noOverflow;
        }
      }
      await logout(client);
    } catch (error) {
      mobileResult.status = 'FAIL';
      mobileResult.error = error.message;
    }
    add('mobile', mobileResult);
  }
  await client.send('Emulation.clearDeviceMetricsOverride');
  client.close();

  for (const file of ['/manifest.webmanifest', '/offline.html', '/sw.js']) {
    const response = await fetch(`${FRONTEND_URL.replace(/\/$/, '')}${file}`).catch((error) => ({ error }));
    add('pwa', {
      file,
      status: response.status ?? 'ERROR',
      ok: response.status === 200,
      error: response.error?.message,
    });
  }

  for (const role of state.roles) {
    if (role.status !== 'PASS') issue(`Role smoke failed: ${role.role}`, role);
  }
  for (const mobile of state.mobile) {
    if (mobile.status !== 'PASS') issue(`Mobile smoke failed: ${mobile.role}`, mobile);
  }
  if (state.pwa.some((item) => !item.ok)) issue('PWA file smoke failed', state.pwa);

  console.log(JSON.stringify(state, null, 2));
  if (state.issues.length) process.exit(1);
}

main().catch((error) => {
  state.browserAutomation = state.browserAutomation === 'UNKNOWN' ? 'BLOCKED_BY_ENVIRONMENT' : state.browserAutomation;
  issue('Browser automation crashed', { message: error.message, stack: error.stack });
  console.log(JSON.stringify(state, null, 2));
  process.exit(1);
});
