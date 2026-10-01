const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const root = path.resolve(__dirname, '..', '..');

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function getJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  assert(response.ok, `${pathname} should return 2xx, got ${response.status}`);
  return response.ok ? response.json() : null;
}

async function main() {
  const manifestPath = path.join(root, 'frontend', 'public', 'manifest.webmanifest');
  const serviceWorkerPath = path.join(root, 'frontend', 'public', 'sw.js');
  const offlinePath = path.join(root, 'frontend', 'public', 'offline.html');
  const appPath = path.join(root, 'frontend', 'src', 'App.tsx');
  const syncPath = path.join(root, 'frontend', 'src', 'offline', 'sync.ts');
  const clientPath = path.join(root, 'frontend', 'src', 'api', 'client.ts');
  const docsPath = path.join(root, 'docs', 'stage19-pwa-offline-realtime.md');

  assert(fs.existsSync(manifestPath), 'manifest.webmanifest exists');
  assert(fs.existsSync(serviceWorkerPath), 'service worker exists');
  assert(fs.existsSync(offlinePath), 'offline fallback exists');
  assert(fs.existsSync(docsPath), 'Stage 19 docs exist');

  const manifest = JSON.parse(read('frontend/public/manifest.webmanifest'));
  assert(manifest.name === 'Завод', 'manifest has app name');
  assert(manifest.display === 'standalone', 'manifest display is standalone');
  assert(manifest.start_url === '/', 'manifest start_url is root');
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest has icon');

  const sw = read('frontend/public/sw.js');
  assert(sw.includes('offline.html'), 'service worker knows offline fallback');
  assert(sw.includes('install'), 'service worker has install handler');
  assert(sw.includes('fetch'), 'service worker has fetch handler');

  const app = read('frontend/src/App.tsx');
  assert(app.includes('setInterval') && app.includes('/notifications/unread-count'), 'notifications unread polling is wired');
  assert(app.includes('startSyncLoop'), 'sync loop is started from app shell');

  const sync = read('frontend/src/offline/sync.ts');
  assert(sync.includes('nextRetryAt') && sync.includes('Date.parse'), 'outbox respects retry schedule');
  assert(sync.includes('retryCount') && sync.includes('lastError'), 'outbox tracks retry metadata');

  const client = read('frontend/src/api/client.ts');
  assert(client.includes('queueOnNetworkError') && client.includes('operationId'), 'api client queues idempotent write actions');

  const health = await getJson('/health');
  assert(health?.status === 'ok', 'health status is ok');
  const version = await getJson('/version');
  assert(version?.stage === 'stage19-pwa-offline-realtime', 'version exposes Stage 19 marker');

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
