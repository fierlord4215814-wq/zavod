# Physical Field Fixes V2: test evidence

Финальный прогон выполнен в Stage 05 после последовательного закрытия этапов 00-04.

## Builds и Prisma

- Backend production build: `PASS`.
- Frontend production build: `PASS`; известное предупреждение Vite о размере chunk не блокирует запуск.
- `prisma validate`: `PASS`.
- `prisma migrate status`: 45 migrations, schema up to date.
- `node --check backend/prisma/seed.js`: `PASS`.
- Changed regression/launcher scripts syntax: `PASS`.

## Backend regression

- Pilot-fix Plast 1-6: `PASS`.
- Semantic integrity: `66 passed, 1 known warning, 0 failed`.
- Pilot route acceptance backend: `PASS`.
- Physical Stage 01: `PASS`.
- Physical Stage 02: `PASS`.
- Physical Stage 03: `32/32 PASS`.
- Physical Stage 04: `15/15 PASS`.
- Stage 30 release readiness: `58 ok, 0 failure`.
- Security/privacy, runtime hygiene, guest RBAC, admin delegation and role hierarchy: `PASS`.
- Access lifecycle and live role change: `PASS`.
- Realtime, notifications, push readiness and resilience/concurrency: `PASS`.
- Shift current/future, DAY/NIGHT boundaries, handover, effective-time and line timeline (`34/34`): `PASS`.
- Checklist Stage 13/44/50/64/65, periodic/workflow/department-first lifecycle: `PASS`.

## Browser/mobile regression

- Pilot-fix Plast 1-6: `PASS`.
- Physical Stage 01-04 desktop/mobile: `PASS`.
- Semantic browser: `2 passed`, `2 intentional project skips`.
- Pilot route acceptance: `3 passed`, `3 intentional project skips`; desktop, 360, 390, 430.
- Runtime browser stability: `3 passed`, `3 intentional project skips`.
- Live role change: `2/2 PASS`.
- Access lifecycle browser: `PASS` with one intentional project skip.
- Realtime multirole: `PASS` with one intentional project skip.
- PWA browser readiness: `2 passed`, `2 intentional project skips`; desktop, 360, 390, 430.
- PWA readiness regression: `{ok:true}`.
- Horizontal overflow on changed Guest, Shift, Lines, People, Future, Worker History and Checklists routes: not found.

Intentional skips относятся к сценариям, которым нужен физический браузер/устройство или внешний системный prompt; они не маскируют падающие product assertions.

## Security/UI scans

- Product usage of browser `prompt/alert/confirm`: not found.
- Mojibake in changed product files: not found.
- Embedded credential/token/passwordHash/secret values: not found.
- `storagePath` не раскрывается публичным DTO/UI; найденные совпадения в scripts являются защитными assertions или внутренним storage code.
- Factory/department/company isolation и прямой API deny: `PASS`.

## Remote mobile pilot

Runtime evidence: `docs/quick-tunnel-mobile-pilot-v1/runtime/20260722-233807Z`.

- External HTTPS: `PASS`.
- Same-origin API: `PASS`.
- WebSocket: `PASS`.
- Login всех 18 pilot accounts: `PASS`.
- Session switch: `PASS`.
- Secure PWA context, manifest и service worker: `PASS`.
- Chat round trip and reconnect: `PASS`.
- Error report round trip with guarded attachment: `PASS`.
- Local backend `/health`: HTTP 200.
- Local gateway `/api/health`: HTTP 200.
- Public `/api/health`, `/manifest.webmanifest`, `/sw.js`: HTTP 200.
- Mobile 390 screenshot: `docs/quick-tunnel-mobile-pilot-v1/runtime/20260722-233807Z/external-master-mobile-390.png`.

## Compatibility updates

- Archive regression switched from UTC date slicing to the product's local-day contract.
- Checklist report fixture attaches its photo before closing the run, matching the correct closed-run guard.
- Browser login/navigation fixtures follow the current session route and final role matrix.
- Audit check selects the concrete action instead of relying on a noisy recent slice.
- Neutral test file/timeline names avoid runtime diagnostic filtering while retaining the filtering assertion itself.

No production guard was weakened to make a test green.
