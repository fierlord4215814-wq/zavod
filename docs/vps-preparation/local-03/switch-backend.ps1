param([ValidateSet('Stop','C1','Restore','FinalC0')][string]$Target)
$ErrorActionPreference='Stop'
$local03Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$local03Root='C:\Users\79164\Documents\work'
$local03Pg=Get-NetTCPConnection -State Listen -LocalPort 15436
$local03PgProc=Get-CimInstance Win32_Process -Filter "ProcessId=$($local03Pg.OwningProcess)"
if($local03Pg.LocalAddress -ne '127.0.0.1' -or $local03PgProc.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $local03PgProc.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'Own PostgreSQL identity mismatch'}
$local03Targets=@{
 C1=@{db='zavod_local01_c0';uploads=(Join-Path $local03Runtime 'uploads');version='LOCAL03-20260924-C1';factory='local01-a'}
 Restore=@{db='zavod_local02_local03_restore';uploads=(Join-Path $local03Runtime 'local03-late-pair/uploads');version='LOCAL03-20260926-RESTORE';factory='local01-a'}
 FinalC0=@{db='zavod_local02_local03_final_c0';uploads=(Join-Path $local03Runtime 'local03-final-c0/uploads');version='LOCAL03-20260926-FINAL-C0';factory='local03-final-c0'}
}
$local03Listener=Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
$local03Before=$null
if($local03Listener){
 if(@($local03Listener).Count -ne 1){throw 'Ambiguous backend listener'}
 $local03Proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($local03Listener.OwningProcess)"
 $local03Version=(Invoke-RestMethod 'http://127.0.0.1:3000/version').version
 if($local03Listener.LocalAddress -ne '127.0.0.1' -or $local03Proc.ExecutablePath -cne 'C:\Program Files\nodejs\node.exe' -or $local03Proc.CommandLine -cne '"C:\Program Files\nodejs\node.exe" backend/dist/main.js' -or $local03Version -notin @('LOCAL03-20260924-C1','LOCAL03-20260926-RESTORE','LOCAL03-20260926-FINAL-C0')){throw 'Own backend identity mismatch'}
 $local03Before=[pscustomobject]@{pid=$local03Proc.ProcessId;startedUtc=$local03Proc.CreationDate.ToUniversalTime().ToString('o');executable=$local03Proc.ExecutablePath;command=$local03Proc.CommandLine;version=$local03Version}
}
$local03Stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$local03Receipt=[pscustomobject]@{atUtc=[DateTime]::UtcNow.ToString('o');target=$Target;pgPid=$local03PgProc.ProcessId;pgStartedUtc=$local03PgProc.CreationDate.ToUniversalTime().ToString('o');before=$local03Before;after=$null}
if($local03Before){Stop-Process -Id $local03Before.pid;Wait-Process -Id $local03Before.pid -Timeout 15 -ErrorAction SilentlyContinue}
if(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue){throw 'Backend did not release 3000'}
if($Target -ne 'Stop'){
 $local03Config=$local03Targets[$Target]
 if(-not (Test-Path -LiteralPath $local03Config.uploads -PathType Container)){throw 'Target uploads path absent'}
 $local03DbSecret=[IO.File]::ReadAllText((Join-Path $local03Runtime 'secrets/db-password.txt')).Trim()
 $env:DATABASE_URL='postgresql://local01_owner:'+[Uri]::EscapeDataString($local03DbSecret)+'@127.0.0.1:15436/'+$local03Config.db+'?schema=public'
 $env:JWT_SECRET=[IO.File]::ReadAllText((Join-Path $local03Runtime 'secrets/jwt-secret.txt')).Trim()
 $env:FILE_STORAGE_ROOT=$local03Config.uploads
 $env:NODE_ENV='production';$env:HOST='127.0.0.1';$env:PORT='3000';$env:APP_VERSION=$local03Config.version
 $env:REGISTRATION_FACTORY_CODE=$local03Config.factory;$env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173'
 $env:DISABLE_DB='false';$env:DEV_MODE='false';$env:ALLOW_TEST_AUTH_HEADERS='false'
 Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW -ErrorAction SilentlyContinue
 $local03Stdout=Join-Path $local03Runtime "logs/local03-$Target-$local03Stamp.stdout.log"
 $local03Stderr=Join-Path $local03Runtime "logs/local03-$Target-$local03Stamp.stderr.log"
 $local03New=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'backend/dist/main.js' -WorkingDirectory $local03Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $local03Stdout -RedirectStandardError $local03Stderr
 Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:FILE_STORAGE_ROOT -ErrorAction SilentlyContinue
 $local03Ready=$false
 for($local03Try=0;$local03Try -lt 40;$local03Try++){Start-Sleep -Milliseconds 250;try{$local03Ready=(Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready}catch{};if($local03Ready){break}}
 if(-not $local03Ready){throw 'New own backend not ready; preserve logs and inspect'}
 $local03Observed=Get-NetTCPConnection -State Listen -LocalPort 3000
 if($local03Observed.OwningProcess -ne $local03New.Id -or $local03Observed.LocalAddress -ne '127.0.0.1' -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne $local03Config.version){throw 'New backend identity/readiness mismatch'}
 $local03Receipt.after=[pscustomobject]@{pid=$local03New.Id;version=$local03Config.version;port=3000;db=$local03Config.db;uploads=$local03Config.uploads}
}
$local03Receipt | ConvertTo-Json -Depth 4 | Out-File -LiteralPath (Join-Path $PSScriptRoot "backend-switch-$local03Stamp.json") -Encoding utf8
$local03Receipt
