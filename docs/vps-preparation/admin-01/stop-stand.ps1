$ErrorActionPreference = 'Stop'
$local03Runtime = 'C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03Root = 'C:\Users\79164\Documents\work'
$local03PgData = Join-Path $local03Runtime 'pgdata'

function Read-OwnListener([int]$Port) {
  $rows = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Where-Object LocalAddress -eq '127.0.0.1')
  if ($rows.Count -ne 1) { throw "Expected exactly one loopback listener at $Port" }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($rows[0].OwningProcess)"
  return [pscustomobject]@{ Port = $Port; PID = $proc.ProcessId; Started = $proc.CreationDate; Executable = $proc.ExecutablePath; Command = $proc.CommandLine }
}

$pg = Read-OwnListener 15436
$back = Read-OwnListener 3000
$front = Read-OwnListener 5173
if ($pg.Executable -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $pg.Command -notlike '*run-20260924-0b9b24e0/pgdata*' -or (Resolve-Path -LiteralPath $local03PgData).Path -cne $local03PgData) { throw 'Own PostgreSQL identity mismatch' }
if ($back.Executable -cne 'C:\Program Files\nodejs\node.exe' -or $back.Command.Trim() -cne '"C:\Program Files\nodejs\node.exe" backend/dist/main.js' -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne 'LOCAL03-20260924-C1') { throw 'Own C1 backend identity mismatch' }
if ($front.Executable -cne 'C:\Program Files\nodejs\node.exe' -or $front.Command.Trim() -cne '"C:\Program Files\nodejs\node.exe" docs/vps-preparation/local-03/frontend-preview.cjs') { throw 'Own frontend identity mismatch' }

& (Join-Path $local03Root 'docs/vps-preparation/admin-01/switch-backend.ps1') -Target Stop | Out-Null
$frontNow = Read-OwnListener 5173
if ($frontNow.PID -ne $front.PID -or $frontNow.Started -ne $front.Started -or $frontNow.Command -cne $front.Command) { throw 'Frontend identity changed before stop' }
Stop-Process -Id $frontNow.PID
Wait-Process -Id $frontNow.PID -Timeout 15 -ErrorAction SilentlyContinue
$pgNow = Read-OwnListener 15436
if ($pgNow.PID -ne $pg.PID -or $pgNow.Started -ne $pg.Started -or $pgNow.Command -cne $pg.Command) { throw 'PostgreSQL identity changed before stop' }
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' stop -D $local03PgData -m fast -w -t 25
if ($LASTEXITCODE -ne 0) { throw 'Own PostgreSQL did not stop cleanly' }
foreach ($port in 15436, 3000, 5173) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port still listening" }
}
'ADMIN01_OWN_C1_STAND_STOPPED_NO_DATA_DELETION'
