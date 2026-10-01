$ErrorActionPreference='Stop'
$local03Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03Root='C:\Users\79164\Documents\work'
$local03Data=Join-Path $local03Runtime 'pgdata'
if((Resolve-Path -LiteralPath $local03Data).Path -cne $local03Data){throw 'Own cluster path mismatch'}
if([IO.File]::ReadAllText((Join-Path $local03Data 'PG_VERSION')).Trim() -ne '18'){throw 'Own cluster version mismatch'}
foreach($local03Port in @(15436,3000,5173)){if(Get-NetTCPConnection -State Listen -LocalPort $local03Port -ErrorAction SilentlyContinue){throw "Port $local03Port already occupied; inspect instead of replacing"}}
$local03Timestamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' start -D $local03Data -l (Join-Path $local03Runtime "logs/local03-pg-$local03Timestamp.log") -o '-h 127.0.0.1 -p 15436' -w -t 25
if($LASTEXITCODE -ne 0){throw 'Own PostgreSQL start failed'}
& (Join-Path $local03Root 'docs/vps-preparation/local-02/start-backend.ps1') -AppVersion 'LOCAL03-20260924-C1'
$local03Ready=$false
for($local03Try=0;$local03Try -lt 30;$local03Try++){try{$local03Ready=(Invoke-RestMethod http://127.0.0.1:3000/ready).ready}catch{};if($local03Ready){break};Start-Sleep -Milliseconds 500}
if(-not $local03Ready){throw 'Own backend not ready; preserve logs and inspect, do not restart blindly'}
Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:FILE_STORAGE_ROOT -ErrorAction SilentlyContinue
$local03Front=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'docs/vps-preparation/local-03/frontend-preview.cjs' -WorkingDirectory $local03Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $local03Runtime "logs/local03-front-$local03Timestamp.stdout.log") -RedirectStandardError (Join-Path $local03Runtime "logs/local03-front-$local03Timestamp.stderr.log")
Write-Output "OWN_FRONTEND_PID=$($local03Front.Id) LOOPBACK=5173"
$local03Receipt=foreach($local03Port in @(15436,3000,5173)){Get-NetTCPConnection -State Listen -LocalPort $local03Port -ErrorAction SilentlyContinue | ForEach-Object {$local03Process=Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)";[pscustomobject]@{port=$local03Port;address=$_.LocalAddress;pid=$_.OwningProcess;createdUtc=$local03Process.CreationDate.ToUniversalTime().ToString('o');command=$local03Process.CommandLine}}}
$local03Receipt | ConvertTo-Json | Out-File -LiteralPath (Join-Path $PSScriptRoot "stand-start-$local03Timestamp.json") -Encoding utf8
