const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const root = path.resolve(__dirname, '..', '..');
const failures = [];

function assert(condition, message, detail) {
  if (!condition) failures.push({ message, detail });
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function request(method, pathname, { body, token, factoryId } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function main() {
  const health = await request('GET', '/health');
  assert(health.status === 200 && health.data?.status === 'ok', 'backend health works', health);

  const login = await request('POST', '/auth/login', {
    body: { phone: '+79000000001', password: '1234' },
  });
  assert(login.status === 201 && login.data?.token, 'phone/password login works', { status: login.status });
  const token = login.data?.token;
  const factoryId = login.data?.recommendedFactoryId || login.data?.availableFactories?.[0]?.id;
  assert(Boolean(factoryId), 'login returns factory context');

  const me = await request('GET', '/auth/me', { token, factoryId });
  assert(me.status === 200 && me.data?.userId === 'test-admin', '/auth/me bootstrap works', { status: me.status });
  assert(!('passwordHash' in (me.data || {})), '/auth/me does not expose passwordHash');

  const notifications = await request('GET', '/notifications/unread-count', { token, factoryId });
  assert(notifications.status === 200 && typeof notifications.data?.count === 'number', 'notification unread badge endpoint works', notifications);

  const manifest = JSON.parse(read('frontend/public/manifest.webmanifest'));
  assert(manifest.display === 'standalone', 'PWA manifest standalone');
  assert(Boolean(manifest.theme_color), 'PWA manifest theme color');

  const sw = read('frontend/public/sw.js');
  assert(sw.includes('offline.html'), 'service worker has offline fallback');
  assert(sw.includes('APP_SHELL'), 'service worker has app shell list');

  const index = read('frontend/index.html');
  assert(index.includes('manifest.webmanifest'), 'index links manifest');
  assert(index.includes('theme-color'), 'index has theme color');

  const app = read('frontend/src/App.tsx');
  for (const label of ['Смена', 'Заявки', 'Мойка', 'Чек-листы', 'Заказы', 'Оттайка', 'Уведомления', 'Аудит', 'Выйти']) {
    assert(app.includes(label), `main shell contains ${label}`);
  }
  assert(app.includes('notificationsTimer'), 'notification polling timer is wired');
  assert(app.includes('Офлайн: действия в очереди'), 'offline indicator text is present');

  const factory = read('frontend/src/screens/FactorySelectScreen.tsx');
  assert(factory.includes('/auth/login'), 'login screen uses phone/password endpoint');
  assert(factory.includes('/auth/set-password'), 'reset-required set-password flow is wired');
  assert(factory.includes('import.meta.env.DEV'), 'dev-login is hidden outside dev mode');

  const sync = read('frontend/src/offline/sync.ts');
  assert(sync.includes('nextRetryAt') && sync.includes('retryCount'), 'outbox retry metadata is implemented');

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, failures: [] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
