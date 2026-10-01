. (Join-Path $PSScriptRoot 'common.ps1')
$state = Read-PilotState
if (-not $state) {
  Write-Host 'Активный runtime-манифест не найден. Ничего не остановлено.'
  exit 0
}
foreach ($name in @('cloudflaredPid', 'keepAwakePid', 'frontendPid', 'backendPid')) {
  $pidValue = $state.$name
  if ($pidValue -and (Test-PidAlive $pidValue)) {
    Stop-Process -Id ([int]$pidValue) -Force
    Write-Host "Остановлен $name PID $pidValue"
  }
}
$state.status = 'STOPPED'
$state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
Write-PilotState $state
Write-Host 'Pilot runtime остановлен. Данные sandbox не удалялись.'
