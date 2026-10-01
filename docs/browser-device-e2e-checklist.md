# Browser / Device E2E Checklist

## Devices

Run at least:
- desktop browser;
- mobile width 360px;
- one real phone browser when available.

## Roles

Check:
- ADMIN;
- MASTER;
- WORKER;
- OKK;
- STORE;
- TECH_HOLOD;
- MANAGEMENT.

## Core Path

For each role:
1. Login with phone/password.
2. Select factory.
3. Verify visible menu matches permissions.
4. Open allowed modules.
5. Verify forbidden modules are hidden or show no-access on direct access.
6. Logout.

## Mobile Width 360px

Check:
- topbar wraps cleanly;
- bottom nav remains usable;
- cards are readable;
- action buttons are not tiny;
- modals fit;
- forms do not overflow horizontally.

## Module Smoke

Check:
- Shift;
- line dashboard;
- Tasks create/take/done;
- Wash start/issue/review/complete;
- Checklist run;
- ShiftLog important;
- Orders low stock/order request;
- Notifications badge/read/read-all;
- Ops audit screen;
- OKK;
- Stock defects;
- Returns;
- Defrost;
- Admin config.

## PWA / Offline

Check:
- manifest reachable;
- service worker registers in production build;
- offline shell loads after first visit;
- offline indicator appears;
- one supported JSON action queues;
- reconnect retries;
- unsupported offline action shows honest error;
- attachments are not claimed as offline-ready.

## Error Handling

Check:
- API down produces honest error;
- 403 produces no-access state;
- no endless spinner;
- no raw stack trace;
- no `window.prompt`, `window.alert`, or `window.confirm`.
