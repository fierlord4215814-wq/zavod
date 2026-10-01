# PHYSICAL FIELD FIXES V5 - Пласт 6: состояние требований

Дата evidence: 09.08.2026.

## Итог по продукту

- Единая частичная выдача количества реализована в существующих контурах ОКК и возвратов.
- Исходное количество остаётся неизменным; выданное количество хранится в immutable ledger; остаток вычисляется backend.
- Полная выдача остатка переводит существующую родительскую запись в штатный архив.
- RBAC, factory scope, blocked/deactivated и cross-factory denial остаются backend-ограничениями.
- P0: 0.
- P1: 0.
- P2: 0.

## Acceptance gates

| Gate | Статус | Evidence |
| --- | --- | --- |
| PARTIAL_QUANTITY_MODEL_GATE | PASS | Общая таблица `QuantityReleaseOperation` для OKK/RETURN |
| ORIGINAL_QUANTITY_PRESERVED_GATE | PASS | Regression подтверждает неизменность 52 после всех выдач |
| REMAINING_QUANTITY_GATE | PASS | Backend выводит 52 / 30 / 22 |
| PARTIAL_OPERATION_HISTORY_GATE | PASS | Immutable операции доступны в detail и архиве |
| COMMENT_REQUIRED_GATE | PASS | Пустой комментарий отклоняется backend |
| OKK_PARTIAL_RELEASE_GATE | PASS | OKK 52 -> 30 -> 22 |
| OKK_ARCHIVE_HISTORY_GATE | PASS | Операция видна отдельно, родитель не дублируется |
| RETURN_PARTIAL_RELEASE_GATE | PASS | Возврат 52 -> 30 -> 22 |
| RETURN_ARCHIVE_HISTORY_GATE | PASS | Операция видна отдельно, родитель не дублируется |
| FULL_RELEASE_AUTO_ARCHIVE_GATE | PASS | Выдача полного остатка атомарно архивирует родителя |
| OVER_RELEASE_DENY_GATE | PASS | Сверхостаток, ноль и отрицательное значение запрещены |
| UNIT_CONSISTENCY_GATE | PASS | Единица берётся с родителя и не меняется запросом |
| ATOMIC_QUANTITY_GATE | PASS | Ledger и архивирование выполняются в одной транзакции |
| CONCURRENT_RELEASE_GATE | PASS | Два параллельных запроса 30 + 30 дают один успех и один 409 |
| IDEMPOTENCY_GATE | PASS | Повторный `operationId` не создаёт вторую операцию или realtime event |
| REPORT_NO_DOUBLE_COUNT_GATE | PASS | Сводка продолжает считать родительские случаи, не ledger rows |
| AUDIT_GATE | PASS | Audit хранит before/released/after/comment для каждой операции |
| REALTIME_GATE | PASS | Событие отправляется только после подтверждённого commit |
| RBAC_GATE | PASS | Read-only и blocked пользователи не могут выполнить mutation |
| FACTORY_ISOLATION_GATE | PASS | Cross-factory source mutation запрещена |
| LEGACY_DATA_SAFETY_GATE | PASS | Backfill не выполнялся; старые записи не переписывались |
| CLEANUP_GATE | PASS | Активных тестовых OKK/Return/partial records: 0/0/0 |
| PARTIAL_RELEASE_MOBILE_GATE | BLOCKED_EXTERNAL_BROWSER_RUNTIME | Единственная штатная Vite-попытка остановлена внешним `Access is denied` |
| ARCHIVE_MOBILE_GATE | BLOCKED_EXTERNAL_BROWSER_RUNTIME | Playwright spec компилируется и обнаруживается, runtime недоступен |

## Проверки

- `physical-field-fixes:v5-plast6-regression`: PASS, failures `[]`.
- `stage16:quality-stock-returns-regression`: PASS после обоснованного compatibility update read-only fixture.
- `stage27:store-returns-work-areas-regression`: PASS, 43 checks, 0 failures.
- `stage18:ops-audit-regression`: PASS, failures `[]`.
- `realtime:v1-regression`: PASS, failures `[]`.
- `security:privacy-v1-regression`: PASS.
- Backend build: PASS.
- Frontend build: PASS; только известные предупреждения Vite CJS/large chunk.
- Prisma validate: PASS.
- Prisma migrate status: PASS, 52 migrations, schema up to date.
- Browser E2E compile/list: PASS, один targeted test найден.
- Destructive SQL scan: PASS, запрещённые операции отсутствуют.
- Browser dialog scan: PASS, вызовов `window.prompt/alert/confirm` нет.
- Secret value scan: PASS, literal credentials/passwordHash/storagePath/token/secret values не найдены.
- Mojibake scan: PASS; два найденных маркера в archive service являются decode-guards, а не пользовательским текстом.
- Diff/trailing whitespace check: PASS.
- `stage26:line-skills-okk-table-regression`: не дошёл до продуктовых assertions из-за отсутствующего seed-only шаблона линий. Seed не запускался; обязательный quality contour покрыт `stage16` и targeted regression.

## Cleanup

- CLEANUP_GATE: PASS.
- ACTIVE_TEST_OKK_RECORDS: 0.
- ACTIVE_TEST_RETURN_RECORDS: 0.
- ACTIVE_TEST_PARTIAL_OPERATIONS: 0.
- PREEXISTING_ENTITIES_DELETED: 0.
- Тестовые родители закрыты штатными archive endpoints; marker-tagged immutable audit/history сохранены по действующей политике.

## Финальный статус evidence

Продуктовые backend/data/business gates: PASS.

Visual-only evidence: BLOCKED_EXTERNAL_BROWSER_RUNTIME.

FINAL_STATUS: BLOCKED

Причина `BLOCKED` только в отсутствии browser runtime evidence. Это не продуктовый P1 и не свидетельство дефекта частичной выдачи.
