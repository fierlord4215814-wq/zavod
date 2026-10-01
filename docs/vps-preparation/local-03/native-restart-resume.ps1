$ErrorActionPreference='Stop'
$local03Root='C:\Users\79164\Documents\work'
$local03Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03ReceiptPath=Join-Path $PSScriptRoot 'native-restart-20260926-112729-938.json'
$local03Receipt=Get-Content -LiteralPath $local03ReceiptPath -Raw | ConvertFrom-Json
if($local03Receipt.status -ne 'IN_PROGRESS' -or $local03Receipt.before.Count -ne 3){throw 'Unexpected restart receipt'}
$local03Pg=Get-NetTCPConnection -State Listen -LocalPort 15436
$local03PgProc=Get-CimInstance Win32_Process -Filter "ProcessId=$($local03Pg.OwningProcess)"
if($local03Pg.LocalAddress -ne '127.0.0.1' -or $local03PgProc.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $local03PgProc.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*' -or $local03PgProc.ProcessId -eq $local03Receipt.before[0].pid){throw 'New own PG identity not proven'}
foreach($p in 3000,5173){if(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue){throw "Port $p unexpectedly occupied"}}
& (Join-Path $local03Root 'docs/vps-preparation/local-03/switch-backend.ps1') -Target C1 | Out-Null
$local03Stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$local03Front=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'docs/vps-preparation/local-03/frontend-preview.cjs' -WorkingDirectory $local03Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $local03Runtime "logs/local03-native-front-$local03Stamp.stdout.log") -RedirectStandardError (Join-Path $local03Runtime "logs/local03-native-front-$local03Stamp.stderr.log")
$local03Ok=$false
for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;try{$local03Ok=(Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing).StatusCode -eq 200}catch{};if($local03Ok){break}}
if(-not $local03Ok){throw 'Frontend not ready after own restart'}
$after=@(foreach($p in 15436,3000,5173){$tcp=Get-NetTCPConnection -State Listen -LocalPort $p;$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($tcp.OwningProcess)";[pscustomobject]@{port=$p;pid=$proc.ProcessId;createdUtc=$proc.CreationDate.ToUniversalTime().ToString('o');executable=$proc.ExecutablePath;command=$proc.CommandLine}})
for($i=0;$i -lt 3;$i++){if($after[$i].pid -eq $local03Receipt.before[$i].pid -or [DateTime]$after[$i].createdUtc -le [DateTime]$local03Receipt.before[$i].createdUtc){throw 'Listener identity did not change'}}
if($after[1].command -cne $local03Receipt.before[1].command -or $after[2].command -cne $local03Receipt.before[2].command -or $after[2].pid -ne $local03Front.Id -or (Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready -ne $true -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne 'LOCAL03-20260924-C1'){throw 'Restarted own stack mismatch'}
$local03Receipt.after=$after
$local03Receipt.status='PASS_THREE_NEW_OWN_LISTENERS_READY'
$local03Receipt | Add-Member -NotePropertyName anomaly -NotePropertyValue 'Initial pg_ctl start left controller waiting on inherited output after PG launched; exact own controller17428 stopped, PG retained; backend/frontend started separately and verified.'
$local03Receipt | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $local03ReceiptPath -Encoding utf8
$local03Receipt
