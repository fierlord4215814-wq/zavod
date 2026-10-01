# FACTORY9-PEOPLE-SERVICE-CHATS-06 — продолжение и review 30.09.2026

Позднее [адресное дополнение по `blocked by policy`](policy-diagnosis-20260930.md) установило версию текущего исполнителя, ограничения сеанса и отсутствие совпадения в проверенном пользовательском execpolicy. Конкретный уровень отказа остаётся `NOT_IDENTIFIED`; запуск не повторялся, live-статусы ниже не изменились. Следующий шаг — поддерживаемое разрешение исходного запуска, затем fresh identity и только оставшиеся live-гейты 06.

Текущий статус: **SOURCE/ISOLATED и отдельный DISPOSABLE_SQL PASS; live 06 BLOCKED_POLICY / NOT_RUN; этап не принят**. Цель — исходная локальная `mes` на `127.0.0.1:5432`, завод №4 `537cbb48-7fba-48b6-80af-659f82cdaeb3` и №9 `f33f9682-8168-4562-a8c8-5c196b2c0d37`. Основания — исходный REQUEST 06 и продолжение `REQUEST.txt` из `ZAVOD_SERVICE06_REVIEW_AND_RESUME_20260930.zip`. Профиль Андрея и три прежних доступа не создавались повторно. `T1_TOUCHED=NO`; прежние стенды, №4, миграции, пароли, старые чаты и uploads не очищались. Нижние разделы «Первый срез 06» сохраняют историческое наблюдение до этого продолжения; текущие статусы указаны здесь.

## Продолжение 30.09 — фактически выполнено

13/13 `source-after` файлов полученного внешнего пакета побайтно совпали с текущим репозиторием; снимки из ZIP поверх кода не накладывались. Сверены свежие PostgreSQL `mes`/5432, factory IDs, 57 migrations, №4 UFA 2486, №9 UFA 26, shared chats 0, чаты №9 0. Три прежних TECH UFA №9 active/non-guest; Андрей имеет 8 `ALLOW` overrides только №9. На момент запуска 3000 и 5173 не слушали, PostgreSQL слушал 5432 PID 5316. Protected env содержит DB URL, storage root и порт, отдельный protected JWT имеет 64 символа; проверены целевой `localhost:5432/mes`, `work/uploads`, точный выбранный CORS `http://127.0.0.1:5173`, `NODE_ENV=production`, `HOST=127.0.0.1`, отключение test-auth/dev flags. `localhost:5173` не включали, поскольку планировались независимые browser contexts на одном origin. Значения DB/JWT-секретов не выводились и не записывались в repo.

До дальнейшей записи сравнили все 2269 uploads и два protected config файла с предыдущей предзаписью: SHA совпали. С момента исходного dump обнаружены 24 audit rows с `createdAt` позднее его времени (часть временных меток учебной истории может быть будущей); старый dump не назван свежим. В том же защищённом каталоге создан актуальный `mes.before-resume-06.dump`: 13 720 252 байта, SHA-256 `5A2F1C6FF5B6A6F375C8FF3B98EDC4739365BB7003B5136464D49B20F8BDCBD3`, TOC 806 строк. Он сопряжён с неизменной проверенной копией 2269 uploads и protected config в этом каталоге. Независимый restore не выполнялся.

**Runtime-blocker:** единственная новая штатная команда запуска существующего backend с указанными production env и точным CORS была отклонена `exec_command` **до исполнения**: `CreateProcess ... rejected: blocked by policy`. Это повторное отклонение после предыдущего 06, не ошибка CORS/Node/PostgreSQL и не действие пользователя. Доступного в этом окружении approval-параметра для команды нет; запуск через иной shell, UI, скрипт или агента не предпринимался. Ни `/ready`, ни `/version`, обычный вход, WS, UI-настройка чатов и live-сценарии не заявлены. На финальном readback 3000/5173/15445 не слушали; только рабочий PostgreSQL 5432 PID 5316. Сам preview отсутствует. Для дальнейшего live-этапа нужен поддерживаемый запуск backend без обхода политики, затем `/ready` и свежая identity.

Внешние source-method findings проверены на совпавшем коде и адресно исправлены:

| Finding | Подтверждение и минимальное изменение | Уровень |
|---|---|---|
| `F06-LIMIT-TWO` | В `ChatsService` и `ChatsScreen` действительно стояли `members.length !== 2`, число 2 и №9 в тексте. Теперь действует существующий минимум группового чата (хотя бы один выбранный участник + ADMIN owner); каждый выбранный User, роль и заводские полномочия проверяются, дубли запрещены. **Live первоначальный состав остаётся ровно двумя специалистами на службу + ADMIN**, расширение людей не выполнялось. | SOURCE/ISOLATED PASS: 1/2/3, duplicate, stale actor/member/permission. |
| `F06-WS-LOCAL` | Новый общий `chats.read` gate действительно гасил локальный CUSTOM с explicit `canRead` и `chats.access`. `WsService` теперь для `CHAT_UPDATED` сверяет существующую `canReadChat` на текущем чате; общие defaults не менялись. | SOURCE/ISOLATED PASS; настоящий local socket NOT_RUN. |
| `F06-WS-CONTEXT` | Null-factory событие действительно могло передать `chatId` текущему контексту с другим отделом; текст/байты утекшими не объявляются. Перед event читаются актуальные Chat/member/dept и UFA/role/permission каждого socket; событие уходит только если `canReadChat` разрешает и текущий, и исходный socket context. Удалённому member и stale UFA последующие события не посылаются. | SOURCE/ISOLATED PASS; actual WS/reconnect/revoke NOT_RUN. |
| `F06-CREATE-STALE` | Старые member UFA/permissions проверялись до транзакции; advisory lock защищал только duplicate chat. Actor, выбранные UFA, role/dept и effective `chats.access/read/write` теперь проверяются в той же Serializable-транзакции перед созданием. Конкурентный revoke после commit всё равно оценивается динамическими read guards. | SOURCE/ISOLATED PASS; настоящая гонка create/revoke в SQL NOT_RUN, не выдаётся за доказанную атомарность. |
| TECH «Моя явка» | `ShiftService.me` брал только локальную session и показывал `canStartShift=true` при проекции source shift в `person.onShift`; backend `start` уже запрещает foreign active attendance через `assertNoForeignAttendanceTx` под person-wide lock. `me` теперь скрывает ложный старт, UI показывает завод-источник и факт той же смены; новый backend guard не придумывался. | SOURCE/ISOLATED PASS; живой №4→№9 и две страницы NOT_RUN. |
| Локальная админка MANAGEMENT | Финальный `frontend typecheck` выявил TS2448/TS2454: `activeFactoryId` использован до объявления в ветке без глобального overview. Ветка читала переменную в temporal dead zone и могла падать у Андрея. Использован уже доступный `selectedFactoryId` без изменения полномочий. | SOURCE/typecheck PASS после точной правки; обычный вход Андрея и UI retest NOT_RUN. |

Итоговые targeted F04/F05/F06 tests: **19/19 PASS**, backend/frontend build, frontend typecheck и Prisma validate `exit 0`; размер Vite chunk по-прежнему warning. Новая `backend/scripts/factory09-service06-disposable-sql.cjs` запускалась только на собственном PostgreSQL 18 кластере `127.0.0.1:15445`, не на `mes`: создана отдельная одноразовая БД с 57 migrations; fault после изменения назначения/credit/session целиком rollback; реальная sendHome/self-end race дала одну ENDED session, одно завершённое Assignment, ровно один UserSkillCredit и experienceCount=1, повтор не удвоил кредит. Одноразовая БД штатно удалена, её кластер остановлен, порт 15445 закрыт. Это **DISPOSABLE_SQL PASS**, а не live сценарий на `mes`.

Перед публикацией итогового review свежая read-only проверка `mes`: 57 migrations, shared chats 0, чатов №9 0, UFA №4 2486/№9 26, восемь №9 overrides Андрея и три активных старых TECH UFA №9. Полученные в REQUEST UUID `46797300…`, `e7df4257…`, `45919643…` являются **ID записей UFA №9**, не `User.id`; действительные старые `User.id` — `pilot-tech-kipia-1`, `mobile-tech-electric`, `mobile-tech-holod`. Новые №9 User.id из запроса подтверждены. Не создавать чат по ошибочно названным UFA UUID. Подробнее [матрица](actor-factory-action.md).

| Контроль | Факт на этом срезе |
|---|---|
| `BACKEND_STARTED` / `REAL_READY_AND_TARGET` | `NO / NOT_RUN_POLICY`; DB identity отдельно read-only подтверждена. |
| `SOURCE_REVIEW_FINDINGS` | 4 точных finding адресно исправлены; TECH self-projection и подтверждённая TDZ в локальной админке дополнительно согласованы. SOURCE/ISOLATED/typecheck PASS, live NOT_RUN. |
| `PEOPLE_SHIFT_HEADER_SELF_PARITY` | SOURCE/ISOLATED PASS; две страницы/настоящая source shift NOT_RUN. |
| `SHARED_CHATS_3_UI_CREATED` / `SAME_CHAT_MESSAGE_READSTATE` | `0 / NOT_RUN`; исходный старый чат №4 не изменён. |
| `CHAT_BYTES_CURRENT_CONTEXT_AND_REVOCATION` / `LOCAL_CHAT_REALTIME_RETAINED` | Isolated policy PASS; bytes/socket/UI NOT_RUN. |
| `MANAGER_DIRECT_STALE_DENIAL` / `TASK_REVERSE_SOURCE` / `CHECKLIST_TWO_WINDOW` | NOT_RUN; прежний профиль Андрея ON, но 06 live retest не было. |
| `ASSIGNMENT_SENDHOME_SINGLE_CREDIT` | DISPOSABLE_SQL PASS; на `mes` новый live Assignment не создан. |
| `DISPOSABLE_SQL_RACE_ROLLBACK` | PASS в собственной БД, удалена; рабочая 5432 не использована для fault. |
| `EXISTING_GRANTS_FINAL` | Read-only `8 ALLOW + 3 active UFA №9`; №4 не отзывался. |
| `RUNTIME_FINAL` | 5432 PID5316; 3000/5173/15445 не слушают; `/version` NOT_RUN, штатно остановить backend нечего. |
| `T1_TOUCHED` / `MIGRATIONS_SOURCE` / `PILOT_READY` | `NO / 57_UNCHANGED / NOT_DECLARED`. |

[Итоговый review ZIP этого продолжения](review-pack-factory09-service06-resume-20260930.zip) содержит текущий source AFTER, реальные BEFORE и документы без dump/uploads/config/secrets. [Readback](review-pack-resume-readback.md) хранится отдельно во избежание самоссылки. Старый ZIP в историческом разделе ниже сохраняет первый source-срез и не является итоговым пакетом продолжения.

## Первый source-срез 06 — сохранённая история до продолжения

## Предзапись и identity

До source-изменений защищённо сохранены DB+uploads+config и 14 исходных source-файлов: `C:\Users\79164\AppData\Local\Zavod-MES4\backup-20260929-service06-before`. Dump `mes.before-service06.dump`: 13 720 252 байта, SHA-256 `E707C4FC755712353EF94030AC3B28D16B6C8A767DE76877BC0004F23A256DB1`, TOC 806 строк. Все 2269 файлов uploads скопированы и сверены по SHA-256 (`MISSING=0`, `CHANGED=0`); protected config — 2 файла. Это предзапись, **не независимое восстановление**. Первая попытка копирования uploads неверно передала wildcard как literal path и дала 0; до source-изменений копирование исправлено и проверено 2269/2269. Защищённые данные и секреты не включены в review ZIP.

Свежая read-only проверка перед работой: PostgreSQL PID 6052, `mes`, 57 успешных миграций, №4 UFA 2486, №9 UFA 26; три прежних специалиста имели активные UFA №4 и №9, три новых специалиста — только №9. Старый чат `ef6ddaa9-ecd5-4f6a-b571-c89a9bee9cc3` оставался локальным №4, `Chat.factoryId IS NULL=0`, чатов №9 — 0. У старого электрика активных смен — 0. После остановки старого backend заключительная read-only сверка показала те же UFA/чат/смену и 57 миграций. Точная логика участия приведена в [матрице](actor-factory-action.md).

## Адресные изменения исходников

| Владелец | Подтверждённый разрыв | Изменение | Доказательство |
|---|---|---|---|
| `shared-service-presence.ts`, `EmployeeService`, `PeopleService`, `PeopleScreen` | `/shift/people` уже проецировал одну смену источника №4 в №9, но `/people` и профиль считали только локальную `ShiftSession`, поэтому показывали `onShift=false`. | Общая проверка активной не-гостевой UFA той же TECH-роли, живых заводов/отделов и `GLOBAL` source department; `/people` list/filter/profile отображают source session с пояснением завода-источника. Source shift не копируется в №9. | Isolated positive/negative, включая гостя, чужую роль, inactive UFA/dept/factory: PASS; live UI ещё не запускался после изменения. |
| `ShiftPeopleScreen` | Верхний счётчик использовал `workforcePeople`, исключавший TECH, тогда как нижняя карточка использовала текущих людей: `0` против `1`. Нативной кнопки начала/конца смены TECH в frontend не было. | Оба счётчика берут `currentShiftPeople`; для TECH добавлены формы существующих штатных `/shift/start` и `/shift/end`, без нового backend endpoint. | Frontend build PASS; реальная TECH-кнопка, две страницы и source end — NOT_RUN. Для этого файла отдельный pre-edit snapshot по ошибке не был сохранён: в ZIP есть только AFTER, не подменённое восстановление BEFORE. |
| `chat-message-delete-policy.ts`, `ChatsService`, `ChatsScreen` | Три единых service chatId нельзя было создать через существующую админку: `create` делал только factory-local chat. | Узкий `sharedService` путь в существующем `POST /chats`: `CUSTOM`, `factoryId=NULL`, активный `GLOBAL` department, ADMIN OWNER, ровно два выбранных участника одной TECH-службы; явное членство, текущие роль/отдел/разрешения, advisory lock и отказ дублю. Добавлен выбор службы и двух участников в админке. Старые чаты не мигрируются. | Isolated exact-member/role/dept/guest/permission/revocation/ADMIN-only/duplicate tests PASS. Настройка через реальный UI, обычные сообщения, direct/foreign denial — NOT_RUN. |
| `AttachmentsService`, `WsService` | `factoryId=NULL` сообщения считалось несуществующим источником вложения; WS-извещение отбрасывалось для общего чата. | Для существующего null-factory chat message применяется точная актуальная chat-member authority, не автоматическое публичное чтение. `CHAT_UPDATED` рассылается только exact recipients в разрешённых контекстах; локальный factory-filter сохранён. | Isolated metadata/revoked-member PASS; byte-read/upload, браузерные две страницы и WS delivery — NOT_RUN. |
| F04/F05 isolated tests | Реальная source-policy теперь проверяет статус отдела; старые mocks этих полей не задавали. | Совместимые mock-поля приведены к действующей DB-модели; ожидания запретов не ослаблены. | 17/17 совокупных targeted checks PASS. |

Backend build `exit 0`; frontend build `exit 0` (Vite предупредил только о размере chunk); Prisma validate `exit 0`; `node --test` для F04/F05/F06: 17 PASS, 0 FAIL. Это не SQL/API/WS/browser PASS. `schema.prisma` и 57 migration source files этим блоком не менялись. Отдельная disposable SQL-проверка настоящей гонки assignment→sendHome/self-end и credit **NOT_RUN**; старый `factory09-shift05-sql.test.cjs` требует `CREATE DATABASE` на `mes`-службе, что уже получило `42501` в 05, и не является безопасной заменой новым isolated cluster. На рабочей `mes` fault/race не запускались.

## Почему live-этап не выполнен

Исходный backend проекта PID 10980 был точно опознан на порту 3000 и остановлен для загрузки собранных изменений. Первая попытка запуска нового backend PID 18116 завершилась на штатной production-проверке: не был задан точный `CORS_ALLOWED_ORIGINS` (`[STARTUP_FAILED]`). Это ошибка подготовленной команды, не дефект продукта. Следующая команда запуска с точным origin `http://127.0.0.1:5173` была **отклонена политикой инструмента до исполнения** (`exec_command ... rejected: blocked by policy`). Тот же запуск другим каналом не обходился. На финальном readback порт 3000 не слушал; 5173 оставался Vite preview PID 3652, 5432 — PostgreSQL PID 6052. Обещать доступное приложение нельзя. Защищённый файл конфигурации не изменялся, новые runtime-секреты не печатались. До следующего live-продолжения нужен разрешённый штатный запуск backend с точной production CORS-настройкой, проверка `/ready` и повторная identity БД/процессов.

Из-за этой границы **через UI не созданы ни один из трёх общих чатов и ни одно новое бизнес-действие**. Не выполнялись под обычными пользователями: People/Shift counters и профиль с source shift; чат/вложения/WS/две страницы без F5; отзыв/возврат №9 и членства; менеджерские self/peer/ADMIN/foreign/stale-tab; обратная Task №4→№9; новый checklist; assignment→sendHome с одним credit. Их статусы `NOT_RUN`, а не PASS. Состояние прежних F05 PASS не перепроверено и не перекрашено.

## Итоговые границы

- `SHARED_SHIFT_PEOPLE_PARITY=SOURCE/ISOLATED_PASS; LIVE_NOT_RUN`.
- `THREE_SHARED_SERVICE_CHATS=SOURCE/ISOLATED_PASS; CREATED_VIA_UI=0; LIVE_NOT_RUN`.
- `MANAGER9_AND_THREE_SPECIALISTS=PREVIOUSLY_ON; NO_NEW_GRANT; F06_RETEST_NOT_RUN`.
- `REVERSE_TASK/CHECKLIST/ASSIGNMENT_CREDIT/WS_TWO_PAGES=NOT_RUN`.
- `MIGRATIONS_SOURCE=57_UNCHANGED`; `T1_TOUCHED=NO`; `PILOT_READY=NOT_DECLARED`.

Следующий допуск — только после законного backend restart и свежей identity: пройти оставшиеся UI/HTTP/WS/SQL проверки на исходной `mes`, не пересоздавая уже выданные права и не повторяя предзапись без причины. Действия расширения chat membership/доступа требуют предусмотренного инструментом подтверждения в момент действия. Общий UI Sweep, R5, VPS и физический телефон не возобновлялись. `FINAL_STOP=SOURCE_REVIEW_AND_RUNTIME_BLOCKER`.

[Один review ZIP](review-pack-factory09-service06-20260930.zip) фиксирует source AFTER, реально доступные BEFORE и документы без dump/uploads/secrets. Контроль суммы и чтение всех payload — [readback](review-pack-readback.md) вне ZIP во избежание самоссылки.
