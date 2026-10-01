# PHYSICAL FIELD FIXES V5 — Пласт 14

Дата завершения: 25.08.2026.

## Статус

- `PLAST14_STATUS: PASS_WITH_FINAL_PHYSICAL_PENDING`
- P0: 0.
- P1: 0.
- P2: 1 read-only historical warning, не созданный Пластом 14.
- Migration: не нужна; существующая схема разделяет ownership (`ChecklistRun`) и occurrence (`ChecklistRunCheck`).
- `FINAL_ANDROID_GATE: DEFERRED_UNTIL_AFTER_PLAST16`
- `NEXT: PLAST 15 NOT STARTED`

## Canonical implementation

- Lifecycle, guards, reminders, pause и auto-close остались в существующем `checklists.service.ts`.
- Transaction lock и idempotent start остаются backend source of truth.
- Existing WebSocket transport получил только factory-scoped invalidation `checklist_updated`; payload содержит безопасный summary, после события UI перечитывает свой scoped workspace.
- Existing `PremiumSheet`, focused runner и canonical `styles.css` переиспользованы. Новая тема или параллельная checklist-модель не создавались.
- Global archive по умолчанию не изменён: completed occurrences активного run доступны только локальной detail-sheet через отдельный scoped query flag.
- Affected periodic regression теперь штатно закрывает только созданные им active test runs до архивации своих шаблонов; повторный прогон не оставляет active ownership на неактивном template.
- Технический anonymous context больше не используется как фиктивный внешний ключ аудита: deny остаётся 403, а `ACCESS_DENIED` сохраняется без пользователя и недоверенного factory context. Реальные guest/cross-factory actors продолжают аудироваться своими существующими id.

## Product result

- «Доступные» показывает только то, что действительно можно взять.
- «В работе» сохраняет periodic ownership после каждой отдельной проверки и показывает число завершённых проверок за смену.
- One-time checklist после completion исчезает из active flow.
- Duplicate take не создаёт второй ownership или occurrence.
- Сроки имеют короткий countdown/«Пора»/overdue status и deterministic sorting.
- «Подробнее» показывает локальную историю occurrences с исполнителем, ответами, комментариями и фото.
- Template controls сведены к одному входу без переписывания builder.
- Composite numeric + photo проходит двумя UI-substeps, оставаясь одной canonical записью backend.

Полная матрица before/root cause/fix/after/regression: `requirement-status.md`.

## Targeted evidence

| Проверка | Результат |
| --- | --- |
| `physical-field-fixes:v5-plast14-regression` | 50 passed, 0 failed, включая anonymous deny/audit |
| `physical-field-fixes:v5-plast14-e2e` | 1 cohesive journey passed, 0 browser failures |
| `checklists:periodic-lifecycle-regression` | 56 passed, 0 failed |
| Stage44 builder/runner | 27 passed, 0 failed |
| Stage50 library/assignment/archive | 22 passed, 0 failed |
| Stage64 archive journal | 15 passed, 0 failed |
| Stage65 final polish | 13 passed, 0 failed |
| Stage43 attachments | 13 passed, 0 failed |
| Realtime v1 | 7 passed, 0 failed |
| Security/privacy v1 | 17 passed, 0 failed |
| Backend build | PASS |
| Frontend production build | PASS; только известное предупреждение Vite о размере chunk |
| Prisma validate | PASS |
| Prisma migrate status | 52 migrations; database schema up to date |
| Changed JS syntax checks | PASS |
| Affected diff/whitespace check | PASS |
| Targeted UI/security scans | 0 prompt/alert/confirm; 0 mojibake; 0 literal secret values; 0 public sensitive fields; 0 production localhost/LAN targets |

Mobile evidence: viewport 360/390/430, horizontal overflow 0, one-finger scroll PASS, Android Back PASS, sticky footer и safe-area PASS.

Security evidence: anonymous/WORKER/cross-factory mutation = 403/403/403; anonymous deny имеет корректную audit-запись без FK warning; existing department/factory scopes не ослаблены; realtime scoped by factory; публичные responses не раскрывают внутренние пути или секретные значения.

## Cleanup and post-cleanup

- Marker active templates: 0.
- Marker active ownerships/runs/occurrences: 0/0/0.
- Marker active notifications/attachments/test artifacts: 0/0/0.
- Physical deletes: 0.
- Pre-existing entities deleted or unintentionally modified: 0/0.
- Post-cleanup: marker absent, counters coherent, template builder healthy, server errors absent.

## Reference integrity

- Duplicate active ownerships: 0.
- Active runs with multiple active occurrences: 0.
- Ownerships linked to inactive templates: 0.
- P14 active occurrence without active run: 0.
- P14 invalid template snapshot references: 0.
- P14 orphan active answers: 0.
- P14 active marker objects after cleanup: 0.

Read-only global inspection found 723 pre-existing historical occurrences marked `ACTIVE` under runs already `CLOSED` or `AUTO_CLOSED`. New close/auto-close paths now close their active occurrence, and all P14 marker checks are clean. Existing history was not rewritten because its provenance and intended preservation require a separate evidence-led decision; this is recorded as P2 and does not mask an R1-R10 failure.

## Screenshots

Directory: `docs/physical-field-fixes-v5-plast14/`.

1. `01-available-compact-390.png`
2. `02-in-work-countdown-390.png`
3. `03-in-work-due.png`
4. `04-duplicate-prevented.png`
5. `05-runner-numeric.png`
6. `06-composite-photo-step.png`
7. `07-detail-history.png`
8. `08-post-cleanup.png`

Machine-readable evidence: `test-artifacts.json`.

## Changed files

- `backend/src/modules/checklists/checklists.service.ts`
- `backend/src/common/audit.service.ts`
- `backend/src/common/user-context.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast14-regression.js`
- `backend/scripts/checklist-periodic-lifecycle-regression.js`
- `backend/package.json`
- `frontend/src/screens/ChecklistsScreen.tsx`
- `frontend/src/styles.css`
- `frontend/src/ws/client.ts`
- `frontend/e2e/physical-field-fixes-v5-plast14.spec.ts`
- `frontend/scripts/physical-field-fixes-v5-plast14-e2e.js`
- `frontend/package.json`
- `docs/physical-field-fixes-v5-plast14/`

No tunnel, QR, public smoke or physical-phone PASS was produced. Temporary P14 backend/frontend processes were stopped; ports 3000/5173 are free.
