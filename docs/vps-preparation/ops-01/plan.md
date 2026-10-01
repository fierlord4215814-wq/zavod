# OPS-01 — единый живой план

**Новый верхний статус 28.09.2026:** пользователь решил сохранить T1 без отката с признанным `FAILED` и недоказанной полной row-delta. Прежний `PENDING_USER` ниже — историческая review-точка. OPS-01 не перезапускается. Отдельно разрешён [VPS-TECH-01](../vps-tech-01/plan.md), но target/access отсутствуют; технический runtime `NOT_RUN_BLOCKED_INPUT`. T1/старые стенды не трогать.

## Review-точка 28.09.2026 — STOP, не выполнять исходные шаги ниже

[Отдельное дополнение](t1-review-addendum-20260928.md) сверило baseline/incident row-linkage, source/diff/saved results и все 344 ZIP entries. `T1_EXACT_PRESERVATION_DURING_OPS01=FAILED`; источник и after-цепочки совместимы с штатным catch-up, но точный pre-row diff отсутствует: `T1_DELTA_CLASSIFICATION=INSUFFICIENT_EVIDENCE`; `T1_DELTA_DECISION=PENDING_USER`. На 3000/5173/15437 при read-only проверке listeners не было; SQL/приложение/БД не запускались, новая дельта **не перечитывалась**. Никакого `stand.ps1 Start/Restart/Stop`, HTTP/UI, restore/rollback и VPS по этому поручению. Исходные отчёты/receipts/ZIP и незавершённые A/B/C/role/gate roots сохранены.

Единственная дальнейшая последовательность: решение пользователя по T1 (при необходимости отдельно санкционированная protected row-review/recovery plan) → отдельное поручение на закрытую Linux/Compose/VPS-техприёмку существующих owners → лишь затем решение о пилотных пользователях. [Серверная граница](server-readiness.md), [handoff](../handoff.md). `FINAL_STOP=STOP_FOR_T1_DECISION_AND_EXTERNAL_OPS_REVIEW`.

27.09.2026. `OPS01_STATUS=PARTIAL_T1_PRESERVATION_EXCEPTION`. Один writer/browser worker. [Итог](report.md), [решение A/B/C](server-readiness.md). Текущая остановка `STOP_FOR_REVIEW_BEFORE_VPS`; ниже initial sequence сохранена как история, не команда повторять шаги.

## Конечное состояние живого плана

1. DONE discovery/baseline/copy:25owners/57checksums/4priorZIP;90tables/68files exact;31users/2existingfactories. Late uploadhelper baseline caveat вsourcechecks.
2. DONE analytics:86/86slots/648valuechecks,343finalSQLHTTP/6periods,104history,72controlledrows;2roles2datasets/46cards+details. [Реестр](metric-register.json).
3. DONE filters/access/export/refresh:12UIqueries,103scopechecks,latefilter/factory/logout/reload/400reset; existingArchiveXLSX3sheets; actualTask/checklist/manualrefresh.
4. DONE audit:7knownactions,2roles,stablepagination/search/details; old800/moduleissues fixed.
5. DONE current error-report path:11ordinaryassertions+guest/create-retry/statuslatch; longrunnerpost-caseHARNESSexit retained, compositeproof explicit. StoredappVersion absent/manualrestriction.
6. DONE fixes/checks:15groups/6productowners+stand/4tests;95isolated/builds/typecheck/Prisma57/diff0. Mainperiod/visibility/producers unchanged.
7. PARTIAL preservation: ownrestart90/83uploads/111exports exact; mainbeforeReturn90/68exact. AfterT1return3nativeautoclose→6tables changed,84exact/68filesexact. [Exception](preservation-exception.md): factoryACTIVE, appsquiesced/PGretained/no rollback. Не переобъявлятьbaseline.
8. DONE review docs/package/readback; **NO closedVPS transition доreviewT1delta**. Нужно принятиеobservedhistory либо отдельно разрешённый recoveryplan; автоматически не выполнять. [Manifest](review-pack-manifest.json),[readback](review-pack-readback.json).

## Исходная последовательность — исторический срез до завершения

1. **DONE — discovery/baseline.** [25 owners/builds/57/checksums/4 ZIP](before.json), [новая copy90tables/68files exact](copy.json), [ACL](acl-readback.json), [два обычных UI,5tabs/46cards плюс nested metrics](inventory-ui.json). Никаких новых users/factories. Stand Ops01, export в защищённом own dir.
2. **IN_PROGRESS — source → independent expected → HTTP → UI.** [104 сравнения real T1 history](history-independent-before.json); [72 timestamp fixture rows, включая relational history, только copy](controlled-fixtures.json); [6periods before](controlled-before.json)→[343 числовых SQL/HTTP comparisons после backendfix](controlled-after-1.json), все совпали. UI parity, обзор/модули и полный inventory ещё не закрыты. [Доказанные gaps](confirmed-gaps.md), independent.cjs не импортирует продуктовые helpers. Backend build/15isolated PASS; frontend scope labels/error recovery правка проходит typecheck, build/UI в работе.
3. **PENDING — границы/фильтры/доступы.** 08/20, полночь/месяц, [from,to), открытые интервалы/asOf, несколько линий, nearest-rank contract, lifecycle дочерних записей, normal visibility. ADMIN/MANAGEMENT, ordinary/guest/ADMINguest/blocked/revoked/stale/foreign; фильтры, детали, late responses, reload и действующий механизм обновления; существующий export.
4. **DONE — пользовательский аудит.** [Две роли,7 известных действий,1765/1766 видимых строк, stable pages/search/details](audit-after.json). Комбинация action+module, поздняя история и secondary prefixes исправлены. Просматриваемые business audit rows неизменны; аудит доступа отдельно.
5. **IN_PROGRESS — error report.** [Lost-response retry и ADMIN+guest](error-retry-after.json) PASS; [точное ранее скрытое UUID-фото](error-file-after.json) видно после fix, bytes unchanged. Реальные форма/фото/export/status/relogin/foreign/lost-upload/double-click/intentional-separate/cancel/bad-file выполнены в сохранённых последовательных receipts; [отдельный guest-text](error-guest.json) PASS. Консолидированный повтор/закрытие собственных обращений ещё в работе. Export после status исправлен; прежние failure receipts сохранены.
6. **PENDING — подтверждённые узкие fixes и повтор.** Before/expected → canonical owner fix → same case/affected consumers. Новая schema/business policy/retro cleanup не разрешены; останавливается только зависимая ветвь.
7. **PENDING — final build/tests/menu smoke/preservation.** Ops/Archive/Audit/ErrorReport targeted, builds/typecheck, Prisma validate/controlled generate/57 checksums/strict diff0. ADMIN/MANAGEMENT 1440/390 all top-level menus. Main T1 90-table/file exact before/after, ACTIVE; own copy retained protected/own active operations finished.
8. **PENDING — review.** A BLOCKS_SERVER_ACCEPTANCE / B MUST_VERIFY_ON_VPS / C DEFERRED_OR_RESTRICTED с точными основаниями. Handoff/gap/completeness delta, self-contained ZIP и full byte/SHA readback. Ответить о закрытой VPS-приёмке, deployment не запускать.

## Среда и сохранность

Main T1 `zavod_factory01_t1`, own PG15437; текущие PID/command/pgdata/version проверяются заново. Новая разрешённая цель: `zavod_factory01_ops01`, own runtime `ops01`, paired baseline `pair-ops01`; это не новый завод/учётные записи. Stand helper — существующий `../factory-01/stand.ps1`, canonical builds/backend production auth/loopback. Пароли/config/dump/uploads вне repo и ZIP. Рабочие .env/БД/uploads и retained copies не используются для изменений.

Прежние ATT-AUTH и TASK/NOTIFY fixes сохраняются; historical PARTIAL не перезаписываются. Windows SQL/HTTP/UI proof не доказывает Linux/Compose/volumes/permissions/HTTPS/WSS/VPS restart. Phone/WSL/VPN/UAC/сеть/Windows clock/№4 вне задания.

`MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`; `MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE`; конечная остановка `STOP_FOR_REVIEW_BEFORE_VPS`.
