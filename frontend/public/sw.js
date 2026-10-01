const CACHE_NAME = 'zavod-shell-v7';
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/pwa-maskable-512.png',
  '/apple-touch-icon.png',
];

const STATIC_PREFIXES = ['/assets/'];
const STATIC_FILES = new Set(APP_SHELL);
const NETWORK_ONLY_PREFIXES = [
  '/admin',
  '/announcements',
  '/archive',
  '/attachments',
  '/auth',
  '/checklists',
  '/chats',
  '/defrost',
  '/error-reports',
  '/health',
  '/lines',
  '/notifications',
  '/okk',
  '/orders',
  '/people',
  '/returns',
  '/shift',
  '/stock',
  '/tasks',
  '/uploads',
  '/version',
  '/wash',
];

function isNavigation(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isStaticAsset(url) {
  return STATIC_FILES.has(url.pathname) || STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isNetworkOnly(url) {
  return NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
}

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cachedShell = await caches.match('/index.html');
    if (cachedShell) return cachedShell;
    return caches.match('/offline.html');
  }
}

async function staticResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldCaches().then(() => clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Завод';
  const body = typeof payload.message === 'string' ? payload.message : 'Новое уведомление';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    tag: typeof payload.id === 'string' ? payload.id : undefined,
    data: {
      notificationId: typeof payload.id === 'string' ? payload.id : null,
      factoryId: typeof payload.factoryId === 'string' ? payload.factoryId : null,
      sourceRoute: typeof payload.sourceRoute === 'string' ? payload.sourceRoute : null,
    },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const intent = {
    notificationId: typeof event.notification.data?.notificationId === 'string' ? event.notification.data.notificationId : null,
    factoryId: typeof event.notification.data?.factoryId === 'string' ? event.notification.data.factoryId : null,
    sourceRoute: typeof event.notification.data?.sourceRoute === 'string' ? event.notification.data.sourceRoute : null,
  };
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) {
        client.postMessage({ type: 'ZAVOD_NOTIFICATION_NAVIGATION', intent });
        return client.focus();
      }
    }
    if (clients.openWindow) {
      const url = new URL('/', self.location.origin);
      if (intent.notificationId) url.searchParams.set('notificationId', intent.notificationId);
      if (intent.factoryId) url.searchParams.set('notificationFactory', intent.factoryId);
      if (intent.sourceRoute) url.searchParams.set('notificationRoute', intent.sourceRoute);
      return clients.openWindow(url.toString());
    }
    return undefined;
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isNavigation(event.request)) {
    event.respondWith(navigationResponse(event.request));
    return;
  }

  if (isNetworkOnly(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staticResponse(event.request));
  }
});
