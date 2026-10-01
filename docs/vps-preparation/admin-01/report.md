# ADMIN-01 — итог Admin acceptance и сверки v1

26.09.2026. **ADMIN01_STATUS=PARTIAL; V1_FUNCTIONALITY_COMPLETE=PARTIAL.** Проверенная часть — настоящее Windows-приложение (UI → HTTP/WS → собственная PostgreSQL → audit/второй consumer), не Linux/VPS. Ни Pilot Ready, ни полная самостоятельная эксплуатация без разработчика пока не подтверждены.

## Ответ на два вопроса

1. **Базовую площадку ADMIN теперь может настроить через интерфейс:** завод, отделы, иерархию должностей, линию/позиции/состав, людей и доступы, действующие параметры, шаблоны и объявления. Это выполнено на чистой изолированной основе. **Полное сопровождение — пока нет:** найден конфликт active UFA с home-factory guard отправки домой, отсутствует UI решения запроса на возврат, 30 сохраняемых настроек не подключены к операционным потребителям; часть ветвей ещё не получила полного live proof.
2. Все перечисленные крупные модули v1 имеют текущие UI и backend owners. Однако утверждать полноту v1 нельзя: одна доказанно отсутствующая UI-функция, мёртвые настройки/связи и прежние PARTIAL/POLICY_PENDING остаются. Скрытые по RBAC экраны и отложенные функции не объявлены потерянными.

Основные результаты: [Admin Acceptance Matrix](admin-acceptance-matrix.md), [Module Settings Matrix — все 66 полей](module-settings-matrix.md), [V1 Completeness Matrix](v1-completeness-matrix.md), [точные оставшиеся пробелы и один следующий пакет](remaining-gaps.md), [clean Admin journey](clean-setup-journey.md).

## Итоговые статусы

`PASS` здесь ограничен проверенной Admin-функцией и пределами матрицы, а не всей ролью или бизнес-модулем.

```text
ADMIN01_STATUS=PARTIAL
ADMIN_FACTORY=PARTIAL
ADMIN_DEPARTMENTS=PARTIAL
ADMIN_LINES_POSITIONS=PASS
ADMIN_USERS=PASS
ADMIN_MULTI_FACTORY=PASS
ADMIN_ROLES_PERMISSIONS=PASS
ADMIN_COPY_RIGHTS=PASS
ADMIN_JOB_TITLES=PASS
ADMIN_SKILLS=PASS
ADMIN_MODULE_SETTINGS=PARTIAL
ADMIN_CHECKLIST_EDITOR=PASS
ADMIN_ANNOUNCEMENTS=PARTIAL
ADMIN_CHATS=PASS
ADMIN_AUDIT=PASS
ADMIN_CLEAN_SETUP_JOURNEY=PARTIAL
V1_FUNCTIONALITY_COMPLETE=PARTIAL
LOCAL03_STATUS=PARTIAL
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
FULL_NEW_FACTORY=NOT_CREATED
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_AFTER_ADMIN_AND_V1_COMPLETENESS_REVIEW
```

`MISSING_V1_FUNCTIONS`: список/решение мастером `ShiftReturnRequest` — существующий запрос пользователя обещает решение мастера, GET/PATCH backend есть, соответствующий frontend consumer не найден. Не доказано отсутствие целого модуля смен.

`DEAD_CONFIG_OR_LINKS`: **точные 30 полей перечислены по восьми моделям в [remaining-gaps](remaining-gaps.md#dead_config--exact30)**; дополнительно active C UFA → `EmployeeService.sendHome` получает home-factory409; ShiftLog → второй открытый UI не refresh за8с (retained LOCAL03). Это не означает, что сами файлы/чаты/календарь отсутствуют: не работает управление ими через конкретные toggles.

`DEFERRED_V1_FUNCTIONS`: `TaskSettings.taskChatMirrorEnabledReserved`, `ChatSettings.voiceReserved`, `ChatSettings.videoReserved`; два legacy `DefrostSettings.defrostCommentRequiredOnStart/End` superseded для today UI согласованным Stage37. Общие freeze-исключения (ERP/1С, цены/себестоимость/партии, внешний realtime/chat service, сложный BI, offline binary sync, новые архитектуры и полный Stage68) не восстанавливаются как «потерянный v1». Уже отдельно принятые Windows backup/restore этим не отменены.

`POLICY_PENDING`: MI-SEC changed payload при том же operationId; MI-PUB future/expired/late ACK/global owner; checklist grace UI re-entry и global/shared reference inheritance; требование Range206 вместо фактического200; принятие альтернативы исходной недоступной UI063 geometry. Поведение и границы описаны в [remaining-gaps](remaining-gaps.md#policy_pending--сохранены-без-решения).

`SCHEMA_DECISION_REQUIRED`: для выполненных исправлений — **нет**; для будущего attendance reconciliation необходимость новой схемы ещё не установлена. Migration58 не разрешена и не создана.

## PRODUCT_FIXES — точный состав

16 product files (15 существующих + один маленький helper), четыре новых targeted tests; schema, зависимости, auth/security ceilings и production runtime config не менялись. До/после каждого owner: [final-integrity.json](final-integrity.json), полная meaningful разница от сохранённой dirty baseline — [product-changes.diff](product-changes.diff), исходные 40 snapshots в `before/`. Это не diff от чистого HEAD, который потерял бы прежнюю работу.

| Исправление существующего owner | Точные product files | Проверка результата |
|---|---|---|
| Реальный factory context Admin picker/create и сохранение маршрута; operational settings editor с dirty guard; одноразовый recovery credential в UI; недостающие формы edit и accessible job selects | `frontend/src/App.tsx`, `frontend/src/screens/AdminConfigScreen.tsx` | context A0→C/C/200, CRUD/security/recovery/role receipts, settings save/reload, draft probe |
| Factory PATCH в текущем Admin owner; безопасный audit, flex-position DTO, postcommit LINE_UPDATED для конфигурации, русские preview warnings | `backend/src/modules/admin/admin.controller.ts`, `backend/src/modules/admin/admin.service.ts` | CRUD/negative409, MASTER второй UI526мс, A0 unchanged |
| Checklist inactive row не загружает фото; copy pending reference использует отдельный operationId без наследования сохранённого reference; pause form hint | `frontend/src/components/checklist-item-draft.ts` (новый), `frontend/src/components/ChecklistItemEditor.tsx`, `frontend/src/screens/ChecklistsScreen.tsx`, `backend/src/modules/checklists/checklists.service.ts` | editor9 типов/copy/photo immutable SHA, второй UI738мс, pause201/409 |
| Редактор group title/description через существующий modal/dirty guard; whitespace title validation | `frontend/src/screens/ChatsScreen.tsx`, `backend/src/modules/chats/chats.service.ts` | real group/direct/member/file/revoke, title735мс/message528мс/member removal771мс |
| Обычная форма остатков получает defaultUnit и comment flags через четыре безопасных summary hints | `frontend/src/screens/OrdersStockScreen.tsx`, `backend/src/modules/orders/orders.service.ts` | кг в новой форме, UI движения/archive, required409, уведомление0→1, второй UI1095мс |
| Формы заявок получают пять безопасных hints; default deadline и comment flags; прежняя factory-time input/parse пара вместо UTC-сдвига поля | `frontend/src/screens/TasksScreen.tsx`, `backend/src/modules/task/task.service.ts` | UI deadline7h, redirect/done/read-receipt/escalation consumers, DONE; timezone architecture не менялась |
| Право отмены «Я буду» не зависит от обязательности комментария; форма следует backend hint, русская ошибка | `frontend/src/screens/ShiftPeopleScreen.tsx`, `backend/src/modules/shift/shift.service.ts` | UI cancel без комментария при false → CANCELLED; backend true409 |

Новые tests: `backend/scripts/admin01-config.test.js` (7), `admin01-chat-config.test.js` (3), `admin01-settings-consumers.test.js` (4), `frontend/scripts/admin01-checklist-draft.test.cjs` (5). Не меняли исторический тест ради зелёного результата. `EmployeeService.sendHome` и отсутствующий return-decision UI **не исправлены** в этом пакете: первый требует согласования attendance scope, второй остаётся отдельным current-contract пробелом.

## TESTS_BUILDS и границы доказательств

- [Final57](final57.json): Prisma validate, controlled generate, все57 имён/checksums неизменны; новый fresh57, upgrade собственной56→57, strict diff0 для обеих и C1. Это Windows PostgreSQL18.3, не Linux SQL/Compose.
- [Final builds/tests](final-build-checks.json): backend build, frontend typecheck/build PASS; **246 current-scope tests + 41 foundation/auth checks PASS**. Покрыты Admin/hierarchy/delegation/UFA/effective permissions, task/orders, checklist/chat, wash/defrost, notifications/publication, shift/people и применимые shared owners. Не запускался весь исторический954 corpus.
- Исторический **J20 FAIL сохранён**: owner не имеет canonical `chats.access`, WORKER предполагается допустимым member вопреки LOCAL02. Два неуспешных запуска (включая не сработавший negative name-filter) не вычеркнуты; остальные13 shared cases прошли отдельным явным набором. Current chat-security/R2 chain и реальные Admin chat proofs PASS. Утверждения «все исторические тесты зелёные» нет.
- [132 UI состояния](ui-quality.json): 11 форм/состояний ×1440/360/390/430×три темы, overflow/pageerror0; [Admin draft](admin-draft-probe.json), checklist nested cancel и chat Stay. Скриншоты просмотрены, включая final clean390. Не все keyboard/Back сочетания каждого inline editor, не физический телефон.
- [Audit](audit-readback.json):1638 собственных строк/117 типов; обязательные семейства, actor/factory/action/target/time/safe details; проверка утечки ключей секретов/JWT/DBURL в details0. GLOBAL/system nulls объяснены. [Чистый final smoke](clean-smoke-ui.json) PASS, оговорка о техническом hidden fixture раскрыта в journey.
- Source scans: новых browser prompt/alert/confirm и replacement characters0. Это не новый глобальный security/UI Sweep. Секреты тестового runtime, dumps и uploads в review не включены. Final Vite build использовал отдельный пустой envDir; не следует обобщать это на все исторические builds.

Final changed-source identity: `9d45c9851effe1545ae46a73867ff8a7caa7199f102cf3f34074d8beb4e2669c`. HEAD baseline `2dd40727042a01994ff32f396897f70b41d3a3a7`, существующий dirty worktree сохранён. Frontend: `index-SfYBvhTV.js` / `index-iuCOMHyM.css`; hashes и backend entry SHA в final-integrity. Vite CJS/bundle-size warnings — неблокирующие, не скрыты.

## Сохранность и доступный стенд

[Cleanup C](cleanup-c.json) PASS: `admin01-c` inactive, три собственных пользователя blocked, все их UFA revoked; собственные смены/назначения завершены, шаблоны/группы/остаток архивированы, структура деактивирована. 19 history counters до/после совпали; audit/history физически не удалены. HTTP-only закрытие своей shift session и cleanup скрытого smoke-отдела не выданы за UI proof.

**C1 возвращён и оставлен для просмотра:** [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Backend3000, PostgreSQL15436 — только127.0.0.1. [Свежая identity процессов](runtime-readback.json), [read-only C1 verification](final-live-state.json): `/ready=true`, version `LOCAL03-20260924-C1`; users17/activeUFA17/activeLines1/activeSessions0 и A active/B inactive соответствуют baseline. Это не byte equality всей базы. Проверки ADMIN01 записывали в отдельные собственные targets, не C1 и не рабочую БД.

В последнем наблюдении: backend PID8176 (запущен ADMIN01 при возврате C1), frontend PID14676 и PostgreSQL PID17668 оставлены от LOCAL03. Временные ADMIN01 backend-процессы остановлены при переключениях, receipts `backend-switch-*.json` сохранены. PID — только факт наблюдения, не инструкция остановки.

Штатно остановить **только собственный стенд**:

```powershell
& 'C:\Users\79164\Documents\work\docs\vps-preparation\admin-01\stop-stand.ps1'
```

Helper сначала заново проверяет port/PID/creation/executable/command/version/own pgdata, затем останавливает backend, frontend и PostgreSQL штатным pg_ctl; ничего не удаляет. [stop-stand.ps1](stop-stand.ps1) синтаксически проверен, **не выполнялся**, чтобы C1 остался доступен. Прежние PID не использовать вслепую.

## Review package и остановка

Один [review-pack-admin01-20260926.zip](review-pack-admin01-20260926.zip). Состав, исключения и retained external evidence — [README-review.md](README-review.md), [manifest](review-pack-manifest.json). **Размер, SHA256 и полный byte/SHA readback каждой записи — [review-pack-readback.json](review-pack-readback.json)**; receipt лежит рядом с ZIP, поскольку собственный SHA архива нельзя вложить в него без изменения этого SHA.

LOCAL03 report/role-matrix/five-gate-matrix и ссылки на его прошлые receipts — явно retained external evidence, не новая приёмка и не перепакованный LOCAL03 ZIP. Текущие ADMIN01 receipts, три матрицы, изменённые sources/tests, before/after/diff, безопасные логи и bounded screenshots включаются в новый review.

Одна рекомендуемая следующая реализация — **ADMIN02 attendance scope + существующий UI решения возврата**, критерии/разрешения в [remaining-gaps](remaining-gaps.md#одна-рекомендуемая-следующая-реализация--не-запущена). **Автоматически не начата.** Остановка после этого review, до полноценного нового завода. Linux/deployment остаётся обязательной отдельной проверкой до серверного пилота, не доказан native Windows результатом.

---

## Исторический рабочий журнал — не текущий статус

Ниже сохранены промежуточные IN_PROGRESS и прежние остатки. Они заменены итогом выше; C больше не ACTIVE, backend уже возвращён на C1. Ошибки before/локаторов в receipts сохранены намеренно; окончательные статусы читаются вместе с after/readback, а не стирают первоначальное наблюдение.

26.09.2026. `ADMIN01_STATUS=IN_PROGRESS`, не итоговый PASS. Источник поручения — ADMIN-01, отдельная приёмка админки после LOCAL03 PARTIAL. Один writer/browser worker. Цель — завершить доступные ветви, затем остановиться перед полноценным новым заводом.

## Изоляция и исходная точка

`before.json`: HEAD, 57 применённых migrations, relevant source snapshots/hashes, identity собственного C1. `clean-target.json`: отдельная копия неизменённого final C0 в `zavod_local02_admin01_clean`, исходно только foundation + первый ADMIN + нейтральный A0. PostgreSQL 18.3/15436, backend3000 и frontend5173 — loopback. Рабочие данные и исходный C1 не используются для записей этой приёмки. Собственный uploads-каталог изолирован в защищённом ADMIN01 runtime. `switch-backend.ps1` проверяет свежую identity; текущий backend временно обслуживает ADMIN01 clean, в конце требуется возврат C1.

## Подтверждённые находки и текущее исправление

1. Admin factory picker и результат создания меняли только локальное состояние компонента. Реальный header оставался A0: после UI POST создания C `/auth/me`/staffing=A0, GET C/context=403. `structure-journey.json.contextBefore`. Исправлены существующие `App.tsx` и `AdminConfigScreen.tsx`: destination `/auth/me`, действующие UFA/ADMIN/active checks, единый app context и сохранение маршрута Admin. `contextAfter` показывает C/C/200. Backend bypass не добавлен.
2. Normal branch «Настройки модулей» — read-only; fallback пересохранял прежние значения без редактора. `admin-ui-before.json`, `admin-settings-before.png`. Добавлен редактор полей с найденными рабочими consumers через прежние preview/PATCH. Неиспользуемые и reserved поля видны с ограничением, не представлены рабочими переключателями. Полный per-setting source inventory — `settings-source-inventory.json`; наличие совпадения имени ещё не PASS consumer. UI→DB→consumer проверки продолжаются.
3. В форме должностей подсказка была первым labelable control внутри label, из-за чего select не получал ожидаемого accessible name. Добавлены точные aria-label трём select. Тест использует доступные combobox, а не кнопку подсказки.

## Bounded C

Создан через видимый UI, EMPTY, без копирования истории: `admin01-c` / `7615c315-5c00-415b-92d6-39182af7ea0a`. Два отдела и две должности parent→child, одна линия создаются тем же последовательным UI runner. Receipt сохраняется после каждого HTTP commit, повторный запуск не плодит fixtures. Ошибки локаторов отличены от отказов продукта. C пока ACTIVE: обязателен штатный lifecycle cleanup в конце, не физическое удаление.

## Остаток программы (не потерять)

### Продолжение текущей сессии 26.09, не финальный результат

Сохранены следующие новые реальные UI→HTTP→SQL/consumer receipts:

- `users-journey.json`, `recovery-after.json`, `users-security.json`: регистрация/назначение, одноразовое восстановление с личным паролем, block/revoke/downgrade/stale denial и один multi-factory User. Никакие credentials в evidence не записаны.
- `roles-permissions.json`: все15 ролей configurator→auth/me→menu→direct API, исходные права восстановлены; ADMIN canonical exception отдельно. `permission-copy-ui.json`: limited MASTER, права ниже себя, запреты повышения/self/cross-factory/blocked, identity/password/history не копируются; поле `recipientRetired` в том же receipt — собственный получатель заблокирован, C UFA revoked.
- `skills-ui.json`, `crud-edit-journey.json`: штатные навыки/профиль и edit основных конфигураций; line update во втором открытом UI без F5. Новые редакторы используют прежние owners; factory PATCH добавлен в существующий Admin owner.
- `announcements-ui.json`: factory/selected departments, ACK/report/archive и оба активных параметра; policy-пункты не изменены.
- `checklist-editor-ui.json`, `checklist-copy-after.json`: все9 текущих типов, эталон replace/remove, immutable closed snapshot, копирование pending photo с отдельными operationId; inactive row больше не пытается загрузить файл после частичного save. Все исходные шаблоны этой ветви архивированы.
- `chats-admin-ui.json`: PASS в проверенном Admin scope; title update второй страницы735ms, message528ms, membership removal771ms; владельцы/администраторы/участники, private, файл/revoke, direct, archive. Три настройки проверены и восстановлены. Добавлен отсутствовавший UI редактор названия/описания, backend whitespace guard.
- `wash-defrost-settings.json`: шесть wash settings дали реальные guard/operation результаты, мойка DONE, настройки восстановлены. **Коррекция discovery:** два legacy defrost comment flags не управляют today UI по согласованному `docs/stage37-defrost-calendar-ux.md:50`. Сегодняшний UI start/complete без комментария проверен; backend не изменялся. Эти два поля убраны из нового operational editor и помечены устаревшими. Первоначальные32 сохранённых поля в `settings-persistence.json` — историческое persistence proof; текущих operational editable полей30.
- `orders-settings-ui.json`: воспроизведены игнорирование defaultUnit и обязательности комментариев; исправлены форма и узкая `summary.formSettings`, без расширения доступа к full settings. UI/realHTTP/SQL расход/пополнение/archive, low-stock notification0→1, второй UI1095ms; item архивирован, настройки восстановлены.
- `task-settings-ui.json`, `shift-setting-ui.json`, `checklist-settings-ui.json`: сохранены before-доказательства ещё трёх разрывов настройки→форма. Правки текущих owners сделаны; after-прогоны/финальные regressions ещё продолжаются. Task deadline также использует существующую пару factory-time input/parse вместо потери трёх часов UTC→datetime-local. Архитектура времени не менялась.

Завод C пока ACTIVE, worker/master активны, часть ограниченных операций ещё требует закрытия. Финальный C cleanup/C1 return/матрицы/ZIP пока **НЕ ВЫПОЛНЕНЫ**. Ошибки локаторов в receipts — промежуточная история, не продуктовые FAIL/PASS; финальная матрица обязана перечислить точные пределы.

Завершить structure/settings downstream; Users/registration/recovery/UFA/multifactory/role15/delegation/security; полный checklist editor/announcement/chat Admin; audit; минимальные подтверждённые CRUD gaps; 1440/360/390/430 и темы изменённых экранов; Admin/Module Settings/V1 completeness matrices; affected regressions + final identity + Prisma validate/generate/fresh57/56→57/diff/builds; отдельный final clean Admin smoke; свои users revoke/block, fixtures lifecycle, C inactive, C1 вернуть; safe self-contained ZIP/full entry readback/SHA.

LOCAL03 остаётся PARTIAL, его пять gates и 14-role matrix не повышаются. Policy-bound MI-SEC payload retry, MI-PUB, checklist grace re-entry, Range interpretation, historical UI063 geometry сохранены. Новая migration после57 не разрешена. `LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED`, `PHYSICAL_PHONE=PENDING`, полноценный новый завод/№4/VPS не начаты; MASTER R5 и MAIN_UI_SWEEP на паузе.
