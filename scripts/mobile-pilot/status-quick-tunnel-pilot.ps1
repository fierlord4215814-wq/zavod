. (Join-Path $PSScriptRoot 'common.ps1')
$state = Read-PilotState
if (-not $state) {
  Write-Host 'Pilot runtime ещё не запускался.'
  exit 1
}
$checks = [ordered]@{
  status = $state.status
  startedAt = $state.startedAt
  publicUrl = $state.publicUrl
  backendPid = $state.backendPid
  backendAlive = Test-PidAlive $state.backendPid
  frontendPid = $state.frontendPid
  frontendAlive = Test-PidAlive $state.frontendPid
  cloudflaredPid = $state.cloudflaredPid
  cloudflaredAlive = Test-PidAlive $state.cloudflaredPid
  keepAwakePid = $state.keepAwakePid
  keepAwakeAlive = Test-PidAlive $state.keepAwakePid
  evidenceDir = $state.evidenceDir
  qrPath = $state.qrPath
  apiStatus = $state.acceptance.sameOriginApi
  webSocketStatus = $state.acceptance.websocket
  chatRoundTripStatus = $state.acceptance.chatRoundTrip
  chatReconnectStatus = $state.acceptance.chatReconnect
  errorReportRoundTripStatus = $state.acceptance.errorReportRoundTrip
  pwaSecureContextStatus = $state.acceptance.pwaSecureContext
  physicalPhoneStatus = $state.acceptance.physicalPhone
}
foreach ($target in @(
  @('localGateway', 'http://127.0.0.1:5173/'),
  @('localHealth', 'http://127.0.0.1:5173/api/health'),
  @('externalHealth', "$($state.publicUrl)/api/health")
)) {
  try { $checks[$target[0]] = (Invoke-WebRequest -UseBasicParsing -Uri $target[1] -TimeoutSec 12).StatusCode }
  catch { $checks[$target[0]] = 'FAIL' }
}
$checks | ConvertTo-Json -Depth 4
if (-not ($checks.backendAlive -and $checks.frontendAlive -and $checks.cloudflaredAlive -and $checks.keepAwakeAlive -and $checks.externalHealth -eq 200)) { exit 1 }
