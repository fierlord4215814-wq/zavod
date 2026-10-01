$ErrorActionPreference='Stop'
$local03Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03Root='C:\Users\79164\Documents\work'
$pgListener=Get-NetTCPConnection -State Listen -LocalPort 15436
$pgProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($pgListener.OwningProcess)"
if($pgListener.LocalAddress -ne '127.0.0.1' -or $pgProcess.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'Own pgdata mismatch'}
$listener=Get-NetTCPConnection -State Listen -LocalPort 3000
$backend=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
$version=Invoke-RestMethod http://127.0.0.1:3000/version
if($listener.LocalAddress -ne '127.0.0.1' -or $backend.CommandLine -cne '"C:\Program Files\nodejs\node.exe" backend/dist/main.js' -or $version.version -notin @('LOCAL02-20260924-C1','LOCAL03-20260924-C1')){throw 'Own backend identity mismatch'}
$before=[pscustomobject]@{observedUtc=[DateTime]::UtcNow.ToString('o');pid=$backend.ProcessId;createdUtc=$backend.CreationDate.ToUniversalTime().ToString('o');commandLine=$backend.CommandLine;port=3000;version=$version.version;pgCommand=$pgProcess.CommandLine}
$before | ConvertTo-Json | Out-File -LiteralPath (Join-Path $PSScriptRoot ('restart-before-'+[DateTime]::UtcNow.ToString('HHmmss')+'.json')) -Encoding utf8
# Freshly discovered PID, not a number copied from a prior receipt.
Stop-Process -Id $backend.ProcessId
Wait-Process -Id $backend.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
& (Join-Path $local03Root 'docs/vps-preparation/local-02/start-backend.ps1') -AppVersion 'LOCAL03-20260924-C1'
