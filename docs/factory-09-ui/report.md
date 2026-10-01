# FACTORY-09-UI-01 — фактическое выполнение

> Исторический отчёт об отдельной FACTORY09. Актуальная цель №4+№9 в исходной `mes` и более поздняя ролевая работа отражены в [DIRECT-01](mes4-direct-01/report.md) и [FACTORY9-TEST-GUESTS-03](test-guests-03/report.md). Не использовать этот отдельный стенд вместо `mes`.

28.09.2026. Прямое уточнение пользователя заменяет только полный завод №7 на №9; отдельный контрольный №9 не создаётся. Приложенный `REQUEST.txt` и исходный XLSX прочитаны из ZIP без наложения snapshot на рабочий репозиторий. XLSX `shtat_linii_i_personal.xlsx` SHA-256 `92f7fafc074f58b048f864350fea3ab7e5de5b6a9e890fb4e5cb3477cebf33a8`, лист «Штат», A1:I25: 9 линий, 22/18/8 = 48 **мест**, не 48 предоставленных людей. Изменения product code/schema/migrations запрещены и не выполнялись.

## Новая собственная среда и уже проверенный C0

- Создан только новый ACL-ограниченный каталог `C:\Users\79164\AppData\Local\Zavod-Factory09\run-20260928-ui01` с собственными `pgdata`, uploads, секретами и копией Prisma schema/57 migration SQL. T1/C0/C1/старые каталоги и их credentials не читались и не менялись. Порт новой PostgreSQL 18.3 — только `127.0.0.1:15439`.
- Обычный `npm run build --workspace frontend` завершился EXIT1: Vite/esbuild `Cannot read directory "../../..": Access is denied`, `vite.config.ts` не смог загрузиться. Без изменения зависимостей и прав выполнена текущая production-сборка **тех же frontend исходников** через Vite 5.4.21 Node API с `configFile:false`; каноническая конфигурация содержит только dev/preview proxy и не задаёт build options. 89 modules, output `frontend/dist`. Backend `npm run build --workspace backend` PASS. Это не превращает штатную CLI-сборку в PASS.
- Изолированный launcher [`runtime.ps1`](runtime.ps1) и [`preview.cjs`](preview.cjs) используют существующие compiled backend/frontend и точные proxy `/api`, `/health`, `/ws`; это не вторая реализация приложения. Первый вызов init остановлен после запуска нового PG из-за ожидания pipe от `pg_ctl`; повторный путь строго проверил новую цель. Относительный путь staged schema был отвергнут Prisma до начала миграций; после подтверждения `0` public-таблиц использован абсолютный путь. Эти launcher-ошибки исправлены; T1 не привлекался.
- В новой БД штатный `migrate deploy` применил **57/57**; strict Prisma schema diff — `No difference detected`; 57 staged SQL совпали по SHA с source `57/57`. До foundation были `Factory/User/UFA=0/0/0`. Штатный `apply-system-foundation` вернул `INITIALIZED_CLEAN`; штатный `bootstrap-first-admin` вернул `CREATED` и создал только отдельную «УЧЕБНАЯ ОСНОВА FACTORY09» + первого технического ADMIN. **Это не завод №9.** `backend/prisma/seed.js` не запускался.
- После bootstrap read-only SQL: Factory/User/UFA `1/1/1`, Department/JobTitle/Line/LinePosition/LineStaffingTemplate/ShiftSession/Assignment/Task/ChecklistRun/Attachment все `0`. Backend `127.0.0.1:3000/ready` — `READY`, `/version` — `FACTORY09-UI01-20260928`; frontend `127.0.0.1:5173/` — HTTP 200 и видимая обычная форма входа. На 09:26:26 UTC проверены собственные PID PG `32900`, backend `26892`, frontend `32120` (только историческое наблюдение, не команда остановки). Часы/scheduler не менялись.
- Повторный read-only readback в 09:37 UTC: Factory/User/UFA `1/1/1`, Line/ShiftSession/Task/ChecklistRun `0/0/0/0`, `/ready=READY`; runtime не создал demo-бизнес-объекты за этот интервал. Это не замена restart/update проверки.
- В 09:42 UTC отдельный read-only запрос из того же защищённого контекста подтвердил, что все три исходных listener PID всё ещё работают; обычный ограниченный shell не видит ACL-защищённые процессы/каталоги и его пустой `Status` не является доказательством остановки. Проверять и останавливать этот стенд нужно через `runtime.ps1` из разрешённого контекста с точной identity.
- Build identity: `backend/dist/main.js` SHA `d5dc33dddda2c516d571284f4def4c80778ac5fa82ced7aad46355a2b510b734`, `frontend/dist/index.html` SHA `1d31695c5abe5227c1990c4f59df21418cd6f47ea2ed61714b5dbc8c01e8c427`, JS SHA `8aa9341ea9c06b1b50e7de686e800283b98aa050bb97d768a1a1622d46328def`, CSS SHA `0b462bee06f070196773a919b79fad1a48534dfefa0b5d5b8b1345f2fb35906b`.

## Первый UI-вход — hand-off владельцу

Согласно обязательному computer-use правилу, ввод/подтверждение **нового личного пароля** через браузер выполняет пользователь. Вкладка нового стенда открыта и сохранена; пользователю переданы только локальные пути к **новым собственным** защищённым файлам временного кода и личного пароля, без вывода значений. До подтверждения обычного входа бизнес-записи через UI **не выполнялись**. Временный код CLI выдал с expiry `2026-09-28T09:54:54.987Z`; если истечёт, не обходить auth и не использовать mutation API.

В 09:42 UTC обычная форма показывала ошибку «Неверный или истёкший временный код». Read-only проверка **только нового ADMIN** показала `failedLoginCount=2`, `passwordResetRequired=true`, `code_consumed=false`, `lockedUntil=NULL`, срок ещё не истёк. Причина конкретных двух ошибочных вводов не установлена; старые pilot-логины `+7900…`/`1234` в новой изолированной БД отсутствуют и не подменяют bootstrap ADMIN `+79990009000`. Пользователю разъяснено, что надо использовать именно его новый временный код, не сообщая значение в чат.

После этого пользователь предложил создать личную ADMIN-запись и использовать старые пароли проекта. Персональные реквизиты и предложенный пароль в review-пакет **не включены**. Для создания записи через обычную админку сначала требуется завершить вход bootstrap ADMIN; старые учётные записи/пароли не присутствуют в этой новой БД. Правило browser hand-off для ввода и подтверждения нового пароля остаётся обязательным и при тестовом пароле. Новый личный ADMIN не создавался. В 09:50 UTC read-only counts новой БД: Factory/User/Line/JobTitle/ShiftSession/ChecklistRun = `1/1/0/0/0/0`.

В 09:54:59 UTC, уже после установленного expiry, браузер оставался на форме входа с ошибкой временного кода; экран установки нового пароля и рабочая админка не открылись. Действие с истёкшим кодом не повторять как проверку доступа. Для продолжения потребуется штатная повторная выдача временного кода в **этом же изолированном** контуре и личное завершение установки пароля; источник такого восстановления следует сначала проверить отдельно, без прямой записи в БД и без использования старых стендов. Дальнейшие UI-сценарии, роль/межзаводская граница, checklist/archive и второй вход — `NOT_RUN`, а не FAIL/PASS.

## Продолжение после обычного входа

Источник Excel: Фасовка А 3/2/1, Б 5/2/1, В 4/0/0, Г 1/2/1, Д 1/2/1, Е 1/2/1, Ж 1/2/1, И 1/1/1, К 5/5/1. Сумма 48 мест. Повременщики — три должности по 1–2/12 ч; мастер цеха, сменный технолог, механик — по 1/24 ч; сырьевой мастер 1/12 ч; старший мастер H23=12 ч при неуточнённом графике I23. Реальный roster не предоставлен. Эти значения пока **только прочитаны**, не созданы в приложении.

После hand-off: только обычная админка для завода №9 и бизнес-объектов; минимальный контрольный №4 для TECH 4↔9; обычные отдельные входы для прав, смен, checklist/archive. Запрещены прямые mutation HTTP/SQL/Prisma/seed и исправления product code. UI/SQL/HTTP результаты должны отделяться от NOT_RUN. Временный серверный scheduler может штатно менять **собственную учебную** историю; работающая среда не является frozen snapshot.

Адресная source-проверка до ролевого UI: `AdminService.createFactory` и `createJobTitle` вызывают `assertAdmin`, `createLine` — `assertAdminFactoryScope`. Это признак возможного ограничения делегирования начальнику производства, но пока **не** результат обычного MANAGEMENT-сеанса. Права/guards не менялись и ADMIN этому профилю не выдавался.

```text
FACTORY09_STRUCTURE=NOT_CREATED_FIRST_ADMIN_CREDENTIAL_EXPIRED
STAFFING=SOURCE_XLSX_48_POSITIONS_ONLY
REAL_ROSTER=NOT_PROVIDED
UI_CREATED_BUSINESS_OBJECTS=0
DIRECT_BUSINESS_API_SQL_WRITES=0
T1_TOUCHED=NO
MIGRATIONS=57_UNCHANGED
VPS=NOT_RUN
PILOT_READY=NOT_DECLARED
```
