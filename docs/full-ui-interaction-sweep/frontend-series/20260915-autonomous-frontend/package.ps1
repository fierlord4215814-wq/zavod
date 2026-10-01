$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$batchDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $batchDirectory 'package-files.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $batchDirectory 'frontend-series-review.zip'
if (Test-Path -LiteralPath $zipPath) { throw 'Review ZIP exists; do not overwrite evidence.' }
$archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $manifest.entries) {
    $source = [IO.Path]::GetFullPath((Join-Path $batchDirectory $item.path))
    if (-not $source.StartsWith($batchDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Out-of-scope package path' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw "Changed package input: $($item.path)" }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $item.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $batchDirectory 'package-files.json'), 'package-files.json', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  foreach ($item in $manifest.entries) {
    $entry = $archive.GetEntry($item.path)
    if (-not $entry) { throw "Missing ZIP entry: $($item.path)" }
    $stream = $entry.Open()
    try { $hasher = [Security.Cryptography.SHA256]::Create(); $actual = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant(); $hasher.Dispose() } finally { $stream.Dispose() }
    if ($actual -ne $item.sha256) { throw "ZIP hash mismatch: $($item.path)" }
  }
  $count = $archive.Entries.Count
} finally { $archive.Dispose() }
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
$result = [ordered]@{ status='VERIFIED'; entries=$count; verifiedEntries=$manifest.entries.Count; zipBytes=(Get-Item -LiteralPath $zipPath).Length; sha256=$zipHash; excluded='env/cookies/storageState/DB/uploads/original trace archives' }
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $batchDirectory 'zip-verification.json') -Encoding utf8
"$zipHash  frontend-series-review.zip" | Set-Content -LiteralPath (Join-Path $batchDirectory 'review-zip.sha256') -Encoding ascii
$result | ConvertTo-Json
