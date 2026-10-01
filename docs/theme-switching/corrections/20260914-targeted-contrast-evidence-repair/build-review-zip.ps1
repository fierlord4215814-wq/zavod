param(
  [switch]$UpdateTaskPackage
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$correctionRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$zipDirectory = (Resolve-Path -LiteralPath (Join-Path $correctionRoot '..\..\evidence-zips')).Path
$zipPath = Join-Path $zipDirectory '20260914-targeted-contrast-correction.zip'

if ((Test-Path -LiteralPath $zipPath) -and -not $UpdateTaskPackage) {
  throw "Refusing to overwrite existing ZIP: $zipPath"
}

$reportNames = @(
  'progress.md',
  'owner-impact-map.md',
  'resolution-matrix.md',
  'computed-styles.md',
  'test-results.md',
  'changed-files.txt',
  'harness-change-summary.md',
  'applied-product.diff',
  'final-report.md',
  'evidence-selection.txt',
  'build-review-zip.ps1'
)

$files = @()
foreach ($name in $reportNames) {
  $path = Join-Path $correctionRoot $name
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing report file: $path"
  }
  $files += Get-Item -LiteralPath $path
}

$beforeReference = Join-Path $correctionRoot 'before-from-20260913'
$files += Get-ChildItem -LiteralPath $beforeReference -File -Filter '*.png'

$acceptedBatches = @(
  'before-headings-admin-retry2',
  'before-controls',
  'before-checklists-retry1',
  'before-loading',
  'after-headings-admin',
  'after-controls',
  'after-checklists',
  'after-checklists-empty',
  'after-checklists-error-retry1',
  'after-loading-retry1'
)

foreach ($batch in $acceptedBatches) {
  $directory = Join-Path $correctionRoot (Join-Path 'screenshots' $batch)
  $files += Get-ChildItem -LiteralPath $directory -File | Where-Object {
    $_.Extension -eq '.png' -or $_.Name -in @('index.csv', 'runtime.json')
  }
  foreach ($requiredName in @('index.csv', 'runtime.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $directory $requiredName))) {
      throw "Missing $requiredName in $batch"
    }
  }
}

$files = @($files | Sort-Object FullName -Unique)
$manifestPath = Join-Path $correctionRoot 'zip-manifest.csv'
$manifest = foreach ($file in $files) {
  $relativePath = $file.FullName.Substring($correctionRoot.Length + 1).Replace('\', '/')
  [pscustomobject]@{
    Path = $relativePath
    Bytes = $file.Length
    SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
    ArtifactClass = if ($file.Extension -eq '.png') {
      'original-png'
    } elseif ($file.Name -eq 'index.csv') {
      'screenshot-index'
    } elseif ($file.Name -eq 'runtime.json') {
      'runtime-evidence'
    } else {
      'report'
    }
    BuildStatus = 'frontend-production-build-pass'
  }
}
$manifest | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
$files += Get-Item -LiteralPath $manifestPath

$stream = $null
if ($UpdateTaskPackage) {
  $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Update)
  foreach ($entry in @($archive.Entries)) {
    $entry.Delete()
  }
} else {
  $stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
  $archive = [System.IO.Compression.ZipArchive]::new(
    $stream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )
}
try {
  foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($correctionRoot.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $relativePath,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
  if ($null -ne $stream) {
    $stream.Dispose()
  }
}

$openedZip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($openedZip.Entries)
  $forbidden = @($entries | Where-Object {
    $_.FullName -match '(^|/)(\.env|cookies?|storageState|uploads?|database|.*\.db)(/|$)'
  })
  [pscustomobject]@{
    Path = $zipPath
    Bytes = (Get-Item -LiteralPath $zipPath).Length
    SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
    Entries = $entries.Count
    PngEntries = @($entries | Where-Object FullName -Like '*.png').Count
    ForbiddenMatches = $forbidden.Count
    ManifestRows = @($manifest).Count
  }
} finally {
  $openedZip.Dispose()
}
