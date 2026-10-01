# Physical Fixes V4 — final report

Дата завершения: 29.07.2026  
Run ID: `PFFV4_20260727T075200Z`

## Итог

- `FINAL_STATUS: PASS_WITH_P2`
- `P0: 0`
- `P1: 0`
- `P2: 2`
- `CLEANUP_GATE: PASS`
- `TEST_ARTIFACTS_CREATED: 305`
- `TEST_ARTIFACTS_REMOVED: 118`
- `TEST_ARTIFACTS_IMMUTABLE_HISTORY_PRESERVED: 187`
- `TEST_ARTIFACTS_REMAINING: 0`
- `PREEXISTING_ENTITIES_DELETED: 0`
- `PHYSICAL_PHONE_GATE: PENDING`

Все функциональные, RBAC, data-scope, regression и локальные browser gates завершены без открытых P0/P1. Итог `PASS_WITH_P2` выбран честно: установленная Android PWA не проверена на физическом телефоне, а frontend build сохраняет известное неблокирующее предупреждение Vite о крупном chunk.

## Requirement evidence

| Requirement | Result | Primary evidence |
|---|---|---|
| SYS-SCROLL-01 | PROVEN | Shared reference-counted scroll lock; Stage 3 desktop/mobile Back and scroll-restore E2E |
| CONSISTENCY-01 | PROVEN | Stage 1 propagation `36/0`, parity `25/0`, line detail `20/0` |
| CONSISTENCY-02 | PROVEN | Shared list/dashboard/shift counters and refresh/realtime parity |
| LINE-STOP-01 | PROVEN | Stage 2 atomic STOP/idempotency regression `62/0` |
| SHIFT-DURATION-01 | PROVEN | Additive 12/24 snapshot model and DAY/NIGHT boundary regression |
| WORKAREA-01 | PROVEN | Shared requirement/assignment read model and production KPI isolation |
| WORKAREA-02 | PROVEN | Exact `positionId + slotIndex`, guarded reduction and both assignment directions |
| SHIFT-UI-01 | PROVEN | Stable 360/390/430 px KPI and assignment layout |
| ASSIGN-01 | PROVEN | Person-first uses canonical backend command and operation idempotency |
| ASSIGN-02 | PROVEN | Slot-first uses the same command and compact person picker |
| ASSIGN-03 | PROVEN | Compact targets, one-layer Android Back and page-state restore |
| CHAT-PERSONAL-01 | PROVEN | Participant-only communication block and exact active-pair lookup |
| CHAT-GROUP-01 | PROVEN | OWNER/ADMIN/MEMBER lifecycle and direct URL denial |
| CHAT-GROUP-02 | PROVEN | Locked, idempotent membership actions; Stage 4 backend `29/0` |
| CHAT-GROUP-03 | PROVEN | Atomic membership system events without operation replay duplicates |
| CHAT-PROFILE-01 | PROVEN | Canonical profile navigation and chat position restore |
| PHONE-RBAC-01 | PROVEN | One backend DTO policy; Stage 5 backend `41/0`, privacy `17/0` |
| DELEGATION-01 | PROVEN | Server-filtered candidates and desktop/mobile role hierarchy gates |
| ANNOUNCE-01 | PROVEN | Shared publisher policy and direct API denial |
| ANNOUNCE-02 | PROVEN | Factory/own department/multiple department audience isolation |
| RETURN-01 | PROVEN | Existing return history/attachments used as guarded publication feed |
| CHECK-EDITOR-01 | PROVEN | Existing ActionModal and canonical scroll lock |
| CHECK-PERIODIC-01 | PROVEN | Two cycles, reload and reconnect while run stays active |
| CHECK-PERIODIC-02 | PROVEN | Server-time due/overdue and DAY/NIGHT boundaries |
| CHECK-PERIODIC-03 | PROVEN | Explicit idempotent cycle completion creates next check |
| CHECK-PERIODIC-04 | PROVEN | Separate reason-required immutable early closure |

The detailed ledger is in `docs/physical-fixes-v4-requirement-status.md`.

## Acceptance gates

| Gate | Result |
|---|---|
| A — canonical consistency | PASS |
| B — assignment parity | PASS |
| C — shift 12/24 | PASS |
| D — WorkArea | PASS |
| E — mobile assignment | PASS |
| F — chats | PASS |
| G — phone and delegation | PASS |
| H — announcements and returns | PASS |
| I — periodic checklist | PASS |
| J — scroll/PWA | Browser PASS; installed Android PWA PENDING |
| K — cleanup | PASS |

## Implemented contours

- Canonical line composition and operational counters now agree across admin, lines, shift, planning and assignment consumers.
- STOP, 12/24-hour session snapshots and WorkArea slots use existing canonical assignment/session models.
- Mobile person-first and slot-first assignment flows converge on one guarded backend command.
- Personal and group chats use one membership model with formal roles, operation idempotency and participant/factory guards.
- Phone visibility and delegation are filtered on the backend, including department/company/factory boundaries.
- Announcements support normalized department audiences; returns remain in the existing return and attachment contour.
- Periodic checklist checks advance explicitly; full closure is separate, reason-required and immutable.

## Database changes

Only three safe additive migrations were applied:

- `20260727090000_physical_fixes_v4_shift_duration`
- `20260727120000_physical_fixes_v4_chat_membership`
- `20260728110000_physical_fixes_v4_publication_feeds`

They add duration snapshots, chat membership state and publication audience fields/relations. No reset, drop, truncate, destructive rewrite or physical history deletion was used. Prisma status: 49 migrations, schema up to date.

## Verification

- Backend V4 gates: Stage 1 `36/0` plus parity `25/0`; Stage 2 `62/0`; Stage 4 `29/0`; Stage 5 `41/0`; periodic lifecycle PASS.
- Frontend V4 static gates: Stage 3 `13/0`; Stage 4 `15/0`; Stage 5 `20/0`; Stage 6 `21/0`.
- V4 browser gates: Stage 3 `7 passed, 1 intentional wrapper skip`; Stage 4 `2 passed`; Stage 5 `6 passed`; Stage 6 `4 passed`.
- Related checklist gates: Stage 13, 44, 50, 64 and 65 passed; their browser gates passed with only intentional project wrappers skipped.
- Cross-cutting: security/privacy `17/0`; role menu visibility `59/0`; Stage 30 `58/0`; pilot data/role audit `122 passed, 1 warning, 0 failed`.
- Realtime, runtime stability, reconnect/offline, resilience/concurrency, access lifecycle and live role change passed.
- Backend build PASS; frontend build PASS; Prisma validate/status PASS; seed syntax PASS.
- Targeted prompt/alert/confirm, mojibake and secret-value scans PASS.

## Cleanup evidence

The runner `backend/scripts/physical-fixes-v4-stage7-cleanup.js` defaults to dry-run and applies only with `--apply`. It uses exact run/manifest scope and canonical archive, deactivate, close, soft-remove and read routes.

The apply run performed 53 soft actions. The repeated dry-run found zero active artifacts in every tracked category. All 17 attachment files and their parent records remain present; no upload was physically removed. Audit, line events, skill credits and other immutable history remain preserved.

Manifest: `docs/physical-fixes-v4-test-artifacts.json`.

## Changed files

Core backend work was confined to existing common time/session/publication helpers and existing admin, announcements, attachments, chats, checklists, employee, line, people, returns, shift and WorkArea services/controllers.

Core frontend work was confined to existing App/store/realtime/navigation, shared ActionModal/confirm/attachment/person picker/scroll-lock components, shared `styles.css`, and existing Admin, Announcements, Chats, Checklists, People, Returns, Shift People and Situation screens.

V4-specific scripts, migrations and browser specs:

- `backend/scripts/physical-fixes-v4-*.js`
- `frontend/e2e/physical-fixes-v4-stage3.spec.ts`
- `frontend/e2e/physical-fixes-v4-stage4.spec.ts`
- `frontend/e2e/physical-fixes-v4-stage5.spec.ts`
- `frontend/e2e/physical-fixes-v4-stage6.spec.ts`
- the three additive migrations listed above

Compatibility-only fixture changes were limited to current contracts in `pilot-pack-v1-regression.js`, `security-privacy-v1-regression.js`, `role-hierarchy-delegation-ui.spec.ts`, and the Stage 44/50 checklist browser fixtures. Backend guards and security assertions were not weakened.

## Screenshots

Thirty screenshots are stored in:

- `docs/physical-fixes-v4-screenshots/stage3/`
- `docs/physical-fixes-v4-screenshots/stage4/`
- `docs/physical-fixes-v4-screenshots/stage5/`
- `docs/physical-fixes-v4-screenshots/stage6/`

## Runtime

- Backend: `http://127.0.0.1:3000`, PID `13232`, `/health` HTTP 200.
- Frontend: `http://127.0.0.1:5173`, PID `13164`, HTTP 200.
- Both local processes remain running.

## Residual risks

1. Installed Android PWA behavior, physical keyboard/camera interactions and actual-device safe areas remain a manual physical-phone gate.
2. The production frontend bundle has the existing Vite large-chunk warning. It does not block startup or tested routes, but remains a later performance optimization.

No Stage68, Docker/setup, backup/restore, `.env` change, upload cleanup or unrelated product expansion was performed.
