# Manual operator action only. Never stop a PID based on a historical number alone.
$ErrorActionPreference = 'Stop'
$receipt = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'processes.json') -Raw | ConvertFrom-Json
$pgdata = 'C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0\pgdata'
# Validate every identity first; abort without stopping anything on any mismatch.
foreach ($row in $receipt.processes) {
  $item = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)"
  $listener = Get-NetTCPConnection -State Listen -LocalPort $row.port
  if (!$item -or $item.CreationDate.ToUniversalTime().ToString('o') -ne $row.createdUtc -or $item.CommandLine -cne $row.commandLine -or $item.ExecutablePath -cne $row.executable -or $listener.OwningProcess -ne $row.pid -or $listener.LocalAddress -ne '127.0.0.1') { throw "Identity changed on $($row.port); inspect, do not stop blindly." }
  if ($row.port -eq 15436 -and $item.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*') { throw 'Own pgdata mismatch' }
}
foreach ($port in 5173,3000) { $row = $receipt.processes | Where-Object port -eq $port; Stop-Process -Id $row.pid }
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $pgdata stop -m fast
if ($LASTEXITCODE -ne 0) { throw 'Own PostgreSQL did not report a normal stop; inspect its log.' }
Write-Output 'Own LOCAL01/LOCAL02 processes stopped; all data, uploads and evidence retained.'
