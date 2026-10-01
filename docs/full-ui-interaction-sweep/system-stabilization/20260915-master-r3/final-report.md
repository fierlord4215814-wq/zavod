# MASTER R3 — итог разрешённой серии A–I

Дата:16.09.2026. MASTER_R3_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS. A–H выполнены в source/isolated scope; результат подготовлен для внешнего review, не для объявления Pilot Ready. Main UI Sweep: PAUSED_BY_USER / NOT_ACCEPTED; MAIN_FULL_SWEEP_RESUMED=NO.

## Что сделано и что не относится к R3

R2 принят как проверяемая база: совпали исходные G2 product/build identities и65 сохранённых after owners. Рассмотрены все26 R2 product diffs и связанные реальные callers/guards/readers. Прежние исправления replay eligibility, publication selection, active Orders read, membership attachment access, DEFROST projection, profile styles и type adapters не приписываются R3. Старый полный UI Sweep не запускался.

Собственный R3 delta: **13 product +34 test/support исходных файла**. Полные before/after, ABSENT receipts новых файлов и собственные diffs находятся в `handoff/source-delta-manifest-v2.json`. Это не весь накопленный dirty worktree. Ничего не reset/clean/stash/restore/rebase/commit/push; schema, .env, uploads, история и реальные данные не изменялись. North Star сохранена.

| Исправленная причина | Existing owners | Подтверждение |
|---|---|---|
| Поздний список завершал восстановление на коротком DOM; поздний профиль открывался после закрытия; старый unlock/scroll callback вмешивался в следующий экран | PeopleScreen, useBodyScrollLock, App | Причинные red traces;6 controlled schedules,12 untraced layout cases, manual-scroll cancellation, rapid Back и retained12 return cases в H |
| Revoke/ABA оставлял форму или позволял старому POST/blob/XHR продолжить работу в новом контексте | App, api/client | Actual revoked People draft/late POST red→green;13 serializer/client context cases; нет обещания отменить серверный commit |
| Удалённый option выглядел как пустой выбор, а строка могла превращаться в checkbox=true | ActionModal | Раздельные typed drafts, unavailable marker, отрицательный submit; actual People line→position;0/false/empty/hidden/defaults;12 component +9 form Back cases |
| Replay direct Wash request принимал изменённый target/input; stock/release — иной quantity/comment | WashService, OrdersService, QuantityReleaseService | Immutable persisted input comparison; changed payload409 без повторной мутации; actual OKK10→3+7→history/archive/Audit/Ops |
| Unchanged retry создавал новую команду | WashScreen, DefrostScreen, ChecklistsScreen |5 Wash +3 Defrost +1 Checklist browser case; тот же serialized operationId для retry, новый для изменённого/переоткрытого действия; numeric0 сохранён |
| Повтор будущего плана выдавал лишний WS event | ShiftService | Changed-result tag в прежней transaction;2 fanout red→green; current rights/time guards сохранены |
| После denied expired/future announcement пустой экран утверждал, что всё прочитано | AnnouncementsScreen | Фактический нейтральный текст;2 actual UI→IPC→controller/service/poll paths,12 сопоставимых before +12 after frames |

Новых бизнес-функций, router/RBAC/idempotency store или CSS-движка нет. `styles.css`, `mobile-back.ts` и Prisma schema неизменны. Во всех13 product owners есть actual regression; нет изменённого product owner, оставленного только с syntax check. При этом production/live эффект ни одного source fix не объявляется доказанным.

## Навигация и настоящие границы результата

Исходный редкий R2 возврат **1286→1213 остаётся UNKNOWN / NOT_REPRODUCED_WITH_LIMITS**. Старый failed run и исходный точный assertion сохранены. Доказанные readiness/unlock/late roots объясняют другие наблюдённые сбои, не эти73px. Полной зависимости UI-063 от UI-036 нет.

Финальная конечная серия:6 расписаний в исходном MASTER390×640, каждое один раз;12 untraced theme/layout cases, внутри dark390×844 два последовательных перехода (13 chains, но12 cases); manual-scroll cancellation, rapid Back и refresh-after-close отдельно. Все эти final first executions PASS, retries0. Порядок фиксированный в исходниках, случайного seed нет. Это ограниченная проверка, не статистическая гарантия отсутствия гонок. Точные даты, shift/panel/search/service/filter, entity вне board300 и ненулевой offset проверяются assertions, не только заголовком.

Pristine Back проверен `page.goBack`, не Cancel. Действующий неизменённый owner сначала снимает focus; следующий Back закрывает нужный слой. Без focus достаточно одного Back. Text/textarea/select/number/checkbox, delayed defaults, edited→revert, nested Stay/discard, busy/error/retry проверены отдельно. Это browser/component proof; физический Android Back остаётся PENDING.

## Реальные связки, static и live — отдельно

Сохранены32 определения journeys:29 BOUNDED_ISOLATED и3 PARTIAL (J03/J04/J15), без уменьшения знаменателя. `G2/integrated-journeys-matrix.json` содержит прежний scope и точный R3 delta каждого ID. Actual Task и Chat/attachment UI→existing client→IPC→real controller/guard/service chains расширены; J14/J19 сохранены. Actual AuditService, NotificationsService, Ops reader и ProcessedOperation используются вместо одного счётчика вызовов в пяти прежних partial edge witnesses.

OKK→QuantityRelease доказывает одинаковые record/history/audit IDs, partial3/10, remaining7, final/replay и readers. Автоматического OKK defect→Task в текущем продукте нет: CONTRACT_ABSENT, не симулированный PASS и не реализованная новая функция. Ручное создание обычной заявки — отдельная команда.

Static: source compatibility всех31 ActionModal/28 preview bindings;45 AST replay method rows плюс supplemental direct-key paths;29 import-dependent provenance readers; graph1407 — карта связей, не1407 PASS. Typecheck проверяет настоящий React graph, а граничный JSON отдельно проверен runtime cases. Не все31 формы были индивидуально отправлены.

Isolated: actual compiled services/controllers/guards/serializers с fail-closed memory; браузерный API/WS перехвачен до App. Изолированная transaction queue не доказывает SQL locks/rollback; fake transport не доказывает room delivery; memory file bytes не HTTP Range/codec. Готовый UserContext не выдаётся за реальный authentication middleware.

Live: **не выполнялся**. PostgreSQL, backend/Nest/AppModule/lifecycle, реальный HTTP API/WS, Docker, внешние push/SMTP/SMS/Cloudflare не запускались и не использовались. Real fixtures/cleanup status UNKNOWN.

## Финальные проверки H

Current product: `33318c278635e56d75458df104bb99a412fb0bd7868de6f52337c3d477783e3c`.

Current build: `f78d0ddaf5e5cabe57f8cfd005d8bf2b7a4d016df705de214da89cf2f055a308`;132 compiled files; frontend asset `index-DAyG6Svj.js`. Harness generation2: `4c854fad4d57daedb7a14f5efe13d243a9a06634e9003ea24b630301648f3148`,64 files. Product/config identities —G2; test identity/results —handoff.

| Единица | Конечный результат |
|---|---|
| Actual backend contract cases |489/489 PASS |
| Type-adapter contract cases |2/2 PASS |
| WS client cases |3/3 PASS |
| Unique browser cases |165/165 PASS, retries0 |
| Настоящий строгий React gate |23 исходных R2 ошибок→0 current;67 roots/139 graph files |
| Backend/frontend builds |PASS; ограничение esbuild преодолено только штатным разрешением |
| Offline Prisma validate |PASS с network/Prisma guard, без DB connection/schema apply |
| Targeted source safety |13 own product diffs:0 findings;17 changed JS/CJS syntax checks PASS |

Исходные425/82/3/2 R2 cases сохранены в общем mapping без исключений; результаты не заимствованы с другой product version. Node494 и browser165 — различные тестовые единицы, не659 уникальных UI controls и не659 production flows.

First scheduled browser165:153 PASS,1 environment failure,11 NOT_RUN. First executed per unique ID:163 PASS,1 environment failure,1 harness failure,0 product failures (2/165=1,21% non-product failures). H-base не смог загрузить esbuild в component beforeAll; после разрешения выявилось неверное `toBeDisabled` ожидание для `<option>` (matcher смотрел на select). Проверка заменена на фактический `option.disabled`, сохранены aria-invalid и отдельный deny-submit. Полная затронутая21-case ветвь повторена и PASS; raw failures не удалены. Эти цифры не стирают genuine red failures предыдущих increment runs и не закрывают исходные73px.

Initial browser census153 сохранён; generation2 добавила12 actual People missing-option theme/width cases, итог165. Изменялся только harness, product после H freeze не менялся. Current expected→actual unique mapping и84 raw run records: `handoff/final-test-manifest.json`.

## Native evidence и сохранность

Индивидуально прочитаны128 кадров: все84 final targets (24 changed visual states +60 profile top/end),24 сопоставимых C1/C4 before и20 targeted menu/history/labels/Ops/long-list frames. Три темы,1440/360/390/430, обязательный360×640 для проблемных групп. На top/end проверены читаемость, переносы, доступность действий; executable hit/Range/end-scroll assertions сохранены рядом. Dark не заменялась новым стилем. Ops spot-check — populated gray frame, не все Ops states во всех темах.

В R3 сохранены398 recorder-native PNG +34 raw failure sidecars =432 screenshots. Иконки build не считаются screenshots. В `native-reviewed.json`, `handoff/native-evidence-index.json` и `handoff/raw-failure-png-index.json` CAPTURED_NOT_REVIEWED отделён от VIEWED; прошлые fail/superseded не принимаются за финальный PASS. Семь кадров, однажды попавших в обрезанный tool output, просмотрены заново малыми партиями перед отметкой VIEWED.

Handoff byte-check обнаружил ограничение прежнего R2 exporter:10 generated dist rows ошибочно попали в source census,4 бинарные копии иконок были записаны как UTF-8. Это не corruption текущего product/build/screenshots. Старые промежуточные файлы сохранены, их generated export-копии исключены из финального ZIP;47 actual source before/after byte-verified,132 current compiled files включены непосредственно с проверкой G2 hashes. Current manifest —`source-delta-manifest-v2.json`, не старое имя безv2.

## Покрытие родительского sweep не перепринято

Шесть parent matrices byte-unchanged.957 semantic controls (956 legacy IDs):954 исторических PASS,3 FAIL/UI-063.284 surfaces:231 PARTIAL_SCOPED_EVIDENCE,49 REVALIDATION_REQUIRED,2 unreachable N/A,2 no-current-state N/A. Reachability249 YES/2NO/2no-current/31revalidation. Back:1614 PASS,1 physical pending,4FAIL,4component-only. Text:2711PASS,35FAIL,8NOT_RUN. Исторический severity snapshot P0=0/P1=1/P2=10 не является current reacceptance.

14 source-control exclusions с точными основаниями сохранены в parent-matrix-retention.json: unreachable inline image branches, dev-only login, противоречивые manager branches и недостижимые legacy line forms. R3 не меняет знаменатель и не суммирует clicks/tests/PNG в controls. Конкретные роли/widths R3 указаны в каждом case/runtime; основные return consumers MASTER, TECH_MECHANIC, MANAGEMENT, targeted worker/admin и отрицательные backend identities. Это не повтор всех ролей на каждом control.

## Полный консолидированный остаток

1. Original UI-06373px: новая причинная гипотеза или реальный witness; не повтор957 controls и не обещание, что036 его исправит.
2. UI-014: exact actor/start operation/resultKey/parent session facts. Marker найден, authoritative chain нет. Read-only extract только по отдельному разрешению; occupancy не освобождать.
3. UI-050/MI-CLS: persisted alternatives для broad legacy PILOT.232 source literal texts/1105 occurrences не доказывают происхождение записей. Exact fixes сохранены.
4. Durable replay kind/input и legacy rows: additive proposal без migration/backfill; per-invocation legacy callers не превращены массово в новую retry queue.
5. Cross-window result-read policy и expired/future publication semantics: конкретные варианты и последствия в decision-queue.md, права не расширялись.
6. Пять live gates MI-SEC-01/MI-PUB-01/MI-R2-ORD-01/MI-R2-CHAT-ATT-01/036: отдельно утверждённые synthetic environment/adapter/fixtures, реальные transaction/revoke/file/WS boundaries. Подготовлены exact routes/steps и default-deny guard17 cases; target adapter намеренно отсутствует до разрешения.
7. J03 atomic plan→fact maintenance; J15 automatic edge отсутствует. Не запускать Scheduler и не создавать workflow ради закрытия матрицы.
8. Физический телефон: установка, cold/update сdirty, camera/mic/gallery cancel/deny/revoke, nested Android Back, reconnect, themes/touch/scroll по единому physical-checklist.md.

Внешние замечания о переносах меню/перекрытии истории сопоставлены с retainedTHV06/FS15, не задвоены. Отличие обычного комментария от immutable handover относится к036/J14, не доказательство потери данных. Все решения объединены в одну очередь; серия не оставлена на первом blocker.

## Runtime, источники и окончание

Own static preview PID556 на127.0.0.1:5173 остановлен Ctrl+C в собственной session98569 после проверки exact command/PID. Повторная проверка16.09.2026 01:00:24MSK: PID/listener отсутствуют. Остальные процессы/службы не тронуты. Все test/build runs terminal; незавершённой текущей проверки нет. Никаких новых реальных fixtures; старый cleanup UNKNOWN.

Repo progress/gap/README получили только semantic delta; history/evidence/matrices сохранены. Library/память аккаунта не обновлены: PERSISTENCE_PENDING. `source-update-delta.md` — готовый точный материал для синхронизации, не обещание записи.

Один полный `zavod-master-r3-full-review.zip`, его entry plan и внешний SHA256/readback receipt перечислены в INDEX.md. После полного package readback — FINAL_STOP=STOP для внешнего review. Новые проверки, полный UI Sweep, Scheduler, Load/Capacity и Stage68 не продолжаются.
