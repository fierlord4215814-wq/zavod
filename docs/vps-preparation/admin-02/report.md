# ADMIN02 — factory-scoped attendance, возврат, live журнал

26.09.2026. **ADMIN02_STATUS=PASS** — только согласованный bounded Windows-пакет, не Pilot Ready и не полная ролевая/серверная приёмка. Три доказанных разрыва закрыты в существующих owners. `FINAL_STOP=STOP_BEFORE_FULL_NEW_FACTORY`.

## Изменения / точные владельцы

| Файл / owner | Было → минимальное исправление → проверка |
|---|---|
| `backend/src/modules/employee/employee.service.ts` | Смешение home/selected factory → active UFA, selected lookup/close/audit/broadcast для6 paths; foreign presence deny; factual send-home и comment setting → SQL всех paths, UI line/home/reassign, HTTP negatives |
| `backend/src/common/operation-lock.ts`, `shift-attendance.ts` | Factory-only lock при global state → person-wide factual lock, foreign guard, fresh UFA/current send-home provenance →2 SQL clients, foreign rows unchanged, stale approval deny |
| `backend/src/modules/shift/shift.service.ts`, `shift.controller.ts` | Create по OFF_SHIFT, несериализованное решение, полный user DTO → provenance/PENDING CAS/one audit/SHIFT_UPDATED/safe DTO; current feedback, start/end/contractor/maintenance impact → SQL/HTTP/UI/WS |
| `backend/src/modules/wash/wash.service.ts`, `line/line.service.ts` | Global-state writers без foreign guard; wash home filter → shared locks/foreign checks/target UFA, убран только ошибочный home filter → SQL wash/contractor/changed-assignment, STOP/credit regressions |
| `frontend/src/screens/ShiftPeopleScreen.tsx` | Нет master return UI → очередь, existing ActionModal reject/approve, worker feedback, invalidation/8s polling, comment hints →390/1440 two-context journey, Back/busy/403/409 |
| `frontend/src/screens/ShiftLogScreen.tsx` | Второй экран не refresh → scoped5s existing GET list/detail/focus, sequence/scope/Back guards → ordinary create/comment/metadata/important-close без F5, foreign denial/archive readonly |
| `backend/src/modules/admin/admin.service.ts`, `frontend/src/screens/AdminConfigScreen.tsx` | Comment toggle readonly/dead → только sendHomeRequiresComment operational/truthful preview → Admin UI false/true, HTTP/SQL/null audit, default true |

**11 product files**,1 новый targeted test +4 compatibility updates fixtures. User.factoryId не удалён/не переписан; production auth/guards и зависимости не ослаблены. [Before/after41-file identity](final-integrity.json): `e89c2bb4cc781ce01253d7574b608c558f0c1fd12c114473577387cda9fe1375`. [ADMIN02 diff](changes.diff), [полная targeted authority matrix](attendance-authority-matrix.md). До правки подтверждены45 final ADMIN01 hashes,36 owner snapshots,57 checksums;4 дополнительных test baselines сохранены. Dirty worktree не сбрасывался.

## Реальные доказательства / пределы

- [Непрерывный UI→HTTP→SQL/WS journey](ui-final-journey-final.json): home=A0/active C UFA/normal login C; start→UI assign→worker1612ms→home→request/master328ms→reject/worker434ms→повтор311ms→approve→предусмотренное назначение. Старое одобрение не отображается разрешением после нового home. Approval не создаёт Assignment автоматически. A0 UFA/Assignment/Session/Return/Audit digest совпал: `0ddbb45de35e0d19ffe6fbe8d2126fc60b97935838e0e5e2c18170e7b32ec303`. Это baseline после setup, не утверждение отсутствия setup-записей A0.
- [SQL attendance](sql-attendance.json):26 cases настоящего PostgreSQL,6 Employee paths/home/foreign Session+Assignment/negative access/start-home-create-decision races.2 independent clients/PIDs; один winner/audit/state transition. Service calls **не выданы за HTTP/WS**: транспорт подтверждён отдельно живым journey.
- [SQL impact](sql-impact.json):4 cases LINE→WASH lifecycle, contractor arrival/absence/foreign deny, foreign Assignment без Session, changed-assignment пока sendHome ждёт lock →409 без home audit/global transition.
- [HTTP security](http-security.json):15 различных guards (27 записей включают повторы harness), revoked/guest/blocked/deleted/stale token, wrong-factory request/object, disabled/duplicate, worker manage deny; race200/409 и1audit. DTO без hashes/secrets/phone/storagePath. Отрицательные deleted/role fixtures только собственные, восстановлены; auth не обходился.
- [UI errors](ui-errors-final.json): настоящий409 stale decision,403 fresh authority, русская ошибка, ноль второго decision audit;409 empty required comment. Для403 собственный UFA временно SQL MASTER→WORKER оставлял форму устаревшей; exact MASTER восстановлен. Это не UI редактирование роли, response не подменялся.
- [Настройка](comment-setting-ui.json): Admin editor→preview→save false, empty send-home UI201/audit null, true восстановлено. Busy approve проверен задержкой доставки **подлинного** server response, не mock. Back сначала снимает фокус textarea, повтор закрывает форму по текущему mobile contract.390/1440 визуально просмотрены, horizontal overflow не обнаружен; physical phone не проверен.
- [Журнал](journal-ui.json): create4580ms/comment5181ms/metadata4705ms/important-close5174ms.4 contexts: writer/allowed reader/другой department/A0; чужие list без записи/detail409. Ordinary запись и настоящее собственное PNG сохранены; archive readonly, Back после polling не переоткрывается. Это **не весь UI-SWEEP-036**.
- [Safe SQL/audit](safe-sql-audit.json):30 relevant audit rows11 UI requests, factory C/actor/target/time, ровно1create/decision;26 ACCESS_DENIED rows. Это объём с harness-повторами, не число независимых accepted cases. Паролей/токенов/DBURL нет.

## Финальные проверки

[Последний targeted runner](final-checks/2026-09-26T18-31-09-598Z/summary.json): **215/215 +52/52 +13/13 =280**, плюс41 foundation/auth checks; backend build/frontend typecheck PASS. [Финальная production-сборка и asset hashes](build-2026-09-26T18-55-58-385Z.json) PASS на последних product edits, Vite с пустым envDir без рабочего `.env`; полный Vite output сохранён в `logs/2026-09-26T18-55-58-385Z/frontend-build.txt`. [24 source/UI/security checks](source-checks.json) PASS. CJS/chunk-size warnings сохранены.

[Prisma](prisma-verification.json): validate0, controlled generate0 в новый owned output, migrate status0, strict schema diff0; disk/SQL chain57 matched, schema unchanged. Migration58/seed/reset не выполнялись; неизменная schema не требует повторять полный historical fresh57/56→57.

Первый final runner имел8 UNMOCKED errors (6 STOP-credit/1 STOP/1 wash). Добавлены только dependency tables новых guards, прежние assertions сохранены; failed logs retained. Historical J20/related Chat leave current-visible с устаревшими WORKER/chats.access assumptions не исправлялись ослаблением LOCAL02 ceilings, не входят в280. Current chat-policy/R2 tests проходят; full Chat acceptance не повышен.

Ранние harness-проходы ошибались в UI labels/template activation/archive selector/Back/тексте403. Их receipts сохранены, не product PASS. Авторитетные завершённые: `ui-final-journey-final.json`, `ui-errors-final.json`, `journal-ui.json` (finalizer), `comment-setting-ui.json`, `http-security.json`; [разбор исторических попыток](evidence-notes.md).

## Изоляция / завершение / доступный стенд

Target `zavod_local02_admin02_clean` создана из owned ADMIN01 final clean, не из рабочих данных/C1. [Identity](target.json), [setup](fixture.json). A0/C — bounded fixture, не полноценный завод. Production auth/personal login/loopback HTTP+WS/PostgreSQL18.3/Edge; тестовый clock не применялся, scheduler не отключался.

[Cleanup](cleanup.json):36 созданных users blocked/all UFA revoked, C inactive;0 active Assignment/Session/pending Return/Wash/proposed Contractor. 37 users/74 UFA/17 assignments/34 sessions/15 requests/1attachment **сохранены**, audit313→432. Унаследованный founder clone не блокировался; его UFA к inactive C не открывает C. БД/uploads/история не удалены. Рабочие БД/.env/uploads и старые VM/retained-каталоги не использовались.

**C1 доступен: http://127.0.0.1:5173/**; backend3000 `LOCAL03-20260924-C1`, ready=true; PG15436. [Read-only C1](final-live-state.json):17 users/17 active UFA/1line/0active sessions/factory states совпали с before. Это counts/factories, не byte-identity всей БД или whole C1 rerun.

[Runtime identity](runtime-readback.json),26.09 18:41 UTC: backend PID16268 запущен ADMIN02; frontend14676/PG17668 сохранены. ADMIN02 backend17424 остановлен при возврате C1; browser contexts закрыты. Порты только loopback. Остановка существующим helper с повторной проверкой identity (сам stop **не выполнен**, C1 оставлен для просмотра):

```powershell
& 'C:\Users\79164\Documents\work\docs\vps-preparation\admin-01\stop-stand.ps1'
```

Он останавливает только этот backend/frontend/own pgdata и сохраняет данные. Старые PID не использовать вслепую. Fixtures ADMIN02 уже закрыты; автоматического нового replay нет.

## Точные статусы / review boundary

```text
ADMIN02_STATUS=PASS
ATTENDANCE_FACTORY_AUTHORITY=PASS_BOUNDED_WINDOWS
SECONDARY_UFA_ASSIGN_LINE=PASS_SQL_AND_UI_HTTP
SECONDARY_UFA_ASSIGN_WASH=PASS_REAL_SQL
SECONDARY_UFA_ASSIGN_WORK_AREA=PASS_REAL_SQL
SECONDARY_UFA_ASSIGN_TIME_ROLE=PASS_SQL_OWNER_AND_TIME_WORK_AREA; PUBLIC_LEGACY_409_PRESERVED
SECONDARY_UFA_RELEASE=PASS_REAL_SQL_AND_HTTP
SECONDARY_UFA_SEND_HOME=PASS_UI_HTTP_SQL
CROSS_FACTORY_ACTIVE_PRESENCE_GUARD=PASS_TWO_SQL_CLIENTS_FOREIGN_ROWS_UNCHANGED
SEND_HOME_COMMENT_SETTING=PASS_DEFAULT_TRUE_FALSE_UI_HTTP_SQL
RETURN_REQUEST_FACTORY_PROVENANCE=PASS
RETURN_REQUEST_WORKER_UI=PASS
RETURN_REQUEST_MASTER_LIST=PASS
RETURN_REQUEST_REJECT=PASS_REPEAT_ALLOWED
RETURN_REQUEST_APPROVE=PASS_NO_AUTOMATIC_ASSIGNMENT
RETURN_REQUEST_CONCURRENCY=PASS_TWO_SQL_AND_HTTP_CLIENTS
RETURN_REQUEST_SECOND_UI=PASS_WITHOUT_F5
SHIFTLOG_SECOND_UI_REFRESH=PASS_TARGETED_ORDINARY_JOURNAL
MIGRATIONS=57_UNCHANGED
SCHEMA_DECISION_REQUIRED=none
DEAD_SETTINGS_REMAINING=29
ADMIN01_STATUS=PARTIAL
LOCAL03_STATUS=PARTIAL
V1_FUNCTIONALITY_COMPLETE=PARTIAL
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
FULL_NEW_FACTORY=NOT_CREATED
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_BEFORE_FULL_NEW_FACTORY
```

**ЕСТЬ В КОДЕ / ПРОВЕРЕНО ЛОКАЛЬНО** — перечисленные bounded изменения/receipts. **ПРОВЕРЕНО НА VPS — ничего. НЕ ПРОВЕРЕНО** — Linux/Compose/volumes/permissions/внешние HTTPS/WSS/reboot VPS, phone, остальные29 settings и прежний14-role/five-gate/policy/063 остаток. Self start/end — API/SQL, новый UI contract не придуман. [Пять gates](../local-03/five-gate-matrix.md) сохранены; journal repair не повышает весь036 до PASS.

Один [ADMIN02 ZIP](review-pack-admin02-20260926.zip), [manifest](review-pack-manifest.json), [полный entry readback/размер/SHA256](review-pack-readback.json). Новое evidence self-contained, external-retained перечислено в `evidence-notes.md`; ADMIN01/LOCAL03 не перепакованы целиком. Следующее действие — **review ADMIN02**. Полноценный испытательный завод только по следующему отдельному поручению, автоматически не создавался.
