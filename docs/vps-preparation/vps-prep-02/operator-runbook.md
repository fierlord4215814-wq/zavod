# VPS-PREP-02 — будущий clean Linux runbook

Это исполняемый маршрут после отдельного допуска к новому Linux target. Команды здесь не запускались. `<...>` означает операторское значение; секреты в чат и журнал команд не помещать. До HTTPS-этапа HTTP остаётся доступен только на `127.0.0.1` хоста, тестировщиков не подключать.

## Первичная подготовка

1. Проверить происхождение нового сервера, Docker/Compose и назначенные абсолютные пути. Для DB выбрать **новый** пустой отдельный путь, не прежний каталог PostgreSQL; storage marker установщик создаст сам. Uploads, backups, exports и logs — отдельные пути вне исходников. На Linux владелец установки должен иметь право создавать эти каталоги; не использовать `chmod 777` и широкий recursive `chown`.
2. Из каталога reviewed source выполнить:

```bash
node setup/zavod-setup.js prepare \
  --server-address '<INTERNAL_ADDRESS_OR_127.0.0.1>' \
  --backend-port '<BACKEND_LOOPBACK_PORT>' \
  --frontend-port '<FRONTEND_LOOPBACK_PORT>' \
  --db-data-dir '<NEW_ABSOLUTE_DB_PARENT_DIR>' \
  --uploads-dir '<ABSOLUTE_UPLOADS_DIR>' \
  --backups-dir '<ABSOLUTE_BACKUPS_DIR>' \
  --error-reports-dir '<ABSOLUTE_ERROR_EXPORT_DIR>' \
  --logs-dir '<ABSOLUTE_LOGS_DIR>'
```

Expected: build release ID и `FIRST_ADMIN_REQUIRED`; DB/migrations/foundation завершены, app ещё не стартует. `backend/prisma/seed.js` не запускать. Любая ошибка migration/foundation останавливает цепочку. Если каталог DB уже существует без маркера или с прежней структурой, остановиться и исследовать; новый mount не преобразует старые данные.

## Явный первый ADMIN

Реальные реквизиты завода и администратора задаёт оператор. Первоначальный credential создаётся скрытым вводом в файл mode 600 на защищённом пути; это пример без действующего секрета:

```bash
umask 077
read -r -s -p 'Временный код первого администратора: ' FIRST_ADMIN_CODE
printf '\n'
printf '%s\n' "$FIRST_ADMIN_CODE" > '<PROTECTED_CREDENTIAL_FILE>'
unset FIRST_ADMIN_CODE
chmod 600 '<PROTECTED_CREDENTIAL_FILE>'
node setup/zavod-setup.js bootstrap \
  --factory-name '<REAL_FACTORY_NAME>' \
  --factory-code '<stable-lowercase-code>' \
  --admin-phone '<REAL_ADMIN_PHONE>' \
  --admin-last-name '<REAL_LAST_NAME>' \
  --admin-first-name '<REAL_FIRST_NAME>' \
  --credential-file '<PROTECTED_CREDENTIAL_FILE>'
```

Отчество при наличии добавляется отдельным `--admin-middle-name '<REAL_MIDDLE_NAME>'`. Runner проверяет защищённый файл и передаёт credential в container CLI через stdin; его нет в Compose YAML, args, env или выводе. Expected: `FIRST_ADMIN_BOOTSTRAP=CREATED`, затем `RUNTIME_READINESS=READY`. Первый ADMIN устанавливает личный пароль и входит заново обычным способом. После ротации временный файл выводится из обращения по утверждённой политике хранения.

При потере ответа после возможного commit повторить **те же** non-secret реквизиты и **тот же** исходный credential. `ALREADY_COMPLETED` означает диагностический повтор без новой записи и замены пароля; другой credential не является способом reset. Не создавать demo ADMIN.

## Start, update, abort

```bash
node setup/zavod-setup.js start
node setup/zavod-setup.js check
```

`start` сначала останавливает app, поднимает только DB, запускает один migrator и foundation, проверяет ADMIN, затем допускает backend/frontend и ждёт `/ready`. При `FIRST_ADMIN_REQUIRED` app остаётся остановленным. Автоматический старт контейнеров после reboot дополнительно защищён backend preflight: неполная schema/foundation/ADMIN не начинает обслуживать запросы.

Для обновления сначала получить и согласовать полный backup **этой** установки (DB + uploads + config), проверить его штатным `backup-validate`. Затем:

```bash
node setup/zavod-setup.js update --backup '<VERIFIED_BACKUP_DIRECTORY>'
```

`update` сверяет checksums/manifest и исходный uploads path, останавливает app, собирает images из очищенного staging, затем повторяет порядок DB → migrations → foundation → readiness. Не использовать `docker compose down -v`, `volume prune`, `db push`, `migrate resolve`, seed, ручное редактирование `_prisma_migrations` или автоматический rollback данных.

Если migrate/foundation/bootstrap/readiness завершились ошибкой, сохранить первичный sanitized output, зафиксировать точную фазу и остановиться. Нельзя считать запуск контейнера успешной установкой. `/health` показывает liveness, `/ready` — минимальную готовность; для full schema drift нужен отдельный DB harness. Реальные fresh/upgrade, recreate и restart readback должны пройти на disposable target до допуска тестировщиков.
