# Stage 19 — PWA / Offline / Realtime Production Hardening

## Scope

Stage 19 prepares the mobile-first factory app for real PWA operation without claiming full offline production sync.

Included:
- PWA manifest and installability basics.
- Service worker app shell cache.
- Offline fallback page.
- Global online/offline indicator.
- Frontend outbox foundation for JSON write actions.
- Retry metadata and retry scheduling.
- Notification unread polling.
- Backend health/version endpoints.
- Regression coverage for PWA files and health endpoints.

Not included:
- Browser push production.
- SMS/email.
- Full binary attachment offline sync.
- WebSocket hardening.
- Complex notification preferences.
- Production deployment automation.

## PWA Shell

The frontend serves:
- `frontend/public/manifest.webmanifest`;
- `frontend/public/sw.js`;
- `frontend/public/offline.html`;
- `frontend/public/pwa-icon.svg`.

The service worker caches the app shell and same-origin GET responses. API write calls are not faked by the service worker; the API client is responsible for queuing supported actions.

## Offline UX

The app shell shows a small status pill:
- online: `Сеть активна`;
- offline: `Офлайн: действия в очереди`.

Network failures are surfaced honestly. Supported write actions may be queued; unsupported actions should show an error instead of pretending success.

## Outbox Foundation

The frontend IndexedDB outbox stores pending JSON actions with:
- id;
- operationId;
- type;
- endpoint;
- method;
- payload;
- entityType/entityId optional;
- user/factory context;
- status;
- retryCount/attempts;
- lastError/error;
- nextRetryAt.

Supported at the foundation level:
- JSON `POST`;
- JSON `PATCH`;
- operationId injection for idempotent writes.

Attachments are not fully offline synced in Stage 19. The future shape remains:
- local preview URL;
- IndexedDB blob storage;
- upload operationId;
- retry state;
- final attachment metadata replacement after upload.

## Realtime / Polling

Stage 19 keeps the existing WebSocket client hook and adds periodic notification unread-count polling. This is intentionally lightweight and can later be replaced or supplemented by stronger realtime delivery.

## Backend Readiness

Added:
- `GET /health`;
- `GET /version`.

These endpoints expose operational readiness without secrets.

## Storage Policy

Local uploads are still local development storage unless configured otherwise. Do not commit:
- uploads;
- logs;
- dist;
- node_modules;
- `.env`.

Production storage, backup, and retention policy remain future hardening work.

## Regression Checklist

Run:
- db doctor;
- Prisma validate/generate/migrate status;
- backend build;
- frontend build;
- Stage 6 through Stage 18 regressions;
- `stage19:pwa-offline-regression`;
- seed syntax check;
- prompt/alert scan.

## Temporary Decisions

- Offline binary attachment sync is documented but not implemented.
- The outbox supports safe JSON writes only.
- Notification polling interval is simple and conservative.
- The service worker favors network-first for same-origin GETs and falls back to cache/offline shell.
