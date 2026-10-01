param([Parameter(Mandatory=$true)][ValidateSet('Clean','C1','Stop')][string]$Target)
$ErrorActionPreference='Stop'
$admin02Runtime='C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$admin02Root='C:\Users\79164\Documents\work'
$pg=@(Get-NetTCPConnection -State Listen -LocalPort 15436)
if($pg.Count -ne 1 -or $pg[0].LocalAddress -ne '127.0.0.1'){throw 'Own PostgreSQL loopback identity mismatch'}
$pgProc=Get-CimInstance Win32_Process -Filter "ProcessId=$($pg[0].OwningProcess)"
if($pgProc.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $pgProc.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'Own pgdata identity mismatch'}
$before=$null
$back=@(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
if($back.Count){
 if($back.Count -ne 1 -or $back[0].LocalAddress -ne '127.0.0.1'){throw 'Backend loopback identity mismatch'}
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($back[0].OwningProcess)"
 $version=(Invoke-RestMethod 'http://127.0.0.1:3000/version').version
 if($proc.ExecutablePath -cne 'C:\Program Files\nodejs\node.exe' -or $proc.CommandLine.Trim() -cne '"C:\Program Files\nodejs\node.exe" backend/dist/main.js' -or $version -notin @('LOCAL03-20260924-C1','ADMIN02-20260926-CLEAN')){throw 'Own backend identity mismatch'}
 $before=[pscustomobject]@{pid=$proc.ProcessId;createdUtc=$proc.CreationDate.ToUniversalTime().ToString('o');version=$version;command=$proc.CommandLine}
 Stop-Process -Id $proc.ProcessId
 Wait-Process -Id $proc.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
}
if(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue){throw 'Backend still listening'}
$after=$null
if($Target -ne 'Stop'){
 $db=if($Target -eq 'Clean'){'zavod_local02_admin02_clean'}else{'zavod_local01_c0'}
 $uploads=if($Target -eq 'Clean'){Join-Path $admin02Runtime 'admin02/uploads'}else{Join-Path $admin02Runtime 'uploads'}
 $appVersion=if($Target -eq 'Clean'){'ADMIN02-20260926-CLEAN'}else{'LOCAL03-20260924-C1'}
 if(-not (Test-Path -LiteralPath $uploads -PathType Container)){throw 'Own uploads absent'}
 $secret=[IO.File]::ReadAllText((Join-Path $admin02Runtime 'secrets/db-password.txt')).Trim()
 $env:DATABASE_URL='postgresql://local01_owner:'+ [Uri]::EscapeDataString($secret)+'@127.0.0.1:15436/'+$db+'?schema=public'
 $env:JWT_SECRET=[IO.File]::ReadAllText((Join-Path $admin02Runtime 'secrets/jwt-secret.txt')).Trim()
 $env:FILE_STORAGE_ROOT=$uploads;$env:NODE_ENV='production';$env:HOST='127.0.0.1';$env:PORT='3000';$env:APP_VERSION=$appVersion
 $env:REGISTRATION_FACTORY_CODE=if($Target -eq 'Clean'){'admin01-final-c0'}else{'local01-a'}
 $env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173';$env:DISABLE_DB='false';$env:DEV_MODE='false';$env:ALLOW_TEST_AUTH_HEADERS='false'
 Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW -ErrorAction SilentlyContinue
 $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
 $new=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'backend/dist/main.js' -WorkingDirectory $admin02Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $admin02Runtime "logs/admin02-$stamp.stdout.log") -RedirectStandardError (Join-Path $admin02Runtime "logs/admin02-$stamp.stderr.log")
 Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:FILE_STORAGE_ROOT -ErrorAction SilentlyContinue
 $ready=$false
 for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;try{$ready=(Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready}catch{};if($ready){break}}
 $observed=Get-NetTCPConnection -State Listen -LocalPort 3000
 if(-not $ready -or $observed.OwningProcess -ne $new.Id -or $observed.LocalAddress -ne '127.0.0.1' -or (Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne $appVersion){throw 'Own backend readiness mismatch'}
 $after=[pscustomobject]@{pid=$new.Id;database=$db;version=$appVersion;ready=$true}
}
$receipt=[pscustomobject]@{atUtc=[DateTime]::UtcNow.ToString('o');pgPid=$pgProc.ProcessId;before=$before;after=$after}
$receipt|ConvertTo-Json -Depth 5|Out-File -LiteralPath (Join-Path $PSScriptRoot ('backend-switch-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')+'.json')) -Encoding utf8
$receipt
