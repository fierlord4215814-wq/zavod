$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$reviewRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$reviewPrefix = 'docs/vps-preparation/admin-01/'
$zipPath = Join-Path $PSScriptRoot 'review-pack-admin01-20260926.zip'
$readbackPath = Join-Path $PSScriptRoot 'review-pack-readback.json'
foreach ($target in @($zipPath, $readbackPath)) {
  if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite $target" }
}
function Resolve-ReviewFile([string]$Relative) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $reviewRoot $Relative))
  if (-not $resolved.StartsWith($reviewRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Outside canonical review root' }
  $file = Get-Item -LiteralPath $resolved -ErrorAction Stop
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Not a plain file: $Relative" }
  return $resolved
}
$manifestRelative = $reviewPrefix + 'review-pack-manifest.json'
$manifest = Get-Content -LiteralPath (Resolve-ReviewFile $manifestRelative) -Raw | ConvertFrom-Json
$expected = @{}
foreach ($entry in $manifest.entries) {
  if ($expected.ContainsKey($entry.path)) { throw 'Duplicate manifest entry' }
  $file = Resolve-ReviewFile $entry.path
  if ((Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { throw "Source changed after preflight: $($entry.path)" }
  $expected[$entry.path] = $entry
}
if ($expected.Count -ne $manifest.count) { throw 'Manifest count mismatch' }
$manifestFile = Resolve-ReviewFile $manifestRelative
$expected[$manifestRelative] = [pscustomobject]@{ path = $manifestRelative; bytes = (Get-Item -LiteralPath $manifestFile).Length; sha256 = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() }
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in @($expected.Keys | Sort-Object)) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-ReviewFile $relative), $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }

$readback = @()
$seen = @{}
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($archive.Entries.Count -ne $expected.Count) { throw 'ZIP entry count mismatch' }
  foreach ($entry in $archive.Entries) {
    if ($seen.ContainsKey($entry.FullName) -or -not $expected.ContainsKey($entry.FullName)) { throw "Duplicate/unexpected ZIP entry: $($entry.FullName)" }
    $seen[$entry.FullName] = $true
    $stream = $entry.Open()
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
    finally { $hasher.Dispose(); $stream.Dispose() }
    $source = $expected[$entry.FullName]
    if ($entry.Length -ne $source.bytes -or $digest -cne $source.sha256) { throw "Full stream byte/SHA mismatch: $($entry.FullName)" }
    $current = Resolve-ReviewFile $entry.FullName
    if ((Get-FileHash -LiteralPath $current -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) { throw "Source changed while packing: $($entry.FullName)" }
    $readback += [pscustomobject]@{ path = $entry.FullName; bytes = $entry.Length; sha256 = $digest }
  }
} finally { $archive.Dispose() }
$result = [pscustomobject]@{
  status = 'PASS_FULL_ZIP_ENTRY_BYTE_SHA_READBACK'
  atUtc = [DateTime]::UtcNow.ToString('o')
  zip = $reviewPrefix + 'review-pack-admin01-20260926.zip'
  bytes = (Get-Item -LiteralPath $zipPath).Length
  sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  entryCount = $readback.Count
  finalSourceIdentity = $manifest.finalSourceIdentity
  manifestIncluded = $true
  duplicateOrUnexpectedEntries = 0
  fullStreamReadback = $true
  entries = $readback
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $readbackPath -Encoding utf8
$result | Select-Object status, zip, bytes, sha256, entryCount, fullStreamReadback | ConvertTo-Json
