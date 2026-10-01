$ErrorActionPreference = 'Stop'

$batchRoot = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $batchRoot '..\..\..\..'))
$previousRoot = Join-Path $repoRoot 'docs\theme-switching\corrections\20260914-targeted-contrast-evidence-repair'
$inputZip = 'C:\Users\79164\Downloads\ZAVOD_THEME_LABELS_EVIDENCE_CODEX_PACKAGE_2026-09-14.zip'
$zipPath = Join-Path $repoRoot 'docs\theme-switching\evidence-zips\20260914-tc14-label-visibility-evidence.zip'
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-Sha256([string]$path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
}

function Write-Utf8([string]$path, [string]$content) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
  [IO.File]::WriteAllText($path, $content, $utf8)
}

function Remove-Section([string]$content, [string]$startMarker, [string]$endMarker) {
  $start = $content.IndexOf($startMarker, [StringComparison]::Ordinal)
  if ($start -lt 0) { throw "Start marker not found: $startMarker" }
  $end = $content.IndexOf($endMarker, $start, [StringComparison]::Ordinal)
  if ($end -lt 0) { throw "End marker not found: $endMarker" }
  return $content.Substring(0, $start) + $content.Substring($end)
}

$inputMapRoot = Join-Path $batchRoot 'input-map'
[IO.Directory]::CreateDirectory($inputMapRoot) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputArchive = [IO.Compression.ZipFile]::OpenRead($inputZip)
try {
  $extract = @(
    @{ Entry = 'README.md'; Destination = 'package-README.md' },
    @{ Entry = 'tc14-targets.csv'; Destination = 'tc14-targets.csv' },
    @{ Entry = 'tc14-targets.json'; Destination = 'tc14-targets.json' },
    @{ Entry = 'review/ZAVOD_CONTRAST_CORRECTION_REVIEW_2026-09-14.md'; Destination = 'ZAVOD_CONTRAST_CORRECTION_REVIEW_2026-09-14.md' }
  )
  foreach ($item in $extract) {
    $entry = $inputArchive.GetEntry($item.Entry)
    if (-not $entry) { throw "Input ZIP entry missing: $($item.Entry)" }
    $destination = Join-Path $inputMapRoot $item.Destination
    $sourceStream = $entry.Open()
    $targetStream = [IO.File]::Create($destination)
    try { $sourceStream.CopyTo($targetStream) } finally { $targetStream.Dispose(); $sourceStream.Dispose() }
  }
} finally {
  $inputArchive.Dispose()
}

$targets = Get-Content -LiteralPath (Join-Path $inputMapRoot 'tc14-targets.json') -Raw | ConvertFrom-Json
if ($targets.Count -ne 21) { throw "Expected 21 TC14 target rows, got $($targets.Count)" }
if (@($targets | Where-Object observation -eq 'TC14-E01').Count -ne 13) { throw 'Expected 13 TC14-E01 rows' }
if (@($targets | Where-Object observation -eq 'TC14-01').Count -ne 8) { throw 'Expected 8 TC14-01 rows' }

$sourceTargetsRoot = Join-Path $batchRoot 'source-targets'
[IO.Directory]::CreateDirectory($sourceTargetsRoot) | Out-Null
$sourceCopies = @{}
foreach ($target in $targets) {
  $source = Join-Path $previousRoot ($target.source_relative_path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $source)) { throw "Previous source target missing: $source" }
  $actualHash = Get-Sha256 $source
  if ($actualHash -ne $target.sha256.ToLowerInvariant()) { throw "Previous source hash mismatch: $($target.review_id)" }
  $leaf = [IO.Path]::GetFileName($source)
  $destinationName = "$($target.review_id)-$leaf"
  $destination = Join-Path $sourceTargetsRoot $destinationName
  [IO.File]::WriteAllBytes($destination, [IO.File]::ReadAllBytes($source))
  $sourceCopies[$target.review_id] = "source-targets/$destinationName"
}

$acceptedParts = @(
  'before-tc14-labels',
  'after-tc14-labels',
  'after-tc14-visible-checklists',
  'after-tc14-visible-gallery',
  'after-tc14-visible-orders'
)
$allEvidence = @()
foreach ($part in $acceptedParts) {
  $indexPath = Join-Path $batchRoot "screenshots\$part\index.csv"
  if (-not (Test-Path -LiteralPath $indexPath)) { throw "Accepted index missing: $part" }
  foreach ($row in (Import-Csv -LiteralPath $indexPath)) {
    $allEvidence += [pscustomobject]@{
      relativePath = "screenshots/$part/$($row.file)"
      evidencePart = $part
      file = $row.file
      sha256 = $row.sha256
      bytes = $row.bytes
      theme = $row.theme
      width = $row.width
      state = $row.state
      role = $row.role
      capturedAt = $row.capturedAt
      productStyleFingerprint = $row.productStyleFingerprint
      harnessFingerprint = $row.harnessFingerprint
      oldReviewId = $row.oldReviewId
      sourceRelativePath = $row.sourceRelativePath
      visibilityStatus = $row.visibilityStatus
      scrollMethod = $row.scrollMethod
      correctionPhase = $row.correctionPhase
      correctionPart = $row.correctionPart
    }
  }
}
if ($allEvidence.Count -ne 49) { throw "Expected 49 accepted new PNG rows, got $($allEvidence.Count)" }
$allEvidence | Export-Csv -LiteralPath (Join-Path $batchRoot 'evidence-index.csv') -NoTypeInformation -Encoding utf8

$mapping = @()
foreach ($target in $targets) {
  $viewport = if ([int]$target.width -eq 1440) { 'desktop' } else { [string]$target.width }
  if ($target.observation -eq 'TC14-01') {
    $newRelativePath = "screenshots/after-tc14-labels/$viewport-$($target.theme)-chat-form-labels.png"
    $status = 'FIXED_VERIFIED'
  } elseif ($target.state -eq 'checklists-real-checkbox') {
    $newRelativePath = "screenshots/after-tc14-visible-checklists/$($target.width)-$($target.theme)-checklists-only-deviations-visible.png"
    $status = 'VERIFIED_VISIBLE'
  } elseif ($target.state -eq 'gallery-checkbox') {
    $newRelativePath = "screenshots/after-tc14-visible-gallery/desktop-$($target.theme)-gallery-checkbox-visible.png"
    $status = 'VERIFIED_VISIBLE'
  } elseif ($target.state -eq 'orders-tabs') {
    $newRelativePath = "screenshots/after-tc14-visible-orders/desktop-$($target.theme)-orders-tabs-visible.png"
    $status = 'VERIFIED_VISIBLE'
  } else {
    throw "Unknown target state: $($target.state)"
  }
  $newRow = $allEvidence | Where-Object relativePath -eq $newRelativePath | Select-Object -First 1
  if (-not $newRow) { throw "Mapped new evidence missing: $newRelativePath" }
  $mapping += [pscustomobject]@{
    reviewId = $target.review_id
    observation = $target.observation
    theme = $target.theme
    width = $target.width
    state = $target.state
    target = $target.target
    oldSourcePath = $target.source_relative_path
    oldSha256 = $target.sha256
    packagedOldSource = $sourceCopies[$target.review_id]
    newEvidencePath = $newRelativePath
    newSha256 = $newRow.sha256
    result = $status
  }
}
$mapping | Export-Csv -LiteralPath (Join-Path $batchRoot 'old-to-new-mapping.csv') -NoTypeInformation -Encoding utf8

$labelComputed = @()
foreach ($part in @('before-tc14-labels', 'after-tc14-labels')) {
  $runtime = Get-Content -LiteralPath (Join-Path $batchRoot "screenshots\$part\runtime.json") -Raw | ConvertFrom-Json
  foreach ($row in ($runtime.computedStyles | Where-Object { $_.caseId -like 'tc14-*' })) {
    $labelComputed += [pscustomobject]@{
      evidencePart = $part
      phase = if ($part.StartsWith('before')) { 'before' } else { 'after' }
      caseId = $row.caseId
      theme = $row.selectedTheme
      width = $row.width
      selector = $row.selector
      text = $row.text
      color = $row.color
      backgroundColor = $row.backgroundColor
      opacity = $row.opacity
      disabled = $row.disabled
      rectX = $row.rect.x
      rectY = $row.rect.y
      rectWidth = $row.rect.width
      rectHeight = $row.rect.height
    }
  }
}
$labelComputed | Export-Csv -LiteralPath (Join-Path $batchRoot 'computed-labels.csv') -NoTypeInformation -Encoding utf8

$visibilityRecords = @()
foreach ($part in @('after-tc14-visible-checklists', 'after-tc14-visible-gallery', 'after-tc14-visible-orders')) {
  $runtime = Get-Content -LiteralPath (Join-Path $batchRoot "screenshots\$part\runtime.json") -Raw | ConvertFrom-Json
  foreach ($row in $runtime.visibilityChecks) {
    $visibilityRecords += [pscustomobject]@{
      evidencePart = $part
      reviewId = $row.oldReviewId
      theme = $row.selectedTheme
      width = $row.width
      scrollMethod = $row.scrollMethod
      targetText = $row.text
      rect = $row.rect
      viewport = $row.viewport
      effectiveClip = $row.effectiveClip
      clippingAncestors = $row.clippingAncestors
      points = $row.points
      fullyInsideClip = $row.fullyInsideClip
      hitTestClear = $row.hitTestClear
      fullyVisible = $row.fullyVisible
    }
  }
}
if ($visibilityRecords.Count -ne 13 -or @($visibilityRecords | Where-Object { -not $_.fullyVisible }).Count -ne 0) {
  throw 'TC14-E01 visibility result is not exactly 13/13'
}
Write-Utf8 (Join-Path $batchRoot 'visibility-results.json') (($visibilityRecords | ConvertTo-Json -Depth 12) + "`n")
$visibilityRecords | Select-Object evidencePart,reviewId,theme,width,scrollMethod,targetText,fullyInsideClip,hitTestClear,fullyVisible,@{n='rectX';e={$_.rect.x}},@{n='rectY';e={$_.rect.y}},@{n='rectWidth';e={$_.rect.width}},@{n='rectHeight';e={$_.rect.height}},@{n='clipTop';e={$_.effectiveClip.top}},@{n='clipBottom';e={$_.effectiveClip.bottom}} | Export-Csv -LiteralPath (Join-Path $batchRoot 'visibility-results.csv') -NoTypeInformation -Encoding utf8

$baselineRoot = Join-Path $batchRoot 'baseline-source'
$finalRoot = Join-Path $batchRoot 'final-source'
[IO.Directory]::CreateDirectory($baselineRoot) | Out-Null
[IO.Directory]::CreateDirectory($finalRoot) | Out-Null

$stylesPath = Join-Path $repoRoot 'frontend\src\styles.css'
$stylesCurrent = [IO.File]::ReadAllText($stylesPath)
$stylesBefore = Remove-Section $stylesCurrent '  :root:is([data-theme="gray"], [data-theme="light"]) .modal-card .form-grid > label:not(.checkbox-row) {' '  :root:is([data-theme="gray"], [data-theme="light"]) .form-grid .checkbox-row {'
$stylesBeforePath = Join-Path $baselineRoot 'styles.before-tc14.css'
Write-Utf8 $stylesBeforePath $stylesBefore
if ((Get-Sha256 $stylesBeforePath) -ne '01ad09437159036198ed3ded733ba224e8da1fdeb52f7263e494851753dcc92b') {
  throw 'Reconstructed styles baseline does not match recorded start SHA-256'
}
$stylesAfterPath = Join-Path $finalRoot 'styles.after-tc14.css'
[IO.File]::WriteAllBytes($stylesAfterPath, [IO.File]::ReadAllBytes($stylesPath))

$specPath = Join-Path $repoRoot 'frontend\e2e\three-themes.spec.ts'
$specCurrent = [IO.File]::ReadAllText($specPath)
$newline = if ($specCurrent.Contains("`r`n")) { "`r`n" } else { "`n" }
$tc14Marker = $newline + "test('TC14-01 real modal form labels and affected shared consumers'"
$tc14Start = $specCurrent.IndexOf($tc14Marker, [StringComparison]::Ordinal)
if ($tc14Start -lt 0) { throw 'TC14 test marker not found' }
$specBefore = $specCurrent.Substring(0, $tc14Start)
$specBefore = $specBefore.Replace("import { expect, Locator, Page, Route, test } from '@playwright/test';", "import { expect, Page, Route, test } from '@playwright/test';")
$specBefore = $specBefore.Replace("  visibilityChecks: Array<Record<string, unknown>>;$newline", '')
$specBefore = $specBefore.Replace("  visibilityChecks: [],$newline", '')
$specBefore = Remove-Section $specBefore "const productStyleFingerprint = crypto.createHash('sha256')" 'type IsolatedIdentity'
$captureStart = $specBefore.IndexOf('  runtime.screenshots.push({', [StringComparison]::Ordinal)
$captureEnd = $specBefore.IndexOf('  expect(geometry.overflowX)', $captureStart, [StringComparison]::Ordinal)
if ($captureStart -lt 0 -or $captureEnd -lt 0) { throw 'Capture metadata block not found' }
$specBefore = $specBefore.Substring(0, $captureStart) + '  runtime.screenshots.push({ file, ...geometry, ...extra });' + $newline + $specBefore.Substring($captureEnd)
$specBefore = Remove-Section $specBefore 'async function recordLocatorComputedStyle(' 'async function recordComputedStyle('
$specBefore = Remove-Section $specBefore 'async function recordTargetVisibility(' 'function csvCell('
$specBefore = Remove-Section $specBefore 'function tc14LabelCombinations()' 'function correctionPartEnabled('
$columnsStart = $specBefore.IndexOf('  const columns = [', [StringComparison]::Ordinal)
$columnsEnd = $specBefore.IndexOf('  const lines =', $columnsStart, [StringComparison]::Ordinal)
if ($columnsStart -lt 0 -or $columnsEnd -lt 0) { throw 'Index columns block not found' }
$originalColumns = "  const columns = ['file', 'sha256', 'bytes', 'theme', 'width', 'state', 'role', 'correctionPhase', 'correctionPart'];$newline"
$specBefore = $specBefore.Substring(0, $columnsStart) + $originalColumns + $specBefore.Substring($columnsEnd)
$specBeforePath = Join-Path $baselineRoot 'three-themes.before-tc14.spec.ts'
Write-Utf8 $specBeforePath $specBefore
if ((Get-Sha256 $specBeforePath) -ne 'e31d666bad11d3134e0b3f7f5f6b806856fa4ba5649c7aebf5b2f0841c047cea') {
  throw 'Reconstructed harness baseline does not match recorded start SHA-256'
}
$specAfterPath = Join-Path $finalRoot 'three-themes.after-tc14.spec.ts'
[IO.File]::WriteAllBytes($specAfterPath, [IO.File]::ReadAllBytes($specPath))

Push-Location $repoRoot
try {
  $productDiff = (& git diff --no-index --no-ext-diff --unified=8 -- 'docs/theme-switching/corrections/20260914-tc14-label-visibility-evidence/baseline-source/styles.before-tc14.css' 'frontend/src/styles.css' 2>$null) -join "`n"
  if ($LASTEXITCODE -notin 0,1) { throw 'Product diff generation failed' }
  $harnessDiff = (& git diff --no-index --no-ext-diff --unified=8 -- 'docs/theme-switching/corrections/20260914-tc14-label-visibility-evidence/baseline-source/three-themes.before-tc14.spec.ts' 'frontend/e2e/three-themes.spec.ts' 2>$null) -join "`n"
  if ($LASTEXITCODE -notin 0,1) { throw 'Harness diff generation failed' }
} finally {
  Pop-Location
}
Write-Utf8 (Join-Path $batchRoot 'applied-product.diff') ($productDiff + "`n")
Write-Utf8 (Join-Path $batchRoot 'applied-harness.diff') ($harnessDiff + "`n")
Write-Utf8 (Join-Path $batchRoot 'full-applied.diff') ("# PRODUCT OWNER`n$productDiff`n`n# EXISTING EVIDENCE HARNESS`n$harnessDiff`n")

$excludedPattern = '[\\/](failures)[\\/]|interrupted|package-verification\.txt$|package-manifest\.csv$'
$batchFiles = @(Get-ChildItem -LiteralPath $batchRoot -Recurse -File | Where-Object { $_.FullName -notmatch $excludedPattern })
$pointerFiles = @(
  @{ Path = Join-Path $repoRoot 'docs\theme-switching\progress.md'; ArchivePath = 'pointers/theme-progress.md' },
  @{ Path = Join-Path $repoRoot 'docs\theme-switching\verification-summary.md'; ArchivePath = 'pointers/theme-verification-summary.md' },
  @{ Path = Join-Path $repoRoot 'docs\full-ui-interaction-sweep\progress.md'; ArchivePath = 'pointers/main-ui-sweep-progress.md' }
)
$manifestRows = @()
foreach ($file in $batchFiles) {
  $relative = $file.FullName.Substring($batchRoot.Length).TrimStart('\').Replace('\', '/')
  $manifestRows += [pscustomobject]@{ archivePath = "batch/$relative"; bytes = $file.Length; sha256 = Get-Sha256 $file.FullName }
}
foreach ($pointer in $pointerFiles) {
  $item = Get-Item -LiteralPath $pointer.Path
  $manifestRows += [pscustomobject]@{ archivePath = $pointer.ArchivePath; bytes = $item.Length; sha256 = Get-Sha256 $item.FullName }
}
$manifestRows | Sort-Object archivePath | Export-Csv -LiteralPath (Join-Path $batchRoot 'package-manifest.csv') -NoTypeInformation -Encoding utf8

if (Test-Path -LiteralPath $zipPath) { throw "Refusing to overwrite existing review ZIP: $zipPath" }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($zipPath)) | Out-Null
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $batchFiles) {
    $relative = $file.FullName.Substring($batchRoot.Length).TrimStart('\').Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, "batch/$relative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  $manifestPath = Join-Path $batchRoot 'package-manifest.csv'
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $manifestPath, 'batch/package-manifest.csv', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  foreach ($pointer in $pointerFiles) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $pointer.Path, $pointer.ArchivePath, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

$zipItem = Get-Item -LiteralPath $zipPath
$zipHash = Get-Sha256 $zipPath
$countArchive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $zipEntryCount = $countArchive.Entries.Count
} finally {
  $countArchive.Dispose()
}
$verification = @"
REVIEW_ZIP=$zipPath
BYTES=$($zipItem.Length)
SHA256=$($zipHash.ToUpperInvariant())
ENTRIES=$zipEntryCount
MANIFEST_EXCLUDES_ITSELF=YES
INTERRUPTED_TRACES_EXCLUDED_FROM_ZIP=YES_RETAINED_ON_DISK
"@
# Re-open only to validate every non-manifest manifest row against the archive.
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entryMap = @{}
  foreach ($entry in $archive.Entries) { $entryMap[$entry.FullName] = $entry }
  foreach ($row in $manifestRows) {
    if (-not $entryMap.ContainsKey($row.archivePath)) { throw "ZIP entry missing: $($row.archivePath)" }
    $stream = $entryMap[$row.archivePath].Open()
    try {
      $hash = [Security.Cryptography.SHA256]::Create()
      try { $actual = [Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant() } finally { $hash.Dispose() }
    } finally { $stream.Dispose() }
    if ($actual -ne $row.sha256) { throw "ZIP entry hash mismatch: $($row.archivePath)" }
  }
} finally { $archive.Dispose() }
Write-Utf8 (Join-Path $batchRoot 'package-verification.txt') ($verification.Trim() + "`nHASH_VALIDATION=PASS`n")
Write-Output $verification.Trim()
Write-Output 'HASH_VALIDATION=PASS'
