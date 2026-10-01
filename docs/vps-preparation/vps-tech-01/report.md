# VPS-TECH-01 — безопасная подготовка завершена; Linux target не предоставлен

## Продолжение R1 + CHECKLIST-VERIFY-01 / SOURCE REVIEW STOP

Новый текущий результат: [раздельный A/B отчёт, команды и ограничения](r1/report.md), [один конечный план](plan.md), [обновлённый release inventory](release-inventory.json). Старый исходный checkpoint и ZIP ниже сохранены как исторические; R1 review pack будет указан в новом отчёте после полного readback. Никаких runtime/SQL/Compose/VPS/T1/phone действий в R1 не было. `FINAL_STOP=STOP_FOR_SOURCE_REVIEW_BEFORE_SEPARATE_LINUX_RUNTIME_ACCEPTANCE`.

28.09.2026. Статус `BLOCKED_INPUT_TARGET_NOT_PROVIDED`. Это **не технический VPS PASS**. Прямое решение пользователя: учебный T1 сохраняется без отката; `T1_EXACT_PRESERVATION_DURING_OPS01=FAILED`, точная post-row дельта не доказана, но её дополнительная реконструкция не заказана. Старые T1/C0/C1/копии не запускались, не читались SQL и не изменялись. Исходные OPS reports/receipts/ZIP/защищённая копия не переписаны. Пользователь сообщил, что OPS ZIP уже доставлен во внешний review: reviewer сверил source/evidence и ещё 132 сохранённых значения, **без** нового live исполнения; это user-reported review, не результат настоящего VPS-этапа.

## Что сделано сейчас без сервера

- Прочитаны текущие deploy owners и [операторский runbook](../vps-prep-02/operator-runbook.md)/[pending-runtime](../vps-prep-02/pending-runtime.md). Исторические команды не исполнялись. Обнаруженная текущая схема и 57 SQL migration files побайтно совпали с последними OPS source/checksum receipts; migration58, schema change и dependency update не делались.
- [Release inventory](release-inventory.json) фиксирует **280 image-context files / 6 145 016 bytes**, включая необходимые untracked исходники (217), SHA-256 каждого файла, 57 миграций и четыре отдельные host-control файла. Отбор выполнен текущим `setup/deployment-context.js`; выбранные файлы — обычные, не symlink; локальные конфиги/секреты/T1 uploads/dumps/старые review ZIP/`node_modules` не выбраны. Детерминированный ожидаемый Linux-path build digest `d2749fbc9a95f984808bfcab6b70247a894e1ad8315480ec654ab04e7eea0b53`; это **source candidate**, а не образ/release, созданный на VPS. Windows native-path digest отличается — текущий setup включает разделители путей в хеш.
- [Карта конфигурации и конкретные source hazards](config-map.md) готова без значений секретов: HTTP-origin/CORS/TLS path; несогласованная пара DB↔uploads при backup без quiesce; опасная для independent restore подстановка source config после in-place `dropdb`; отсутствие доказанного compatible rollback; cross-platform release ID. Не выполнять текущий `restore` на независимой цели до адресного исправления existing owner. Код продукта/деплоя сейчас не менялся — не было Linux target для регрессии.
- [Один конечный план](plan.md) разделяет target identity, clean release, C0/admin, HTTPS/WSS/auth, Linux storage/time/restart/update, consistent backup/independent restore, load/failure и review. Gates 2–8 стоят `NOT_RUN_BLOCKED_INPUT`, не заменяются Windows proof или документом «отложено».

## Точная внешняя граница

В прямом поручении и актуальном repo **нет предоставленного и подтверждённого сервера/адреса, SSH identity/host key и защищённого доступа**; прежний `pending-runtime` также не называл target. Поэтому не было SSH, Docker, image pull/build, контейнера, новой DB, API/WS/UI, TLS, миграций, backup/restore, load или reboot. Никакого произвольного хоста из SSH config/старой VM/WSL не использовано. Порты/процессы прежних стендов не переключались. Неопределённость источника — `BLOCKED_INPUT`, не FAIL продукта.

Source gaps — конкретный change-impact перед runtime, **не** новый live fault. Их минимальные fixes должны остаться в существующем `setup/zavod-setup.js`/Compose/proxy и backup/restore owners, затем получить адресные tests и фактический Linux readback. Без target/TLS policy не подставлялись значения и не создавался второй installer. Для приватной clean C0 проверки домен сам по себе не обязателен; для HTTPS/WSS нужен доверенный origin. До физического пользовательского пилота сохраняются все ограничения [A/B/C](../ops-01/server-readiness.md): 14 roles, five gates, UI036/19 bindings/original UI063, 29 dead settings, changed-payload/publication/checklist/Range206, source-only notification risks, skill-only profile, ErrorReport version/list/status/export, physical phone/PWA/camera. Предположение 200 users и фото примерно раз в 30 секунд суммарно — не capacity proof.

## Следующее одно действие

Предоставить и подтвердить выделенный тестовый Linux-хост с доступом и разрешённой областью ресурсов по [плану](plan.md). После этого тот же VPS-TECH-01 начинается с read-only identity/isolation gate, а не с миграции. Текущий финальный STOP — `STOP_AT_CONFIRMED_TARGET_INPUT_BEFORE_REMOTE_ACTION`; пользовательский пилот не начинать.

```text
T1_EXACT_PRESERVATION_DURING_OPS01=FAILED
T1_DELTA_CLASSIFICATION=INSUFFICIENT_EVIDENCE_FOR_EXACT_ROW_DELTA
T1_DECISION=KEEP_CURRENT_HISTORY_WITH_ACKNOWLEDGED_UNCERTAINTY_NO_ROLLBACK
T1_TOUCHED_THIS_TASK=NO
LINUX_TARGET=BLOCKED_INPUT_NOT_PROVIDED
RELEASE_ID=SOURCE_CANDIDATE_LINUX_PATH_EXPECTED_1.0.0+d2749fbc9a95f984;TARGET_NOT_BUILT
CLEAN_INSTALL=NOT_RUN_BLOCKED_INPUT
AUTH_TLS_WSS=NOT_RUN_BLOCKED_INPUT
STORAGE=NOT_RUN_BLOCKED_INPUT
FACTORY_TIME_CATCHUP=NOT_RUN_BLOCKED_INPUT
RESTART=NOT_RUN_BLOCKED_INPUT
SERVER_REBOOT=NOT_RUN_BLOCKED_INPUT
UPDATE_ROLLBACK=NOT_RUN_BLOCKED_INPUT
BACKUP_RESTORE=NOT_RUN_BLOCKED_INPUT;SOURCE_GAPS_IDENTIFIED
LOAD_PROFILE_AND_RESULT=NOT_RUN_BLOCKED_INPUT
FAILURE_RECOVERY=NOT_RUN_BLOCKED_INPUT
PHYSICAL_PHONE=PENDING_NOT_RUN_BY_USER_PRIORITY
REAL_FACTORY_4=NOT_CONFIGURED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
PILOT_READY=NOT_DECLARED
PRODUCT_CODE_CHANGED=NO
DATA_MUTATIONS_PERFORMED=NO
FILE_DELIVERY=LOCAL_ONLY
FINAL_STOP=STOP_AT_CONFIRMED_TARGET_INPUT_BEFORE_REMOTE_ACTION
```
