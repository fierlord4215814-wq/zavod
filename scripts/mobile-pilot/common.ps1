$ErrorActionPreference = 'Stop'
$script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:EvidenceRoot = Join-Path $script:ProjectRoot 'docs\quick-tunnel-mobile-pilot-v1'
$script:StatePath = Join-Path $script:EvidenceRoot 'current-runtime.json'
$script:GatewayPort = 5173
$script:BackendPort = 3000

function Import-PilotEnv {
  $envFile = Join-Path $script:ProjectRoot 'backend\.env'
  if (-not (Test-Path -LiteralPath $envFile)) { throw 'backend/.env не найден.' }
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim().Trim('"')
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

function Find-Cloudflared {
  $candidates = @()
  if ($env:CLOUDFLARED_EXE) { $candidates += $env:CLOUDFLARED_EXE }
  $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  $candidates += @(
    'C:\Program Files\cloudflared\cloudflared.exe',
    'C:\Program Files (x86)\cloudflared\cloudflared.exe',
    (Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe')
  )
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'cloudflared.exe не найден. Установите официальный MSI или задайте CLOUDFLARED_EXE.'
}

function Get-PortOwner {
  param([int]$Port)
  return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Assert-PortAvailableOrOwned {
  param([int]$Port)
  $owner = Get-PortOwner -Port $Port
  if (-not $owner) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.OwningProcess)" -ErrorAction SilentlyContinue
  $commandLine = [string]$process.CommandLine
  if (-not $commandLine.Contains($script:ProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Порт $Port занят посторонним процессом PID $($owner.OwningProcess). Процесс не остановлен."
  }
  Stop-Process -Id $owner.OwningProcess -Force
  Start-Sleep -Milliseconds 700
}

function Wait-HttpOk {
  param([string]$Url, [int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastFailure = 'нет ответа'
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $response.StatusCode }
    } catch {
      $lastFailure = $_.Exception.Message
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $deadline)
  throw "Адрес не стал доступен за $TimeoutSeconds сек.: $Url. Последняя ошибка: $lastFailure"
}

function Start-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string]$StdoutPath,
    [string]$StderrPath
  )
  return Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -PassThru
}

function Invoke-NativeLogged {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$LogPath
  )
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $FilePath @Arguments *> $LogPath
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  Get-Content -LiteralPath $LogPath -Encoding UTF8 | ForEach-Object { Write-Host $_ }
  return $exitCode
}

function Read-PilotState {
  if (-not (Test-Path -LiteralPath $script:StatePath)) { return $null }
  return Get-Content -LiteralPath $script:StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-PilotState {
  param($State)
  New-Item -ItemType Directory -Force -Path $script:EvidenceRoot | Out-Null
  $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8
}

function Test-PidAlive {
  param([object]$PidValue)
  if (-not $PidValue) { return $false }
  return $null -ne (Get-Process -Id ([int]$PidValue) -ErrorAction SilentlyContinue)
}
