# LOCAL-02 — три адресных узла: результат 24.09.2026

`LOCAL02_STATUS=PASS_BOUNDED_WINDOWS_FUNCTIONAL`; `FINAL_STOP=STOP_FOR_REVIEW`.
Это завершение данного пакета, **не** полная ролевая приёмка и не Pilot Ready. Работа продолжена в существующем C1; нового проекта/installer нет. Рабочие DB/.env/uploads, прежние retained-каталоги, WSL/VPN/UAC/routes не использованы и не изменены.

## Владельцы и минимальная дельта

| Узел / канонические файлы | Что изменено | Проверка |
|---|---|---|
| `backend/prisma/system-foundation.cjs`, `backend/src/common/effective-permissions.ts` | Capability `chats.access` отделяет право пользоваться разрешённым чатом от каталога `chats.read`. WORKER/CONTRACTOR лишены всех `chats.*` в effective context **после** overrides; старые ALLOW и membership не обходят потолок. Defaults исправлены. CONTRACTOR_LEAD получает только eligibility, не широкое read/write. | [Baseline](before.json), 12 isolated chat checks, [реальные HTTP/WS](chat-live.json), [финальные defaults/UI](final-readback.json). |
| `backend/src/modules/chats/{chats.controller.ts,chats.service.ts,chat-message-delete-policy.ts}`, `backend/src/modules/attachments/attachments.service.ts`, `backend/src/ws/ws.service.ts` | Guard входа, service/policy authority, проверка eligibility адресата direct/group, единая attachment authority, WS fanout по capability и factory. Все старые ChatMember/сообщения сохранены. ADMIN остаётся каноническим администратором. | WORKER и CONTRACTOR: по 12 HTTP отказов 403; legacy WORKER direct недоступен; тот же токен после STORE→CONTRACTOR→WORKER даёт 403 при сохранённом membership; возврат STORE возвращает доступ, отзыв снова 403. Разрешённые direct/group/message/file работают; вторая открытая страница обновилась без F5. |
| `backend/prisma/schema.prisma`, новая `20260924190000_local02_chat_and_checklist_reference/migration.sql` | Новый attachment target `CHECKLIST_TEMPLATE_ROW`; nullable reference FK у template row и run row, индексы, `ON DELETE RESTRICT`. Run получает отдельный неизменяемый указатель, а не зависимость от текущего шаблона. Физической копии файла для архива нет. Та же additive migration согласует chat grants. | [fresh57](logs/zavod_local02_fresh-deploy.txt), [upgrade56→57](logs/zavod_local02_upgrade-deploy.txt); обе strict diff пусты. Старые **56** SQL byte-identical baseline. В PostgreSQL попытка удалить A из откатываемой транзакции получила точный RESTRICT/23001. |
| `backend/src/modules/checklists/{checklists.controller.ts,checklists.service.ts}`, `backend/src/modules/attachments/{attachments.service.ts,attachments.module.ts}` | 0/1 reference: upload+pointer атомарны в SQL; отдельное снятие ссылки; run materialization сериализован с заменой/снятием. Operation ID повторяет тот же файл, не откатывая позднюю замену B обратно на A. Guarded read следует template/run/factory rights; DTO выбирает только безопасные поля. Reference не попадает в массив result attachments. Запрещены изменения файлов закрытого run (включая ADMIN); lock согласован с close/complete. | [Настоящий UI/API](reference-ui.json), [negative/API/SQL/files](reference-negative.json), [валидный ADMIN Б→файлы/чат А: 403](cross-factory-reference.json). |
| `frontend/src/components/ChecklistItemEditor.tsx`, `frontend/src/screens/ChecklistsScreen.tsx`, `frontend/src/utils/pilot-ui.ts` | Загрузка/замена/снятие одного фото-эталона с preview; retry формы продолжает уже созданные template/row IDs. Runner и архив отдельно показывают «Фото-эталон» и «Фото результата». Текстовая имитация эталона удалена. Подтверждённая скриншотом неверная подпись закрытого runner «В работе» исправлена на «Закрыт» и «Архив: только просмотр». Новое право подписано по-русски. | UI create A→run1/R1/close→replace B→run2/R2/close; снятие дополнительного эталона через форму. Последняя build: 360/390/1440 px, оба изображения загружены, overflow нет, archive file inputs отсутствуют. |
| `frontend/src/screens/ShiftPeopleScreen.tsx`, backend shift owner | **Без продуктовых изменений LOCAL-02**: default server roster уже исключает внесменного работника. Исходное подозрение в обычном manager flow не подтвердилось. | [До](shift-panel-before.json), [0→1→0](shift-live.json): новая active WORKER access, null ShiftSession/Assignment/onShift=false; открытая панель пуста. Настоящие HTTP start/end 201, две страницы получают `shift_updated`, тот же человек появляется/исчезает без F5. SQL сессия ENDED. |

## Фото: доказательства и сохранность

| Факт | SHA-256 |
|---|---|
| A, run1 reference | `b9a88aff8211dddd17212f1890c2944179a16e5663d7ffdb1d6262bc829338eb` |
| R1, run1 result | `15ff11e577ee5697a041b0ffa119e8cda2925d7e9ea8b2bf4a3849addae2f582` |
| B, run2 reference | `37a7c200625773a8fde530fb0e4a84d4e599c266ef78746bfa107465138eb5b5` |
| R2, run2 result | `fd6f62f697c0a18f97caf13e261f9040b292e439f1763550c1f8192dab32a923` |

Шаблон сейчас хранит B; после проверки он штатно soft-архивирован. Run1 остаётся A+R1, run2 — B+R2; оба CLOSED. Второй INFO-пункт без эталона проверен в UI/API. При одном эталоне и отсутствии result сервер вернул 409. A/B/R1/R2 сравнивались по HTTP bytes, собственной SQL metadata и bytes собственного uploads; `storagePath` не утёк в API.

Реальный незавершённый multipart body отправлен на native HTTP backend и соединение оборвано: metadata и привязка не появились. Полный повтор дал одну Attachment; повтор того же operationId вернул тот же ID; другие bytes с тем же ID операции получили 409. Повтор старой A-загрузки после B **не** меняет pointer B.

Снятие reference не удаляет Attachment/bytes. Generic DELETE reference запрещён; run FK не даёт физически удалить нужную metadata. Нового GC нет; потенциальные unlinked bytes после ошибки SQL commit не удаляются автоматически. Это безопасное удержание, не обещание crash-cleanup. Общие/global templates и наследование reference при duplicate-template не входят в принятый локальный сценарий: новый reference target ограничен factory-scoped пунктом; в UI-копии эталон нужно загрузить явно. Политика будущего GC и расширение копирования не реализовывались.

До миграции сохранены собственные C1 dump+uploads (`local02-before.dump`, `local02-before-uploads` в защищённом runtime). После сценария новый собственный dump+uploads восстановлен в **новую** `zavod_local02_restore`: связи template→B, run1→A, run2→B, result metadata и четыре byte SHA совпали. [Restore receipt](reference-restore.json). Это **WINDOWS_NATIVE_SQL_FILES**, не Docker/volumes/Linux/VPS proof. Dump/конфигурация/секреты не включены в review ZIP.

## Проверки после продуктовой правки

- Prisma 6 validate/generate — PASS, отдельный защищённый staging; identical установленный engine DLL не заменён. Генерация не меняла dependencies. Первую попытку записи DLL остановил EPERM из-за собственного загруженного клиента; затем generate перенесён в отдельный output с проверкой SHA engine.
- 57 migrations fresh + собственный synthetic upgrade из 56-migration C1 snapshot — PASS. Финальные strict diff свежей, upgrade, C1 и restore целей — `No difference detected`, exit 0; `db push/reset/resolve/stamp` не применялись.
- Backend build, frontend typecheck/build — PASS. Vite использует пустой envDir, без working .env. Прежний warning о размере bundle и CJS API не скрыт; зависимости не понижались.
- [Chat security](logs/chat-policy-isolated.txt): **12/12**; [checklist targeted](logs/checklist-isolated.txt): **7/7**; [foundation/auth](logs/foundation-auth-isolated.txt): **41/41**. Это ISOLATED, не подмена live.
- Старый chat fixture изменён адресно: у разрешённого MASTER теперь явный eligibility capability; positive LOCAL-01 fixture стал STORE вместо запрещённого WORKER. Проверки guest/revocation/membership не ослаблялись. Исторический 119-code permission snapshot проверяется вместе с единственной новой capability, старый SQL не редактировался.
- [Live chat](chat-live.json), [shift](shift-live.json), [reference UI](reference-ui.json), [negative](reference-negative.json), [последний readback](final-readback.json) — PASS. Legacy сценарии с test-auth headers, working env fallback и physical cleanup не запускались на C1; общий Sweep не запускался.
- Два UI probe сначала остановились на неверных именах кнопок **теста**, не продукта; продолжены с теми же сохранёнными template/run IDs. PostgreSQL 18 вернул RESTRICT `23001`, а не ожидавшийся Prisma P2003: тест теперь принимает именно этот constraint/code, не произвольную ошибку.

## Учебные данные и работающий стенд

Новые LOCAL-02 runs закрыты, шаблон и новая группа/direct-чаты штатно архивированы. Новый пользователь `…20-02` завершил смену; после role-transition проверки его доступ деактивирован, история не удалена. [Receipt](fixture-closure.json). Старые сообщения/членства сохранены; в старый учебный WORKER direct добавлено только собственное маркированное контрольное сообщение/файл. Для точного negative proof кратко восстановлена **существующая** временная Б с уже имевшимся ADMIN-доступом: настоящий ADMIN Б получил 403 на файлы/чат А; Б затем снова деактивирован. Новых заводов, новых Б-доступов и рабочих операций Б не создано.

Финальный readback: [http://127.0.0.1:5173/](http://127.0.0.1:5173/), backend `/ready=READY`, version `LOCAL02-20260924-C1`. Наблюдение 24.09 15:30 UTC: backend **39312/3000**, frontend **55816/5173**, PostgreSQL **67088/15436**, все на loopback; точные commandline/creation time в [processes.json](processes.json). Предыдущие backend PID 67924→37188→50072 остановлены адресно после identity-проверки; последняя 39312 оставлена для просмотра. PG/frontend не перезапускались этим пакетом.

Ручная штатная остановка из `C:/Users/79164/Documents/work`: `powershell -NoProfile -File docs/vps-preparation/local-02/stop-stand.ps1`. [Helper](stop-stand.ps1) сначала сверяет **все** PID/времена создания/команды/loopback-порты с receipt, при несовпадении ничего не останавливает; затем завершает только эти frontend/backend и вызывает `pg_ctl -D <собственный pgdata> stop -m fast`. Helper проверен парсером, **не исполнен**: стенд оставлен работающим. Ничего не удаляет.

## Статус и следующая граница

`ЕСТЬ В КОДЕ`: все три scoped решения; shift — подтверждение существующего кода без новой правки.
`ПРОВЕРЕНО ЛОКАЛЬНО`: описанные PostgreSQL/HTTP/WS/Edge/UI/file/restore сценарии.
`ПРОВЕРЕНО НА VPS`: ничего.
`НЕ ПРОВЕРЕНО`: Linux/Compose, container networking/permissions/volumes, external HTTPS/WSS, server reboot; физический телефон; полная оставшаяся ролевая/эксплуатационная программа и незакрытые части пяти live gates.

Один следующий ограниченный запрос **после review**, не выполнен автоматически: «Принять или вернуть LOCAL-02 по этому пакету; при принятии продолжить существующий остаток Windows functional матрицы LOCAL-01 с точными pending UI/live-gate строками, без общего Sweep и без Linux/WSL». Текущий пакет на этом заканчивается.

`CHAT_POLICY_WORKER=PASS`; `CHAT_POLICY_CONTRACTOR=PASS`; `CHECKLIST_REFERENCE_PHOTO=PASS`; `REFERENCE_ARCHIVE_SNAPSHOT=PASS`; `SHIFT_PEOPLE_PANEL=PASS_WITHOUT_PRODUCT_CHANGE`; `MIGRATION=PASS_57`; `WORKING_DATA_CHANGED=NO` (собственная C1 намеренно изменена).

`LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED`; `PHYSICAL_PHONE=PENDING`; `FULL_NEW_FACTORY=NOT_CREATED`; `REAL_FACTORY_4=NOT_CONFIGURED`; `VPS_DEPLOYMENT=NOT_STARTED`; `MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE`; `MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`; `FINAL_STOP=STOP_FOR_REVIEW`.

Передача: [один review ZIP](review-pack-local02-20260924.zip), [полный entry readback/SHA](review-pack-readback.json), [hashes изменённых owners](after-hashes.json). Это review, не backup данных и не общая приёмка.
