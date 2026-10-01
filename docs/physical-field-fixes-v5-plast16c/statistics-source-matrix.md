# PFF V5 Plast 16C - statistics source matrix

Общие правила матрицы:

- Period должен быть factory-local half-open `[from, to)`; открытые интервалы обрезаются на `min(to, factoryServerNow())`.
- Normal view исключает reliable Stage/PILOT/physical markers. Diagnostic view разрешён только backend-authorized diagnostic ADMIN.
- Каждая query ограничена `UserContext.selectedFactoryId`; cross-factory id из query не принимается.
- Колонка `STATUS` фиксирует состояние на момент discovery до исправлений. Итоговая резолюция всех строк приведена после матрицы и подтверждена controlled regression, source regression и browser E2E.

| SCREEN/TAB | METRIC | HUMAN MEANING | CANONICAL MODEL | CANONICAL FIELD/EVENT | FILTERS | FORMULA | OPEN-INTERVAL RULE | FIXTURE VISIBILITY | FACTORY SCOPE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| Потери | Потеряно времени | Суммарное время STOP/PAUSE | LineEvent | status, effective/confirmed/corrected times | period, line, shift | sum unique clipped downtime minutes | clip to selected as-of | normal excluded | line.factoryId | PROOF_PENDING |
| Потери | Простоев | Число уникальных интервалов STOP/PAUSE | LineEvent | status transition to next WORK | period, line, shift | count normalized non-empty intervals | event crossing boundary counts once | normal excluded | line.factoryId | PROOF_PENDING |
| Потери | Открытых простоев | Интервалы, ещё открытые на конец selection | LineEvent | next WORK / correctedEndAt / confirmedEndAt | period, line, shift | count intervals without close before as-of | open at selected as-of, not current-row status | normal excluded | line.factoryId | CONFIRMED_DEFECT |
| Потери | Открытых заявок | Заявки не DONE на конец selection | Task | createdAt, startedAt, doneAt | period, line, dept, type, status, shift, scope | count status-as-of-period-end != DONE | created before end and not done before end | normal excluded | Task.factoryId | CONFIRMED_DEFECT |
| Потери | Просроченных долгих | Открытые LONG с deadline до selected as-of | Task | type, deadlineAt, doneAt | common task filters | LONG and deadline < as-of and no done before as-of | remains open until done timestamp | normal excluded | Task.factoryId | CONFIRMED_DEFECT |
| Потери | Самая проблемная линия | Линия с максимальной потерей времени | Line + LineEvent | grouped clipped durations | period, line, shift | max lostMinutes; tie: downtimeCount, then human line name | same clipping | normal excluded | Line.factoryId | PROOF_PENDING |
| Потери | Срочные открытые | URGENT, открытые на конец selection | Task | type, doneAt | common task filters | count URGENT without done before as-of | status-as-of | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Средняя реакция | Среднее created -> taken | Task + TaskHistory | createdAt, startedAt/TASK_TAKEN | common task filters | round(sum minutes / N) for taken samples | no sample before take | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Медиана реакции | Typical created -> taken | Task + TaskHistory | same | common task filters | nearest-rank p50 | completed reaction only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | p90 реакции | 90% реакций не дольше значения | Task + TaskHistory | same | common task filters | sorted values; index ceil(N*0.9)-1 | completed reaction only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Среднее исполнение | Среднее taken -> done | Task + TaskHistory | startedAt/TASK_TAKEN, doneAt/TASK_DONE | common task filters | rounded average | completed execution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Медиана исполнения | Typical taken -> done | Task + TaskHistory | same | common task filters | nearest-rank p50 | completed execution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | p90 исполнения | 90% исполнений не дольше значения | Task + TaskHistory | same | common task filters | nearest-rank p90 | completed execution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Среднее решение | Среднее created -> done | Task + TaskHistory | createdAt, doneAt/TASK_DONE | common task filters | rounded average | completed resolution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Медиана решения | Typical created -> done | Task + TaskHistory | same | common task filters | nearest-rank p50 | completed resolution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | p90 решения | 90% решений не дольше значения | Task + TaskHistory | same | common task filters | nearest-rank p90 | completed resolution only | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери | Эффект 10 минут | Ограниченный потенциал уменьшения потерь | computed from LineEvent | selected period + totalLostMinutes | period, line, shift | min(actual loss, 10 min * factory calendar days in selection) | uses same clipped loss | follows loss rows | current factory | CONFIRMED_DEFECT |
| Потери / Линии | Остановки | STOP transitions recorded in period | LineEvent | status=STOP, created/effective time | period, line, shift | count matching transition rows once | no duration arithmetic | normal excluded | line.factoryId | PROOF_PENDING |
| Потери / Линии | Паузы | PAUSE transitions recorded in period | LineEvent | status=PAUSE | period, line, shift | count rows once | no duration arithmetic | normal excluded | line.factoryId | PROOF_PENDING |
| Потери / Линии | Возвраты в работу | WORK transitions recorded in period | LineEvent | status=WORK | period, line, shift | count rows once | no duration arithmetic | normal excluded | line.factoryId | PROOF_PENDING |
| Потери / Линии | Заявки из простоя | Requests with explicit downtime relation | Task | lineStatusEventId | common task filters | count unique Task where linked event belongs to visible interval | task overlap semantics | normal excluded | Task.factoryId + line factory | PROOF_PENDING |
| Потери / Качество | Брак ОКК | Число созданных active-history records | OkkRecord | createdAt, archivedAt, deletedAt | period, line, shift | count non-deleted/non-archived rows created in period | n/a | normal excluded | OkkRecord.factoryId | PROOF_PENDING |
| Потери / Качество | Некондиция | Число records | StockDefect | createdAt, deletedAt | period | count non-deleted rows created in period | n/a | normal excluded | StockDefect.factoryId | PROOF_PENDING |
| Потери / Качество | Количество некондиции | Сумма quantities самих StockDefect | StockDefect | quantity | period | sum quantity once per record; no release ledger addition | n/a | normal excluded | StockDefect.factoryId | PROOF_PENDING |
| Потери / Качество | Возвраты | Число records | ReturnRecord | createdAt, archivedAt, deletedAt | period | count non-deleted/non-archived rows created in period | n/a | normal excluded | ReturnRecord.factoryId | PROOF_PENDING |
| Потери / Чек-листы | Запущено | Runs started in selection | ChecklistRun | startedAt | period, line, dept, shift | count runs whose startedAt in period | n/a | normal excluded | ChecklistRun.factoryId | PROOF_PENDING |
| Потери / Чек-листы | Проверок выполнено | Completed periodic occurrences | ChecklistRunCheck | status, completedAt | period, line, dept, shift | count COMPLETED children completed in period | child belongs to visible run | normal excluded | parent factoryId | PROOF_PENDING |
| Потери / Чек-листы | Запусков завершено | Runs closed in selection | ChecklistRun | status, closedAt | period, line, dept, shift | CLOSED/AUTO_CLOSED with closedAt in period | immutable close event | normal excluded | ChecklistRun.factoryId | PROOF_PENDING |
| Потери / Чек-листы | Просрочено | Effective active occurrences past due | ChecklistRun + ChecklistRunCheck | parent status, child status, dueAt | period, line, dept, shift | child not COMPLETED + due before as-of + parent ACTIVE/PAUSED | closed parent never current | normal excluded | parent factoryId | PROOF_PENDING |
| Потери / Чек-листы | Закрыто вручную | Manual run closes | ChecklistRun | closeKind, status, closedAt | common checklist filters | MANUAL + MANUAL_EARLY + legacy CLOSED without closeKind | n/a | normal excluded | ChecklistRun.factoryId | PROOF_PENDING |
| Потери / Чек-листы | Закрыто сменой | Shift/automatic closes | ChecklistRun | closeKind, status, closedAt | common checklist filters | SHIFT_END or AUTO_CLOSED | n/a | normal excluded | ChecklistRun.factoryId | PROOF_PENDING |
| Потери / Мойка | Активные мойки | Sessions active at selected as-of | WashSession | createdAt, completedAt, status | period, line | created before as-of and not completed before as-of | status-as-of | normal excluded | WashSession.factoryId | PROOF_PENDING |
| Потери / Мойка | Завершённые мойки | Sessions completed in period | WashSession | completedAt, status | period, line | count completedAt in period | n/a | normal excluded | WashSession.factoryId | PROOF_PENDING |
| Потери / Мойка | Открытые проблемы | Issues open at selected as-of | WashIssue | createdAt, resolvedAt, isResolved/status | period, line | created before as-of and not resolved before as-of | status-as-of | normal excluded | parent session factory | PROOF_PENDING |
| Потери / Мойка | Всего проблем | Issues intersecting selection | WashIssue | createdAt/resolvedAt | period, line | created in period or open across period | overlap selection | normal excluded | parent session factory | PROOF_PENDING |
| Потери / Мойка | Мини-задания | Mini tasks intersecting selection | WashControlItem | type, createdAt, doneAt | period, line | MINI_TASK created in or open across period | status-as-of | normal excluded | factoryId | PROOF_PENDING |
| Потери / Мойка | Выполнено мини-заданий | Mini tasks done in period | WashControlItem | doneAt, status | period, line | DONE with doneAt in period | n/a | normal excluded | factoryId | PROOF_PENDING |
| Потери / ranking | Линии с потерями | Ranked loss + count + share | Line + LineEvent + Task + LineShiftResult | grouped canonical fields | period, line, shift | lost desc, count desc, human name asc | same clipping | normal excluded | current factory | PROOF_PENDING |
| Потери / departments | Реакция отделов | Received/taken/closed/open/overdue and response | TaskDepartmentRecipient + Task | active recipient, task timestamps | period, dept, task filters | group unique task per recipient | task status-as-of | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери / detail | Крупные простои | Top intervals by clipped duration | LineEvent | interval fields | period, line, shift | duration desc, deterministic tie | same clipping | normal excluded | line.factoryId | PROOF_PENDING |
| Потери / detail | Заявки, влияющие на потери | Visible filtered request list | Task | timestamps, lineStatusEventId | all task filters | canonical rows, no frontend re-count | task overlap | normal excluded | Task.factoryId | PROOF_PENDING |
| Потери / detail | Повторяющиеся проблемы | Repeated normalized reason/text | Task + LineEvent | description, downtimeReason/comment | period, line, dept | group normalized problem key; count >=2 | clipped downtime total | normal excluded | current factory | PROOF_PENDING |
| Потери / data quality | Качество данных | Proven limitations only | LineEvent, Task, ChecklistRun/Check | missing comment/timestamps, overlap, parent-child lifecycle, limits | common selection plus explicit global legacy warning | count each proven condition | open is period-clipped | diagnostic rows follow view policy | current factory | GAP_LEGACY_WARNING |
| Обзор | Активные заявки | Current non-DONE task workload | Task | status, deletedAt | current factory, no period by design | current visible count | current state | normal excluded | Task.factoryId | GAP_FIXTURE |
| Обзор | Просроченные заявки | Current open overdue LONG | Task | type, deadlineAt, doneAt | current factory | open LONG past server now | current state | normal excluded | Task.factoryId | GAP_FIXTURE |
| Обзор | Активные мойки | Current sessions | WashSession | status, deletedAt | current factory | status != DONE | current state | normal excluded | WashSession.factoryId | READY |
| Обзор | Проблемы мойки | Current unresolved issues | WashIssue | status/isResolved | current factory | sum unresolved for current visible sessions | current state | normal excluded | parent factory | READY |
| Обзор | Остатки ниже порога | Current low stock positions | MinimumStockItem | currentQuantity, minThreshold, active/archive | current factory | currentQuantity <= minThreshold | current state | normal excluded | item.factoryId | PROOF_PENDING |
| Обзор | Заявки на заказ | Current active orders | OrderRequest | status | current factory | ACTIVE count | current state | normal excluded | order.factoryId | GAP_FIXTURE |
| Обзор | Важные пересменки | Current active important logs | ShiftLog | isImportant, status, isDeleted | current factory/dept scope | active important count | current state | normal excluded | log.factoryId | GAP_PERIOD_AMBIGUITY |
| Обзор | Непрочитанные уведомления | Current unread visible to viewer | Notification | readAt + audience fields | canonical notification visibility | count readAt null | current state | normal excluded | audience/factory policy | GAP_FIXTURE |
| Обзор | Автозакрытые чек-листы | Auto closes in selected period | ChecklistRun | status, closedAt | period, dept | AUTO_CLOSED in period | n/a | normal excluded | run.factoryId | GAP_PERIOD_PARSE |
| Обзор | Отказы доступа | ACCESS_DENIED in selected period | AuditLog | action, createdAt | period | count visible logs | n/a | normal excluded | AuditLog.factoryId | GAP_PERIOD_PARSE |
| События | Операционная строка | Human event, source, actor, time, severity | AuditLog + TaskHistory + Notification + ShiftLog + WashEvent + ChecklistRun + DefrostEvent | canonical event timestamps/actions | period, module, severity, search | union, sort desc, unique source id, limit | n/a | normal excluded | each source factory policy | GAP_TASKHISTORY_PERIOD |
| Аудит | Действие | Human action title | AuditLog | action | period, actor, module, object/search | common action mapping | n/a | normal excluded | AuditLog.factoryId | READY |
| Аудит | Объект | Human object type and resolved name | AuditLog + referenced canonical entity | entityType/entityId | audit filters | batch resolve visible label, never raw id primary | n/a | normal excluded | same factory | GAP_OBJECT_NAME |
| Аудит | Автор | Human actor label | AuditLog + UserFactoryAccess | userId | actor filter | seeded display or role/job/department fallback | n/a | normal excluded | same factory access | GAP_ACTOR_NAME |
| Аудит | Важное изменение | Human before/after/details | AuditLog.details | known keys and nested old/new | audit filters | safe common presentation rows; sensitive/id fields omitted | n/a | normal excluded | parent log factory | GAP_BEFORE_AFTER |
| Модули | Заявки | Tasks created in selected period | Task | createdAt, deletedAt | period | count visible non-deleted rows | n/a | normal excluded | Task.factoryId | CONFIRMED_DEFECT |
| Модули | Мойка | Sessions started in selected period | WashSession | createdAt, deletedAt | period | count visible rows | n/a | normal excluded | WashSession.factoryId | CONFIRMED_DEFECT |
| Модули | Чек-листы | Runs started in selected period | ChecklistRun | startedAt | period, dept | count visible runs | n/a | normal excluded | run.factoryId | GAP_PERIOD_PARSE |
| Модули | Заказы | Orders created in selected period | OrderRequest | createdAt | period | count visible rows, all statuses | n/a | normal excluded | order.factoryId | CONFIRMED_DEFECT |
| Модули | ОКК | Okk records created in selected period | OkkRecord | createdAt, deletedAt | period | count visible rows | n/a | normal excluded | record.factoryId | CONFIRMED_DEFECT |
| Модули | Остатки | StockDefect records created in selected period | StockDefect | createdAt, deletedAt | period | count visible rows | n/a | normal excluded | record.factoryId | CONFIRMED_DEFECT |
| Модули | Возвраты | Return records created in selected period | ReturnRecord | createdAt, deletedAt | period | count visible rows | n/a | normal excluded | record.factoryId | CONFIRMED_DEFECT |
| Модули | Пересменка | Persisted ShiftLog rows created in selected period | ShiftLog | createdAt, isDeleted | period, dept | count persisted rows; no live recompute | n/a | normal excluded | log.factoryId | GAP_PERIOD_PARSE |
| Модули | Оттайка | DEFROST events started in selected period | DefrostEvent | eventType, startAt | period | count canonical DEFROST rows | active may cross but module count is starts | normal excluded | event.factoryId | CONFIRMED_DEFECT |
| Модули | Уведомления | Notifications created in selected period and visible to viewer | Notification | createdAt, audience fields | period | count canonical visible rows | n/a | normal excluded | audience/factory policy | CONFIRMED_DEFECT |
| Модули | Доступ | ACCESS_DENIED logs in selected period | AuditLog | action, createdAt | period | count visible logs | n/a | normal excluded | AuditLog.factoryId | GAP_PERIOD_PARSE |

## P90 definition

- `P90_METHOD`: nearest rank.
- `FORMULA`: sort ascending; one-based rank `ceil(N * 0.90)`; array index `rank - 1`.
- `CONTROLLED_EXPECTED`: для `[10, 10, 20, 30]` ожидается `30`.
- `ACTUAL`: `30`; controlled formula regression и browser E2E прошли.

## Final resolution

- Все строки со статусом `PROOF_PENDING` доказаны literal expected/actual значениями: `PASS`.
- Все строки `CONFIRMED_DEFECT` исправлены в canonical `OpsService` без нового хранилища статистики: `PASS`.
- Все `GAP_*` закрыты factory-local period parsing, status-as-of, общим fixture policy и human audit presentation: `PASS`.
- Строки `READY` повторно подтверждены affected regression: `PASS`.
- `STATISTICS_CANONICAL_SOURCE_GATE: PASS`.
- `NO_PARALLEL_STATISTICS_STORE_GATE: PASS`.
- `NO_HARDCODED_METRIC_GATE: PASS`.
- Полные числовые доказательства: `controlled-formulas.md` и `test-artifacts.json`.
