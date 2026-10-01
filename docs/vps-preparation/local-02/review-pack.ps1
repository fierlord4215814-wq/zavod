$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = 'C:\Users\79164\Documents\work'
$ownRuntime = 'C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0'
$artifactRoot = $PSScriptRoot
$zipPath = Join-Path $artifactRoot 'review-pack-local02-20260924.zip'
if (Test-Path -LiteralPath $zipPath) { throw 'Review ZIP already exists; never overwrite retained evidence.' }
$baseline = Get-Content -LiteralPath (Join-Path $artifactRoot 'before.json') -Raw | ConvertFrom-Json
$beforeFiles = @($baseline.files) + @(Get-Content -LiteralPath (Join-Path $artifactRoot 'additional-before.json') -Raw | ConvertFrom-Json) + @(Get-Content -LiteralPath (Join-Path $artifactRoot 'labels-before.json') -Raw | ConvertFrom-Json) + @(Get-Content -LiteralPath (Join-Path $artifactRoot 'test-fixture-before.json') -Raw | ConvertFrom-Json)
$changed = @()
foreach ($item in $beforeFiles) {
  $full = Join-Path $sourceRoot $item.file
  $after = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($after -ne $item.sha256.ToLowerInvariant()) { $changed += [PSCustomObject]@{ file=$item.file; beforeSha256=$item.sha256.ToLowerInvariant(); sha256=$after } }
}
foreach ($file in @('backend/prisma/migrations/20260924190000_local02_chat_and_checklist_reference/migration.sql','backend/scripts/local02-chat-policy.test.js')) {
  $changed += [PSCustomObject]@{ file=$file; beforeSha256=$null; sha256=(Get-FileHash -LiteralPath (Join-Path $sourceRoot $file) -Algorithm SHA256).Hash.ToLowerInvariant() }
}
foreach ($item in $baseline.migrations) {
  $hash = (Get-FileHash -LiteralPath (Join-Path $sourceRoot "backend/prisma/migrations/$($item.name)/migration.sql") -Algorithm SHA256).Hash
  if ($hash.ToLowerInvariant() -ne $item.sha256) { throw "Historical migration changed: $($item.name)" }
}
$hashes = [PSCustomObject]@{ capturedUtc=[DateTime]::UtcNow.ToString('o'); historicalMigrationsUnchanged=56; migrationCount=57; files=@($changed | Sort-Object file) }
[IO.File]::WriteAllText((Join-Path $artifactRoot 'after-hashes.json'), ($hashes | ConvertTo-Json -Depth 6))
$paths = @($changed.file) + @('docs/vps-preparation/local-01/plan.md','docs/vps-preparation/local-01/report.md','docs/vps-preparation/handoff.md','docs/full-ui-interaction-sweep/visual-gap-register.md')
$paths += Get-ChildItem -LiteralPath $artifactRoot -Recurse -File | Where-Object { $_.Extension -in '.md','.json','.txt','.png','.cjs','.ps1' -and $_.Name -ne 'review-pack-readback.json' } | ForEach-Object { $_.FullName.Substring($sourceRoot.Length+1).Replace('\','/') }
$paths = @($paths | Sort-Object -Unique)
$buildStage = Join-Path ([IO.Path]::GetTempPath()) ('zavod-local02-review-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildStage | Out-Null
$secrets = @(Get-ChildItem -LiteralPath (Join-Path $ownRuntime 'secrets') -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName).Trim() } | Where-Object Length -gt 10)
$manifest = @()
foreach ($relative in $paths) {
  $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relative))
  if (!$source.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source escapes project' }
  $bytes = [IO.File]::ReadAllBytes($source)
  if ([IO.Path]::GetExtension($source) -ne '.png') {
    $content = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($secret in $secrets) { if ($content.Contains($secret)) { throw "Owned secret found in artifact candidate: $relative" } }
  }
  $destination = Join-Path $buildStage $relative
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  [IO.File]::WriteAllBytes($destination, $bytes)
  $manifest += [PSCustomObject]@{ file=$relative; bytes=$bytes.Length; sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
}
[IO.File]::WriteAllText((Join-Path $buildStage 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4))
[IO.Compression.ZipFile]::CreateFromDirectory($buildStage, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
$expected = @{}
foreach ($file in Get-ChildItem -LiteralPath $buildStage -Recurse -File) { $relative=$file.FullName.Substring($buildStage.Length+1).Replace('\','/'); $expected[$relative]=@{ bytes=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$readback = @()
try {
  foreach ($entry in $archive.Entries) {
    $name=$entry.FullName.Replace('\','/')
    if (!$expected.ContainsKey($name)) { throw "Unexpected ZIP entry: $name" }
    $stream=$entry.Open(); $buffer=[IO.MemoryStream]::new()
    try { $stream.CopyTo($buffer); $bytes=$buffer.ToArray() } finally { $stream.Dispose(); $buffer.Dispose() }
    $digest=[Security.Cryptography.SHA256]::Create()
    try { $hash=([BitConverter]::ToString($digest.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $digest.Dispose() }
    if ($bytes.Length -ne $expected[$name].bytes -or $hash -ne $expected[$name].sha256) { throw "ZIP readback mismatch: $name" }
    $readback += [PSCustomObject]@{ file=$name; bytes=$bytes.Length; sha256=$hash; verified=$true }
  }
  if ($readback.Count -ne $expected.Count -or @($readback.file | Sort-Object -Unique).Count -ne $expected.Count) { throw 'ZIP entry count/uniqueness mismatch' }
} finally { $archive.Dispose() }
$receipt = [PSCustomObject]@{ verifiedUtc=[DateTime]::UtcNow.ToString('o'); zip='review-pack-local02-20260924.zip'; bytes=(Get-Item -LiteralPath $zipPath).Length; sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant(); fullReadback=$true; ownedSecretScan='PASS'; entries=$readback.Count; files=$readback }
[IO.File]::WriteAllText((Join-Path $artifactRoot 'review-pack-readback.json'), ($receipt | ConvertTo-Json -Depth 6))
# Only remove our newly generated disposable staging copies after complete byte verification.
$resolvedStage=[IO.Path]::GetFullPath($buildStage)
$resolvedTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (!$resolvedStage.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedStage) -notmatch '^zavod-local02-review-[0-9a-f]{32}$') { throw 'Staging cleanup target mismatch' }
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
$receipt | Select-Object zip,bytes,sha256,fullReadback,ownedSecretScan,entries | ConvertTo-Json
