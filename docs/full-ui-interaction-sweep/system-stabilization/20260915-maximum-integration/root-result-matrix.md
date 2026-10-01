# Roots — отдельный master package

Все11 старых roots + THV06 рассмотрены. «Реализовано» относится к source, «проверено» — только указанному слою. Parent severity/954PASS history не закрывается этим документом. Общий fingerprint — `0b2bd805f1eb468accfe99e9d9c58bc21d2fdbfe0c57c1763b20af6a618b8de4`.

| ID / severity | Текущая причина и изменение этого пакета | Owners | Итоговый proof / остаток |
|---|---|---|---|
| THV06 / historical UI | Существующая измеряемая nav сохранена; новая nav implementation не создавалась | App/styles + unchanged mobile-back | H navigation/criticalgeometry/overlay/theme roles PASS; native review; Androidpending |
| UI-SWEEP-014 P2 | У WashSession нет однозначной operation relation; read-filter также участвует в active occupancy | Wash/Line/Defrost/Shift/Handover/Archive/Ops, ProcessedOperation | SOURCE_REVIEWED; patch STOPPED. Exact persisted fact + projection/occupancy decision; не hide по имени |
| UI-SWEEP-036 P1 | Предыдущая archive implementation уже существовала; не переписана | ShiftLog controller/service/screen, Attachments, classifier | H7actualgroups + real-shellJ14;19/19 handlers matched, только boundedbrowser, LIVE P1pending |
| UI-SWEEP-042 P2 | Archive downtime использовал более узкий pilot classifier; exact runtime/realtime operation fixtures проходили в totals/details | common/pilot-visibility, ArchiveService | H provenance corpus + summary/details/department/diagnostics parity isolated. Liveexportpending |
| UI-SWEEP-044 P2 | Late read/count/auth мог вернуть прежний factory; epoch/latestintent/singleflight guards | App; existing Notifications/browser/SW adapter unchanged | H factory/logout/newuser/reversed/dedupe/error/cold PASS; actualNotification contracts; nativepushpending |
| UI-SWEEP-046 P2 | Не распознавались доказанные announcement title+body generatorpairs | common classifier; unchanged Announcements consumers | H exactpositive/negative and current/unread/archive memory PASS; MI-PUB-01 отдельно |
| UI-SWEEP-047 P2 | Conditional field disappearance теряла draft/baseline; late defaults; parent безbusy разрешал закрыть pending | ActionModal | H all7fields/defaults/edited/revert/conditional/reorder/options/newentity/childdirty/picker/busy/retry PASS.31bindingmatrix; не31живыхsubmit |
| UI-SWEEP-050 P2 | Exact Cyrillic company formats не покрывались; добавлены доказанные exactmarkers | classifier; unchanged Admin company readers | H memorycorpuses/list PASS. Legacy PILOT human-prefix collision MI-CLS-01 остаётся policydecision |
| UI-SWEEP-053 P2 | Exact scheduler/mf-service factory markers были в ordinary list | classifier; unchanged Admin/factory consumers | H source-positive/negative/currentfactoryprojection PASS. Scheduler не запускался; live selectedaccesspending |
| UI-SWEEP-060 P2 | Perinstance completedURL cache не объединял pending requests; added finite context leases | new api/attachment-preview-resource; AttachmentPreviewList | H5resource/media tests (в общем component файле10: ещё5form), incl4modes/allformats/refcounts/denials/retry.28bindingsstatic; backendfile/physicalpending |
| UI-SWEEP-063 P2 | Prior consumer реализован, но неполный return; board300falseabsence, dirtytargetlost, stale detail и readonly footer | App/Tasks/ShiftPeople | H real writers/guardeddetail/error/races/revoke/dirty/managerfuture/Back PASS. Не зависит от036; всеparent-scrollварианты не доказаны |
| UI-SWEEP-069 P2 | Install owner отсутствовал; один lifecycle/twoentries, honest fallback + gesture-only selected device check | App/FactorySelect; new PwaInstallButton/DeviceAccessPanel/pwa-install | H events/standalone/update/draft/permission/fake media cleanup PASS; native3themes4widths; physicalPENDING |
| MI-FORM-02 P2 fixed | Checklists validation/503 rejection не ловился goNext/finish/retry | ChecklistsScreen | Genuine beforeFAIL→H UI required0/text/offline/retry/reopen no pageerror PASS |
| MI-CAP-01 P2 fixed (063) | Readonly task footer рекламировал forbidden actions вопреки action-sheet predicates | TasksScreen | Genuine FbeforeFAIL→HreadonlycapabilityPASS; неbackendbypass finding |
| MI-RT-01 P2 fixed | Closed WS callback и pending invalidation могли менять новый контекст | ws/client.ts | GbeforeFAIL→HactualWS/store3/3 + Appcontext pathsPASS. Sameowner, no transportprotocol/rights change |
| MI-VIS-01 P2 fixed | Собственная новая DeviceAccessPanel унаследовала белый/бледный текст Gray/Light | styles scoped2selectors | Before2FAIL→Hnativecontrast+buttonsPASS; ownintroducedregression устранена |
| MI-VIS-02 P2 fixed | Старый plain Task candidate label оставался бледным Gray/Light | styles scopedtask label | Nativebefore observation→Hnative+computedcolorPASS; Dark token rules untouched |
| MI-SEC-01 P1 open | Actual Task.take processed replay не делает selected-factory/canAct проверку перед return | TaskService/UserContext/ProcessedOperation (product unchanged) | H negativeFAIL; безопасность/idempotencydecision; AstraHigh/Max separate review |
| MI-PUB-01 P1 open | archive.read переводит markRead visibleWhere в archived-only и запрещает ack активной записи | AnnouncementsService (unchanged) | H negativeFAIL; current/expired/archiveeligibility decision; не расширять scope автоматически |

Типы: 10 supplemental diagnostic instances устранены, четыре семейства реальных DTO/duplicate/LineStatus contracts;90→80, introduced0. Остаток и отсутствие React declarations/tsconfig описаны отдельно. Миграций/API roles/схемы/формул нет.

Счётчики разных слоёв: historical canonical parent open P0=0/P1=1/P2=10 сохранены; новые незакрытые product findings этого пакета P0=0/P1=2/P2=0 (MI-CLS-01 — часть старого050, не дубликат). Это не новая глобальная приёмка. KNOWN_NEW_REGRESSIONS=0 в выполненных bounded gates; отсутствие ошибок вне них не утверждается.
