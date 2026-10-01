# PHYSICAL FIELD FIXES V5 — Пласт 8: статус требований

Дата проверки: 09.08.2026.

## Fixture cleanup

- `PILOT_FIXTURE_INVENTORY_GATE`: PASS.
- `PILOT_FIXTURE_OPERATIONAL_CLEANUP_GATE`: PASS.
- `REAL_DATA_SAFETY_GATE`: PASS.
- Одна доказанная запись «Проверка пересменки для пилота» штатно soft-архивирована. В operational API мастера совпадений нет, в архиве запись сохранена, audit `SHIFT_LOG_ENTRY_UPDATED` записан.
- `POSSIBLE_REAL_DATA` не изменялись. Physical delete, reset, drop и truncate: 0.

## Checklist user UX

- `CHECKLIST_MAIN_NAV_GATE`: PASS — «В работе / Доступные / Архив».
- `CHECKLIST_ACTIVE_LIST_GATE`: PASS.
- `CHECKLIST_AVAILABLE_LIST_GATE`: PASS.
- `CHECKLIST_ARCHIVE_GATE`: PASS.
- `CHECKLIST_TAKE_IN_WORK_GATE`: PASS.
- `CHECKLIST_PERSONAL_INSTANCE_GATE`: PASS.
- `CHECKLIST_FOCUSED_RUNNER_GATE`: PASS.
- `CHECKLIST_PROGRESS_GATE`: PASS.
- `CHECKLIST_ITEM_TYPES_GATE`: PASS.
- `CHECKLIST_NUMBER_ISSUE_GATE`: PASS.
- `CHECKLIST_COMMENT_POLICY_GATE`: PASS.
- `CHECKLIST_PAUSE_RESUME_GATE`: PASS.
- `CHECKLIST_AUTOCLOSE_GATE`: PASS.
- `CHECKLIST_REMINDER_GATE`: PASS.

## Template builder

- `CHECKLIST_BUILDER_MAIN_GATE`: PASS.
- `CHECKLIST_BUILDER_SCOPE_GATE`: PASS.
- `CHECKLIST_BUILDER_PERIODICITY_GATE`: PASS.
- `CHECKLIST_BUILDER_ITEMS_GATE`: PASS.
- `CHECKLIST_ITEM_EDITOR_GATE`: PASS.
- `CHECKLIST_ITEM_ORDER_GATE`: PASS.
- `CHECKLIST_PREVIEW_GATE`: PASS; preview не создаёт run.
- `CHECKLIST_ACTIVE_EXECUTION_SNAPSHOT_GATE`: PASS.
- `CHECKLIST_NEW_REVISION_GATE`: PASS.
- `CHECKLIST_TEMPLATE_ARCHIVE_GATE`: PASS.
- Подтверждение новой версии отображается над `PremiumSheet` и доступно без force-click.

## Future plan picker

- `FUTURE_PLAN_PICKER_COMPACT_GATE`: PASS.
- `FUTURE_PLAN_LONG_NAME_GATE`: PASS.
- `FUTURE_PLAN_WHOLE_ROW_ACTION_GATE`: PASS.
- `FUTURE_PLAN_STICKY_FOOTER_GATE`: PASS.
- `FUTURE_PLAN_SAFE_AREA_GATE`: PASS.
- Все активные реальные линии доступны; искусственного ограничения первых 18 строк нет.

## Common gates

- `RBAC_GATE`: PASS.
- `FACTORY_ISOLATION_GATE`: PASS.
- `REALTIME_GATE`: PASS по связанным существующим regression gates; новый realtime-контур не создавался.
- `ONE_FINGER_SCROLL_GATE`: PASS.
- `ANDROID_BACK_GATE`: PASS по canonical `PremiumSheet`/mobile-back контракту.
- `SAFE_AREA_GATE`: PASS.
- `MOBILE_360_GATE`: PASS.
- `MOBILE_390_GATE`: PASS.
- `MOBILE_430_GATE`: PASS.
- `DESKTOP_SMOKE_GATE`: PASS.
- `NO_HORIZONTAL_OVERFLOW_GATE`: PASS.
- `CLEANUP_GATE`: PASS.

## Automated evidence

- Checklist workflow: 80 passed, 0 failed.
- Periodic lifecycle: failures 0.
- Department-first: 16 passed.
- Stage13: failures 0.
- Stage44: 27 passed.
- Stage50: 22 passed.
- Stage64: 15 passed.
- Stage65: 13 passed.
- Stage66: failures 0.
- Stage48 future planning: 27 passed, 0 failed.
- Stage14 shift log and safe archive: failures 0.
- Browser E2E: 3 passed, 0 failed.
- Backend build: PASS.
- Frontend build: PASS; остаётся известное неблокирующее предупреждение Vite о размере chunk.
- Prisma validate: PASS.
- Prisma migrate status: 52 migrations, schema up to date.

## Severity

- P0: 0.
- P1: 0.
- P2: 0 по automated evidence Пласта 8.
- `PHYSICAL_PHONE_GATE`: PENDING до подтверждения пользователя на реальном Android.
