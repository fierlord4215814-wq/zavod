# Physical Field Fixes V2: requirement status

Дата классификации: 19.07.2026. Источник требований: `codex_zavod_physical_field_fixes_v2/REQUIREMENTS_LEDGER.md`.

## Сводка

| Classification | Count |
|---|---:|
| `EXISTS_AND_ACTIVE` | 146 |
| `EXISTS_NOT_CONNECTED` | 60 |
| `OLD_SCREEN_ACTIVE` | 4 |
| `LAYOUT_BROKEN` | 49 |
| `STALE_PWA_BUNDLE` | 0 |
| `REALLY_MISSING` | 47 |
| **Всего** | **306** |

`STALE_PWA_BUNDLE = 0` означает только текущий inspected checkpoint: dist новее source и preview отдает этот dist. Финальный cache/update gate остается обязательным в Stage 05.

## Классификация каждого ID

**EXISTS_AND_ACTIVE (146):** A01, A02, A03, A04, A05, A06, A07, A08, A09, A11, B03, B10, B11, B12, B13, C02, C03, C07, C08, C10, C15, C16, C19, C22, D06, D07, D08, D10, D11, D13, D14, D15, F04, F05, F08, F09, F10, F15, F16, F20, F21, F22, F23, F24, F25, F26, F27, G02, G03, G04, G06, G08, G09, G10, G11, G12, G14, G15, G16, G20, G21, G22, G23, G24, G25, G28, G29, H03, H10, J01, J02, J03, J06, J07, J08, J09, J14, J15, J18, J19, J20, J21, J22, J23, J24, J27, J28, J30, J32, J33, J34, J35, J36, J37, J38, J39, J40, K01, K07, K08, K09, K11, K12, L01, L02, L06, L21, L22, L23, L25, L26, L27, L29, L30, L31, L32, L33, M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14, M15, M20, M21, M22, M23, M24, M25, M26, M29, N15, N16, O01, O11, O12, O16.

**EXISTS_NOT_CONNECTED (60):** A12, B02, C11, C12, C14, C17, C20, D04, E10, F01, F06, F11, G01, G05, G13, G27, I01, I02, I03, I04, I05, I06, I07, I08, I09, I10, I11, I12, I13, I14, I15, J12, J16, K10, L03, L04, L07, L08, L09, L10, L11, L12, L13, L14, L15, L16, M17, O02, O03, O04, O05, O06, O07, O08, O09, O10, O13, O14, O15, O17.

**OLD_SCREEN_ACTIVE (4):** B04, B05, C01, C05.

**LAYOUT_BROKEN (49):** A10, E01, E02, E03, E09, E15, E16, F02, F03, F07, F12, F14, F17, F19, G26, H01, H02, H04, H05, H06, H07, H08, H09, J04, J05, L18, L19, L20, L24, L28, M16, M18, M19, M27, M28, N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11, N12, N13, N14.

**STALE_PWA_BUNDLE (0):** нет подтвержденных ID на текущем runtime.

**REALLY_MISSING (47):** B01, B06, B07, B08, B09, C04, C06, C09, C13, C18, C21, D01, D02, D03, D05, D09, D12, E04, E05, E06, E07, E08, E11, E12, E13, E14, F13, F18, G07, G17, G18, G19, J10, J11, J13, J17, J25, J26, J29, J31, K02, K03, K04, K05, K06, L05, L17.

## Evidence и reuse plan по ID-группам

Каждый ID выше наследует source/gap/test/risk/data-impact своей буквенной группы; исключения отражены его индивидуальной classification.

| IDs | Canonical source и active route | Real gap / reuse plan | Targeted evidence | Risk / data impact |
|---|---|---|---|---|
| A01-A12 | canonical map doc и перечисленные source paths | не создавать parallel contours; reconnect item constructor | source assertions + read-only route smoke | low; no data/schema |
| B01-B13 | `App.tsx`, `GuestAssignmentRequestCard`, auth/admin assignment services, ErrorReport | отдельный Home; atomic server option поверх текущей request/review модели | Guest UI/API, incompatible option deny, live refresh | P1 RBAC; no migration |
| C01-C22 | `App.tsx`, app store, `mobile-back.ts`, shared modals | role-home persistence, keyboard/layer/step/source history, standalone pull protection | cold/reload/logout/factory/back/pull/draft E2E | P1 state-loss; local/session state only |
| D01-D15 | `permissions.ts`, App shell counters, notifications/announcements/chats/tasks read models | configurable allowed slots; chat/task attention aggregation; one badge function | role menu matrix + badge relevance | P2; no data write |
| E01-E16 | `ShiftPeopleScreen`, `/shift/timeline` | compact selector + four operational entry squares | MASTER current mobile E2E | P2 layout/read-model |
| F01-F27 | line dashboard/board, line service, line-plan routes | shared compact line/slot presentation; main ordering; quick actions | line/slot/plan/idempotency + 360/390/430 | P1 current action safety; no migration |
| G01-G29 | assignment controller/services, work areas, employee send-home, people search | sequential sheets over same command paths; working-line start handoff | operationId/concurrency/RBAC/send-home/history | P1 assignment; no new engine |
| H01-H10 | current workforce data + profile | compact `На смене` rows | mobile geometry/profile smoke | P2 layout only |
| I01-I15 | line status events/tasks explicit relation | current-shift scoped downtime/request aggregate | boundary/filter/explicit-link/API tests | P1 read-scope; no schema |
| J01-J40 | shift timeline/future, line planning, planned assignments, contractor submissions, shift-time | add missing metrics/status/invitation connections without mixing fact | boundary/rollover/concurrency/privacy/company tests | P1 time/RBAC; existing tables |
| K01-K12 | `/shift/past`, past detail, actual ShiftSession/Assignment history | calendar presentation and self-only route | calendar + spoof deny | P2 UI; read-only |
| L01-L33 | checklist template/row routes and row editor in `ChecklistsScreen` | reconnect one constructor to create/edit/duplicate; validate active rows; dedupe selector | CRUD/duplicate/RBAC/factory/keyboard | P1 template integrity; no migration expected |
| M01-M29 | checklist runs/checks/cycles/reminders and guided runner | compact active runner, preserve lifecycle | lifecycle/reminders/auto-close/runner mobile | P1 lifecycle; no data rewrite |
| N01-N16 | checklist workspace/available/archive read models | clickable four-state home, one selected list, secondary management | counts/filter/RBAC mobile E2E | P2 layout/read state |
| O01-O17 | builds/Prisma/security suites, PWA and mobile-pilot scripts | execute only after Stages 01-04; physical remains pending | one full sweep + public runtime | operational only; no data cleanup |

## Migration decision

`MIGRATION_NEEDED: NO` по текущему discovery. Atomic Guest options являются безопасным server read-model/opaque option contract; current/future/checklist данные уже поддерживаются существующей schema. Если реализация обнаружит schema-only invariant, работа должна остановиться до отдельного доказательства необходимости.
