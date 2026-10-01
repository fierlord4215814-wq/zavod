#014/050 — ограниченный extractor specification, EXECUTION_DISABLED

ACCESS_AUTHORITY=ABSENT_FOR_HISTORICAL_DATA. R4 fresh synthetic permission DOES_NOT authorize this extractor. No DB URL/env reader, driver import or connection is shipped/run here. R3 default-deny gate explicitly rejects014 historical execution; do not fake its forbidden hashes/fixture prefixes. A data adapter can only be bound under a separate approved historical read-only scope. Ни рабочая БД, ни protected business snapshots R4 не читались.

##014 exact bounded query, NOT EXECUTED

В отдельно разрешённой исторической среде: read-only role/transaction, statement timeout5s, row cap2 to detect ambiguous actor bindings. Параметр operationId — exact `__PFFV5_P17C_BROWSER_1788105576992__:wash-start`, не LIKE. Выборка:

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT p."userId", p."operationId", p."resultKey", p."createdAt",
       w."id", w."factoryId", w."startedById", w."targetType", w."lineId",
       w."status", w."createdAt" AS "sessionCreatedAt", w."completedAt", w."deletedAt"
FROM "ProcessedOperation" p
LEFT JOIN "WashSession" w ON w."id" = p."resultKey"
WHERE p."operationId" = $1
ORDER BY p."createdAt", p."id"
LIMIT 2;
ROLLBACK;
```

Поля сверены с текущей schema; SQL prepared specification, не выполненная валидация PostgreSQL. У actual WashSession нет startedAt: используется createdAt с явным alias sessionCreatedAt, не выдуманный столбец из прежнего R3 плана. Missing row/null resultKey/missing parent остаётся MISSING. Two rows/conflicting actor/factory — CONFLICTING. Один row сам по себе ещё не UNIQUE: нужен независимый original invocation(actor/factory/owner WashService.startWash/operationId/returned session). Совпадение имени/UUID/child-hide/complete недостаточно. Без этого extractor output UNKNOWN, никаких projection/cleanup writes. Из external handoff исключить реальные user identities и business fields.

##050 finite extraction contract, NOT EXECUTED

Вход будущего adapter: явный separately approved manifest с ограниченным списком точных IDs и entity kinds Line/Chat/Department/ContractorCompany/Factory, selected factory, owner schema hash, сроком, row limit. Никакой discovery-query `name LIKE '%PILOT%'`, scanning всех tables или guessed ID registry. Source literals232/occurrences1105 — список исследованных строк кода, не вход автоматически одобренных persisted IDs.

Выход: только entityKind/id/factoryId/createdAt/deletedAt/isActive где поле существует; exact documented provenance key/creator relation и независимый invocation receipt, не имена/comments/contact data. Нельзя выбирать одинаковый набор колонок для всех моделей без schema mapping. По отсутствующему полю/неизвестному kind/ID вне manifest — fail closed доquery. Recheck target before each bounded chunk; максимум100IDs/тип, row cap inputLength+1; превышение требует нового scope, не автопагинацию всей БД.

Классы результата: PROVEN_FIXTURE только exact persisted+invocation proof; HUMAN_LOOKALIKE — отдельно подтверждённое обычное происхождение; UNKNOWN при одном похожем названии, source literal, нет creator/return chain или конфликте. Классификатор продукта R4 не меняет ни один класс. Диагностика/архив сохраняют историю; занятость IN_PROGRESS не освобождается.

Готова bounded specification, но production connection adapter намеренно **NOT_IMPLEMENTED/NOT_AUTHORIZED**, не “готовый живой extractor”. Завершить привязку adapter и отрицательные pre-import/network/row-limit/foreign-id проверки возможно только после предоставления разрешённого historical target. Это явный остаток G, не замаскированный PASS. R3/R4 isolated human/fixture/UNKNOWN cases проверяют правило, не происхождение фактических данных.
