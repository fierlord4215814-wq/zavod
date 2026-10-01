const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const frontend = path.join(root, 'frontend');
const failures = [];

function fail(message, detail) {
  failures.push({ message, detail });
}

function assert(condition, message, detail) {
  if (!condition) fail(message, detail);
}

function read(relativePath, encoding = 'utf8') {
  return fs.readFileSync(path.join(frontend, relativePath), encoding);
}

function exists(relativePath) {
  return fs.existsSync(path.join(frontend, relativePath));
}

function pngSize(relativePath) {
  const file = read(relativePath, null);
  if (file.length < 24 || file.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), bytes: file.length };
}

function hasSecretValue(text) {
  return /(postgres(?:ql)?:\/\/[^\s'"]+|Bearer\s+[A-Za-z0-9._-]{12,}|(?:password|token|secret)\s*[:=]\s*['"][^'"]{8,})/i.test(text);
}

function main() {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const sw = read('public/sw.js');
  const index = read('index.html');
  const offline = read('public/offline.html');
  const mainTsx = read('src/main.tsx');
  const app = read('src/App.tsx');
  const client = read('src/api/client.ts');
  const store = read('src/store/app.store.ts');
  const wsClient = read('src/ws/client.ts');
  const mobileBack = read('src/navigation/mobile-back.ts');
  const checklists = read('src/screens/ChecklistsScreen.tsx');
  const styles = read('src/styles.css');

  assert(manifest.name === 'Завод', 'manifest name is Завод', manifest.name);
  assert(manifest.short_name === 'Завод', 'manifest short_name is Завод', manifest.short_name);
  assert(manifest.start_url === '/', 'manifest start_url is root', manifest.start_url);
  assert(manifest.scope === '/', 'manifest scope is root', manifest.scope);
  assert(['standalone', 'fullscreen'].includes(manifest.display), 'manifest display is standalone/fullscreen', manifest.display);
  assert(manifest.theme_color === '#172033', 'manifest theme_color matches dark topbar', manifest.theme_color);
  assert(manifest.background_color === '#1e1e2e', 'manifest background_color matches dark shell', manifest.background_color);
  assert(!JSON.stringify(manifest).includes('localhost'), 'manifest has no dev localhost URLs');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const icon192 = icons.find((icon) => icon.sizes === '192x192' && icon.type === 'image/png');
  const icon512 = icons.find((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'any');
  const maskable = icons.find((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'maskable');
  assert(Boolean(icon192), 'manifest has PNG 192 icon');
  assert(Boolean(icon512), 'manifest has PNG 512 icon');
  assert(Boolean(maskable), 'manifest has maskable 512 icon');
  for (const icon of [icon192, icon512, maskable].filter(Boolean)) {
    const relative = `public/${icon.src.replace(/^\//, '')}`;
    const size = pngSize(relative);
    const expected = Number(icon.sizes.split('x')[0]);
    assert(size?.width === expected && size?.height === expected, `${icon.src} has expected PNG dimensions`, size);
  }
  const apple = pngSize('public/apple-touch-icon.png');
  assert(apple?.width === 180 && apple?.height === 180, 'apple-touch-icon has 180x180 PNG dimensions', apple);

  assert(index.includes('viewport-fit=cover'), 'index enables standalone safe-area viewport');
  assert(index.includes('apple-mobile-web-app-capable'), 'index has iOS standalone meta');
  assert(index.includes('apple-touch-icon.png'), 'index links apple-touch-icon');
  assert(index.includes('manifest.webmanifest'), 'index links manifest');
  assert(index.includes('Для работы приложения'), 'index has no-JS Russian fallback');
  assert(!index.includes('localhost'), 'index has no dev localhost URLs');

  assert(exists('public/offline.html'), 'offline fallback exists');
  assert(offline.includes('Нет связи'), 'offline fallback has Russian title');
  assert(offline.includes('Сервер или сеть сейчас недоступны'), 'offline fallback explains server/network problem');
  assert(offline.includes('Обновить'), 'offline fallback has refresh action');
  assert(offline.includes('#1e1e2e'), 'offline fallback uses dark theme');

  assert(sw.includes("CACHE_NAME = 'zavod-shell-v6'"), 'service worker cache version was bumped');
  assert(sw.includes('NETWORK_ONLY_PREFIXES'), 'service worker has network-only API guard list');
  for (const prefix of ['/auth', '/attachments', '/uploads', '/health', '/notifications']) {
    assert(sw.includes(`'${prefix}'`), `service worker never caches ${prefix}`);
  }
  assert(sw.includes('SKIP_WAITING'), 'service worker supports explicit update activation');
  assert(sw.includes('navigationResponse'), 'service worker has navigation fallback');
  assert(!/cache\.put\(event\.request/.test(sw), 'service worker does not blindly cache every same-origin GET');
  assert(!sw.includes('localhost'), 'service worker has no dev localhost URLs');

  assert(mainTsx.includes('zavod:pwa-update'), 'main registers PWA update event');
  assert(mainTsx.includes('updatefound'), 'main detects service worker updatefound lifecycle');
  assert(app.includes('Доступна новая версия'), 'app shows Russian update banner');
  assert(app.includes('SKIP_WAITING'), 'app can activate a waiting service worker after user action');
  assert(app.includes('startFallbackPolling') && app.includes("status === 'fallback'"), 'counter polling starts only as realtime fallback');
  assert(app.includes('stopFallbackPolling') && app.includes("status === 'connected'"), 'counter polling stops when realtime reconnects');
  assert(app.includes('ws.close()') && app.includes('selectedFactoryId, visibleScreens'), 'session/factory effect closes the previous websocket');
  assert(wsClient.includes('closedByCaller') && wsClient.includes('clearReconnect()'), 'websocket caller cleanup cancels reconnect');
  assert(wsClient.includes('1000 * 2 **') && wsClient.includes('Math.min(15000'), 'websocket reconnect uses bounded exponential backoff');
  assert(app.includes('SESSION_ROUTE_PREFIX') && app.includes('navigationContextKey'), 'saved route is scoped by user and factory');
  assert(store.includes("key?.startsWith('zavod.session.')"), 'logout removes saved session routes');
  assert(mobileBack.includes("active.matches('input, textarea, select") && mobileBack.includes('layers.values()'), 'mobile Back closes keyboard and top layer first');
  assert(checklists.includes("useMobileFormDirty('checklist-runner'") && checklists.includes('Ответ не сохранён'), 'focused checklist runner guards unsaved answers');
  assert(app.includes('Сервер недоступен'), 'app shows Russian server-down banner');
  assert(client.includes('zavod:api-connectivity'), 'api client emits connectivity status');
  assert(client.includes('Сессия истекла. Войдите снова.'), 'expired session has Russian login message');
  assert(styles.includes('env(safe-area-inset-bottom'), 'styles account for mobile safe-area bottom inset');

  const changedText = [index, JSON.stringify(manifest), sw, offline, mainTsx, app, client, store, wsClient, mobileBack, checklists, styles].join('\n');
  assert(!hasSecretValue(changedText), 'changed PWA files do not contain obvious secret values');
  assert(client.includes('storagePath|passwordHash|DATABASE_URL|token|secret'), 'api client defensively rejects forbidden technical fields');
  assert(!/(?:storagePath|passwordHash)\s*[:=]\s*['"][^'"]+['"]/.test(changedText), 'changed PWA files do not contain forbidden storage/password values');

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: 'pwa-readiness', failures: [] }, null, 2));
}

main();
