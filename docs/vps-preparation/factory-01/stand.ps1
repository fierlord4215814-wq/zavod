param([ValidateSet('Start','Stop','Switch','Quiesce')][string]$Action='Start',[ValidateSet('T1','Restore','Handover','HandoverRestore','TaskNotify','Notify02','AttAuth01','Ops01')][string]$Target='T1',[string]$TestNow='',[ValidateSet('','before-publication','ws','push')][string]$NotificationFault='')
$ErrorActionPreference='Stop'
if($NotificationFault -and $Target -notin @('TaskNotify','Notify02')){throw 'Transport faults are restricted to the isolated notification copies'}
if($TestNow -and $Target -ne 'Handover'){throw 'Test clock is restricted to the isolated Handover copy'}
if($TestNow){$null=[DateTimeOffset]::Parse($TestNow)}
$factory01Runtime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$factory01Root='C:\Users\79164\Documents\work'
$pgData=Join-Path $factory01Runtime 'pgdata'
$pgCtl='C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
$node='C:\Program Files\nodejs\node.exe'
$preview='"C:\Program Files\nodejs\node.exe" docs/vps-preparation/local-03/frontend-preview.cjs'
$database=@{T1='zavod_factory01_t1';Restore='zavod_factory01_restore';Handover='zavod_factory01_handover';HandoverRestore='zavod_factory01_handover_restore';TaskNotify='zavod_factory01_task_notify';Notify02='zavod_factory01_notify02';AttAuth01='zavod_factory01_attauth01';Ops01='zavod_factory01_ops01'}[$Target]
$version='FACTORY01-20260926-'+$Target.ToUpperInvariant()
$uploads=if($Target -eq 'T1'){Join-Path $factory01Runtime 'uploads'}else{Join-Path $factory01Runtime ($Target.ToLowerInvariant()+'/uploads')}
function Observe([int]$port){
 $l=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
 if(!$l.Count){return $null};if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1'){throw "Loopback identity mismatch:$port"}
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($l[0].OwningProcess)"
 if($port -eq 15437){if($p.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $p.CommandLine -notlike '*Zavod-Factory01/run-20260926-t1/pgdata*'){throw 'Own PG identity mismatch'}}
 elseif($p.ExecutablePath -cne $node){throw 'Node identity mismatch'}
 elseif($port -eq 3000){if($p.CommandLine.Trim() -cne ('"'+$node+'" backend/dist/main.js') -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -notlike 'FACTORY01-20260926-*'){throw 'Own backend mismatch'}}
 elseif($p.CommandLine.Trim() -cne $preview){throw 'Own preview mismatch'}
 return [pscustomobject]@{port=$port;pid=$p.ProcessId;createdUtc=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}
}
$before=@();foreach($port in 3000,5173,15437){$r=Observe $port;if($r){$before+=$r}}
if($Action -in @('Stop','Switch','Quiesce')){
 foreach($port in $(if($Action -eq 'Stop'){@(3000,5173,15437)}elseif($Action -eq 'Quiesce'){@(3000,5173)}else{@(3000)})){
  $r=Observe $port;if(!$r){continue};$again=Observe $port;if($r.pid -ne $again.pid -or $r.createdUtc -cne $again.createdUtc){throw 'Identity changed before stop'}
  if($port -eq 15437){& $pgCtl stop -D $pgData -m fast -w -t 25;if($LASTEXITCODE -ne 0){throw 'Own PG stop failed'}}else{Stop-Process -Id $r.pid;Wait-Process -Id $r.pid -Timeout 15 -ErrorAction SilentlyContinue}
 }
}
if($Action -notin @('Stop','Quiesce')){
 if(!(Test-Path -LiteralPath $uploads -PathType Container)){throw 'Own uploads absent'}
 if(!(Observe 15437)){& $pgCtl start -D $pgData -l (Join-Path $factory01Runtime 'logs/postgresql.log') -o '-h 127.0.0.1 -p 15437' -w -t 25;if($LASTEXITCODE -ne 0){throw 'Own PG start failed'}}
 $back=Observe 3000
 if($back){if((Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne $version){throw 'Other FACTORY01 target active; use explicit Switch'}}else{
  $password=[IO.File]::ReadAllText((Join-Path $factory01Runtime 'secrets/db-password.txt')).Trim()
  $env:DATABASE_URL='postgresql://factory01_owner:'+ [Uri]::EscapeDataString($password)+'@127.0.0.1:15437/'+$database+'?schema=public'
  $env:JWT_SECRET=[IO.File]::ReadAllText((Join-Path $factory01Runtime 'secrets/jwt-secret.txt')).Trim()
  $env:FILE_STORAGE_ROOT=$uploads;$env:NODE_ENV='production';$env:HOST='127.0.0.1';$env:PORT='3000';$env:APP_VERSION=$version;$env:REGISTRATION_FACTORY_CODE='test-factory-t1'
  $env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173';$env:DISABLE_DB='false';$env:DEV_MODE='false';$env:ALLOW_TEST_AUTH_HEADERS='false'
  Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW -ErrorAction SilentlyContinue
  Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_OPTIONS,Env:TASK_NOTIFY_FAULT,Env:NOTIFY02_FAULT -ErrorAction SilentlyContinue
  Remove-Item Env:ERROR_REPORTS_EXPORT_PATH -ErrorAction SilentlyContinue
  if($Target -eq 'Ops01'){$env:ERROR_REPORTS_EXPORT_PATH=Join-Path $factory01Runtime 'ops01/error-reports-export'}
  if($NotificationFault){if($Target -eq 'Notify02'){$env:NOTIFY02_FAULT=$NotificationFault;$env:NODE_OPTIONS='--require=./docs/vps-preparation/notify-02/transport-fault.cjs'}else{$env:TASK_NOTIFY_FAULT=$NotificationFault;$env:NODE_OPTIONS='--require=./docs/vps-preparation/task-notify-01/transport-fault.cjs'}}
  if($TestNow){$env:NODE_ENV='test';$env:ZAVOD_INTERNAL_TEST_NOW=$TestNow}
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
  $started=Start-Process -FilePath $node -ArgumentList 'backend/dist/main.js' -WorkingDirectory $factory01Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $factory01Runtime "logs/backend-$stamp.stdout.log") -RedirectStandardError (Join-Path $factory01Runtime "logs/backend-$stamp.stderr.log")
  Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:FILE_STORAGE_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:ERROR_REPORTS_EXPORT_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_OPTIONS,Env:TASK_NOTIFY_FAULT,Env:NOTIFY02_FAULT -ErrorAction SilentlyContinue
  $ready=$false;for($i=0;$i -lt 60;$i++){Start-Sleep -Milliseconds 250;try{$ready=(Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready}catch{};if($ready){break}}
  if(!$ready -or (Observe 3000).pid -ne $started.Id){throw 'Own backend not ready'}
 }
 if(!(Observe 5173)){
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
  Start-Process -FilePath $node -ArgumentList 'docs/vps-preparation/local-03/frontend-preview.cjs' -WorkingDirectory $factory01Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $factory01Runtime "logs/frontend-$stamp.stdout.log") -RedirectStandardError (Join-Path $factory01Runtime "logs/frontend-$stamp.stderr.log")
  for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;if(Observe 5173){break}}
  if(!(Observe 5173)){throw 'Own frontend failed'}
 }
}
$after=@();foreach($port in 3000,5173,15437){$r=Observe $port;if($r){$after+=$r}}
$receipt=[pscustomobject]@{atUtc=[DateTime]::UtcNow.ToString('o');action=$Action;target=$Target;before=$before;after=$after}
$receipt | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $PSScriptRoot ('runtime-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')+'.json')) -Encoding utf8
$receipt | ConvertTo-Json -Depth 5
