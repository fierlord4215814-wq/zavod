# Stage 19.1 — Browser / Mobile / PWA Sanity Pass

## Goal

Stage 19.1 is a sanity pass, not a new business module. It checks the real user path around auth, factory context, navigation, PWA shell, offline/outbox boundaries, notifications, and mobile layout risk.

## What Was Checked

Automated/static sanity:
- phone/password login endpoint;
- `/auth/me` bootstrap with selected factory;
- notification unread count endpoint;
- PWA manifest file;
- service worker file;
- offline fallback file;
- index manifest/theme metadata;
- shell navigation labels;
- logout action;
- offline indicator text;
- set-password flow wiring;
- dev-login guarded by dev mode;
- outbox retry metadata.

Full backend regressions remain the source of truth for business flows and RBAC.

## Manual Browser Checklist

Run backend and frontend:

```powershell
npm.cmd run start --workspace backend
npm.cmd run dev --workspace frontend -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/`.

Auth:
- log in with dev seed phone/password;
- verify factory select appears;
- select factory;
- verify `/auth/me`-backed shell loads;
- press `Выйти`;
- verify login/factory screen returns.

Navigation:
- open main screens allowed by the current role;
- verify forbidden modules are hidden for roles without permission;
- verify notification badge is visible when unread count is non-zero.

Mobile width 360px:
- header wraps without horizontal overflow;
- bottom nav remains usable;
- cards and forms stay readable;
- modals/actions fit the viewport.

PWA:
- `manifest.webmanifest` reachable;
- service worker registers in production build;
- `offline.html` reachable;
- after first visit, offline navigation falls back to cached shell/offline page;
- icon and theme color are present.

Offline/outbox:
- only JSON `POST/PATCH` actions are foundation-supported;
- binary attachments are not offline-ready;
- unsupported offline actions must show honest error;
- queued actions include `operationId`;
- reconnect retries pending actions and keeps failed state if max retry is reached.

Notifications:
- unread count refreshes periodically;
- notification screen opens;
- mark read and read-all work;
- related entity labels are shown when available.

## Known Limitations

- Browser plugin automation was unavailable in this environment during this pass, so the repository includes a lightweight sanity regression plus this manual checklist.
- Full mobile installability must still be verified in a real browser/device.
- Offline attachments are intentionally out of scope.
- WebSocket/realtime hardening remains future work; Stage 19 uses existing WS plus polling.

## Regression

Run:
- `stage191:browser-pwa-sanity`;
- Stage 6 through Stage 19 regressions;
- backend/frontend builds;
- prompt/alert scan.

## Next Recommendation

After Stage 19.1, prefer either:
- Role-based real shift simulation preparation;
- Production hardening around storage, sessions, backups, and browser/device e2e.
