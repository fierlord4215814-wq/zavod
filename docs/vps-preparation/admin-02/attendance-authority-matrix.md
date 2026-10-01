# ADMIN02 — attendance authority: исходная матрица и проверенный результат

## Результат 26.09.2026 — ПРОВЕРЕНО ЛОКАЛЬНО

Исходная таблица ниже сохранена как before, не описание оставшихся дефектов. [Изменения и hashes](final-integrity.json), [diff от собственного baseline](changes.diff). **SCHEMA_DECISION_REQUIRED=none**,57 migrations/schema unchanged. User.factoryId не переписан; общий person lock применяется к перечисленным factual writers, плановые locks остаются factory-scoped. Scheduler не отключён. Foreign factual conflict возвращает409 без переноса/закрытия чужих строк; автоматического ремонта исторических конфликтов нет.

| Владелец → минимальное исправление | Проверка результата / предел |
|---|---|
| Employee.assignToLine/assignToWash/assignToWorkArea/assignToTimeRole/release/sendHome → selected factory/active UFA; foreign/sent-home guards; согласованные lookup/close/audit/broadcast | [26 SQL cases](sql-attendance.json): secondary UFA всех paths, home A0, foreign Session/Assignment, negative access, concurrent start/send-home/return. Line/home/reassign дополнительно UI/HTTP/WS |
| operation-lock/shift-attendance → person-wide factual lock, canonical current sent-home provenance, fresh UFA | Два независимых SQL clients/PIDs: один start двух заводов, один send-home/decision; [changed assignment while waiting](sql-impact.json)409 без ложного audit/state transition |
| Shift start/end/contractor/maintenance, Line STOP/remap, Wash start/complete → согласованный change-impact | [SQL impact](sql-impact.json):4 cases, включая secondary LINE→WASH, contractor presence; existing STOP/credit/wash/time regressions. Maintenance/remap — source-impact, не новая полная естественная boundary-приёмка |
| Shift create/decide/me/returnRequests → provenance, PENDING CAS, safe DTO, существующий SHIFT_UPDATED | [HTTP guards/race](http-security.json), [непрерывный journey](ui-final-journey-final.json), [UI errors](ui-errors-final.json), [SQL/audit](safe-sql-audit.json). Старое одобрение не разрешает новую отправку домой |
| Employee/Admin/ShiftController/ShiftPeople/AdminConfig → operational sendHomeRequiresComment | [Admin UI false→empty accepted/null audit→true](comment-setting-ui.json), default true/HTTP409; остальные29 fields не подключены |
| ShiftPeople → manager queue/decision и worker feedback, invalidation/8s polling | UI390/1440, normal login C,2 contexts без F5, Back/busy/403/409; reject→повтор→approve→назначение; A0 digest unchanged |
| ShiftLog → scoped5s list/detail polling/focus, response sequence/Back/context protection | [Ordinary journal](journal-ui.json): create4580ms, comment5181ms, metadata4705ms, important-close5174ms; other dept/A0 denial; archive readonly; Back не переоткрывается |

Public legacy `/assignments/time` намеренно409 по source, не объявлен новым работающим HTTP route. Actual TIME через настроенную WorkArea и legacy service проверены отдельно SQL. Self start/end подтверждены API/SQL, новый UI contract не придуман.

## Исходный source-first снимок (история до исправлений)

26.09.2026. Current source, snapshots в `before/`, identity в `before.json`. Это адресный change-impact, не новый общий аудит. `ЕСТЬ В КОДЕ` ниже не означает runtime PASS.

| Операция / owner | selected factory / home usage | UFA | Session / Assignment / employeeState | Текущая блокировка | Audit / WS | Подтверждённый пробел и минимальное изменение |
|---|---|---|---|---|---|---|
| Employee.assignToLine | factory линии=selected; home не guard | active non-guest, role, blocked/deleted | Assignment C; manual add создаёт Session C; общий FSM | assignmentUser(C,user), line, slot, operation | C / C | Нет foreign presence guard; sent-home проверялся только manual. Общий person lock, scoped guard; lock заменяемого участника |
| Employee.assignToWash | selected C | аналогично + contractor arrival | Assignment C→WASH; глобальный FSM | person(C), wash/line, operation | C / C | Нет foreign presence guard; общий person lock, canonical sent-home guard |
| Employee.assignToWorkArea | selected C | аналогично | Assignment C, kind TIME/WORK_AREA; manual Session C | person(C), work-area slot/position, operation | C / C | Аналогично line; actual TIME использует этот public path |
| Employee.assignToTimeRole | selected C, ошибочный home equality | active UFA, role | legacy TIME C, общий FSM | person(C) | C / C | Убрать home guard, добавить согласованные UFA/foreign/sent-home checks. Public `/assignments/time` намеренно409: не включать legacy route |
| Employee.release/unassign | lookup C, ошибочный home guard; **close и audit home** | отсутствует fresh guard | lookup Assignment C; закрывает home, FSM AVAILABLE | person(C), old line/slot | **home** / C | Один factoryId C во всех шагах; active UFA; фактическое назначение C; foreign guard |
| Employee.sendHome | selected C, ошибочный home equality | отсутствует fresh guard | закрывает Assignment C; Session ACTIVE сохраняется по contract; OFF_SHIFT | person(C), old line/slot | C / C | UFA/foreign/factual C/duplicate guard. Потреблять `sendHomeRequiresComment` с default true, null-safe audit |
| Shift.start/end | selected C; home не используется | контекст HTTP, нет fresh tx target check | Session C, закрывает Assignment C; глобальный FSM | person(C) | C / SHIFT_UPDATED C | Fresh UFA + foreign guard; глобальный lock исключает concurrent A0/C start даже при AVAILABLE |
| Shift contractor arrival/absence | selected C + company | часть проверок вне tx | Session C / global state; Assignment C запрещает absence | item/submission + person(C) | C / existing invalidation | Fresh UFA/company и foreign guard внутри tx; sent-home не обходится existing session |
| Shift.createReturnRequest | selected C, но только глобальный OFF_SHIFT | контекст, нет fresh tx check | last Session C; PENDING search вне tx | отсутствует | C / notification only | Canonical sent-home C provenance; person lock + duplicate check внутри tx; SHIFT_UPDATED C |
| Shift.decideReturnRequest | request C | контекст, нет fresh target check | APPROVED→AVAILABLE; request update без PENDING CAS | отсутствует | C / отсутствует | Person lock, PENDING CAS, provenance/current request time/UFA/foreign/state checks; один audit, postcommit invalidation |
| Shift.me / returnRequests | selected C | HTTP context | canRequestReturn только OFF_SHIFT; list include user:true | read-only | none | Provenance в hints; last decision safe DTO; list explicit safe projection с UFA department/role |
| Shift maintenance | factory session/boundary | system closure, не право нового назначения | scoped closure, но меняет global state | person(C) | C / C | Общий person lock; conflict check до affected closure; scheduler не отключать |
| Wash.startWash / complete / legacy closure | selected/session C | actor UFA; target state update ошибочно `User.factoryId=C` | преобразование LINE C→WASH C, global state | start только line/operation; complete person(C) | C / C | Lock фактических участников; foreign guard; target UFA перед transfer; убрать home filter для validated ids |
| Line.stop / template remap | line C | actor guards | scoped Assignment C closure/remap + global state | line, затем person(C) | C / C | Общий person lock; foreign guard до изменения фактов/общего состояния |

## Контракт исправления

`assignmentUser(factory,user)` сохраняет signature вызывающих owners, но ключ становится person-wide: employeeState глобален, поэтому блокировка только C не защищает от A0. Плановые назначения остаются scoped: план не фактическое присутствие. Guard проверяет ACTIVE Session или незакрытый Assignment другого factory; ошибка русская, без чужих ids/имён. Никакого переноса или закрытия иностранных строк. Существующие optimistic/version/slot locks сохраняются. Deadlock/rollback не считается успешным переходом; SQL concurrency проверяется отдельно.

Home/default User.factoryId не удаляется. Send-home оставляет существующий ACTIVE Session C по прежнему contract, но OFF_SHIFT и canonical audit provenance запрещают рабочие действия до APPROVED; approval не создаёт Assignment. Rejection допускает новый request. Запрос предыдущего периода или до последнего send-home не должен разблокировать новое отсутствие.

Новая schema не планируется: transaction advisory lock + PENDING CAS достаточны для перечисленных runtime writers. Это гипотеза до SQL доказательства, не `ПРОВЕРЕНО ЛОКАЛЬНО`.

## Отдельный журнал

ShiftLogScreen не подписана ни на invalidation, ни на polling; серверные owners сохраняют scoped данные. Минимальный repair — scoped polling существующих GET list/detail, без доменных payload в WS, с защитой от устаревшего ответа после Back/смены контекста. Archive остаётся read-only. Проверять create/comment/metadata/important-close в двух настоящих контекстах.
