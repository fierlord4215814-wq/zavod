# v1.0 realtime, push and device signals

## Concept

The v1.0 notification layer keeps the existing `/notifications` model as the source of truth and adds delivery channels around it:

- WebSocket `/ws` for in-app realtime updates.
- Existing polling `/notifications/unread-count` as a fallback.
- Optional browser push subscriptions for PWA devices.
- Optional sound and vibration in the frontend, controlled by the user.

Business modules still create ordinary `Notification` records through the existing `NotificationsService`. The realtime layer does not introduce a new business module.

## Backend routing

WebSocket connections are accepted only after backend validation of:

- user existence;
- selected factory access;
- active `UserFactoryAccess`;
- non-guest access;
- no `blockedAt` / `deletedAt`.

Notification delivery is routed by backend recipient calculation:

- direct `userId` notifications go only to that user with active factory access;
- factory notifications go to active non-guest users of that factory;
- department notifications go to active users of that department plus factory admins;
- global notifications are limited to active admins.

Frontend hiding is not used as a security boundary.

## Push subscriptions

Push subscriptions are stored in the additive `PushSubscription` table:

- `userId`;
- `factoryId`;
- browser endpoint;
- browser push keys;
- device label/user agent;
- active/revoked state.

Users can only subscribe or revoke their own device in the selected factory. Another user cannot revoke a foreign subscription by direct API request.

For a production-like PWA push setup, the server needs:

- `VAPID_PUBLIC_KEY`;
- `VAPID_PRIVATE_KEY`;
- `VAPID_SUBJECT`;
- HTTPS or a browser-supported trusted context.

No VAPID secret is committed to the repository. If VAPID keys are absent, the UI clearly says that browser push is not configured while in-app realtime and polling still work.

## Frontend behavior

The frontend connects to `/ws` when a user and factory are selected. If the WebSocket is unavailable, it reconnects with backoff and keeps the old polling fallback active.

The notification screen provides:

- unread count;
- important count;
- browser push status;
- sound toggle;
- vibration toggle;
- explicit push enable/disable button.

Sound and vibration use feature detection and a cooldown. Unsupported browser APIs do not crash the UI.

## Service worker

The existing service worker now handles:

- PWA shell/offline behavior;
- `push` events;
- notification click focusing/opening the app.

The service worker does not cache API notification payloads and does not expose storage paths or secrets.

## Security notes

Public API/UI responses must not expose:

- `storagePath`;
- `passwordHash`;
- token values;
- secrets;
- VAPID private key;
- `DATABASE_URL` credentials.

Blocked users, deleted users, guests and users without selected factory access are denied by backend guards and do not receive realtime/push delivery.

## Verified evidence

Targeted checks added for this layer:

- `realtime:v1-regression`;
- `push:v1-regression`;
- `notifications:routing-v1-regression`;
- `realtime-push:v1-browser-e2e`;
- existing `prepilot:realtime-multirole-e2e`;
- existing PWA, RBAC, role-change, access lifecycle, resilience and security gates.

## Remaining manual check

Physical web push delivery on a real phone requires HTTPS/trusted context and VAPID keys. Code paths, subscription storage, service worker handling, UI controls and backend routing are implemented and tested; actual mobile OS/browser push delivery should be verified during deployment setup after VAPID keys are configured.
