# Stage06 — test evidence

Дата: 23.07.2026.

## Build и Prisma

| Проверка | Результат |
|---|---|
| `npm.cmd run build --workspace backend` | PASS |
| `npm.cmd run build --workspace frontend` | PASS |
| `npm.cmd run prisma:validate --workspace backend` | PASS |
| `npm.cmd run prisma:migrate:status --workspace backend` | PASS, 45 migrations, schema up to date |

Frontend build содержит только известное предупреждение Vite о размере chunk. Новых миграций нет.

## PWA/session/navigation

| Проверка | Результат |
|---|---|
| `npm.cmd run pwa:readiness-regression --workspace frontend` | PASS |
| `npm.cmd run pwa:browser-e2e --workspace frontend` | PASS: 2 tests, 2 intentional project skips |
| `npm.cmd run physical-field-fixes:v2-stage01-e2e --workspace frontend` | PASS: 4/4 |
| `npm.cmd run physical-field-fixes:v2-stage04-e2e --workspace frontend` | PASS: 6/6 |
| `npm.cmd run runtime:browser-stability-v1 --workspace frontend` | PASS: 3 tests, 3 intentional project skips |

Покрыто: cache v5, offline shell/update, role-home, same-session route, logout cleanup, layered Back, dirty Error Report и checklist answer, focused runner и 360/390/430 px.

## Targeted backend

| Проверка | Результат |
|---|---|
| Physical Field Fixes V2 Stage01 regression | PASS: 13 |
| Physical Field Fixes V2 Stage02 regression | PASS: 26 |
| Physical Field Fixes V2 Stage03 regression | PASS: 28, 1 known non-blocking warning |
| Physical Field Fixes V2 Stage04 regression | PASS: 15 |
| Realtime v1 regression | PASS: 7 |
| Security/privacy regression | PASS: 17 |
| Pilot route acceptance regression | PASS: 27 |

Known Stage03 warning: в текущем sandbox нет видимой planned line для одного evidence-сценария; guard и factory/company isolation прошли.

## Targeted browser/mobile

| Проверка | Результат |
|---|---|
| Physical Field Fixes V2 Stage02 E2E | PASS: 4/4 |
| Physical Field Fixes V2 Stage03 E2E | PASS: 4/4 |
| Prepilot realtime multirole E2E | PASS: 1 test, 1 intentional project skip |
| Pilot route acceptance E2E | PASS: 3 tests, 3 intentional project skips |

Проверены desktop, 360, 390 и 430 px; session recovery, role routes, realtime без refresh и отсутствие page-level horizontal overflow.

## Scans

| Проверка | Результат |
|---|---|
| `node --check frontend/scripts/pwa-readiness-regression.js` | PASS |
| `git diff --check` по Stage06 product/test files | PASS |
| Browser `prompt`/`alert`/`confirm` calls | PASS: не найдены |
| Mojibake markers | PASS: не найдены |
| Credential/passwordHash/storagePath/token/secret values | PASS: не найдены |

## Runtime и внешний smoke

- Runtime: `docs/quick-tunnel-mobile-pilot-v1/runtime/20260723-204408Z`.
- `http://127.0.0.1:3000/health`: HTTP 200.
- `http://127.0.0.1:5173/api/health`: HTTP 200.
- `https://weddings-usd-pix-huge.trycloudflare.com/api/health`: HTTP 200.
- Manifest: HTTP 200.
- Service worker: HTTP 200, `zavod-shell-v5`.
- Public production asset: HTTP 200, dev backend URL отсутствует.
- External Playwright: PASS, 1/1.
- Login: PASS для 18 pilot-ролей.
- Same-origin API: PASS.
- WebSocket: PASS.
- Session switch: PASS.
- PWA secure context/manifest/service worker: PASS.
- Chat send/receive/unread/read/reconnect: PASS.
- Error report create/idempotency/attachment/guarded read/admin view: PASS.

## Runtime processes

| Process | PID | Статус |
|---|---:|---|
| Backend | 4324 | RUNNING |
| Frontend preview | 10652 | RUNNING |
| Cloudflare Quick Tunnel | 6264 | RUNNING |
| Keep-awake | 8604 | RUNNING |

Командные строки каждого PID сверены с проектом «Завод». Runtime оставлен запущенным.

## Physical gate

`PHYSICAL_PHONE_GATE: PENDING`.

Автоматические desktop/mobile/remote проверки не заменяют установленную PWA на физическом телефоне.
