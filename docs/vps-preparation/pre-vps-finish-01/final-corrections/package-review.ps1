$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$stage = Join-Path $env:TEMP ('zavod-pre-vps-final-review-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
$sourceZipPath = Join-Path $root 'docs/vps-preparation/pre-vps-finish-01/source-candidate-20260930-final.zip'
$previousZipPath = Join-Path $root 'docs/vps-preparation/pre-vps-finish-01/source-candidate-20260930.zip'
if (-not (Test-Path -LiteralPath $sourceZipPath -PathType Leaf)) { throw 'Final source ZIP missing' }

$afterPaths = @(
  'frontend/src/components/ChamberPanel.tsx', 'frontend/src/screens/DefrostScreen.tsx',
  'frontend/scripts/pre-vps-chamber-panel-isolated.test.cjs',
  'setup/deployment-context.js', 'setup/zavod-setup.js', 'setup/pre-vps-release-portability.test.cjs',
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/20260930210000_pre_vps_login_throttle/migration.sql',
  'backend/prisma/migrations/20260930211000_pre_vps_chambers/migration.sql',
  'AGENTS.md', 'docs/vps-preparation/handoff.md',
  'docs/vps-preparation/pre-vps-finish-01/report.md',
  'docs/vps-preparation/pre-vps-finish-01/evidence.md',
  'docs/vps-preparation/pre-vps-finish-01/DATA-AND-RELEASE.md',
  'docs/vps-preparation/pre-vps-finish-01/VPS-FIRST-RUN.md',
  'docs/vps-preparation/pre-vps-finish-01/final-corrections/report.md',
  'docs/vps-preparation/pre-vps-finish-01/final-corrections/package-review.ps1'
)
$origin = @()
foreach ($relative in $afterPaths) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing after: $relative" }
  $destination = Join-Path $stage ('after/' + $relative)
  [IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
  [IO.File]::WriteAllBytes($destination, [IO.File]::ReadAllBytes($source))
  $beforeSource = Join-Path $PSScriptRoot ('before/' + $relative)
  if (Test-Path -LiteralPath $beforeSource -PathType Leaf) {
    $before = Join-Path $stage ('before/' + $relative)
    [IO.Directory]::CreateDirectory((Split-Path $before -Parent)) | Out-Null
    [IO.File]::WriteAllBytes($before, [IO.File]::ReadAllBytes($beforeSource))
    $origin += [pscustomobject]@{ path = $relative; beforeKind = 'IMMEDIATE_PRE_EDIT'; beforeOrigin = 'final-corrections/before/' + $relative }
  } else {
    $origin += [pscustomobject]@{ path = $relative; beforeKind = 'NOT_CAPTURED_IMMEDIATE'; beforeOrigin = $null }
  }
}

$previousZip = [IO.Compression.ZipFile]::OpenRead($previousZipPath)
try {
  $relative = 'frontend/src/screens/DefrostScreen.tsx'
  $entry = $previousZip.GetEntry($relative)
  if (-not $entry) { throw "Previous candidate missing $relative" }
  $before = Join-Path $stage ('before/' + $relative)
  [IO.Directory]::CreateDirectory((Split-Path $before -Parent)) | Out-Null
  $input = $entry.Open(); $output = [IO.File]::Create($before)
  try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  $item = $origin | Where-Object { $_.path -eq $relative }
  $item.beforeKind = 'PRIOR_CANDIDATE_NOT_CLAIMED_IMMEDIATE'
  $item.beforeOrigin = 'source-candidate-20260930.zip#' + $relative
} finally { $previousZip.Dispose() }

$sourceZip = [IO.Compression.ZipFile]::OpenRead($sourceZipPath)
try {
  $entry = $sourceZip.GetEntry('RELEASE-MANIFEST.json')
  if (-not $entry) { throw 'Final candidate missing release manifest' }
  $destination = Join-Path $stage 'candidate/RELEASE-MANIFEST.json'
  [IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
  $input = $entry.Open(); $output = [IO.File]::Create($destination)
  try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
} finally { $sourceZip.Dispose() }
$candidateHash = (Get-FileHash -LiteralPath $sourceZipPath -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $stage 'candidate/source-candidate-sha256.txt'),
  "source-candidate-20260930-final.zip $candidateHash`n", [Text.UTF8Encoding]::new($false))

$patch = New-Object System.Text.StringBuilder
foreach ($item in ($origin | Where-Object { $_.beforeKind -ne 'NOT_CAPTURED_IMMEDIATE' })) {
  $relative = $item.path
  Push-Location $stage
  try { $diff = & git diff --no-index --no-ext-diff --text -- ('before/' + $relative) ('after/' + $relative) 2>$null }
  finally { Pop-Location }
  if ($LASTEXITCODE -gt 1) { throw "Diff failed: $relative" }
  $fragment = ($diff -join "`n") + "`n"
  $fragment = $fragment.Replace('a/before/' + $relative, 'a/' + $relative).Replace('a/after/' + $relative, 'a/' + $relative).Replace('b/after/' + $relative, 'b/' + $relative)
  [void]$patch.Append($fragment)
}
[IO.File]::WriteAllText((Join-Path $stage 'changes.patch'), $patch.ToString(), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $stage 'before-origin.json'), ($origin | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$payloads = @()
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  $payloads += [pscustomobject]@{ path = $relative; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() }
}
$manifest = [pscustomobject]@{
  kind = 'PRE_VPS_FINISH_01_FINAL_CORRECTIONS_REVIEW'
  status = 'SOURCE_ISOLATED_ONLY_LIVE_WAIT_VPS'
  currentCandidate = 'source-candidate-20260930-final.zip'
  currentCandidateSha256 = $candidateHash
  payloadCount = $payloads.Count
  payloads = @($payloads | Sort-Object path)
}
[IO.File]::WriteAllText((Join-Path $stage 'REVIEW-MANIFEST.json'), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Output $stage
