# Завод v1.0 — результат maximum integration, 15.09.2026

## Итог и границы

`MASTER_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS`.

Это отдельный разрешённый master package, не продолжение основного UI Sweep. Обработаны11/11 старых roots, THV06,26/26 backend modules и23 frontend owners; построены реальные source/contract связи и J01–J32. В доступном isolated контуре исправлены подтверждённые локальные причины и выполнен финальный проход на неизменных продуктовых файлах. **Полная интеграционная/пилотная приёмка не достигнута:** два backend P1 negative contracts оставлены FAIL,014/legacy050 требуют решения, live/physical и часть точных offline ветвей не доказаны. «Весь пакет зелёный» или Pilot Ready не заявляются.

`MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`; `MAIN_FULL_SWEEP_RESUMED=NO`.

Финальная identity: `0b2bd805f1eb468accfe99e9d9c58bc21d2fdbfe0c57c1763b20af6a618b8de4`,207 product source/public/schema files.132 build artifacts захешированы в `final-build-identity.json`; JS `index-D_PTYRHk.js`, CSS `index-fYILHwoi.css`. После freeze product code не менялся; финальная read-only проверка hash совпала.

## Что было до этого запуска и что добавлено

На receipt11/11 owners предыдущего frontend handoff совпали с сохранёнными хешами. До master уже существовали три темы и их предыдущие исправления, измеряемая нижняя навигация THV06, первые frontend044/047/063, source-исправление036. Они **не приписаны этому запуску**. Прежний screenshot ZIP сохранён без изменений: `../../frontend-series/20260915-autonomous-frontend/frontend-series-review.zip`, SHA256 `a7d04c4bffb89a9cabe89d9e49e47e5178dd0688013d7c8fdc5519dd0d40bbde` (409 files/213 PNG, по предыдущему manifest). Основной pause report и его старые evidence остаются отдельными источниками, не current acceptance.

Собственная product delta —16 owners (12 existing +4 new), не накопленный `git diff` всего worktree:

| Причина → исправление | Изменённые owners | Доказательство / ограничение |
|---|---|---|
|044: late read/count/auth мог вернуть старую фабрику; введены context epoch, latest intent, same-key single-flight, post-await guards | `App.tsx` | Before реальный UI FAIL; H factory/logout/new-user/reversed/dedupe/error/cold/adapters. Настоящая доставка push/HTTP не проверена |
|063: board300 ошибочно был authority; терялся parent descriptor и dirty target; stale detail/readonly footer | `App.tsx`, `TasksScreen.tsx`, `ShiftPeopleScreen.tsx` | H actual writers People/Shift/Lines/timeline, guarded detail вне300,401/403/404/409/503, pending Back/revoke/races, MASTER future-night return/dirty Stay-discard. Не все nested scroll permutations |
|047: conditional draft/baseline терялся; поздние defaults; отсутствие parent busy позволяло закрыть pending submit | `ActionModal.tsx` | H5 form cases:7fieldtypes,0/false/empty, untouched/edited/revert/entity/schema/options/child/file cancel, internal+external busy/retry. Не31 живых consumer mutations |
|060: pending preview дублировался между consumers; URL lifetime не был общим | new `api/attachment-preview-resource.ts`, `AttachmentPreviewList.tsx` | H5 resource cases: sameid single-flight/refcount/context/last-release/timeout/403/404/retry/unmount/Back,4modes/image/audio/video/doc. Synthetic media != physical |
|069: общего install owner не было | `App.tsx`, `FactorySelectScreen.tsx`; new `pwa-install.ts`, `PwaInstallButton.tsx`, `DeviceAccessPanel.tsx` | H два входа, available/cancel/error/accepted/appinstalled/standalone/reload/update draft; explicit gesture выбранного device и immediate trackstop. Physical installation/permissions pending |
|042/046/050/053: exact generator predicates не покрывали текущие diagnostic identities | `backend/common/pilot-visibility.ts`, `ArchiveService` | Before4 predicate FAIL; H actual corpus+Archive summary/details/departments+Announcement current/unread/archive+Admin company/factory readers. Старый broad PILOT collision остаётся решением |
|MI-FORM-02: уже показанные validation/503 exceptions уходили в unhandled rejection | `ChecklistsScreen.tsx` | Before FAIL; H required0/text/offline/retry/reopen, draft остаётся, false advance нет |
|MI-RT-01: callback закрытого WS и delayed invalidation меняли новый контекст | `ws/client.ts` | Gbefore1PASS/1FAIL → H actual WS/store3PASS: old socket/ABA/revoke/coalescing/reconnect. Не server room/auth fix |
|MI-VIS-01/02: собственные DeviceAccess labels и старый plain candidate label были бледными Gray/Light | `styles.css`,10 scoped lines | Before2 label FAIL; H computed color + direct native review. Только существующие theme tokens; Dark/global typography неизменны |
|Типовые DTO/duplicate/LineStatus несовпадения | `store/app.store.ts`, `ChecklistsScreen.tsx` |90→80 supplemental diagnostic instances, introduced0/resolved10. Не заменяет full React typecheck |

Полные source paths, exact before/after hashes и diff лежат в `source-delta-manifest.json`, `snapshots/`, `diffs/`. Соответствие каждому старому root и новым findings — `root-result-matrix.md`. Backend Task/Wash/Announcements, схема, роли/guards, расчёты/idempotency engine не переписывались.

## Реальные финальные результаты

| Gate | Терминальный результат | Что это доказывает |
|---|---|---|
| H final browser | **50 PASS /1 FAIL из51** | Один cold-standalone failure вызван преждевременным выбором mobile settings locator до появления desktop navigation; original failure сохранён |
| H scoped harness recheck | **11/11 PASS** | Единственная helper-only правка ожидания, те же product bytes; покрывает все11 затронутых review-variants cases.51 expected unique IDs теперь имеют итоговое isolated доказательство; это НЕ «один51/51 запуск» |
| H offline backend actual contracts | **61 PASS /2 FAIL из63**, cancelled/skipped0 | MI-SEC-01 и MI-PUB-01 остаются настоящими negative FAIL; fail-closed memory repositories и реальные compiled guards/services, без Nest/Prisma bootstrap |
| H actual frontend WS/store | **3/3 PASS** | Fake transport/timer VM, никакого реального сокета/сервера |
| Frontend / backend build | PASS / PASS | Frontend log сохранён; backend terminal exit0 observed в tool session82343, raw stdout отдельно не записан.132 build hashes сохранены; повтор ради лога не запускался |
| Prisma | validate PASS | Exact schema copy, process-local dummy config, no .env loading/DB connection/migration |
| Supplemental types | baseline90/current80; introduced0/resolved10 |73 JSX children/key declaration artifacts +7 inference diagnostics в неполном React graph. Нет frontend tsconfig/@types react/react-dom; full type gate NOT_PASS, dependencies не установлены |

`final-test-manifest.json` сохраняет **все75 существующих log outcomes**, включая before failures и harness/setup failures; ни один не заменён поздним PASS. В финальных browser child records unknown product requests0/pageerrors0; backend writes0 по fail-closed harness. Это не наблюдение production сети. В manifest отдельно указаны пробелы старых run identity: ранние записи содержат App/styles/helper hashes, но не полный старый test graph/точную command line. Эти данные не изобретены задним числом.

## Покрытие без смешивания знаменателей

- Current modules:26/26 backend,23 frontend classes;387 controller signatures (302 permission-annotated,85 требуют service/identity authority). Это не387 live endpoints PASS.
- Семантический graph:1407 method-contract edges,1318 STATIC_ONLY;89 PARTIAL_METHOD_FAMILY. **VERIFIED_ISOLATED_FULL_EDGE=0 в строгом branch-specific счётчике:**89 получили доказательство семейства методов, но не измеренное исполнение каждой вложенной связи.444 wrapper/local/infrastructure bindings исключены с основаниями;0 неразрешённых dynamic API bindings после source reconciliation. `semantic-edge-matrix-handoff.json` — current owner; прежние варианты сохранены как superseded parser snapshots.
-31 ActionModal bindings и28 preview bindings сопоставлены с distinct risk classes; общие классы проверены, individual bindings остаются static.19/19 ShiftLog handler bindings найдены exact text; только J14/archive bounded controls получили current browser proof.
- J01–J32: **19 BOUNDED_ISOLATED /11 PARTIAL_ISOLATED /2 BLOCKED_NEGATIVE**.32 accounted, не32 полных chains PASS. Actual IDs/DTO/permissions/negative paths и недостающие варианты — `integrated-journeys-matrix.md`.
- Parent остаётся историческим:284 surfaces;957 control rows/956 legacy IDs и957 semantic keys;954PASS/3FAIL. Back1614PASS/4FAIL/4component/1physicalpending; text2711PASS/35FAIL/8NOT_RUN.14 exclusions (12unreachable/2non-production) сохранены. Шесть родительских matrix hashes совпадают с receipt. Эти цифры не повышены по новым кликам/tests/PNG.
- Historical parent open P0=0/P1=1/P2=10 не пересчитаны. Новые незакрытые findings master: P0=0/P1=2/P2=0. Это разные срезы, их нельзя выдавать за общий Pilot acceptance.

Неподтверждённые offline branches не названы «невозможными без БД»: все nested Return scrolls, same-name field type replacement/removed options, часть Wash OKK/Checklist occurrence/Admin/order mutations остаются PARTIAL/static. Это ограничения полноты задания, не новые доказанные product bugs и не разрешение их выполнять сейчас.

## Native UI / evidence

В текущем batch **329 оригинальных PNG**,167 из H-final; все перечислены с SHA256 в `screenshot-index.json`. Напрямую просмотрены50 финальных кадров:36 новых Settings/Login/task form (Dark/Gray/Light ×1440/360/390/430),4 low-height/breakpoint overlays,8 навигационных кадров без overlay и2 populated/archive frames. Остальные279: CAPTURED_NOT_DIRECTLY_REVIEWED, не all-reviewed. Metadata содержит роль/тему/viewport, captured build/source/harness, fixture context, состояние, runtime/geometry references; у runner failure PNG отсутствующие поля явно null.

Штатный end-scroll сохраняется в metadata: верхние ранее показанные поля могут быть вне кадра. Внизу истории смен day/night actions доступны; новой «починки ранее недоступной истории» не приписано. Нижние multiline labels компактные, native frames и Range/hit-tests сохранены;1px tolerance не назван комфортным запасом. H J14 отдельно показывает неизменяемый комментарий передачи и отдельный комментарий журнала: различие не объявлено потерей данных по screenshot.

Все captured failure/before PNG включены в export, не только50 удобных. Старые screenshot packages не переписаны. Формальный WCAG ratio всей системы и physical media не утверждаются.

## Открытые решения и будущая узкая работа

1. **MI-SEC-01 P1:** real Task.take replay по прежнему(userId,operationId) возвращает resultKey чужой выбранной фабрики через unscoped findUnique, до normal factory/canAct. Воспроизведено offline с non-admin TECH; Task product unchanged. Нужен Astra High/Max bounded security/idempotency review и решение retry visibility после revoke/factory/delete. Родственные create/complete/Wash ветви — source-only, не дополнительные доказанные exploits.
2. **MI-PUB-01 P1:** archive-capable identity читает active announcement, но markRead выбирает archived-only через visibleWhere(includeArchive:true), получает403. Нужен узкий current/expired/archive ack contract; нельзя расширять аудиторию/guard по предположению.
3. **UI-SWEEP-014 P2:** нет однозначной WashSession operation relation; видимость участвует и в occupancy/write invariants. Нужны exact existing fixture facts и решение projection-only versus occupancy. Схема/данные не менялись.
4. **050/MI-CLS-01:** старое PILOT prefix правило скрывает похожее человеческое имя; это прежняя policy-неоднозначность, не устранённая exact generator delta.
5. **036 P1:** существующее source-исправление подтверждено H7actualgroups+J14UI, но live authenticated HTTP/DB/file guards/readreceipt отсутствуют.063 от036 функционально не зависит; frontend063 сейчас реализован и bounded rechecked.

Owners, воспроизведение, последствия и минимальные verification plans: `decision-queue.md`, `root-result-matrix.md`, `remaining-live-and-physical.md`. Последний файл не даёт разрешения запускать службы. Полный API middleware/UFA/реальные locks/rollback/WS rooms/export parity и физический телефон остаются необходимыми внешними gates.

Заключительный review собственной delta: green UI не доказывает server authorization; tested memory transaction не доказывает rollback/parallel locks; synthetic media не доказывает device permission/codec; static edge у вызванного метода может быть неисполненной branch. Эти границы сохранены явно, отрицательные тесты не ослаблены. KNOWN_NEW_REGRESSIONS=0 только в исполненных bounded gates, не во всём продукте.

## Сохранность, runtime, передача

Dirty worktree сохранён. Никаких reset/clean/stash/restore/rebase/commit/push, seed/migration/DB reset, uploads/.env edits, очистки данных или старых evidence. PostgreSQL/backend/Cloudflare не запускались и не подключались. Собственный loopback frontend PID17760 остановлен Ctrl+C через original session98905; read-only CIM/port check подтвердил PID absent/listeners5173=0. Другие процессы не завершались. Реальные fixture cleanup/data status UNKNOWN. Питание/keep-awake не менялись.

Repo current-state supersession сохранён в parent progress/gap register; Library/account memory **PERSISTENCE_PENDING**, доступного успешного write нет. `source-update-delta.md` готов для последующего переноса после read-before-write. Полные raw conversation/context/error-context snapshots и секреты не экспортируются; original test logs, source snapshots, all PNG и безопасные runtime records включены.

Review package: `review-package-root.zip`, части/полный file manifest/hashes — `INDEX.md` и `package-manifest.json`. Не применять как patch вслепую: источник dirty, нужен own-delta/read-before-write.

`NEXT_EXACT_STEP`: отдельный bounded Astra High/Max review MI-SEC-01 по сохранённому negative test; без запуска служб и без автоматического возобновления остальных ветвей.

`UI_036_LIVE=NOT_PERFORMED / PENDING`; `PHYSICAL_PWA_MEDIA_ANDROID_BACK=PENDING`; `LIVE_RUNTIME_STARTED=NO`; `SOURCE_SYNC=REPO_LOCAL_UPDATED / LOCAL_SAVED / LIBRARY_PERSISTENCE_PENDING`; `FINAL_STOP=STOP`.
