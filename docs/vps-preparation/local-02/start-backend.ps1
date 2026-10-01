param([ValidateSet('LOCAL02-20260924-C1','LOCAL03-20260924-C1')][string]$AppVersion = 'LOCAL02-20260924-C1')
$ErrorActionPreference = 'Stop'
$local02Runtime = 'C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local02Root = 'C:\Users\79164\Documents\work'
if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { throw 'Port 3000 already occupied; inspect identity first.' }
$pg = Get-NetTCPConnection -State Listen -LocalPort 15436
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($pg.OwningProcess)"
if ($pg.LocalAddress -ne '127.0.0.1' -or $process.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*') { throw 'Own PostgreSQL identity mismatch' }
$dbSecret = [IO.File]::ReadAllText((Join-Path $local02Runtime 'secrets/db-password.txt')).Trim()
$env:DATABASE_URL = 'postgresql://local01_owner:' + [Uri]::EscapeDataString($dbSecret) + '@127.0.0.1:15436/zavod_local01_c0?schema=public'
$env:JWT_SECRET = [IO.File]::ReadAllText((Join-Path $local02Runtime 'secrets/jwt-secret.txt')).Trim()
$env:FILE_STORAGE_ROOT = Join-Path $local02Runtime 'uploads'
$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:APP_VERSION = $AppVersion
$env:REGISTRATION_FACTORY_CODE = 'local01-a'
$env:CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
$env:DISABLE_DB = 'false'
$env:DEV_MODE = 'false'
$env:ALLOW_TEST_AUTH_HEADERS = 'false'
Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW -ErrorAction SilentlyContinue
$logPrefix = if ($AppVersion.StartsWith('LOCAL03')) { 'local03-backend' } else { 'local02-backend' }
$logPrefix += '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$local02Backend = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'backend/dist/main.js' -WorkingDirectory $local02Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $local02Runtime "logs/$logPrefix.stdout.log") -RedirectStandardError (Join-Path $local02Runtime "logs/$logPrefix.stderr.log")
Write-Output "OWN_BACKEND_PID=$($local02Backend.Id) LOOPBACK=3000"
