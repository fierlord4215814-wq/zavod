# SERVICE06 — диагностика отказа запуска, 30.09.2026

Статус: `POLICY_LEVEL=NOT_IDENTIFIED`, `BACKEND_START=BLOCKED_BEFORE_EXECUTION`, `LIVE_06=NOT_RUN`. Это дополнение к [отчёту 06](report.md), не новый source-review и не замена уже выполненным 19/19 isolated и disposable SQL проверкам.

## Наблюдение, а не предполагаемая причина

- Сохранённый вызов: `functions.exec` → `tools.exec_command`, `workdir=C:\Users\79164\Documents\work`, `yield_time_ms=10000`. Для shell инструмент выбрал `C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe -Command <PowerShell script>`. Запись сеанса `01a0ca8b-37d5-7d71-a7df-5227959bbfa5`, turn `01a0efb0-3d61-77b2-9678-f99cfa920478`, `2026-09-30T00:27:09.167Z`, transcript lines 47816 (вызов) и 47818 (ответ). Transcript целиком не экспортировался.
- Скрипт проверял `localhost:5432/mes`, `work/uploads`, длину существующего JWT и свободный порт 3000; передавал `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, `CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173`, `DISABLE_DB=false`, `DEV_MODE=false`, `ALLOW_TEST_AUTH_HEADERS=false`; затем вызывал `Start-Process` для существующего `backend/dist/main.js` с hidden window и перенаправлением вывода в защищённые локальные логи. Значения `DATABASE_URL`, `JWT_SECRET` и файлов конфигурации здесь не сохранены. До `Start-Process` команда не дошла.

Исходный вызов инструмента из сохранённого transcript (секретные значения в нём отсутствуют):

~~~javascript
const cmd=`$ErrorActionPreference='Stop'
$repo='C:\\Users\\79164\\Documents\\work'
$secrets='C:\\Users\\79164\\AppData\\Local\\Zavod-MES4\\runtime-20260928-direct01\\secrets'
$logs='C:\\Users\\79164\\AppData\\Local\\Zavod-MES4\\runtime-20260928-direct01\\logs'
$map=@{}
foreach($line in [IO.File]::ReadAllLines((Join-Path $secrets 'backend.env.protected'))){if($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$'){$map[$Matches[1]]=$Matches[2].Trim().Trim('"').Trim("'")}}
$uri=[uri]$map['DATABASE_URL']
if($uri.Host -ne 'localhost' -or $uri.Port -ne 5432 -or $uri.AbsolutePath -ne '/mes'){throw 'Unexpected DB target'}
if([IO.Path]::GetFullPath($map['FILE_STORAGE_ROOT']).TrimEnd('\\') -ine (Join-Path $repo 'uploads')){throw 'Unexpected uploads root'}
$jwt=[IO.File]::ReadAllText((Join-Path $secrets 'jwt-secret.txt')).Trim()
if($jwt.Length -lt 32){throw 'JWT secret too short'}
if((Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)){throw 'Port 3000 already occupied'}
$env:DATABASE_URL=$map['DATABASE_URL']
$env:FILE_STORAGE_ROOT=$map['FILE_STORAGE_ROOT']
$env:JWT_SECRET=$jwt
$env:NODE_ENV='production'
$env:HOST='127.0.0.1'
$env:PORT='3000'
$env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173'
$env:DISABLE_DB='false'
$env:DEV_MODE='false'
$env:ALLOW_TEST_AUTH_HEADERS='false'
$stdout=Join-Path $logs 'service06-resume-backend.stdout.log'
$stderr=Join-Path $logs 'service06-resume-backend.stderr.log'
$process=Start-Process -FilePath (Get-Command node).Source -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $repo 'backend') -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
"BACKEND_PID=$($process.Id)"
"CONFIG=production;DB=localhost:5432/mes;HOST=127.0.0.1;PORT=3000;CORS=http://127.0.0.1:5173;JWT_LENGTH=$($jwt.Length);UPLOADS_ROOT=work/uploads;TEST_AUTH=false"
`;
const r=await tools.exec_command({cmd,workdir:"C:\\Users\\79164\\Documents\\work",yield_time_ms:10000,max_output_tokens:1500});text(r)
~~~

- Полный **полученный инструментом** ответ приведён ниже без значений секретов. Средняя часть возвращённой строки **уже была усечена самим инструментом** маркером `…1694 chars truncated…`; получить неусечённую внутреннюю причину из этого ответа нельзя. Длина текста ошибки 936 символов, SHA-256 UTF-8 `07C232B58719A9782AE1C0C00493F71D8A6A6946C7BB335A8D6C1745F0960C79`. В ответе нет ID правила, категории policy, Windows-кода отказа или доступного решения approval. Это не ошибка Node/CORS/PostgreSQL: дочерний процесс не был создан.

```text
Script failed
Wall time 0.0 seconds
Output:
Script error:
exec_command failed: CreateProcess { message: "Rejected(\"`\\\"C:\\\\\\\\Users\\\\\\\\79164\\\\\\\\.cache\\\\\\\\codex-runtimes\\\\\\\\codex-primary-runtime\\\\\\\\dependencies\\\\\\\\native\\\\\\\\powershell\\\\\\\\pwsh.exe\\\" -Command '$ErrorActionPreference='\\\"'Stop'\\n\\\"'$repo='\\\"'C:\\\\\\\\Users\\\\\\\\79164\\\\\\\\Documents\\\\\\\\work'\\n\\\"'$secrets='\\\"'C:\\\\\\\\Users\\\\\\\\79164\\\\\\\\AppData\\\\\\\\Local\\\\\\\\Zavod-MES4\\…1694 chars truncated…and node).Source -ArgumentList '\\\"'dist/main.js' -WorkingDirectory (Join-Path \\\"'$repo '\\\"'backend') -PassThru -WindowStyle Hidden -RedirectStandardOutput \\\"'$stdout -RedirectStandardError $stderr\\n\\\"BACKEND_PID=$($process.Id)\\\"\\n\\\"CONFIG=production;DB=localhost:5432/mes;HOST=127.0.0.1;PORT=3000;CORS=http://127.0.0.1:5173;JWT_LENGTH=$($jwt.Length);UPLOADS_ROOT=work/uploads;TEST_AUTH=false\\\"\\n'` rejected: blocked by policy\")" }
```

- Дерево текущего read-only shell: bundled `codex.exe` PID 6156 (родитель — приложение `ChatGPT.exe` PID 12228) → `pwsh.exe`. Тот же исполняемый `codex.exe` отвечает `codex-cli 0.158.0-alpha.2.1`; shell — PowerShell 7.6.5. Отдельно инструмент обновления приложения сообщает `installedVersion=26.924.51851`, `status=restart_required`; путь запущенного app-пакета содержит `OpenAI.Codex_26.924.6891.0`. Это разные метки, ни одну не подменяем версией другого компонента. Перезапуск приложения не выполнялся и не объявляется исправлением.
- Эффективные параметры **этого сеанса**, сообщённые исполнителю: `sandbox_mode=danger-full-access`, `approval_policy=never`; для `exec_command` запрещено передавать `sandbox_permissions`, поэтому штатный интерактивный approval на этот вызов здесь недоступен. Это не вывод из пользовательского `config.toml`. Системный `%ProgramData%\OpenAI\Codex\requirements.toml` и локальный `~/.codex/managed_config.toml` отсутствуют; cloud/managed policy этим не исключена. Пользовательский `~/.codex/rules/default.rules` существует; `codex execpolicy check --rules <этот файл>` на токенах исходной команды `pwsh.exe -Command <тот же скрипт>` вернул `{ "matchedRules": [] }`. Проверка охватывает только указанный файл, не все возможные уровни защиты и не разрешает запуск.
- Свежий read-only портовый срез: 3000, 5173 и 15445 не слушают; PostgreSQL 5432 слушает с PID 5316. `/ready`, `/version`, login и UI сейчас не проверялись. Три общих чата по последней read-only DB identity не созданы; новая DB-запись в ходе этой диагностики не выполнялась.

## Поддерживаемое действие владельца

Причину `blocked by policy` локально **не удалось идентифицировать**. Не включать «полный доступ» и не повторять этот запуск через другой shell, скрипт, UI или агента. Одно действие: в текущем чате открыть команду `/` → **Feedback**, приложить этот сеанс и указать support сведения выше (включая session/turn ID и SHA-256 ответа), запросив точный уровень/правило отказа и поддерживаемый способ одобрить именно исходный `exec_command`. Перед отправкой любых дополнительных логов вручную проверить отсутствие секретов. Обращение не отправлено автоматически.

После ответа поддержки или документированного изменения разрешения владельцем: сначала заново сверить identity `mes`, портов, protected config и резервной пары, затем только штатно запустить существующие backend/frontend, подтвердить `/ready` и обычный вход, пройти оставшиеся live-гейты 06 по [actor/factory/action](actor-factory-action.md). Старые №4/№9, 22 профиля, профиль Андрея, три UFA №9 и 57 миграций не пересоздавать. `T1_TOUCHED=NO`; `PILOT_READY=NOT_DECLARED`.
