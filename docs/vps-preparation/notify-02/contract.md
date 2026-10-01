# Current contract и подтверждённое before

27.09.2026. Authority — current source; [исходные hashes](before.json). [SQL before](fault-before.json): все6 событий/7вариантов действительно теряют required Notification после business commit: первыйHTTP500, replay/scan201, notification0. Исторический source inventory не использовался вместо этого доказательства.

| Событие | Persistent representation/получатели | Повтор/resolve до исправления |
|---|---|---|
| ORDER_REQUEST_CREATED department | Department-scoped личные rows: active/nonGuest/not blocked/deleted UFA данного отдела OR ADMIN, active factory, operational filter | ProcessedOperation replay пропускает notify |
| ORDER_REQUEST_CREATED без department | **Одна factory-scoped row, userId=null/departmentId=null**, не snapshot всех пользователей | Visibility определяется текущим guard; не расширять в персональные строки |
| ORDER_STOCK_BELOW_THRESHOLD | MANAGEMENT/ADMIN по usersByRoles; при department ограничение department OR ADMIN; rows user-specific, department=null | Только TAKE и afterQuantity<=minThreshold и enabled. Dedupe по item/type/user; RESTOCK не rearm.10→7→6→10→7 сохраняет те же rows. Archive читает старые rows, но readAt не часть dedupe |
| ORDER_REQUEST_CLOSED | Creator + MANAGEMENT выбранного department; distinct personal rows с department=request.departmentId | Сначала resolve ВСЕХ unread entity rows, затем новый CLOSED; same-status retry снова resolve, включая уже существующий CLOSED |
| TASK_DONE | Creator, personal department=null | Resolve всех unread entity rows, затем DONE. Same-op/уже DONE retry снова resolve, включая DONE notice; права источника проверяются текущие |
| TASK_REDIRECTED | Результат redirect: active assignees personal + department-scoped active recipients OR ADMIN | Resolve только changed. Dedupe type/entity/factory/department/user, **не отдельный operationId**; известный tuple повторно не создаётся даже при следующем redirect. Late replay не новый set |
| TASK_LONG_ESCALATED | Creator + active assignees + MANAGEMENT factory/department по текущему resolver, distinct personal rows | Следующий scan исключает escalatedAt!=null. Нет ProcessedOperation; [реальная гонка двух scanner](contract-before.json) дала history2/audit2 при одном entity |

`sameEventWhere/key` не включает readAt; operationId у этих notification events=null. Выдача дедуплицирует scoped rows в feed. Историческая строка не даёт вечный доступ к source. Explicit creator/assignee persistence и текущая delivery authority — разные стадии: не подменять existing policy фильтром «по вкусу».

[ReadAt before proof](contract-before.json): обычные DONE/CLOSE читали старые rows, создавали новое unread event; неизменённый повтор делал и его read. Эту семантику сохранить: persistent resolve становится tx-bound, count WS — postcommit. Простая ретрансляция на каждом replay запрещена.

Реализованный fix ограничен existing NotificationsService/OrdersService/TaskService:6 tx-persist helpers поверх createOnceTx, tx-resolve, best-effort transport; scanner использует existing task lock + eligibility recheck. [After SQL](sql-after.json), [scanner/retry](retry.json), [полный итог](report.md): durability PASS, общий NOTIFY02 PARTIAL из-за отдельных file-authority gaps. TASK_CREATED body, guards/schema/frontend не менялись.
