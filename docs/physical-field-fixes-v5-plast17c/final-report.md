# Пласт 17C: final report

## Итог

- `PLAST17C_STATUS: PASS`
- `P0: 0`
- `P1: 0`
- `P2: 0`
- `P3: SB-017, SB-018`
- `MIGRATION: NOT_REQUIRED`

## Закрытые gaps

- `SB-009: RESOLVED` - Guest не открывает operational WebSocket и не создаёт reconnect/403 noise.
- `SB-012: RESOLVED` - backend effective permissions и selected factory определяют audience; factory payload opaque.
- `SB-013: RESOLVED` - OKK producer и открытый экран сходятся через canonical refetch.
- `SB-015: RESOLVED` - Wash message/issue/control mutations обновляют второй открытый экран без reload.
- `SB-016: RESOLVED` - Defrost получил профильное invalidation и обновляет calendar/list/detail.

## Контракт

- `REALTIME_CONTRACT: one /ws + one frontend connection owner`.
- `AUDIENCE_FILTER: backend effective capabilities + selected factory`.
- `MINIMAL_PAYLOAD: { changedAt }` for factory broadcasts.
- API/read-model remains the source of truth.
- Chat remains exact-member scoped; notifications remain exact-recipient scoped.

## Регрессии

- `GUEST: PASS`.
- `OKK: PASS`.
- `WASH: PASS`.
- `DEFROST: PASS`.
- `EXISTING_REALTIME_REGRESSION: PASS` for shift, assignment, task, chat, notification, announcement and checklist.
- `OFFLINE/RECONNECT: PASS`.
- `ONE_SOCKET: PASS`.
- `FACTORY_SWITCH: PASS`.
- `CAPABILITY_DOWNGRADE: PASS`.

Checks:

- P17C backend: 52/52.
- P17C browser: 2 passed, 2 expected project-specific skips.
- Existing realtime compact: 34/34.
- Existing `realtime:v1`: 9/9.
- Security/privacy: 17/17.
- Backend and frontend production builds: PASS.
- Prisma validate/status: PASS/up to date.
- Mobile 360/390/430: PASS.
- Public HTTPS frontend/API/auth/Factory 4/WS/PWA: PASS.

## Cleanup

- `CLEANUP: PASS`; active markers 0.
- `PREEXISTING_CHANGED: 0`; protected before/after hash identical.
- `PHYSICAL_DELETES: 0`.
- No reset/drop/truncate/delete, migration, `.env`, uploads, backup or restore action.

## Изменённые owners

Backend: existing WS event registry/service, OKK/Wash/Defrost/Checklist producers and existing Chats post-commit notification. Frontend: existing App WS owner/client and OKK/Wash/Defrost consumers. Targeted regression/E2E scripts and P17C evidence were added. A second WebSocket, event bus, permission engine or polling contour was not created.

## Known non-blocking notes

- Vite retains its known large chunk warning.
- Whole-worktree whitespace scan sees pre-existing generated Prisma output under tracked `node_modules`; P17C and project source scan pass.
- An old auxiliary P16C UI locator expects one login button; the current P17C runtime evidence uses the current two-form login contract and passes.
- `DEAD_CODE_SB_OPEN: SB-017, SB-018`.

## Physical-ready runtime

- `PUBLIC_HTTPS_URL: https://females-structural-milwaukee-tunnel.trycloudflare.com`
- `PUBLIC_HEALTH_URL: https://females-structural-milwaukee-tunnel.trycloudflare.com/api/health`
- `BACKEND_PID: 9336`
- `FRONTEND_PID: 22844`
- `TUNNEL_PID: 20460`
- `KEEP_AWAKE_PID: 3292`
- `SERVICE_WORKER_VERSION: zavod-shell-v6`
- `RUNTIME_STARTED_AT: 2026-08-30T19:03:37+03:00`
- `QR_PATH: C:\Users\79164\Documents\work\docs\physical-field-fixes-v5-plast17c\physical-recheck-qr.png`

Quick Tunnel is temporary. The computer and the four listed processes must remain running during the physical Android check.

## Final status

- `FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING`
- `PHYSICAL_RECHECK_STATUS: READY`
- `PHYSICAL_PHONE_GATE: PENDING`

