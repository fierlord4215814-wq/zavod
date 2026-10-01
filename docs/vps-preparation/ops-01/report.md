# OPS-01 — функциональные результаты проверены; итог PARTIAL из-за сохранности T1

27.09.2026. Canonical work, один writer/browser worker. **86/86 видимых analytics value-slots** сверены с независимым расчётом; настоящий audit/error-report/menu пройдены в описанных границах.15 воспроизведённых gap groups исправлены в6 product files. **Пакет PARTIAL:** при возврате T1 произошли штатные scheduler writes; обещание90tables exact не выполнено. [Отдельная фиксация](preservation-exception.md). Зелёные тесты не отменяют этот факт.

## Реальные результаты

- Статистика: [карта](statistics-map.md), [86 slots/648 сверок/точные IDs и значения](metric-register.json); history104SQL/HTTP comparisons; controlled72rows только вкопии; [6final cases/343 сравнения](controlled-final.json). Null/nearest-rank/two-lines/08/20/month/half-open/asOf/historical children/archive/unit. [46cards+8quantiles×2roles×2datasets](ui-parity-final.json), [таблицы](ui-details.json), [дополнение/empty](ui-supplement.json).
- Фильтры/контекст: [12UIqueries,real heldHTTP,factory/reset/reload](filters-live.json), [same-context logoutADMIN→WORKER,late-response discard,403](final-browser.json). [103access/factory/role checks](access-after.json). [5snapshots на уже открытой статистике после настоящей заявки/чек-листа](live-refresh.json): штатная кнопка,неF5/необещаниеWS.
- Аудит: [7точных действий/2roles/поиск actor/action/entity/module/период/pages/details](audit-after.json),1765/1766visible rows наstable snapshots; businessaudit unchanged, accessaudit отдельно. First800 ограничение/prefix mismatch доказаны доfix. Не новые117producer tests.
- Error-report: [11ordinarycase assertions +status latch+consolidated references](final-browser.json), [guest text/no file](error-guest.json), [lost-create retry1ID](error-retry-after.json), [sameUUID file after](error-file-after.json). Реальные форма/PNG/SQL/reader/status/relogin; lostuploadretry1file; doubleclick1report, следующий намеренный identicaltext новыйID; cancel/retry/invalidfile/foreignsource+file denial. **Long ordinary runner exit1 на последующей очистке черновика сохранён**, completed assertions в `error-journey-failure-1790529663921.json`; guest/status закрыты отдельными runs. Это composite evidence, не ложный exit0.
- Копия: [native backendrestart сохранил90таблиц/83uploads/111exportfiles exact](restart-after.json). [ЗащищённыеACL](acl-readback.json). ErrorReport DB authoritative/export best-effort. **StoredappVersion отсутствует**: runtimeversion известна изidentity, неimmutable report; readerпоказываетauthor/factory/section/status. До пилота buildversion вручную вdescription, [ограниченияC](server-readiness.md). Externalpush/mail/support не отправлялись.
- Экспорт: [ArchiveОКК browserdownload](archive-export.json), [3sheets/types/dates/units/filter](archive-cells.json). Existingowner, не новый engine. Workbookне редактировался; nativeExcelUI не заявлен.
- Меню: [ADMIN20/MGMT18 на1440/390](menu-smoke.json), actualHTTP/нетJSexception; [deniedmobilemenus absent](final-browser.json). Availabilitysmoke, не fullmodule/role/fivegatePASS.

## Минимальные правки

| Existing owner | Исправление |
|---|---|
| backend/src/modules/ops/ops.service.ts | Canonical qualityarchive history; stockunits; shift-window intersection/events; historicalchecklist/wash; openoverdue/DONE denominator; invalidperiod; notificationfactoryAND; stableaudit scan/search/page/action/module |
| frontend/src/screens/OpsAuditScreen.tsx | Current/period/unit/notification labels; applied/draft+obsoleteguard;400filterreset; auditpagination/snapshot; manualrefresh |
| frontend/src/screens/BugReportScreen.tsx | Stableattempt operationId/doubleclicklatch; actor/factoryremount; guestreader/fileUI; statuslatch |
| backend/src/modules/error-report/error-report.service.ts | !guest privilegedreader/status; currentowneraccess; existingfileexport послеstatus |
| frontend/src/api/attachments.ts | uploading0 сразу;100%bytes ещёuploading; doneпослеHTTPsuccess; providedIDs сохранены |
| backend/src/modules/attachments/attachments.service.ts | CanonicalsameUUID URL неfixturetext; `e2e` внутриUUID не скрывает законноефото; name/opId/noncanonical markersсохранены |

[15beforegroups](confirmed-gaps.md), [diff](product-diff.patch), [upload3hunks](upload-helper-change.patch), [source/buildhashes](source-checks.json). Initial25owners baseline **не включал поздно найденный uploadhelper**: его pre-edit bytecapture не выдуман, narrowpatchrecord явно reconstructed. Standhelper добавилтолькоOps01target/exportpath, неinstaller. Общиеperiod/visibility/authresolver/roles/Shift/People owners не переписаны.

Source identity `46a7e80bf7c397e8987ad8e8e6458d60a29ac80cf28c6fd775d76c3b000109b0`. Frontend `index-BVVFqr5f.js`/`index-iuCOMHyM.css`; bytes/SHA вsourcechecks. Orders/Task/Notifications acceptedowners/4priorZIP exact.4newtestfiles; dirtyworktree не очищался/не коммитился.

## Финальная проверка и сохранность

[Tests/builds](final-checks.json):26OPS/Audit/Error/upload +48attachment/archive +21retainednotification = **95/95 isolated**. Backendbuild,frontendtypecheck/build,Prismavalidate/controlledgenerateownstage/DMMFequal/57SQLdiskchecksums/strictdiff0PASS. Первыйrunnerapproval отклонён; [offlineguard+cleanenv устранилипричину](test-safety.md), не обход. Working.env длязапуска не читался, deps/schemaunchanged.

[Owncopy](copy.json) 90/68/68exact настарте,31users/2existingfactories,неT2. [Finish](finish-own.json):32ownErrorReportCLOSED,2fixtureStockARCHIVED quantityunchanged,liveTaskDONE/runCLOSED. История/файлы retained, no physicalcleanup. HistoricalACTIVEchild закрытогородителя — намеренныйдатасет, не текущаяоперация.

**T1:** доReturn90tables/68files exact; послеReturn **84/90tables exact**,68/68files/bindings exact.6таблиц изменены штатным20:00autoclose при моём запуске20:33:3shifts/3assignments/+3credits,6auditrows. Это моя ошибка учёта sideeffects при требованииexactpreservation. [SQL/причина](preservation-exception.json),[решение](preservation-exception.md). FactoryisActive=true,31users,права/структура сохранены; noautodata rollback/schedulerdisable.

Приложение **остановлено дляreview**: backend27280/preview20592 остановлены; OPS01backend6332 ранееостановлен. OwnPG15437/PID24212 оставлен,appSQLconnections0. PID—наблюдения,некоманды. URLпосле отдельного решения о запуске `http://127.0.0.1:5173/`, **сейчаснедоступен**. StopоставшегосяPG: `./docs/vps-preparation/factory-01/stand.ps1 -Action Stop -Target T1` соfreshidentity. [Quiesce](../factory-01/runtime-20260927-173506-227.json). Не возобновлятьT1 автоматически до решения о дельте.

## Решение / передача

[A/B/C readiness](server-readiness.md): **NO доreviewT1exception**, не blanketотказ поhistoricalPARTIAL. В исправленных boundedproductpaths `none proven` открытыхblockers; Linux/Compose/HTTPS/WSS/volumes/backup/serverrestart/load не проверены. Source-onlynotificationwindows отдельно: неliveFAIL, но нельзя обещать надёжный зависимыйalertworkflow безfaultacceptance/решения. Policy/29settings/063/ролевойостаток сохранены.

Один [reviewZIP](review-pack-ops01-20260927.zip), [manifest](review-pack-manifest.json), [fullbyte/SHAreadback](review-pack-readback.json). Self-containedsource/evidence review,неinstaller/backup. Secrets/dump/uploads/credentialindex/dependencyjunction/buildbinaries/старыеZIP исключены. [Retainedexternalindex](review-external-references.json) классифицирует историческиессылки. Repoне выдаётся заLibrary/памятьаккаунта.

```text
OPS01_STATUS=PARTIAL_T1_PRESERVATION_EXCEPTION
STATISTICS_METRICS=86/86_VISIBLE_SLOTS;648_RECONCILED_VALUES;NO_UNCHECKED_VISIBLE_SLOT
SOURCE_API_UI_PARITY=PASS_BOUNDED_INDEPENDENT_2_DATASETS_2_ROLES
PERIODS_AND_SHIFT_BOUNDARIES=PASS_343_FINAL_SQL_HTTP_PLUS_TARGETED
DOWNTIME_AND_OPEN_INTERVALS=PASS_CLIPPED_ASOF_PER_LINE
TASK_TIMES_AND_PERCENTILES=PASS_NEAREST_RANK_NULL_NOT_ZERO
CHECKLIST_QUALITY_WASH_OTHER_KPI=PASS_CURRENT_VISIBLE_CONTRACT
FILTERS_DRILLDOWN_EXPORT=PASS_EXISTING_INLINE_AUDIT_MODAL_ARCHIVE_XLSX
STATISTICS_ACCESS_AND_FACTORY_SCOPE=PASS_103_PLUS_LATE_LOGOUT_CONTEXT
AUDIT_SEARCH_FILTERS_DETAILS=PASS_REAL_UI_7_ACTIONS_STABLE_PAGES
ERROR_REPORT_END_TO_END=PASS_CURRENT_CONTRACT_COMPOSITE;STORED_APP_VERSION_ABSENT
ADMIN_MANAGEMENT_MENU_SMOKE=PASS_20_AND_18_SECTIONS_1440_390
PRODUCT_FIXES=15_GROUPS_6_PRODUCT_FILES
POLICY_PENDING_IN_SCOPE=CHANGED_PAYLOAD;PUBLICATION_FUTURE_EXPIRED_LATE_ACK_GLOBAL;CHECKLIST_GRACE_SHARED_REFS;RANGE206
T1_PRESERVATION=PARTIAL_84_OF_90_TABLES_EXACT_68_FILES_EXACT;3_NATIVE_SHIFT_AUTOCLOSES;APPS_QUIESCED
TESTS_BUILDS=95_ISOLATED_PASS_BACKEND_FRONTEND_PRISMA_DIFF0
MIGRATIONS=57_UNCHANGED
CAN_START_CLOSED_VPS_ACCEPTANCE=NO_PENDING_T1_EXCEPTION_REVIEW
EXACT_BLOCKERS_BEFORE_VPS=T1_DELTA_ACCEPTANCE_OR_SEPARATE_RECOVERY_DECISION;NONE_PROVEN_OPEN_IN_FIXED_PRODUCT_PATHS
REQUIRED_ON_VPS=LINUX_COMPOSE_CONTAINER_NETWORK_AUTH_HTTPS_WSS_VOLUMES_PERMISSIONS_TIME_RESTART_BACKUP_RESTORE_UPDATE_LOAD
DEFERRED_WITH_LIMITS=EXACT_C_TABLE_AND_SOURCE_ONLY_NOTIFICATION_RISKS
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING_NOT_RUN_BY_USER_PRIORITY
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
REVIEW_ZIP=review-pack-ops01-20260927.zip;exact bytes/SHA in adjacent readback
FINAL_STOP=STOP_FOR_REVIEW_BEFORE_VPS
```

Skills: computer-use — настоящие Edgejourneys/визуальнаяпроверка; spreadsheets — read-onlyпроверка existingXLSX bundledartifact-tool, безновогоexportengine.
