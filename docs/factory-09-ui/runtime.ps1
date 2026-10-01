param([ValidateSet('Init','ResumeInit','Start','Stop','Status')][string]$Action='Status')
$ErrorActionPreference='Stop'
$root='C:\Users\79164\Documents\work'
$runtime='C:\Users\79164\AppData\Local\Zavod-Factory09\run-20260928-ui01'
$pgBin='C:\Program Files\PostgreSQL\18\bin'
$node='C:\Program Files\nodejs\node.exe'
$database='zavod_factory09_ui01'
$pgPort=15439
$backendPort=3000
$frontendPort=5173
$version='FACTORY09-UI01-20260928'
$pgData=Join-Path $runtime 'pgdata'
$previewCommand='"'+$node+'" docs/factory-09-ui/preview.cjs'
$backendCommand='"'+$node+'" backend/dist/main.js'

function OwnListener([int]$port) {
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if($listeners.Count -eq 0){return $null}
  if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw "Unexpected listener on port $port"}
  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
  if(!$process){throw "Listener process disappeared on port $port"}
  if($port -eq $pgPort){
    if($process.ExecutablePath -cne (Join-Path $pgBin 'postgres.exe') -or $process.CommandLine -notlike '*Zavod-Factory09*run-20260928-ui01*pgdata*'){throw 'PostgreSQL listener is not the new FACTORY09 cluster'}
  } elseif($port -eq $backendPort){
    if($process.ExecutablePath -cne $node -or $process.CommandLine.Trim() -cne $backendCommand){throw 'Backend listener is not the new FACTORY09 process'}
    if((Invoke-RestMethod 'http://127.0.0.1:3000/version').version -cne $version){throw 'Backend version does not match FACTORY09'}
  } else {
    if($process.ExecutablePath -cne $node -or $process.CommandLine.Trim() -cne $previewCommand){throw 'Frontend listener is not the new FACTORY09 preview'}
  }
  return [pscustomobject]@{port=$port;pid=$process.ProcessId;createdUtc=$process.CreationDate.ToUniversalTime().ToString('o');command=$process.CommandLine}
}

function SourceIdentity {
  $files=@('backend/dist/main.js','frontend/dist/index.html','frontend/vite.config.ts','backend/prisma/schema.prisma')
  $values=@{}
  foreach($file in $files){$values[$file]=(Get-FileHash -LiteralPath (Join-Path $root $file) -Algorithm SHA256).Hash.ToLowerInvariant()}
  $migrationFiles=@(Get-ChildItem -LiteralPath (Join-Path $root 'backend/prisma/migrations') -Directory)
  if($migrationFiles.Count -ne 57){throw 'Expected exactly 57 unchanged source migrations'}
  return [pscustomobject]@{files=$values;migrations=$migrationFiles.Count}
}

function DatabaseUrl {
  $password=[IO.File]::ReadAllText((Join-Path $runtime 'secrets/db-password.txt')).Trim()
  return 'postgresql://factory09_owner:'+ [Uri]::EscapeDataString($password) + '@127.0.0.1:15439/' + $database + '?schema=public'
}

function StartOwnPg {
  if(OwnListener $pgPort){return}
  & (Join-Path $pgBin 'pg_ctl.exe') 'start' '-D' $pgData '-l' (Join-Path $runtime 'logs/postgresql.log') '-o' '-h 127.0.0.1 -p 15439' '-w' '-t' '25'
  if($LASTEXITCODE -ne 0 -or !(OwnListener $pgPort)){throw 'New PostgreSQL cluster did not start'}
}

if($Action -in @('Init','ResumeInit')){
 if($Action -eq 'Init'){
  if(!(Test-Path -LiteralPath $runtime -PathType Container)){throw 'Protected new runtime root absent'}
  if(Test-Path -LiteralPath $pgData){throw 'New pgdata already exists; Init is one-shot'}
  foreach($port in @($pgPort,$backendPort,$frontendPort)){if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw "Port $port occupied"}}
  foreach($folder in @('secrets','uploads','logs','prisma-stage')){New-Item -ItemType Directory -Path (Join-Path $runtime $folder) -ErrorAction Stop | Out-Null}
  foreach($key in @('db-password','jwt-secret','admin-recovery','admin-personal')){
    $value='F09!'+[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).TrimEnd('=').Replace('+','-').Replace('/','_')
    $file=Join-Path $runtime ('secrets/'+$key+'.txt')
    if(Test-Path -LiteralPath $file){throw "Existing secret: $key"}
    [IO.File]::WriteAllText($file,$value)
  }
  $stage=Join-Path $runtime 'prisma-stage'
  New-Item -ItemType Directory -Path (Join-Path $stage 'prisma') | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'backend/prisma/schema.prisma') -Destination (Join-Path $stage 'prisma/schema.prisma')
  Copy-Item -LiteralPath (Join-Path $root 'backend/prisma/migrations') -Destination (Join-Path $stage 'prisma/migrations') -Recurse
  $source=SourceIdentity
  $config=[pscustomobject]@{scope='FACTORY09_NEW_SYNTHETIC_ONLY';root=$root;runtime=$runtime;database=$database;pgPort=$pgPort;backendPort=$backendPort;frontendPort=$frontendPort;uploads=(Join-Path $runtime 'uploads');version=$version;source=$source}
  [IO.File]::WriteAllText((Join-Path $runtime 'identity.json'),($config | ConvertTo-Json -Depth 6))
  & (Join-Path $pgBin 'initdb.exe') '-D' $pgData '--username=factory09_owner' '--auth-host=scram-sha-256' '--auth-local=scram-sha-256' '--encoding=UTF8' '--locale=C' ('--pwfile='+ (Join-Path $runtime 'secrets/db-password.txt')) | Out-Null
  if($LASTEXITCODE -ne 0){throw 'New initdb failed; retain own runtime for diagnosis'}
 } else {
  if(!(Test-Path -LiteralPath $pgData -PathType Container) -or !(Test-Path -LiteralPath (Join-Path $runtime 'identity.json'))){throw 'ResumeInit requires exact partially prepared new runtime'}
  $saved=Get-Content -LiteralPath (Join-Path $runtime 'identity.json') -Raw | ConvertFrom-Json
  if($saved.scope -cne 'FACTORY09_NEW_SYNTHETIC_ONLY' -or $saved.database -cne $database -or $saved.pgPort -ne $pgPort){throw 'ResumeInit identity mismatch'}
  $source=SourceIdentity
  foreach($name in $source.files.Keys){if($source.files[$name] -cne $saved.source.files.PSObject.Properties[$name].Value){throw "Source changed since Init: $name"}}
 }
  StartOwnPg
  try {
    $env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $runtime 'secrets/db-password.txt')).Trim()
    $existing=& (Join-Path $pgBin 'psql.exe') '-X' '-w' '-t' '-A' '-h' '127.0.0.1' '-p' '15439' '-U' 'factory09_owner' '-d' 'postgres' '-c' ("SELECT datname FROM pg_database WHERE datname='"+$database+"'")
    if($LASTEXITCODE -ne 0 -or $existing){throw 'New target DB is not proven absent; no mutation'}
    & (Join-Path $pgBin 'psql.exe') '-X' '-w' '-v' 'ON_ERROR_STOP=1' '-h' '127.0.0.1' '-p' '15439' '-U' 'factory09_owner' '-d' 'postgres' '-c' ('CREATE DATABASE "'+$database+'" OWNER factory09_owner') | Out-Null
    if($LASTEXITCODE -ne 0){throw 'New database creation failed'}
    $env:DATABASE_URL=DatabaseUrl
    Push-Location $stage
    try {
      & $node (Join-Path $root 'backend/node_modules/prisma/build/index.js') 'migrate' 'deploy' '--schema' (Join-Path $stage 'prisma/schema.prisma')
      if($LASTEXITCODE -ne 0){throw 'New database migration deploy failed'}
      & $node (Join-Path $root 'backend/node_modules/prisma/build/index.js') 'migrate' 'diff' '--from-url' $env:DATABASE_URL '--to-schema-datamodel' (Join-Path $stage 'prisma/schema.prisma') '--exit-code'
      if($LASTEXITCODE -ne 0){throw 'New database strict schema diff failed'}
    } finally {Pop-Location}
    & $node (Join-Path $root 'backend/dist/cli/apply-system-foundation.js')
    if($LASTEXITCODE -ne 0){throw 'New database foundation failed'}
    & $node (Join-Path $root 'backend/dist/cli/bootstrap-first-admin.js') '--factory-name' 'УЧЕБНАЯ ОСНОВА FACTORY09' '--factory-code' 'factory09-bootstrap' '--admin-phone' '+79990009000' '--admin-last-name' 'Учебный' '--admin-first-name' 'Администратор' '--credential-file' (Join-Path $runtime 'secrets/admin-recovery.txt')
    if($LASTEXITCODE -ne 0){throw 'New database first ADMIN bootstrap failed'}
    $migrationCount=& (Join-Path $pgBin 'psql.exe') '-X' '-w' '-t' '-A' '-h' '127.0.0.1' '-p' '15439' '-U' 'factory09_owner' '-d' $database '-c' 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    if($LASTEXITCODE -ne 0 -or [string]$migrationCount -cne '57'){throw 'New database migration readback is not 57'}
  } finally {Remove-Item Env:PGPASSWORD,Env:DATABASE_URL -ErrorAction SilentlyContinue}
  [pscustomobject]@{status='NEW_C0_FOUNDATION_FIRST_ADMIN';identity=(Join-Path $runtime 'identity.json');pg=(OwnListener $pgPort);source=$source} | ConvertTo-Json -Depth 5
  exit 0
}

if($Action -eq 'Start'){
  if(!(Test-Path -LiteralPath (Join-Path $runtime 'identity.json'))){throw 'New runtime identity absent; Init first'}
  $saved=Get-Content -LiteralPath (Join-Path $runtime 'identity.json') -Raw | ConvertFrom-Json
  $current=SourceIdentity
  foreach($name in $current.files.Keys){if($current.files[$name] -cne $saved.source.files.PSObject.Properties[$name].Value){throw "Source changed since Init: $name"}}
  StartOwnPg
  if(!(OwnListener $backendPort)){
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    try {
      $env:DATABASE_URL=DatabaseUrl
      $env:JWT_SECRET=[IO.File]::ReadAllText((Join-Path $runtime 'secrets/jwt-secret.txt')).Trim()
      $env:FILE_STORAGE_ROOT=Join-Path $runtime 'uploads'
      $env:NODE_ENV='production';$env:HOST='127.0.0.1';$env:PORT='3000';$env:APP_VERSION=$version
      $env:REGISTRATION_FACTORY_CODE='factory09-bootstrap';$env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173'
      $env:DISABLE_DB='false';$env:DEV_MODE='false';$env:ALLOW_TEST_AUTH_HEADERS='false'
      Remove-Item Env:ZAVOD_INTERNAL_TEST_NOW,Env:ZAVOD_INTERNAL_TEST_NOW_FILE,Env:NODE_OPTIONS -ErrorAction SilentlyContinue
      $started=Start-Process -FilePath $node -ArgumentList 'backend/dist/main.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime "logs/backend-$stamp.stdout.log") -RedirectStandardError (Join-Path $runtime "logs/backend-$stamp.stderr.log")
    } finally {Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:FILE_STORAGE_ROOT -ErrorAction SilentlyContinue}
    $ready=$false
    for($i=0;$i -lt 80;$i++){Start-Sleep -Milliseconds 250;try{$ready=(Invoke-RestMethod 'http://127.0.0.1:3000/ready').ready}catch{};if($ready){break}}
    if(!$ready -or (OwnListener $backendPort).pid -ne $started.Id){throw 'New backend not ready'}
  }
  if(!(OwnListener $frontendPort)){
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    Start-Process -FilePath $node -ArgumentList 'docs/factory-09-ui/preview.cjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime "logs/frontend-$stamp.stdout.log") -RedirectStandardError (Join-Path $runtime "logs/frontend-$stamp.stderr.log") | Out-Null
    for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;if(OwnListener $frontendPort){break}}
    if(!(OwnListener $frontendPort)){throw 'New frontend preview failed'}
  }
}

if($Action -eq 'Stop'){
  foreach($port in @($frontendPort,$backendPort,$pgPort)){
    $before=OwnListener $port
    if(!$before){continue}
    $again=OwnListener $port
    if($before.pid -ne $again.pid -or $before.createdUtc -cne $again.createdUtc){throw "Identity changed on port $port"}
    if($port -eq $pgPort){
      & (Join-Path $pgBin 'pg_ctl.exe') 'stop' '-D' $pgData '-m' 'fast' '-w' '-t' '25' | Out-Null
      if($LASTEXITCODE -ne 0){throw 'Own PostgreSQL stop failed'}
    } else {
      Stop-Process -Id $before.pid
      Wait-Process -Id $before.pid -Timeout 15 -ErrorAction SilentlyContinue
    }
  }
}

$observed=@();foreach($port in @($pgPort,$backendPort,$frontendPort)){$found=OwnListener $port;if($found){$observed+=$found}}
[pscustomobject]@{action=$Action;atUtc=[DateTime]::UtcNow.ToString('o');listeners=$observed;runtime=$runtime} | ConvertTo-Json -Depth 5
