Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = Join-Path $projectRoot 'docs/vps-preparation/vps-prep-02/review-pack.zip'
if (Test-Path -LiteralPath $archivePath) {
  throw 'Review ZIP already exists; refusing to overwrite it.'
}

Push-Location $projectRoot
try {
  $contextJson = & node -e "process.stdout.write(JSON.stringify(require('./setup/deployment-context').collectBuildFiles(process.cwd())))"
  if ($LASTEXITCODE -ne 0) { throw 'Build context owner failed.' }
  $contextFiles = @($contextJson | ConvertFrom-Json)
} finally {
  Pop-Location
}

$extras = @(
  'AGENTS.md',
  'docker-compose.production.yml',
  'setup/zavod-setup.js',
  'setup/wizard.html',
  'setup/restore.html',
  'setup/deployment-context.js',
  'setup/storage-contract.js',
  'setup/vps-prep-02-docker-shim.js',
  'setup/vps-prep-02-regression.js',
  'setup/vps-prep-02-package-review.ps1',
  'backend/prisma/seed.js',
  'backend/scripts/vps-prep-01-regression.js',
  'backend/scripts/vps-prep-01-postgres-integration.js',
  'backend/scripts/vps-prep-02-readiness-regression.js',
  'frontend/e2e/vps-prep-01-auth-recovery.spec.ts',
  'frontend/playwright.vps-prep.config.ts',
  'docs/v1-completion-goal.md',
  'docs/vps-preparation/handoff.md',
  'docs/vps-preparation/source-first-server-plan.md',
  'docs/vps-preparation/vps-prep-01/progress.md',
  'docs/vps-preparation/vps-prep-01/review-report.md',
  'docs/vps-preparation/vps-prep-01/before-hashes.json',
  'docs/vps-preparation/vps-prep-01/after-hashes.json',
  'docs/vps-preparation/vps-prep-01/review-pack/README.md',
  'docs/vps-preparation/vps-prep-01/review-pack/change-diff.md',
  'docs/vps-preparation/vps-prep-01/review-pack/test-results.md',
  'docs/vps-preparation/vps-prep-01/review-pack/operator-runbook.md',
  'docs/vps-preparation/vps-prep-02/progress.md',
  'docs/vps-preparation/vps-prep-02/review-report.md',
  'docs/vps-preparation/vps-prep-02/operator-runbook.md',
  'docs/vps-preparation/vps-prep-02/expected-actual.md',
  'docs/vps-preparation/vps-prep-02/pending-runtime.md',
  'docs/vps-preparation/vps-prep-02/before-hashes.json',
  'docs/vps-preparation/vps-prep-02/after-hashes.json',
  'docs/vps-preparation/vps-prep-02/diff-scope.json',
  'docs/vps-preparation/vps-prep-02/review-diff-checkpoint-to-current.patch',
  'docs/vps-preparation/vps-prep-02/review-pack-readme.md'
)

$logRoot = Join-Path $projectRoot 'docs/vps-preparation/vps-prep-02/logs'
$logs = @(Get-ChildItem -LiteralPath $logRoot -File -Filter '*.txt' | ForEach-Object {
  $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
})
$paths = @($contextFiles) + $extras + $logs | Sort-Object -Unique
$entries = New-Object System.Collections.Generic.List[object]
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relativePath in $paths) {
    $relativePath = $relativePath.Replace('\', '/')
    if ($relativePath.StartsWith('/') -or $relativePath.Contains('..') -or $relativePath -match '(^|/)(\.env|node_modules|uploads|\.git)(/|$)') {
      throw "Unsafe archive path: $relativePath"
    }
    $sourcePath = Join-Path $projectRoot $relativePath
    $source = Get-Item -LiteralPath $sourcePath -ErrorAction Stop
    if ($source.PSIsContainer -or ($source.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw "Unsafe source: $relativePath"
    }
    $bytes = [System.IO.File]::ReadAllBytes($sourcePath)
    $sha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $entry = $zip.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    $entries.Add([pscustomobject]@{path=$relativePath; bytes=$bytes.Length; sha256=$sha256})
  }
  $manifest = [pscustomobject]@{
    format = 'zavod-vps-prep-review-v1'
    status = 'PARTIAL_PENDING_RUNTIME_PROOF'
    note = 'PREP-01+02 actual source and evidence; no working secrets, DB or uploads.'
    files = $entries.ToArray()
  }
  $manifestBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 6))
  $entry = $zip.CreateEntry('review-manifest.json', [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try { $stream.Write($manifestBytes, 0, $manifestBytes.Length) } finally { $stream.Dispose() }
} finally {
  $zip.Dispose()
}

$verify = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($verify.Entries.Count -ne $entries.Count + 1) { throw 'ZIP entry count mismatch.' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  foreach ($item in $entries) {
    $entry = $verify.GetEntry($item.path)
    if ($null -eq $entry -or -not $seen.Add($item.path)) { throw "Missing/duplicate entry: $($item.path)" }
    $memory = [System.IO.MemoryStream]::new()
    $stream = $entry.Open()
    try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
    $bytes = $memory.ToArray()
    $memory.Dispose()
    $sha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    if ($bytes.Length -ne $item.bytes -or $sha256 -ne $item.sha256) { throw "Readback mismatch: $($item.path)" }
  }
  $entry = $verify.GetEntry('review-manifest.json')
  if ($null -eq $entry) { throw 'Manifest missing.' }
  $memory = [System.IO.MemoryStream]::new()
  $stream = $entry.Open()
  try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
  if ([Convert]::ToHexString($manifestBytes) -ne [Convert]::ToHexString($memory.ToArray())) {
    throw 'Manifest readback mismatch.'
  }
  $memory.Dispose()
} finally {
  $verify.Dispose()
}

$archive = Get-Item -LiteralPath $archivePath
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output ("REVIEW_ZIP={0}; bytes={1}; sha256={2}; readback={3}/{3}" -f $archive.FullName, $archive.Length, $hash, ($entries.Count + 1))
