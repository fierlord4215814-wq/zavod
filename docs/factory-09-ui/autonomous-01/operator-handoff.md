# FACTORY09 — контролируемая повторная выдача первого кода

Это подготовленная команда, **не выполненная в основной FACTORY09**. Её запускать только непосредственно перед присутствующим владельцем, который сам завершит браузерный ввод нового личного пароля. Истёкший первый код, повтор bootstrap, прямые auth-записи, старые базы/аккаунты и dev-login не использовать. Каждой фактической повторной выдаче нужен **новый отсутствующий** файл в ACL-защищённом `secrets` этой среды; повтор того же файла до expiry диагностичен (`ALREADY_REISSUED`, exit 3), после expiry тот же код не продлевается.

Перед запуском: `pwsh -NoProfile -File docs/factory-09-ui/runtime.ps1 -Action Status`, затем read-only проверка `current_database=zavod_factory09_ui01`, `server_address=127.0.0.1`, `server_port=15439`, одна bootstrap factory/user/UFA и отсутствие уже завершённого первого пароля. Если identity изменилась — остановиться, не подставлять новый target вслепую. `backend/dist/cli/reissue-first-admin-recovery.js` уже проверен на новой изолированной SQL-базе; он сам повторяет identity/provenance/expiry/row-count/CAS проверку под advisory lock.

Команда для PowerShell из корня `work` в присутствии владельца (не сохранять её вывод вместе с временным кодом):

```powershell
$factory09Runtime = 'C:\Users\79164\AppData\Local\Zavod-Factory09\run-20260928-ui01'
$factory09RecoveryFile = Join-Path $factory09Runtime 'secrets/admin-recovery-reissue-20260928-01.txt'
if (Test-Path -LiteralPath $factory09RecoveryFile) { throw 'Выберите новое отсутствующее имя файла кода' }
$factory09DbPassword = [IO.File]::ReadAllText((Join-Path $factory09Runtime 'secrets/db-password.txt')).Trim()
$env:DATABASE_URL = 'postgresql://factory09_owner:' + [Uri]::EscapeDataString($factory09DbPassword) + '@127.0.0.1:15439/zavod_factory09_ui01?schema=public'
try {
  node backend/dist/cli/reissue-first-admin-recovery.js --database-name zavod_factory09_ui01 --server-address 127.0.0.1 --server-port 15439 --factory-code factory09-bootstrap --admin-phone +79990009000 --credential-file $factory09RecoveryFile
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
```

Ожидаемый результат: `FIRST_ADMIN_RECOVERY=REISSUED`, `CHANGED=YES`, masked phone и срок. **Не выводить содержимое файла в чат, терминал, скриншот или ZIP.** Владелец открывает уже работающий [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/), сам вводит содержимое защищённого файла как временный код, затем лично вводит/подтверждает свой новый пароль на штатной форме и делает отдельный обычный вход. После этого read-only проверить `passwordResetRequired=false`, consumed credential, обычный session/factory scope и только затем создавать завод №9 через UI. Если owner не присутствует, код не выпускать.
