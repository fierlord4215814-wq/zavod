$ErrorActionPreference='Stop'
$factory01Runtime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$factory01Root='C:\Users\79164\Documents\work'
$pgBin='C:\Program Files\PostgreSQL\18\bin'
if(Test-Path -LiteralPath $factory01Runtime){throw 'Target exists: inspect, do not overwrite'}
if(Get-NetTCPConnection -State Listen -LocalPort 15437 -ErrorAction SilentlyContinue){throw 'Dedicated port15437 occupied'}
New-Item -ItemType Directory -Path $factory01Runtime | Out-Null
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $factory01Runtime '/inheritance:r' '/grant:r' ($identity+':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Protected ACL failed'}
& node.exe (Join-Path $PSScriptRoot 'prepare-secrets.cjs')
if($LASTEXITCODE -ne 0){throw 'Preparation failed'}
& (Join-Path $pgBin 'initdb.exe') '-D' (Join-Path $factory01Runtime 'pgdata') '--username=factory01_owner' '--auth-host=scram-sha-256' '--auth-local=scram-sha-256' '--encoding=UTF8' '--locale=C' ('--pwfile='+ (Join-Path $factory01Runtime 'secrets/db-password.txt'))
if($LASTEXITCODE -ne 0){throw 'Own initdb failed'}
& (Join-Path $pgBin 'pg_ctl.exe') 'start' '-D' (Join-Path $factory01Runtime 'pgdata') '-l' (Join-Path $factory01Runtime 'logs/postgresql.log') '-o' '-h 127.0.0.1 -p 15437' '-w' '-t' '25'
if($LASTEXITCODE -ne 0){throw 'Own PostgreSQL start failed'}
& node.exe (Join-Path $PSScriptRoot 'create-c0.cjs')
if($LASTEXITCODE -ne 0){throw 'C0 setup failed; retain target for diagnosis'}
