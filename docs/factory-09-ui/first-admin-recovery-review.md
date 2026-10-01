# FACTORY-09-UI-01 — разбор первого входа и граница восстановления

28.09.2026, source + read-only local SQL, без нового кода, bootstrap, seed, прямых auth-записей или старых стендов. Значения кода, DB/JWT-secret, хеша и предложенного личного пароля не выводились и не включены в документ.

## Факты текущего изолированного контура

| Владелец / проверка | Подтверждённое состояние |
|---|---|
| `docs/factory-09-ui/runtime.ps1 -Action Status`, 10:09:57 UTC | Собственные PID PG `32900` на `127.0.0.1:15439`, backend `26892` на `3000`, frontend `32120` на `5173`; идентичность процессов проверена launcher. Это прежняя FACTORY09, не T1/C0/C1. |
| Read-only Prisma к `zavod_factory09_ui01` на `127.0.0.1:15439` | Ровно один User: ожидаемый bootstrap-телефон совпадает после `normalizePhone`, роль `ADMIN`, `passwordResetRequired=true`, `blocked/deleted=false`. Его единственный UserFactoryAccess — активный не-гостевой `ADMIN` к активной `factory09-bootstrap`; `passwordRecoveryFactoryId` совпадает. |
| Источник `secrets/admin-recovery.txt` и БД | Защищённый файл существует и его значение **совпадает с хешем** `User.passwordRecoveryHash` при проверке существующим `verifyRecoveryCredential`; само значение и хеш не показаны. Код выдан `09:24:54.987Z`, expiry `09:54:54.987Z`, `passwordRecoveryConsumedAt=NULL`. На readback `failedLoginCount=6`, `lockedUntil=NULL`. |
| AuditLog, только action/time/reason | `FIRST_ADMIN_BOOTSTRAPPED=1`, `LOGIN_FAILED=8`, `PASSWORD_RESET_FLOW_STARTED=0`, `ADMIN/MANAGER_PASSWORD_RECOVERY_ISSUED=0`. Ошибки `BAD_OR_EXPIRED_RECOVERY_CREDENTIAL` в `09:40:19`, `09:40:23`, `09:53:01` UTC — **до** expiry; ещё такие ошибки в `09:57:15`, `09:59:08`, `09:59:09` — после expiry. Два `NO_MATCH` в `09:43:13/14` относятся к запросам без найденного профиля. Значения попыток входа не записаны и не известны. |

`backend/src/modules/auth/auth.service.ts` использует общий код ошибки/русский текст «Неверный или истёкший временный код» и при несовпадении, и при истечении. Поэтому прежний отчёт некорректно трактовал ранний текст как истечение. При зафиксированных серверных временах до `09:54:54.987Z` проверка времени не могла быть причиной ранних `BAD_OR_EXPIRED`; предъявленное приложению значение не прошло сравнение с сохранённым хешем. Почему оно отличалось от защищённого источника (ввод, передача через UI или иное) **не установлено**: сырой пароль намеренно не журналируется. `frontend/src/screens/FactorySelectScreen.tsx` передаёт React-state `password` в `/auth/login` без явной трансформации. Оба процесса и БД работают на одном Windows host. После expiry даже исходный правильный код больше не допускается.

## Есть ли штатная повторная выдача без другого ADMIN

Нет — это подтверждённый source gap для единственного первого ADMIN, а не неисполненный ручной шаг пользователя.

- `backend/src/cli/bootstrap-first-admin.ts` + `backend/src/common/first-admin-bootstrap.ts`: CLI создаёт первого ADMIN только при пустых Factory/User/UserFactoryAccess. Exact repeat с тем же кодом возвращает `ALREADY_COMPLETED`, `changed=false` и **прежний** expiry; другой код/identity получает `FIRST_ADMIN_BOOTSTRAP_REFUSED`. Повторять bootstrap как reset нельзя. Это прямо указано в `docs/vps-preparation/vps-prep-01/review-pack/operator-runbook.md`.
- `backend/src/modules/admin/admin.controller.ts` и `admin.service.ts`: существующий `/admin/users/:id/password-reset` создаёт новый код, но требует вошедшего полномочного actor, выбранного завода и запрета на self-reset. Здесь единственный User — целевой ADMIN с `passwordResetRequired=true`; получить такого actor в этом же контуре нельзя.
- `backend/src/modules/auth/auth.controller.ts` и `auth.service.ts`: `/auth/set-password` требует `password-setup` token из **успешного** временного входа; `/auth/change-password` требует уже аутентифицированного пользователя. Публичная регистрация создаёт гостя, не полномочного ADMIN; dev-login в production выключен и не является восстановлением.
- В `backend/src/cli` нет отдельной команды повторной выдачи первому ADMIN. Ни API без actor, ни CLI с такими fail-closed условиями не найдено. Новый код **не выпускался**.

## Минимальное необходимое исправление — отдельный code stage, не этот UI stage

Добавить в существующий auth/bootstrap owner строго ограниченную операторскую команду `reissue-first-admin-recovery`, не второй bootstrap и не прямое редактирование пароля. Она должна: требовать явный `DATABASE_URL` и защищённый источник нового случайного кода; проверять system foundation, исходный `FIRST_ADMIN_BOOTSTRAPPED` audit/fingerprint, ровно одну bootstrap-factory/одного User/один активный не-гостевой ADMIN UFA, `passwordResetRequired=true`, истёкший **неиспользованный** recovery code и отсутствие другого администратора; блокировать строку/транзакцию и делать compare-and-swap; атомарно заменить только recovery hash/expiry/issued metadata, сбросить rate lock, обновить auth epoch и записать отдельный audit без значения кода. Код не печатать и не класть в review. Отказ без изменения при любой identity/row-count/access/concurrency ошибке. После такого адресного исправления проверить targeted negative/rollback/concurrency и реальный SQL readback **на этой же изолированной базе**, выдать код непосредственно перед передачей формы, затем пользователь лично устанавливает пароль и делает обычный вход.

До отдельного разрешения на code stage: `FACTORY09_UI=BLOCKED_FIRST_ADMIN_RECOVERY_GAP`; №9, его люди/роли/шаблоны/checklist/archive `NOT_RUN`. Ни старые данные, ни источник кода, ни product code/schema/migrations в этом разборе не менялись. `T1_TOUCHED=NO`, `MIGRATIONS=57_UNCHANGED`.
