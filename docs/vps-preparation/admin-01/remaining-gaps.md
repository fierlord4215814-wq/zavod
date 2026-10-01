# ADMIN01 — точные оставшиеся разрывы

## Актуальное разрешение ADMIN02 —26.09.2026

Ниже сохранён **исторический** остаток ADMIN01; не считать три закрытых пункта повторным поручением. [ADMIN02 owners/proof](../admin-02/report.md), [authority](../admin-02/attendance-authority-matrix.md).

| ID | Новый bounded результат |
|---|---|
| A01-SEND-HOME-UFA | RESOLVED: assignToLine/Wash/WorkArea/TimeRole/release/sendHome, Shift start/end/contractor, affected Wash/Line/maintenance используют согласованный selected factory/factual guards/person lock.26+4 real SQL cases,2 clients, UI/HTTP/WS, A0 unchanged. Legacy public TIME409 сохранён |
| A01-RETURN-DECISION | RESOLVED: существующие create/list/decide owners, factory provenance, locked PENDING CAS, safe read model, manager/worker UI reject→repeat→approve, обе страницы без F5;403/409/busy/Back |
| LOCAL03-JOURNAL-SECOND-UI | RESOLVED targeted ordinary journal: create/comment/metadata/important-close без F5; dept/factory deny/readonly archive. Не whole UI-SWEEP-036 PASS |
| A01-DEAD-SETTINGS | Теперь29, не30: только sendHomeRequiresComment operational/default true; Admin UI false→empty accepted/null audit→true. Остальные29 ниже без изменения |

`SCHEMA_DECISION_REQUIRED=none`, `MIGRATIONS=57_UNCHANGED`. Current DEAD29 = исторический список30 ниже **минус sendHomeRequiresComment**; ни один другой toggle не подключён. `returnRequestEnabled` positive/negative consumer проверен в ADMIN02. Вопрос self start/end UI остаётся: доказан API/SQL, новый UI contract не создан.

ADMIN01_STATUS=PARTIAL/LOCAL03_STATUS=PARTIAL/V1_FUNCTIONALITY_COMPLETE=PARTIAL сохраняются; прочие непроверенные предпосылки/policy/deferred ниже остаются. Следующее действие — review ADMIN02, затем отдельный запрос на полноценный испытательный завод; автоматически не создавать. `FINAL_STOP=STOP_BEFORE_FULL_NEW_FACTORY`.

## Исторический ADMIN01 snapshot до ADMIN02

Не очередь автоматического продолжения: по ADMIN01 после review требуется остановка перед полноценным новым заводом. Общий Sweep/R5/Linux не возобновлять.

## Блокирует полный self-service / функциональный PASS

| ID / класс | Доказательство → owner | Что требуется следующим отдельным ограниченным этапом |
|---|---|---|
| A01-SEND-HOME-UFA / PROVEN_DEAD_LINK | [shift-remaining-ui.json](shift-remaining-ui.json): C active UFA, UI assignment201×2, STOP закрывает оба; UI send-home409 «Сотрудник относится к другому заводу». `EmployeeService.sendHome` сравнивает User.factoryId=A0, тогда как assignToLine использует active C UFA. В том же owner legacy проверки есть у других attendance операций | Сначала согласовать единый scope текущего присутствия и взаимное влияние User.employeeState/другого завода; затем минимально исправить весь доказанно affected attendance owner, проверить active/revoked/guest/blocked/foreign/busy и сохранность обеих площадок. Простая подмена поля в одном guard здесь **не выполнена** |
| A01-RETURN-DECISION / PROVEN_MISSING, MISSING_V1 | ShiftPeopleScreen создаёт запрос возврата; ShiftController/Service имеют list/decide, но frontend не содержит GET/PATCH `/shift/return-requests` | Закрыть UI решения разрешённого мастера через существующие endpoints и запреты, без нового business meaning |
| A01-DEAD-SETTINGS / PROVEN_DEAD |30 полей ниже хранятся/отдаются, но не имеют операционного consumer; [matrix66](module-settings-matrix.md) | По каждой группе подтвердить нужное current product rule; не подключать массово флаги, меняющие безопасность/время/архив, догадкой |
| LOCAL03-JOURNAL-SECOND-UI / retained PROVEN_DEAD_LINK | `../local-03/five-gate-matrix.md`: вторая открытая страница ShiftLog не refresh за8с, серверный GET уже содержит запись | Existing invalidation/refresh owner, targeted UI036 retest; старый общий Sweep не запускать |

`SCHEMA_DECISION_REQUIRED=none identified for implemented fixes`. Для remaining attendance link необходимость schema изменения пока **не установлена**; новая migration58 не разрешена. Наличие противоречия scope не означает автоматического разрешения менять схему или глобальное employeeState.

## DEAD_CONFIG — exact30

- ShiftSettings: `dayShiftStartTime`, `dayShiftEndTime`, `nightShiftStartTime`, `nightShiftEndTime`, `willBeOpenHoursBeforeShift`, `noShowCheckMinutesAfterShiftStart`, `autoCloseChecklistsAtShiftEnd`, `sendHomeRequiresComment`.
- TaskSettings: `urgentTaskRequiresLineWhenCreatedFromLine`, `taskAttachmentsEnabled`, `taskDepartmentRecipientsEnabled`, `taskPersonalAssigneeEnabled`, `taskStorageRetentionMode`.
- WashSettings: `washIssueRequiresPhoto`, `washDefaultControlItems`, `washAllowNonLineWorkers`, `washMessagesEnabled`, `washAttachmentsEnabled`.
- DefrostSettings: `defrostShowOnLineDashboard`, `defrostCalendarEnabled`, `defrostAttachmentsEnabled`.
- OrderSettings: `orderRequestNotificationsEnabled`, `warningYellowPercent`, `warningRedPercent`.
- ChecklistSettings: `checklistAttachmentsEnabled`, `archiveEnabled`.
- ChatSettings: `attachmentsEnabled`, `retentionMonths`.
- AnnouncementSettings: `archiveRetentionDays`, `attachmentsEnabled`.

Они показаны read-only с ограничением, не удалены из schema/API и не выданы за рабочие switches. **Сама функция**, например файлы задач/персональный исполнитель/календарь оттайки, может работать; DEAD относится к конкретному toggle, а не к модулю.

## DEFERRED / EXPECTED_HIDDEN — не missing

`TaskSettings.taskChatMirrorEnabledReserved`, `ChatSettings.voiceReserved`, `ChatSettings.videoReserved` — explicit reserve. `DefrostSettings.defrostCommentRequiredOnStart/End` — legacy endpoints; today UI superseded утверждённым Stage37 optional-comment contract. `AnnouncementSettings.guestCanRead=false` принудительно соблюдает guest deny. WORKER/CONTRACTOR chat access не выдаётся даже через ALLOW. ERP/1С, offline binary sync, BI сверх текущего и внешний realtime остаются product deferrals исходного v1 goal.

## POLICY_PENDING — сохранены без решения

1. MI-SEC same operationId + changed payload: действующий replay возвращает прежний результат; equality/409 не утверждены.
2. MI-PUB future, expired, late ACK и global audience owner — нет принятого правила/полного proof.
3. Checklist повторный UI вход в grace после смены; global/shared reference inheritance не утверждено, closed snapshot не менять.
4. Chat Range200/full body: нужно ли требовать206/частичное чтение? Не объявлен автоматически product defect.
5. Original UI063: исторический1286→1213 недостижим на текущем небольшом A; нужна исходная fixture либо принятие иной геометрии. Людей ради scroll не создавали.

## Непроверенные предпосылки и ограниченная приёмка

- Не приняты factory duplicate-name UI/uniqueness, clone/import/export configuration и полная рабочая зона. Code duplicate409 проверен; отдельное требование уникальности имени не внедрялось.
- Department→users/checklist/announcement и GLOBAL/no-auto-UFA проверены; DEPARTMENT-chat и полный handover downstream lifecycle в ADMIN01 не пройдены.
- Contractor limit: допустимый1 UI PASS,2-ID guard409, но второй ID не eligible contractor; это не полная two-eligible UI boundary.
- Return flag: disable409 проверен, positiveOFF_SHIFT→request UI не достигнут. Собственная session закрыта HTTP `/shift/end`; это не UI self-end PASS. Методы self-start/end существуют, необходимый пользовательский UI contract ещё требует выяснения.
- Checklist day/night autoclose: source+save/reload есть, естественная временная граница не проверена. Window0 read-only409 есть, positive grace policy pending.
- All role families, five gates, journal archive write UI, original063, physical phone/камера/PWA, Linux/Compose/permissions/volumes/HTTPS/WSS/server restart сохраняют точные прежние потолки.
- Concurrent Admin edit: большинство новых CRUD owners не имеет expectedVersion/If-Match контракта; серверные assignment conflicts проверены в применимых ветвях, предотвращение всех lost updates **не заявлено**.
- UI132 относится к изменённым forms/layout; все сочетания Back/keyboard/draft каждого inline editor не пройдены. Audit UI часть action types обобщает как «Действие админки», entity type остаётся техническим — P2 presentation debt.
- Historical J20 `master-domain-contracts.test.js` не совместим с LOCAL02: отсутствует chats.access у owner и WORKER предполагается допустимым участником. Два неуспешных запуска сохранены, тест/guards не ослаблены; current R2/chat-policy + real Admin chat проходят, 13 иных shared cases проходят отдельно.

## Неблокирующее отложенное улучшение

Размер Vite JS bundle ~1MB и CJS Node-API warning; более точные Audit labels, дополнительные focus/keyboard permutations. В final clean390 [скриншоте](clean-smoke-admin-390.png) сохранена legacy подсказка «скопируйте структуру завода4» при отсутствии такого завода: P2 copy debt, не команда создавать настоящий №4 и не live proof clone. Не меняли зависимости/архитектуру ради предупреждений.

## Одна рекомендуемая следующая реализация — НЕ ЗАПУЩЕНА

**ADMIN02 — согласовать и исправить attendance scope для существующего UFA, затем завершить UI решения возврата.** Только canonical Employee/Shift/ShiftPeople owners и собственная bounded test target; сначала source/read-only reconciliation User.factoryId vs active UFA vs global employeeState. Если нужен новый product rule или schema58 — остановить именно эту ветвь с решением, не внедрять автоматически. После согласованного минимального исправления: ordinary user с home A0/active C проходит назначение→send-home→request→master reject/approve через UI/HTTP/SQL/вторую страницу без F5; foreign/revoked/blocked/guest/другая активная фабрика denied; A0 неизменён; аудит без секретов; все свои fixtures закрыты. Нужны отдельное поручение на этот пакет и явное решение scope там, где нет уже утверждённого контракта. Рабочие данные/VPS/Linux/полноценный новый завод не нужны.
