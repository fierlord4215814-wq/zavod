# PHYSICAL FIELD FIXES V5 - Пласт 6: финальный отчёт

Дата завершения: 09.08.2026.

## 1. Canonical owner ОКК

Существующий контур `backend/src/modules/okk` остаётся единственным владельцем забракованной продукции. Новый endpoint частичной выдачи добавлен в его controller/service/module; второй OKK-модуль не создавался.

## 2. Canonical owner Returns

Существующий контур `backend/src/modules/returns` остаётся единственным владельцем возвратов. Частичная выдача использует его lifecycle, guards и factory scope.

## 3. Существующая семантика количества и единиц

- OKK хранит исходное количество в `OkkRecord.defectQuantity` как nullable text с нормализацией поддерживаемых единиц.
- Return хранит nullable integer `quantity` и nullable text `unit`.
- Legacy-записи без надёжного положительного количества или единицы остаются читаемыми, но не получают действие частичной выдачи.

## 4. Выбранная модель partial operation

Добавлен один общий immutable ledger `QuantityReleaseOperation` с типом источника OKK/RETURN, ссылкой на существующего родителя, factory/actor, before/released/after, unit, обязательным comment, timestamp и уникальным `operationId`.

## 5. Migration

Migration потребовалась, потому что существующие parent records не могли хранить несколько неизменяемых выдач, их автора, комментарий и before/after без потери исходного количества. Migration только additive: enum, таблица, индексы и foreign keys. В SQL нет DROP, TRUNCATE, production DELETE, destructive rewrite или legacy backfill. Она применена; Prisma видит 52 migrations и актуальную schema.

## 6. Сохранение original quantity

Количество в родительской OKK/Return записи не уменьшается. После первой выдачи его редактирование запрещается backend, поэтому база расчёта не меняется задним числом.

## 7. Расчёт released

`released` является суммой подтверждённых immutable ledger operations конкретного родителя внутри его factory. Операции не превращаются в новые случаи брака или возврата.

## 8. Расчёт remaining

Backend получает остаток из последнего `quantityAfter`; до первой операции он равен original. Клиент не присылает доверенный остаток и не может изменить единицу.

## 9. Пример 52 -> 30 -> 22

Targeted regression создала OKK и Return с исходным количеством 52, выполнила выдачу 30 и подтвердила: original 52, released 30, remaining 22 в API и history.

## 10. Последовательные выдачи

Для OKK проверена последовательность 30, затем 10, затем 12. Каждая операция сохраняет собственные before/after/comment, а history остаётся хронологической и неизменяемой.

## 11. Full release и archive

Если выдаётся ровно весь остаток, ledger operation и штатное soft-архивирование parent выполняются в одной транзакции. Parent исчезает из active list и остаётся доступным в архиве вместе с полной историей.

## 12. Защита от over-release

Backend под lock повторно читает актуальный остаток. Значение больше остатка, ноль, отрицательное значение, пустой comment и несовпадающая unit отклоняются русской доменной ошибкой.

## 13. Concurrency

Используются PostgreSQL transaction advisory locks по источнику и `operationId`. В тесте два одновременных запроса 30 + 30 к остатку 52 дали ровно один commit и один conflict 409; отрицательного остатка и двух активных операций не возникло.

## 14. Idempotency через operationId

Повтор того же запроса тем же actor/source возвращает уже созданный результат. Новый ledger row, audit и realtime event не создаются. Использование идентификатора для другого source/actor отклоняется.

## 15. Обязательный comment

Comment валидируется и нормализуется backend, хранится в ledger и audit. Пустая или состоящая из пробелов причина запрещена.

## 16. History и archive

Detail показывает original/released/remaining и список операций с количеством, единицей, причиной, автором и временем. Unified archive отображает операции как «Частичная выдача» отдельно от parent. Фильтр partial release не дублирует родительские карточки.

## 17. Защита от double-count

Операционные KPI продолжают считать существующие OKK/Return parent records. Ledger rows доступны как история действий, но не увеличивают количество дефектов или возвратов. Target regression сравнила module summary до и после выдачи.

## 18. RBAC и factory isolation

Mutation требует существующие `okk.manage` или `returns.manage` и действующий factory access. WORKER/read-only не видит action и получает backend deny при прямом запросе. Blocked user и cross-factory source также получают deny. Guest-доступ не добавлялся.

## 19. Audit и realtime

Audit пишется в той же транзакции и содержит полезный смысл: before, released, after, comment и actor. Factory-scoped realtime `QUANTITY_RELEASE_UPDATED` отправляется только после commit и не повторяется при idempotent retry.

## 20. Legacy data treatment

Существующие записи не переписывались и не получали выдуманные операции. Архивный fingerprint до/после regression совпал. Partial action доступен только там, где original quantity и unit можно однозначно нормализовать.

## 21. Backend targeted tests

- Собственная regression: PASS, включая OKK/Return, 52 -> 30 -> 22, sequential/full release, over-release, comment/unit, idempotency, concurrency, audit, realtime, RBAC, cross-factory, legacy safety и cleanup.
- `stage16`: PASS после compatibility update старого ожидания. WORKER/CONTRACTOR сохраняют чтение возвратов, но не получают `partial-release`; прямой mutation по-прежнему запрещён.
- `stage27`: PASS, 43/0.
- `stage18`: PASS.
- Realtime regression: PASS.
- Security/privacy regression: PASS.
- `stage26` остановился до assertions: в pilot-БД отсутствует его seed-only line-template fixture. Seed не запускался и guards не изменялись.

## 22. Browser evidence

Targeted Playwright spec создан и успешно проходит compile/list. Выполнена ровно одна штатная Vite runtime попытка. Она завершилась внешней ошибкой доступа файлового sandbox: `Cannot read directory "../../..": Access is denied`; frontend process не был поднят, записи и screenshots не создавались. По условиям goal повторные попытки и обходной runtime не выполнялись.

PARTIAL_RELEASE_MOBILE_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME.

ARCHIVE_MOBILE_GATE: BLOCKED_EXTERNAL_BROWSER_RUNTIME.

## 23. Cleanup

Последний run записан в `test-artifacts.json`. Активных тестовых OKK records, Return records и partial operations на активных родителях: 0/0/0. Предсуществующие сущности физически не удалялись. Immutable marker-tagged history/audit оставлены по действующей политике.

## 24. P0/P1/P2

- P0: 0.
- P1: 0.
- P2: 0.
- Внешний browser runtime gap учитывается отдельно и не классифицируется как продуктовый дефект.

## 25. Изменённые файлы

Backend и schema:

- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260809150000_physical_field_fixes_v5_plast6_partial_release/migration.sql`
- `backend/src/common/quantity-release.service.ts`
- `backend/src/common/operation-lock.ts`
- `backend/src/ws/events.ts`
- `backend/src/modules/okk/okk.controller.ts`
- `backend/src/modules/okk/okk.module.ts`
- `backend/src/modules/okk/okk.service.ts`
- `backend/src/modules/returns/returns.controller.ts`
- `backend/src/modules/returns/returns.module.ts`
- `backend/src/modules/returns/returns.service.ts`
- `backend/src/modules/archive/archive.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast6-regression.js`
- `backend/scripts/stage16-quality-stock-returns-regression.js`

Frontend:

- `frontend/package.json`
- `frontend/e2e/physical-field-fixes-v5-plast6.spec.ts`
- `frontend/src/components/QuantityRelease.tsx`
- `frontend/src/screens/OkkScreen.tsx`
- `frontend/src/screens/ReturnsScreen.tsx`
- `frontend/src/screens/ArchiveScreen.tsx`
- `frontend/src/store/app.store.ts`
- `frontend/src/ws/client.ts`
- `frontend/src/styles.css`

Evidence:

- `docs/physical-field-fixes-v5-plast6/discovery.md`
- `docs/physical-field-fixes-v5-plast6/requirement-status.md`
- `docs/physical-field-fixes-v5-plast6/final-report.md`
- `docs/physical-field-fixes-v5-plast6/test-artifacts.json`

## 26. Все acceptance gates

Все backend/data/business acceptance gates имеют PASS, включая model, original, remaining, history, comment, OKK, Returns, full release, over-release, unit, atomicity, concurrency, idempotency, report, audit, realtime, RBAC, factory isolation, legacy safety и cleanup.

Два visual-only gates имеют `BLOCKED_EXTERNAL_BROWSER_RUNTIME` из-за внешнего Vite/browser ограничения. Это единственная причина, по которой общий evidence status не отмечен полным PASS.

## Финальный статус

FINAL_STATUS: BLOCKED

Продуктовая реализация и backend evidence: PASS. Блокировка относится только к недоступному внешнему browser runtime. Пласт 7 не начат.
