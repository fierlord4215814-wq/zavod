$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outDir = Join-Path $repoRoot 'docs/vps-preparation/local-01'
$archivePath = Join-Path $outDir 'review-pack.zip'
$afterPath = Join-Path $outDir 'after-hashes.json'
$receiptPath = Join-Path $outDir 'review-pack-readback.json'

$paths = @(
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'docker-compose.production.yml',
  'backend/Dockerfile.production',
  'frontend/Dockerfile.production',
  'backend/package.json',
  'backend/prisma/schema.prisma',
  'backend/prisma/system-foundation.cjs',
  'backend/src/modules/auth/auth.service.ts',
  'backend/src/common/system-foundation.ts',
  'backend/src/common/first-admin-bootstrap.ts',
  'backend/src/common/user-context.service.ts',
  'backend/src/ws/ws.service.ts',
  'backend/scripts/vps-prep-01-regression.js',
  'backend/scripts/vps-prep-01-postgres-integration.js',
  'backend/scripts/local-01-auth-regression.js',
  'setup/storage-contract.js',
  'setup/deployment-context.js',
  'setup/zavod-setup.js',
  'setup/vps-prep-02-regression.js',
  'setup/vps-prep-02-docker-shim.js',
  'setup/local-01-package-review.ps1',
  'docs/vps-preparation/handoff.md',
  'docs/vps-preparation/vps-prep-01/review-report.md',
  'docs/vps-preparation/vps-prep-02/review-report.md',
  'docs/vps-preparation/local-01/before-hashes.json',
  'docs/vps-preparation/local-01/plan.md',
  'docs/vps-preparation/local-01/report.md',
  'docs/vps-preparation/local-01/logs/auth-before.txt',
  'docs/vps-preparation/local-01/logs/auth-after-final.txt',
  'docs/vps-preparation/local-01/logs/storage-before.txt',
  'docs/vps-preparation/local-01/logs/setup-before.txt',
  'docs/vps-preparation/local-01/logs/retry-before.txt',
  'docs/vps-preparation/local-01/logs/registration-before.txt',
  'docs/vps-preparation/local-01/logs/backup-before.txt',
  'docs/vps-preparation/local-01/logs/setup-after-final.txt',
  'docs/vps-preparation/local-01/logs/prep01-after-final.txt',
  'docs/vps-preparation/local-01/logs/backend-build.txt',
  'docs/vps-preparation/local-01/logs/native-initdb.txt',
  'docs/vps-preparation/local-01/logs/native-prep01-integration.txt',
  'docs/vps-preparation/local-01/logs/native-prep01-continued.txt',
  'docs/vps-preparation/local-01/logs/native-prep01-http-ws.txt'
)

$items = foreach ($relative in $paths) {
  $full = Join-Path $repoRoot ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Review file missing: $relative" }
  $item = Get-Item -LiteralPath $full
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Review symlink refused: $relative" }
  [pscustomobject]@{
    path = $relative
    bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$identityLines = ($items | ForEach-Object { "$($_.sha256)  $($_.path)" }) -join "`n"
$identityBytes = [Text.Encoding]::UTF8.GetBytes($identityLines)
$identity = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($identityBytes)).ToLowerInvariant()
$after = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'PARTIAL_BLOCKED_ENVIRONMENT'
  schemaDrift = 'FAIL_FRESH_AND_UPGRADE'
  sourceIdentitySha256 = $identity
  note = 'Selected source/review identity, not a built Docker image or Linux runtime identity. No secrets, databases, uploads or old evidence packs.'
  files = @($items)
}
[IO.File]::WriteAllText($afterPath, (($after | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))

$packPaths = @($paths) + @('docs/vps-preparation/local-01/after-hashes.json')
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $packPaths) {
    $full = Join-Path $repoRoot ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $full, $relative, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }

$expected = @{}
foreach ($item in $items) { $expected[$item.path] = $item.sha256 }
$expected['docs/vps-preparation/local-01/after-hashes.json'] = (Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash.ToLowerInvariant()
$readback = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($readback.Entries.Count -ne $packPaths.Count) { throw 'Review ZIP entry count mismatch' }
  foreach ($entry in $readback.Entries) {
    if (-not $expected.ContainsKey($entry.FullName)) { throw "Unexpected ZIP entry: $($entry.FullName)" }
    $stream = $entry.Open()
    try {
      $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant()
      if ($hash -ne $expected[$entry.FullName]) { throw "ZIP readback mismatch: $($entry.FullName)" }
    } finally { $stream.Dispose() }
  }
} finally { $readback.Dispose() }

$zip = Get-Item -LiteralPath $archivePath
$receipt = [ordered]@{
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'ALL_ENTRIES_SHA256_MATCH'
  entries = $packPaths.Count
  bytes = $zip.Length
  archiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceIdentitySha256 = $identity
}
[IO.File]::WriteAllText($receiptPath, (($receipt | ConvertTo-Json -Depth 5) + "`n"), [Text.UTF8Encoding]::new($false))
$receipt | ConvertTo-Json -Depth 5
