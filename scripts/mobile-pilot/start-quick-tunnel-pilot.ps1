. (Join-Path $PSScriptRoot 'common.ps1')

$current = Read-PilotState
if ($current -and $current.status -eq 'READY' -and (Test-PidAlive $current.backendPid) -and (Test-PidAlive $current.frontendPid) -and (Test-PidAlive $current.cloudflaredPid)) {
  Write-Host "Pilot runtime уже работает: $($current.publicUrl)"
  exit 0
}

$cloudflared = Find-Cloudflared
$node = (Get-Command node.exe -ErrorAction Stop).Source
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
$runDir = Join-Path $script:EvidenceRoot "runtime\$timestamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$backend = $null
$frontend = $null
$tunnel = $null
$keepAwake = $null
$state = [ordered]@{
  status = 'STARTING'
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  localGateway = 'http://127.0.0.1:5173'
  localBackend = 'http://127.0.0.1:3000'
  publicUrl = $null
  backendPid = $null
  frontendPid = $null
  cloudflaredPid = $null
  keepAwakePid = $null
  evidenceDir = $runDir
  qrPath = $null
  cloudflaredExe = $cloudflared
}

try {
  Assert-PortAvailableOrOwned -Port $script:BackendPort
  Assert-PortAvailableOrOwned -Port $script:GatewayPort
  Import-PilotEnv
  $env:HOST = '127.0.0.1'
  $env:PORT = '3000'
  $env:VITE_PROXY_TARGET = 'http://127.0.0.1:3000'
  # Test-only runtime flag: the mobile pilot uses a diagnostic factory that
  # remains hidden during every ordinary backend launch.
  $env:ZAVOD_INCLUDE_DIAGNOSTIC_FACTORIES = 'true'

  if ((Invoke-NativeLogged npm.cmd @('run', 'build', '--workspace', 'backend') (Join-Path $runDir 'backend-build.log')) -ne 0) { throw 'Backend build завершился ошибкой.' }
  if ((Invoke-NativeLogged npm.cmd @('run', 'build', '--workspace', 'frontend') (Join-Path $runDir 'frontend-build.log')) -ne 0) { throw 'Frontend build завершился ошибкой.' }
  if ((Invoke-NativeLogged npm.cmd @('run', 'prisma:validate', '--workspace', 'backend') (Join-Path $runDir 'prisma-validate.log')) -ne 0) { throw 'Prisma validate завершился ошибкой.' }
  if ((Invoke-NativeLogged npm.cmd @('run', 'prisma:migrate:status', '--workspace', 'backend') (Join-Path $runDir 'prisma-status.log')) -ne 0) { throw 'Prisma migrate status завершился ошибкой.' }
  if ((Invoke-NativeLogged $node @((Join-Path $script:ProjectRoot 'backend\scripts\mobile-pilot-sandbox-v1.js')) (Join-Path $runDir 'pilot-data-manifest.json')) -ne 0) { throw 'Подготовка pilot sandbox завершилась ошибкой.' }

  $backend = Start-LoggedProcess -FilePath $node -Arguments @((Join-Path $script:ProjectRoot 'backend\dist\main.js')) -WorkingDirectory (Join-Path $script:ProjectRoot 'backend') -StdoutPath (Join-Path $runDir 'backend.stdout.log') -StderrPath (Join-Path $runDir 'backend.stderr.log')
  $state.backendPid = $backend.Id
  Wait-HttpOk -Url 'http://127.0.0.1:3000/health' -TimeoutSeconds 60 | Out-File -FilePath (Join-Path $runDir 'local-backend-health.txt') -Encoding utf8

  $viteCli = Join-Path $script:ProjectRoot 'node_modules\vite\bin\vite.js'
  $frontend = Start-LoggedProcess -FilePath $node -Arguments @($viteCli, 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory (Join-Path $script:ProjectRoot 'frontend') -StdoutPath (Join-Path $runDir 'frontend.stdout.log') -StderrPath (Join-Path $runDir 'frontend.stderr.log')
  $state.frontendPid = $frontend.Id
  Wait-HttpOk -Url 'http://127.0.0.1:5173/' -TimeoutSeconds 60 | Out-File -FilePath (Join-Path $runDir 'local-frontend-health.txt') -Encoding utf8
  Wait-HttpOk -Url 'http://127.0.0.1:5173/api/health' -TimeoutSeconds 60 | Out-File -FilePath (Join-Path $runDir 'local-api-health.txt') -Encoding utf8
  Wait-HttpOk -Url 'http://127.0.0.1:5173/health' -TimeoutSeconds 60 | Out-File -FilePath (Join-Path $runDir 'local-direct-health.txt') -Encoding utf8

  $keepAwake = Start-LoggedProcess -FilePath $powershell -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'keep-awake.ps1')) -WorkingDirectory $script:ProjectRoot -StdoutPath (Join-Path $runDir 'keep-awake.stdout.log') -StderrPath (Join-Path $runDir 'keep-awake.stderr.log')
  $state.keepAwakePid = $keepAwake.Id
  Start-Sleep -Milliseconds 500
  if (-not (Test-PidAlive $keepAwake.Id)) { throw 'Временный keep-awake process не запустился.' }

  & $cloudflared --version | Set-Content -LiteralPath (Join-Path $runDir 'cloudflared-version.txt') -Encoding UTF8
  $tunnel = Start-LoggedProcess -FilePath $cloudflared -Arguments @('tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:5173', '--no-autoupdate', '--loglevel', 'info') -WorkingDirectory $script:ProjectRoot -StdoutPath (Join-Path $runDir 'cloudflared.stdout.log') -StderrPath (Join-Path $runDir 'cloudflared.stderr.log')
  $state.cloudflaredPid = $tunnel.Id

  $deadline = (Get-Date).AddSeconds(90)
  $publicUrl = $null
  do {
    $logs = @()
    foreach ($log in @('cloudflared.stdout.log', 'cloudflared.stderr.log')) {
      $logPath = Join-Path $runDir $log
      if (Test-Path -LiteralPath $logPath) { $logs += Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue }
    }
    $match = ([string]::Join("`n", $logs) | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches).Matches | Select-Object -First 1
    if ($match) { $publicUrl = $match.Value.TrimEnd('/') }
    if (-not $publicUrl) { Start-Sleep -Seconds 1 }
  } while (-not $publicUrl -and (Get-Date) -lt $deadline -and (Test-PidAlive $tunnel.Id))
  if (-not $publicUrl) { throw 'Cloudflare Quick Tunnel не выдал HTTPS URL. См. cloudflared.stderr.log.' }

  $state.publicUrl = $publicUrl
  Write-PilotState $state
  Wait-HttpOk -Url "$publicUrl/" -TimeoutSeconds 90 | Out-File -FilePath (Join-Path $runDir 'external-frontend-health.txt') -Encoding utf8
  Wait-HttpOk -Url "$publicUrl/api/health" -TimeoutSeconds 90 | Out-File -FilePath (Join-Path $runDir 'external-api-health.txt') -Encoding utf8
  Wait-HttpOk -Url "$publicUrl/health" -TimeoutSeconds 90 | Out-File -FilePath (Join-Path $runDir 'external-direct-health.txt') -Encoding utf8

  $env:MOBILE_PILOT_URL = $publicUrl
  $env:FRONTEND_URL = $publicUrl
  $env:MOBILE_PILOT_EVIDENCE_DIR = $runDir
  $env:STAGE31_SKIP_WEBSERVER = '1'
  if ((Invoke-NativeLogged $node @((Join-Path $script:ProjectRoot 'frontend\scripts\quick-tunnel-mobile-pilot-v1.js')) (Join-Path $runDir 'external-browser-smoke.log')) -ne 0) { throw 'Внешний all-role/API/WebSocket/PWA smoke завершился ошибкой. QR не создан.' }

  $qrPath = Join-Path $script:EvidenceRoot 'mobile-pilot-qr.png'
  $urlPath = Join-Path $script:EvidenceRoot 'mobile-pilot-url.txt'
  & python (Join-Path $PSScriptRoot 'create-qr.py') $publicUrl $qrPath
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать QR. Проверьте Python-модуль qrcode.' }
  Set-Content -LiteralPath $urlPath -Value $publicUrl -Encoding UTF8

  $state.status = 'READY'
  $state.qrPath = $qrPath
  $state.acceptance = [ordered]@{
    externalHttps = 'PASS'; sameOriginApi = 'PASS'; websocket = 'PASS'; allRoleLogin = 'PASS';
    sessionSwitch = 'PASS'; pwaSecureContext = 'PASS'; chatRoundTrip = 'PASS'; chatReconnect = 'PASS';
    errorReportRoundTrip = 'PASS'; physicalPhone = 'WAITING_FOR_USER'
  }
  Write-PilotState $state
  $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'launch-manifest.json') -Encoding UTF8
  Write-Host "MOBILE PILOT READY: $publicUrl"
  Write-Host "QR: $qrPath"
} catch {
  $state.status = 'FAILED'
  $state.error = $_.Exception.Message
  Write-PilotState $state
  foreach ($process in @($tunnel, $keepAwake, $frontend, $backend)) {
    if ($process -and (Test-PidAlive $process.Id)) { Stop-Process -Id $process.Id -Force }
  }
  Write-Error $_.Exception.Message
  exit 1
}
