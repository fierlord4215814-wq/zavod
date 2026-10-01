param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$packRoot = $PSScriptRoot
$zipPath = Join-Path $packRoot 'review-pack-factory09-autonomous-20260928.zip'
$readbackPath = Join-Path $packRoot 'review-readback.json'
if (Test-Path -LiteralPath $zipPath) { throw 'Review ZIP already exists; immutable artifact will not be overwritten.' }
if (Test-Path -LiteralPath $readbackPath) { throw 'Readback already exists; immutable receipt will not be overwritten.' }

$modified = @(
  @{ Before = 'before/first-admin-bootstrap.ts'; Current = 'backend/src/common/first-admin-bootstrap.ts' },
  @{ Before = 'before/checklists.service.ts'; Current = 'backend/src/modules/checklists/checklists.service.ts' },
  @{ Before = 'before/master-r2-checklist.test.js'; Current = 'backend/scripts/master-r2-checklist.test.js' },
  @{ Before = 'before/backend-package.json'; Current = 'backend/package.json' },
  @{ Before = 'before/ChecklistsScreen.tsx'; Current = 'frontend/src/screens/ChecklistsScreen.tsx' }
)
$newSource = @(
  'backend/src/cli/reissue-first-admin-recovery.ts',
  'backend/scripts/factory09-first-admin-recovery-sql.test.cjs',
  'backend/scripts/factory09-checklist-consumer.test.cjs',
  'backend/scripts/factory09-authority.test.cjs',
  'backend/scripts/factory09-staffing.test.cjs'
)
$documents = @(
  'report.md', 'test-evidence.md', 'excel-ui-actions.md', 'operator-handoff.md'
)

$afterRoot = Join-Path $packRoot 'after'
if (-not (Test-Path -LiteralPath $afterRoot)) { New-Item -ItemType Directory -Path $afterRoot | Out-Null }

$entrySources = [ordered]@{}
foreach ($item in $modified) {
  $beforePath = Join-Path $packRoot ($item.Before -replace '/', '\')
  $currentPath = Join-Path $root ($item.Current -replace '/', '\')
  if (-not (Test-Path -LiteralPath $beforePath -PathType Leaf)) { throw "Missing before snapshot: $($item.Before)" }
  if (-not (Test-Path -LiteralPath $currentPath -PathType Leaf)) { throw "Missing current file: $($item.Current)" }
  $afterPath = Join-Path $afterRoot ($item.Current -replace '/', '\')
  New-Item -ItemType Directory -Path (Split-Path -Parent $afterPath) -Force | Out-Null
  if (Test-Path -LiteralPath $afterPath) {
    if ((Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash) { throw "After snapshot changed: $($item.Current)" }
  } else { Copy-Item -LiteralPath $currentPath -Destination $afterPath }
  $entrySources["source/$($item.Before)"] = $beforePath
  $entrySources["source/after/$($item.Current)"] = $afterPath
}
foreach ($relative in $newSource) {
  $sourcePath = Join-Path $root ($relative -replace '/', '\')
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing new source: $relative" }
  $afterPath = Join-Path $afterRoot ($relative -replace '/', '\')
  New-Item -ItemType Directory -Path (Split-Path -Parent $afterPath) -Force | Out-Null
  if (Test-Path -LiteralPath $afterPath) {
    if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash) { throw "After snapshot changed: $relative" }
  } else { Copy-Item -LiteralPath $sourcePath -Destination $afterPath }
  $entrySources["source/after/$relative"] = $afterPath
}

$diffSegments = [System.Collections.Generic.List[string]]::new()
foreach ($item in $modified) {
  $beforePath = Join-Path $packRoot ($item.Before -replace '/', '\')
  $afterPath = Join-Path $afterRoot ($item.Current -replace '/', '\')
  $diff = & git -c core.safecrlf=false diff --no-index -- $beforePath $afterPath 2>&1
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { throw "git diff failed for $($item.Current): $LASTEXITCODE" }
  if ($LASTEXITCODE -eq 1) { $diffSegments.Add(($diff -join "`n")) }
}
if ($diffSegments.Count -lt 4) { throw 'Expected modified source diffs are missing.' }
$diffPath = Join-Path $packRoot 'source-diff.patch'
$diffBytes = [System.Text.UTF8Encoding]::new($false).GetBytes((($diffSegments -join "`n") + "`n"))
if (Test-Path -LiteralPath $diffPath) {
  if ([Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.IO.File]::ReadAllBytes($diffPath))) -ne [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($diffBytes))) { throw 'Diff artifact changed.' }
} else { [System.IO.File]::WriteAllBytes($diffPath, $diffBytes) }
$entrySources['source/source-diff.patch'] = $diffPath
foreach ($doc in $documents) {
  $docPath = Join-Path $packRoot $doc
  if (-not (Test-Path -LiteralPath $docPath -PathType Leaf)) { throw "Missing document: $doc" }
  $entrySources["review/$doc"] = $docPath
}

$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-Digest([byte[]]$bytes) {
  return [Convert]::ToHexString($sha.ComputeHash($bytes)).ToLowerInvariant()
}
$manifestEntries = [System.Collections.Generic.List[object]]::new()
foreach ($key in $entrySources.Keys) {
  $bytes = [System.IO.File]::ReadAllBytes($entrySources[$key])
  $manifestEntries.Add([ordered]@{ path = $key; bytes = $bytes.Length; sha256 = (Get-Digest $bytes) })
}
$manifest = [ordered]@{
  package = 'FACTORY09-AUTONOMOUS-01'
  date = '2026-09-28'
  claim = 'source + isolated SQL evidence; no main recovery issuance; no business UI creation'
  entries = $manifestEntries
}
$manifestBytes = [System.Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8) + "`n")

Add-Type -AssemblyName System.IO.Compression
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($key in $entrySources.Keys) {
    $entry = $archive.CreateEntry($key, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($entrySources[$key])
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
  }
  $entry = $archive.CreateEntry('manifest.json', [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try { $stream.Write($manifestBytes, 0, $manifestBytes.Length) } finally { $stream.Dispose() }
} finally { $archive.Dispose() }

$readbackEntries = [System.Collections.Generic.List[object]]::new()
$reader = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($reader.Entries.Count -ne ($entrySources.Count + 1)) { throw 'ZIP entry count mismatch.' }
  foreach ($entry in $reader.Entries) {
    $stream = $entry.Open()
    $memory = [System.IO.MemoryStream]::new()
    try {
      $stream.CopyTo($memory)
      $bytes = $memory.ToArray()
    } finally {
      $memory.Dispose()
      $stream.Dispose()
    }
    $digest = Get-Digest $bytes
    if ($entry.FullName -eq 'manifest.json') {
      if ($bytes.Length -ne $manifestBytes.Length -or $digest -ne (Get-Digest $manifestBytes)) { throw 'Manifest full readback mismatch.' }
    } else {
      $expected = $manifestEntries | Where-Object { $_.path -eq $entry.FullName }
      if ($null -eq $expected -or $expected.bytes -ne $bytes.Length -or $expected.sha256 -ne $digest) { throw "Full readback mismatch: $($entry.FullName)" }
    }
    $readbackEntries.Add([ordered]@{ path = $entry.FullName; bytes = $bytes.Length; sha256 = $digest; verified = $true })
  }
} finally { $reader.Dispose() }

$zipBytes = [System.IO.File]::ReadAllBytes($zipPath)
$receipt = [ordered]@{
  package = 'FACTORY09-AUTONOMOUS-01'
  fileDelivery = 'LOCAL_ONLY'
  zipPath = $zipPath
  zipBytes = $zipBytes.Length
  zipSha256 = (Get-Digest $zipBytes)
  fullReadback = $true
  entryCount = $readbackEntries.Count
  entries = $readbackEntries
}
[System.IO.File]::WriteAllText($readbackPath, (($receipt | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output "ZIP_BYTES=$($receipt.zipBytes)"
Write-Output "ZIP_SHA256=$($receipt.zipSha256)"
Write-Output "FULL_READBACK=$($receipt.entryCount)/$($receipt.entryCount)"
