# FIVE_GATE_DELTA_MATRIX

## Current pointer OPS01 / ATT-AUTH —27.09.2026

ATT-AUTH принял targetedcurrentfileauthority, поэтому нижний historical `CURRENT_AUTHORITY_FAIL` NOTIFY02 не текущий открытыйdefect. [Принятая authoritymatrix](../att-auth-01/authority-matrix.md). OPS01 сохранил эти owners/guardtests, исправил отдельные Ops notification-factory и ErrorReportguest boundaries, но **не перепринимал пятьgates целиком**. MI-SEC changedpayload pending; MI-PUB pending; MI-R2-ORD acceptedWindows+ATTparity retained; MI-R2-CHAT-ATT/UI036 PARTIAL exactcasesниже. [Серверная классификация](../ops-01/server-readiness.md).

Отдельно OPS01 передача PARTIAL: приReturnmainT1 сработал native shiftcatch-up,6tablesdelta;appsquiesced,68filesexact. [Reviewboundary](../ops-01/preservation-exception.md); не новый fullgatefail/не автоматическиschedulerbug. Старые «T1online/90exact» — snapshots, неактуальная командаstart.

## Current delta NOTIFY-02 — 27.09.2026

[Новый пакет](../notify-02/report.md) не перепринимает все5 gates. MI-SEC durable TASK_CREATED retained PASS; TASK_DONE/REDIRECTED/LONG_ESCALATED и3Orders events теперь **PASS** по real before/after SQL,partialfanout,retry/lost/restart/currentrecipient/transport/UI. **Whole MI-SEC=PARTIAL / CURRENT_AUTHORITY_FAIL / POLICY_PENDING**:2 live-proven attachment gaps в unchanged owner, [точные границы](../notify-02/remaining-gaps.md); changed-payload не решён.

MI-R2-ORD arithmetic/replay/threshold/dedupe/required-notice durability PASS; **Orders file/source authority — FAIL нового bounded case**, поэтому не читать нижнее историческое «PASS required gate» как blanket file/security acceptance. MI-PUB, MI-R2-CHAT-ATT, UI036 не повышены и не перезапускались. Никаких schema58/outbox,physicalphone/Linux/VPS. Новый inventory прочих notification owners source-only: [классификации](../notify-02/similar-patterns.md). T1 ACTIVE/main unchanged, `FINAL_STOP=STOP_FOR_REVIEW_BEFORE_PHYSICAL_OR_DEPLOYMENT`.

27.09.2026. Только текущая Windows functional дельта. [Исходная LOCAL03 matrix](../local-03/five-gate-matrix.md) и R5 history не переписываются; R5/старый Sweep не запускались,19 AST bindings не объявляются19 live PASS.

Обновлено TASK-NOTIFY-01: **MI_SEC_POSTCOMMIT_BRANCH=PASS**, same SQL fault before/after, partial fanout, retry/concurrency/lost/restart/recipient security и two-page UI в [новом отчёте](../task-notify-01/report.md). **Whole MI-SEC=PARTIAL / POLICY_PENDING**, changed-payload отдельно не решён. Остальные четыре gates ниже не повышаются; source-only inventory Orders не отменяет прежний normal/concurrency PASS и не является live fault proof.

| Gate | Реальные новые cases | Итог | Остаток / решение |
|---|---|---|---|
| MI-SEC-01 | Исторический [postcommit FAIL](sec-copy.json) независимо повторён в новой копии. После TASK-NOTIFY атомарные A/B/C/partial rollback; exact concurrent/pending/lost/restart replay; mutable recipient snapshot/current guards; normal/D/E/push two-page UI. [Новые receipts и границы](../task-notify-01/report.md) | **PARTIAL / POLICY_PENDING** whole gate; **postcommit branch PASS / P1 RESOLVED** | Same-key changed payload по-прежнему старый Task201, equality409 не внедрён. Reconnect+Notifications GET recovery, не exactly-once WS/push.57 migrations unchanged/no outbox. Остальные source-proven patterns требуют отдельного follow-up |
| MI-PUB-01 |3currentaudiences/IMPORTANT+NORMAL;4-япубликацияUI/photo;3open readers;notification exactsource;2sessions sameACK1Read/audit;2differentusers/report;archive;blocked/revoke/late200discard |**POLICY_PENDING**, approved current cases PASS. [base](announcements.json), [practical](announcements-practical.json) |Future/expired/lateACK/global owner не утверждены; полный cross-product global×severity×archive нельзя объявить PASS. Poll≈8s не WS publish |
| MI-R2-ORD-01 |5items,10→7→10→3;UI/secondreader401/400ms;retry noextra;quantity/comment/kind changed409;contestedTAKE7 one201/one409;exact movement/audit/processed/notice IDs;foreign409;archive;latertotal7movements/P/R |**PASS** Windows в required current gate. [stock](stock.json), [practical](stock-practical.json), [restore](persisted-ui-restore.json) |Не все role families, неERP, неLinux. Stock immutable-input contract уже есть — не переносится автоматически на Task replay |
| MI-R2-CHAT-ATT-01 |Group owner/member/remove/leave/transfer/readd;private bytes/SHA;WORKER/CONTRACTOR ceiling;heldreal200 late response afterrevoke discarded;Back;abort+new-contextretry;trueWSreconnect;restorefile |**PARTIAL**. [group](chat-group-ui.json), [direct](chat-direct.json), [late](chat-late-file-after-lead-factory01.json), [remainder](chat-remainder.json) |Range200/fullbody безContent-Range — CHARACTERIZED,206 не утверждён. Все stale flag/late command комбинации и сочетания owner/member/role не закрыты одним full gate. Core late receipt закончил с harness menu error; отдельный remainder закрыл именно этот остаток, не весь Range |
| UI-SWEEP-036 |Обычный create/comment/file/important-close secondpage;10authors own dept;normal-onlyarchive403;closed+softarchive read-only;filteredarchive3 Back/open;запретquerybypass/write/receipt/upload/delete/counter;managed immutable+restored snapshot |**PARTIAL**. [journal](journal-ui.json), [roles](journal-roles.json), [negative](journal-archive-gate.json), [handover](handover-copy.json), [restore](handover-restored-readback.json) |Secondpage defect ADMIN02 не воспроизвёлся: targeted PASS. Не весь19-binding corpus: отдельный current archive-only-without-normal permission actor, deleted-user case, explicit no-manage/too-long/outsidewindow submission и исторический linkedBack порядок в этомT1 не повторены. Guest/blocked/revoked retained LOCAL03, не новый14rolesPASS |

## UI036 — точные дельты, без blanket-приёмки

| Состояние/действие | Факт |
|---|---|
| Ordinary comment vs handover comment |Разные owners/поля, ordinarymainT1 и immutablemanagedcopy; exactsnapshotSHA до/послеretry/restore |
| Current/closed ordinary |10UIauthors;create/comment second;MASTERimportantclose, normalclosed preserved |
| Softarchive |MASTER filtered archive UI;ADMINPOSTarchive существующимHTTP, отдельной новой UI archive mutation не объявляли |
| Normal-only |OKK/STORE/TECHNOLOG/5TECH:archive403; MANAGEMENTarchive200 |
| Archive-only actor |Отдельного нового permission override не создавали; retained isolated/current-source contract, **НЕ currentT1 live PASS** |
| Department/factory |Otherdepartment409,otherfactory409,foreignfile403;normalquery archive=true не открывает softarchive |
| Guest/blocked/revoked |[Retained LOCAL03 realguard403](../local-03/access-036-sec.json), включая stale task replay; новые announcement/chat revoke не подменяют этот journalcase |
| Archived mutation |Comment/read/reads/PATCH/closeimportant409;upload/delete403, noSQLreceipt/counter/attachment delta |
| List/detail/file/Back |Current filteredarchive3 open→browserBack cycles, SHA200; не исторические nested Back×3 |
| Immutable restore |В собственной восстановленной managedcopy MASTER390/ADMIN1440 UI+HTTP200, тот же snapshotSHA; mainT1all90 unchanged; clockreal |

## Policy queue сохранена

1. Task same operationId + изменённый payload: старыйresult replay или equality409; действующий Stock409 не решение заTask.
2. Publication future/expired/lateACK/global audience и владелец.
3. Checklist positive grace повторного UI входа и global/shared reference inheritance.
4. Chat Range200/fullbody против обязательного206/partialstream.
5. Original063: нужно исходное достижимое состояние либо явное принятие другой геометрии. НаT1 maxScroll618, не1286; лишние люди/forcedscroll не добавлялись.

Исторический postcommit notification loss был **не policy-only и не dead setting**, а доказанный продуктовый разрыв. Он закрыт отдельным [TASK-NOTIFY-01](../task-notify-01/report.md); прежний next-request в FACTORY01 report сохранён как история. Policy queue выше не снята.
