# FACTORY09-AUTONOMOUS-01 — итог ограниченного автономного блока

28.09.2026. Один writer в каноническом `work`; текущая FACTORY09 сохранена. Это source/isolated/ограниченный SQL результат, **не** завершение завода №9 или пользовательский пилот. Исторические FACTORY09 ZIP и T1 evidence не переписаны.

Один локальный [review-пакет](review-pack-factory09-autonomous-20260928.zip) с source before/after/diff, [evidence exit codes](test-evidence.md), Excel→UI листом и operator hand-off; его полный внешний [readback и SHA](review-readback.json). `FILE_DELIVERY=LOCAL_ONLY`, ссылка на диск не является отправленным вложением.

## Фактическое состояние доступа и UI

- Штатный helper подтвердил собственные PG `127.0.0.1:15439`, backend `3000`, frontend `5173`; браузер показал только обычную форму входа с прежней общей ошибкой. Действующего сеанса текущего ADMIN не было: `EXISTING_ADMIN7_CHECK=NOT_FOUND` **в этой базе**, местонахождение старых администраторов не проверялось. В FACTORY09 остаётся один первый технический ADMIN, не личный аккаунт владельца.
- Read-only SQL после всех действий: `current_database=zavod_factory09_ui01`; foundation/bootstrap audit `1/1`, recovery-reissue audit `0`, истёкший неиспользованный credential `1`; Factory/User/UFA `1/1/1`, Line/JobTitle/ChecklistRun/Attachment `0/0/0/0`. В основной БД **не выпускался** новый код и не было бизнес-записей. Историческая ошибка кода до expiry остаётся несовпадением предъявленного значения с хешем; причину ввода мы не знаем.
- Computer-use требует личный ввод/подтверждение нового пароля. Пользователь предупредил, что сейчас отсутствует; 30-минутный код не выдавался заблаговременно. `AUTH_ACCESS=HUMAN_STEP_PENDING`; `RECOVERY_CODE=IMPLEMENTED_TESTED_NOT_ISSUED_IN_MAIN`. [Точная проверенная команда и hand-off](operator-handoff.md) подготовлены, но **не запущены** на основной FACTORY09.
- Через UI создано `0` бизнес-объектов. Полный №9, минимальный №4, девять линий, должности, фирмы/люди, роли, чек-листы и архив в работающем приложении `NOT_CREATED/NOT_RUN`, не PASS. Действия Excel→форма→ожидаемое сохранение подготовлены [здесь](excel-ui-actions.md); файл XLSX внутри исходного ZIP повторно сверён по SHA-256, 9 линий/48 мест, без roster.

## Адресные изменения кода

1. Владелец `backend/src/common/first-admin-bootstrap.ts`, новый CLI `backend/src/cli/reissue-first-admin-recovery.ts`, npm script в `backend/package.json`: ограниченная операторская повторная выдача только первому единственному bootstrap ADMIN. Проверяются явный URL и фактические DB name/address/port, foundation, ровно один Factory/User/UFA и исходный audit fingerprint, активный не-гостевой ADMIN UFA, незаблокированный/reset-required пользователь, пустой личный пароль, expired/unconsumed credential, непротиворечивые timestamps. В одной транзакции используются тот же advisory lock, CAS, auth epoch и отдельный audit без кода/хеша. Код генерируется существующим криптографическим генератором, пишется исключительно в новый закрытый файл; Windows ACL проверяется. Replay с тем же файлом до expiry не меняет БД, после expiry не продлевает тот же секрет. Обычный self-reset, bootstrap и auth guards не менялись; endpoint не добавлен.
2. Владелец `backend/src/modules/checklists/checklists.service.ts`: активный **периодический** ответ строки теперь требует current `checkId`. Это исправление было сначала воспроизведено красным controller→service тестом: без `checkId` старый код записывал ответ. После fix тест зелёный; непериодические/старые сохранённые replay не изменены. `frontend/src/screens/ChecklistsScreen.tsx` уже передаёт current `checkId` и для строки, и для завершения; source-consumer тест закрепил контракт. Rolling policy («можно раньше; следующий срок от completion») не менялась.
3. Новые изолированные тесты: `factory09-first-admin-recovery-sql.test.cjs`, `factory09-checklist-consumer.test.cjs`, `factory09-authority.test.cjs`, `factory09-staffing.test.cjs`; адресно дополнен `master-r2-checklist.test.js`. Schema/модели/миграции/зависимости не менялись.

## Проверки по уровню доказательства

| Проверка | Результат и уровень |
|---|---|
| Recovery на новой случайно именованной БД **в собственном** PG | SQL/CLI PASS exit 0: 57 migrations, foundation/bootstrap fixture, positive CLI issuance, wrong DB/factory/admin/foundation/provenance/access/cardinality/consumed/blocked/password/not-expired/reset-completed denial, rollback, replay exit 3, expired same-code refusal, две конкурентные попытки → один победитель/один audit. Отдельная тестовая БД и её временный секретный файл проверенно удалены. Это **не** reissue основного ADMIN. |
| Main target wrong-port CLI preflight | SQL target input check: exit 1 до создания файла или записи; main recovery audit остался 0. |
| Checklist | ISOLATED 14/14: rolling due от фактического completion, A/B/C свои ENTRY-фото, старые A/B остаются `COMPLETED` при incomplete C/parent, общий архив привязывает фото к exact entry, reminders 10/2 min dedupe, paging; red→green обязательный row `checkId`. SOURCE_CONSUMER 2/2; связанный checklist replay 5/5. Никакого живого photo/phone/second-session PASS. |
| Роли | ISOLATED 3/3: MANAGEMENT only own №9 UFA; foreign №4 guest/deny; попытки ADMIN/self-elevation/foreign UFA без записи; TECHNOLOG №9 с модельным factory-local OKK override проходит guarded OKK/wash consumers и локальный task-recipient, №4 denied. Это fixture, **не** полномочия реального созданного пользователя. |
| Состав/12–24 | ISOLATED 2/2: нормализация 12/24 и точные 9 line totals 22/18/8=48; старый адресный Admin create/save test 1/1. Никакого UI-save или SQL readback состава. |
| Сборки/старые контракты | Backend `npm run build` exit 0, frontend `npm run build` exit 0 (89 modules, обычное предупреждение о крупном chunk); `vps-prep-01-regression` 41/41 exit 0; admin config 7/7, position 6/6. Историческое сообщение о Vite CLI EXIT1 относится к прежнему запуску, не к этому. |
| Более широкий memory suite | Запуск 29 tests → 28 pass/1 fail и объединённый 81 tests → 80 pass/1 fail: существующие chat fixtures получают `FORBIDDEN` на положительном chat-сценарии. Ни одна ошибка не в адресном recovery/checklist/authority/staffing тесте. Не перекрашивать в PASS и не чинить chat вне этого блока без отдельного reproduced scope. |
| Текущая FACTORY09 | HTTP `/ready=true`, `/version=FACTORY09-UI01-20260928`, frontend HTTP200; backend адресно перезапущен после checklist fix с PID `27304`, PG/front сохранились. Read-only SQL выше; REAL_BROWSER — только форма входа. |

## Подтверждённые ограничения и остаток

- `AdminService.createFactory/createJobTitle/grantFactoryAccess/updateRoleDepartment/updateRolePermissions` требуют полноценного ADMIN; MANAGEMENT №9 имеет широкие операционные grants, но **не** может построить организацию/выдать ADMIN или межзаводский UFA через текущий контракт. Начальнику производства не выдан ADMIN в обход. Factory-local руководство и весь позитивный/негативный live UI цикл остаются `NOT_RUN`.
- Для TECHNOLOG+ОКК source/isolated backend показывает возможность factory-local personal overrides, но текущий UI предлагает глобальное редактирование роли или копирование прав, которое меняет роль TECHNOLOG→OKK и скрывает `.manage`-разрешения из явного списка. Это не подтверждённая UI-настройка одного профиля; контракт/политика нуждаются в отдельном решении. Не меняли глобальную роль, backend guards или персональные overrides в основной БД.
- Межзаводские TECH4↔9, CONTRACTOR/LEAD по фирме, 12/24 фактические смены, 08/20 и checklist21/09, минимальный цикл явка→заявка, live WS второй страницы, фото A/B/C физически, reopen/второй вход, архивные UI фильтры и негативные аккаунты — `NOT_RUN_AUTH_ACCESS`. Isolated tests не равны HTTP/REAL_BROWSER/PHYSICAL_PHONE.
- После присутствующего hand-off выдать новый код **сразу перед формой**, пользователь сам устанавливает пароль и делает обычный вход. Затем UI создать №9 и минимум №4 по [листу](excel-ui-actions.md), продолжить весь прежний FACTORY-09-UI-01. Новые дефекты документировать actor/factory/steps/expected/actual; спорную модель полномочий без решения не расширять.

```text
EXISTING_ADMIN7_CHECK=NOT_FOUND_IN_CURRENT_ALLOWED_TARGET
AUTH_ACCESS=HUMAN_STEP_PENDING
RECOVERY_CODE=IMPLEMENTED_TESTED_NOT_ISSUED_IN_MAIN
FACTORY09_STRUCTURE=NOT_CREATED
STAFFING=EXCEL_VERIFIED_ISOLATED_ONLY
UI_CREATED_COUNT=0
HEAD_LOCAL_SCOPE=ISOLATED_DENIAL_AND_OPERATIONAL_GRANTS_ONLY
TECH4_9=NOT_RUN
TECHNOLOG_OKK9=ISOLATED_CAPABILITY_UI_CONFIGURATION_UNSUPPORTED
CHECKLIST_INTERVAL_PHOTOS_ARCHIVE=ISOLATED_PASS_LIVE_NOT_RUN
FIXES=FIRST_ADMIN_RECOVERY_CLI_AND_PERIODIC_ROW_CHECKID
TESTS_BY_LEVEL=SOURCE_PASS_ISOLATED_PASS_SQL_RECOVERY_PASS_HTTP_HEALTH_ONLY_REAL_BROWSER_LOGIN_FORM_ONLY_PHYSICAL_PHONE_NOT_RUN
NOT_RUN=BUSINESS_UI_SECOND_SESSION_TECH4_9_LIVE_CHECKLIST_PHOTOS_ARCHIVE_LINUX_VPS
T1_TOUCHED=NO
MIGRATIONS=57_UNCHANGED
PILOT_READY=NOT_DECLARED
```
