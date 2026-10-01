# PHYSICAL FIELD FIXES V5 — Пласт 4: requirement status

Дата: 08.08.2026.

## Реализация

| Требование | Статус | Evidence |
|---|---|---|
| Единая семантика active/disabled actions | PASS | `PremiumActionItem`, общие gold/green/red/blue/neutral variants |
| Compact line actions | PASS | 68–76 px rows, whole-row click, human disabled reason, `Открыть мойку` |
| Requests filter sheet | PASS | compact trigger, shared sheet, Reset/Show, summary |
| Human request close labels | PASS | `Закрыть окно` отдельно от `Завершить заявку` |
| Compact People top/list/profile | PASS | 3 KPI, status segments, sheet, dedupe formatter, один assignment block |
| Profile scroll/footer contract | IMPLEMENTED | shared body lock/Back, bottom padding; browser execution blocked externally |
| Line history/stats compactness | IMPLEMENTED | one scroll, compact period controls, bounded 2x2 stats |
| Stock/orders and handover filter sheets | PASS | shared sheet, visible labels, selected tabs |
| Human notifications | PASS | list/read/WS/push use one presenter; DB payload remains raw |
| Compact settings | PASS | one hierarchy control, compact toggles, human permission copy |
| Delegation flow | PASS | existing candidate resolver/permission plan retained; one picker/help sheet |
| Error report mobile/draft | PASS | one attachment trigger, existing draft guard, in-app confirmation |
| WorkArea summary/slots | PASS | `Нужно / Назначено / Не хватает`, group-level requirement action |
| No second UI/system contour | PASS | canonical files only |

## Acceptance gates

- `ACTION_VISUAL_SEMANTICS_GATE: PASS`
- `LINE_ACTIONS_COMPACT_GATE: PASS`
- `REQUEST_FILTER_SHEET_GATE: PASS`
- `REQUEST_CLOSE_LABEL_GATE: PASS`
- `PEOPLE_FILTER_SHEET_GATE: PASS`
- `PEOPLE_LIST_COMPACT_GATE: PASS`
- `EMPLOYEE_PROFILE_COMPACT_GATE: PASS`
- `EMPLOYEE_PROFILE_SCROLL_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME`
- `LINE_HISTORY_LAYOUT_GATE: IMPLEMENTED_BROWSER_PENDING`
- `LINE_HISTORY_NAV_GATE: IMPLEMENTED_BROWSER_PENDING`
- `LINE_STATS_COMPACT_GATE: IMPLEMENTED_BROWSER_PENDING`
- `STOCK_FILTER_SHEET_GATE: PASS`
- `STOCK_TAB_VISUAL_GATE: PASS`
- `HANDOVER_FILTER_SHEET_GATE: PASS`
- `NOTIFICATION_HUMAN_TEXT_GATE: PASS`
- `NOTIFICATION_COMPACT_GATE: PASS`
- `SETTINGS_MOBILE_GATE: PASS`
- `DELEGATION_CANDIDATE_GATE: PASS`
- `DELEGATION_COMPACT_GATE: PASS`
- `ERROR_REPORT_MOBILE_GATE: PASS`
- `ERROR_REPORT_DRAFT_GATE: PASS`
- `WORKAREA_SUMMARY_GATE: PASS`
- `WORKAREA_SLOT_COMPACT_GATE: PASS`
- `MODAL_STACK_REGRESSION_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME`
- `PWA_ONE_FINGER_SCROLL_REGRESSION_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME`
- `RBAC_GATE: PASS`
- `FACTORY_ISOLATION_GATE: PASS`
- `MOBILE_LAYOUT_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME`
- `CLEANUP_GATE: PASS`

## Проверки

- Backend build: PASS.
- Frontend build: PASS; только известные Vite CJS/large chunk warnings.
- Prisma validate: PASS.
- PFFV5 Plast 4 backend regression: 17 passed, 0 failed.
- Error report affected regression: 18 passed, 0 failed.
- Bearer runtime denies: ordinary delegation 403; notification cross-factory 403; ADMIN delegation foreign factory 403.
- Playwright spec compile/list: PASS, 2 tests.
- `git diff --check`: PASS.
- Changed-file prompt/alert/confirm scan: PASS.
- Changed-file mojibake scan: PASS; единственное совпадение находится в защитном regex E2E.
- Secret/storage scan: PASS; `storagePath` встречается только во внутренней записи Attachment, публичный DTO использует explicit serializer без этого поля.

## Внешний blocker

Targeted browser E2E и screenshots не запущены. В workspace sandbox `vite preview` получает `Access is denied` при загрузке `frontend/vite.config.ts`; разрешённый внешний preview был отклонён внешним usage-limit approval-сервиса Codex. Это не ошибка build или startup-кода проекта. Ложный mobile PASS не выставлялся.

P0: 0 известных.

P1: 0 известных по code/backend evidence; visual acceptance остаётся неполной до запуска browser E2E.

P2: 1 внешний verification gap — browser execution/screenshots.

