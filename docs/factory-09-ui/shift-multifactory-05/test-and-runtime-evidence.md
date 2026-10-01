# SHIFT-05 — команды, ответы, границы доказательства

Секреты, bearer, cookies, DATABASE_URL, dump, содержимое uploads не включены. Все SQL-фрагменты здесь — только read-only результаты после обычных действий приложения.

## Red → green

До исправления `node --test backend/scripts/factory09-shift-multifactory05.test.cjs` вернул `tests 3 / pass 0 / fail 3`:

```text
sendHome closes the same active session atomically and broadcasts shift change:
  'ACTIVE' !== 'ENDED'
inactive or deleted local manager title cannot authorize management, enablement or staffing:
  Missing expected rejection.
guest target access never projects an active foreign technician shift:
  true !== false
```

После исходников `npm --prefix backend run build` — exit 0; `npm --prefix frontend run build` — exit 0 с предупреждением Vite об одном большом chunk (не ошибка). Последний совместный targeted запуск:

```text
node --test backend/scripts/factory09-shift-multifactory05.test.cjs backend/scripts/factory09-functional-closure04.test.cjs
✔ local production manager requires selected factory and live explicit factory override
✔ production manager cannot approve self, ADMIN or peer assignment requests
✔ local manager assignment refuses another factory access and writes only one existing subordinate
✔ local profile does not open inter-factory grants or global defaults
✔ contractor title keeps firm-only access and rejects foreign role, department and factory
✔ one active shared-service shift is visible in another authorized factory, without a second session
✔ sendHome closes the same active session atomically and broadcasts shift change
✔ shared shift invalidation reaches only live non-guest same-role factory access
✔ inactive or deleted local manager title cannot authorize management, enablement or staffing
✔ ADMIN can revoke stale manager overrides but cannot enable them until title is active
✔ guest target access never projects an active foreign technician shift
tests 11 / pass 11 / fail 0
```

`npm --prefix backend run stage9:shift-regression` был выполнен **без** DATABASE_URL и упал до проверки на `PrismaClientInitializationError: Environment variable not found: DATABASE_URL` при fixture upsert. На рабочую `mes` его не перенаправляли. `STAGE9_SHIFT_REGRESSION=NOT_RUN`, а не FAIL продукта и не PASS.

Адресный `backend/scripts/factory09-shift05-sql.test.cjs` проверяет hostname/port/имя исходной БД и предназначен только для нового одноразового DB с 57 миграциями, fault rollback и гонкой sendHome/self-end. Первый запуск остановился до записи из-за строгого ожидания `127.0.0.1` при фактическом разрешённом `localhost`; проверка расширена только на эти два loopback имени. Второй запуск дошёл до `CREATE DATABASE` и получил PostgreSQL `42501: нет прав для создания базы данных`. Скрипт **не создал БД**, read-only `pg_database` по точному префиксу вернул `0`. Привилегии/роль не повышались, `mes` и чужие базы для обхода не использовались. `SQL_FAULT_CONCURRENCY=BLOCKED_DB_CREATE_PRIVILEGE`, не PASS.

## Runtime и SQL receipts

```text
Before: 3000/5173 no listener; PostgreSQL 18 on 5432, DB mes, migrations 57.
After: 127.0.0.1:3000 backend PID10980; 127.0.0.1:5173 preview PID3652; GET /ready -> {"ready":true,"code":"READY"}.
UFA factory-4=2486, factory-9=23 (до ещё не подтверждённых UI-grants).
Protected before dump: 13,706,820 bytes, TOC 806; uploads baseline 2268.
Post-upload hash compare: BASELINE_COUNT=2268 MISSING=0 CHANGED=0 LIVE_COUNT=2269.
```

```text
Old Ulyana session e4ad2b06-3a7c-42cf-b1af-1a4bb0e7bcb5:
  before ACTIVE, endedAt=NULL, version=1;
  after normal maintenance ENDED, endedAt=2026-09-29 05:00:00 UTC,
  autoClosed=true, version=2; original Assignment UserSkillCredit count=1.
Independent Nikolai session 65333a08-9091-4a3a-b433-ead7c9758f91:
  normal maintenance ENDED at its own plannedEndAt=2026-09-29 05:00:00 UTC.
```

```text
POST /shift/start as Oleg with normal auth:
  SHIFT_START_ID=d0d42cae-8665-4378-9c1e-0d58b11052c6
  STATUS=ACTIVE FACTORY=f33f9682-8168-4562-a8c8-5c196b2c0d37
  USER=40507f0c-bbee-50cd-ae50-143ca1bd1fcb DURATION=12
UI MASTER Boris: on-shift count 1 -> «Примеров О. 9. отправлен домой» -> count 0 (без F5).
SQL session: ENDED | 2026-09-29 05:06:05.722 UTC |
  endedById=4068896f-ec64-51e1-a0b3-db9260f89713 | autoClosed=false | version=2.
User.employeeState=OFF_SHIFT; active Assignment=0; UserSkillCredit=0.
Audit: 436c6719-9b97-4f94-8123-9063b28b14d3 SHIFT_ENDED;
  d71dbad3-7e41-451e-8721-1938fed986c5 EMPLOYEE_SENT_HOME.
```

```text
UI STORE Marina: «УЧЕБНЫЙ возврат №9 — проверка вложения»;
  image pwa-icon-192.png, 1 шт., TEST-RETURN-09-20260929.
SQL ReturnRecord=e3582754-8d73-455a-8f0e-871b853092fa;
  factory=f33f9682-8168-4562-a8c8-5c196b2c0d37;
  createdBy=7b1a0f7f-e7af-50b0-a560-f25d2633c980;
  status=ACTIVE, attachment count=1.
UI after logout/new login: «Новые 1», photo pwa-icon-192.png, 1 шт.
```

## Дополнение после точного UI-подтверждения пользователя

```text
Identity: localhost:5432/mes; factory-4=537cbb48-7fba-48b6-80af-659f82cdaeb3;
factory-9=f33f9682-8168-4562-a8c8-5c196b2c0d37; migrations_success=57.
Final UFA counts: #4=2486 unchanged, #9=26 (was 23).
Manager ea808f6b-d580-56af-a63c-fb65713d7b7f: role MANAGEMENT,
8 ALLOW overrides only factory-9; UI grant 18:01:19 UTC,
UI OFF 18:05:54 -> HTTP /admin/users #9 403,
UI ON 18:06:15; /admin/users #9 200, #4 403,
/admin/factories and /admin/factories/setup/options 403.
Subordinate Pavel 0c1fe329-f54e-5406-a001-e8874c5c32f9:
UI manager Save logged FACTORY_ACCESS_GRANTED actor=manager factory-9 18:03:56 UTC;
result WORKER/Рабочие/Грузчик, not ADMIN.
``` 

```text
Exact new factory-9 UFA, all active/non-guest final:
KIPIA 46797300-2fab-439b-8f78-a3f4965b498e
  REVOKED 18:06:47 -> RESTORED 18:07:18 UTC.
ELECTRIC e7df4257-c903-4917-9bae-b3c9d71160af
  REVOKED 18:30:13 -> RESTORED 18:31:29 UTC.
HOLOD 45919643-2c00-4c07-b669-9a57b1394ce5
  REVOKED 18:32:14 -> RESTORED 18:33:03 UTC.
Each OFF: old #4 /tasks 200, #9 /tasks 403 on normal login;
electric OFF: exact #9 Task link 403, attachment file 403.
Old #4 UFA identifiers, roles and departments retained.
``` 

```text
UI Task URGENT 44197de5-de68-41df-adc6-073299d7fd7b
  source factory-9, assignee/doneBy=pilot-tech-kipia-1, DONE, comments=2.
UI Task LONG 0766111c-2cfb-4552-8118-a66cef87035d
  source factory-9, assignee/doneBy=mobile-tech-electric, DONE, comments=2.
Both notification UIs showed source Завод 9 from initial factory-4 login;
Open switched to source exact task; take/comment/done persisted.
Archive #9 /archive/items?section=tasks: total=4, both new DONE.
/archive/export/xlsx?section=tasks: HTTP 200, XLSX MIME, 12524 bytes;
/archive/downtime/summary: HTTP 200.
``` 

```text
Shared ELECTRIC source shift session 407c76b9-733e-499b-8563-3ac216f4a2aa:
POST /shift/start source factory-4 -> ACTIVE 18:15:28.629 UTC;
GET /shift/people source#4 onShift=true; target#9 onShift=true,
  sharedPresenceSourceFactoryName=Завод 4.
Two already-open «Смена» tabs showed the one ELECTRIC, count=1 each.
POST /shift/end source#4 -> ENDED 18:26:23.780 UTC version=2;
both tabs without F5 count=0; SQL active session=0, Assignment=0,
UserSkillCredit=0. No second session was created.
New FAIL: GET /people factory-9 showed same ELECTRIC onShift=false
while /shift/people factory-9 showed true; «Люди» target UI stayed 0.
Owner PeopleService.list currently loads only target-factory ShiftSession.
``` 

```text
Chat gap: GET /chats as each of three old TECH in #4 -> one visible
factory-local chat ef6ddaa9-ecd5-4f6a-b571-c89a9bee9cc3;
GET /chats in #9 -> 0; GET old chat ID with selected #9 -> 403.
DB Chat.factoryId NULL count=0; factory-9 Chat count=0.
No shared service chat/message/reply/read-status PASS and no merge/duplication.
Checklist archive after grants: exact A/B/C run first three checks DONE,
fourth CLOSED; photo in check 1 still linked. Full two-window retest NOT_RUN.
```

Методные тесты не подменяют PostgreSQL concurrency/fault test, а успешный экран «Смена» не подменяет дефектный consumer «Люди». Физический телефон/VPS и живые общие чаты не проверены.

