$ErrorActionPreference='Stop'
$local03Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03Root='C:\Users\79164\Documents\work'
function Read-OwnListener([int]$Port){$rows=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Where-Object LocalAddress -eq '127.0.0.1');if($rows.Count -ne 1){throw "Expected one loopback listener at $Port"};$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($rows[0].OwningProcess)";return [pscustomobject]@{port=$Port;pid=$proc.ProcessId;createdUtc=$proc.CreationDate.ToUniversalTime().ToString('o');executable=$proc.ExecutablePath;command=$proc.CommandLine}}
$local03Before=@(Read-OwnListener 15436;Read-OwnListener 3000;Read-OwnListener 5173)
$local03Pg=$local03Before[0];$local03Back=$local03Before[1];$local03Front=$local03Before[2]
if($local03Pg.executable -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $local03Pg.command -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'Own PG identity mismatch'}
if($local03Back.executable -cne 'C:\Program Files\nodejs\node.exe' -or $local03Back.command -cne '"C:\Program Files\nodejs\node.exe" backend/dist/main.js' -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne 'LOCAL03-20260924-C1'){throw 'Own C1 backend identity mismatch'}
if($local03Front.executable -cne 'C:\Program Files\nodejs\node.exe' -or $local03Front.command -cne '"C:\Program Files\nodejs\node.exe" docs/vps-preparation/local-03/frontend-preview.cjs'){throw 'Own frontend identity mismatch'}
$local03PgData=Join-Path $local03Runtime 'pgdata'
if((Resolve-Path -LiteralPath $local03PgData).Path -cne $local03PgData -or [IO.File]::ReadAllText((Join-Path $local03PgData 'PG_VERSION')).Trim() -ne '18'){throw 'Own pgdata mismatch'}
$local03Stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$local03Receipt=[pscustomobject]@{atUtc=[DateTime]::UtcNow.ToString('o');before=$local03Before;after=$null;status='IN_PROGRESS'}
$local03Path=Join-Path $PSScriptRoot "native-restart-$local03Stamp.json"
$local03Receipt | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $local03Path -Encoding utf8
Stop-Process -Id $local03Back.pid
Wait-Process -Id $local03Back.pid -Timeout 15 -ErrorAction SilentlyContinue
Stop-Process -Id $local03Front.pid
Wait-Process -Id $local03Front.pid -Timeout 15 -ErrorAction SilentlyContinue
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' stop -D $local03PgData -m fast -w -t 25
if($LASTEXITCODE -ne 0){throw 'Own PostgreSQL orderly stop failed'}
foreach($p in 15436,3000,5173){if(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue){throw "Port $p still listening after own stop"}}
& (Join-Path $local03Root 'docs/vps-preparation/local-03/start-stand.ps1')
for($i=0;$i -lt 30;$i++){try{$local03FrontOk=(Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing).StatusCode -eq 200}catch{$local03FrontOk=$false};if($local03FrontOk){break};Start-Sleep -Milliseconds 250}
if(-not $local03FrontOk -or (Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready -ne $true){throw 'Restarted own stack not ready'}
$local03After=@(Read-OwnListener 15436;Read-OwnListener 3000;Read-OwnListener 5173)
for($i=0;$i -lt 3;$i++){if($local03After[$i].pid -eq $local03Before[$i].pid -or [DateTime]$local03After[$i].createdUtc -le [DateTime]$local03Before[$i].createdUtc){throw 'Listener identity did not change after native restart'}}
if($local03After[0].command -notlike '*run-20260924-0b9b24e0/pgdata*' -or $local03After[1].command -cne $local03Back.command -or $local03After[2].command -cne $local03Front.command){throw 'Restart target mismatch'}
$local03Receipt.after=$local03After;$local03Receipt.status='PASS_NATIVE_OWN_THREE_PROCESS_RESTART'
$local03Receipt | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $local03Path -Encoding utf8
$local03Receipt
