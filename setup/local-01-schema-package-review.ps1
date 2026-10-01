$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outDir = Join-Path $repoRoot 'docs/vps-preparation/local-01/schema-reconciliation'
$integrationPath = Join-Path $outDir 'integration-full-final.txt'
$integration = Get-Content -LiteralPath $integrationPath -Raw | ConvertFrom-Json
if ($integration.status -ne 'PASS' -or $integration.cleanup.status -ne 'PASS' -or $integration.cleanup.remaining -ne 0) {
  throw 'Final integration or cleanup proof is not PASS'
}
if ($integration.schemaDiffProofs.Count -ne 3) { throw 'Expected fresh, upgrade, and repeat schema diffs' }

$proofFiles = @('fresh-diff.json', 'upgrade-diff.json', 'repeat-upgrade-diff.json')
for ($i = 0; $i -lt $proofFiles.Count; $i++) {
  $proof = $integration.schemaDiffProofs[$i]
  if ($proof.exitCode -ne 0 -or $proof.stdout -ne "No difference detected.`n`n" -or $proof.stderr -ne '') {
    throw "Schema proof $i did not show a true empty diff"
  }
  $proofPath = Join-Path $outDir $proofFiles[$i]
  [IO.File]::WriteAllText($proofPath, (($proof | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
}

$paths = @(
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/20260923193000_local01_schema_contract_reconciliation/migration.sql',
  'backend/scripts/vps-prep-01-postgres-integration.js',
  'backend/scripts/vps-prep-01-regression.js',
  'backend/scripts/local-01-schema-client-probe.js',
  'setup/local-01-schema-package-review.ps1',
  'docs/vps-preparation/handoff.md',
  'docs/vps-preparation/local-01/plan.md',
  'docs/vps-preparation/local-01/report.md',
  'docs/vps-preparation/local-01/schema-reconciliation/before-hashes.json',
  'docs/vps-preparation/local-01/schema-reconciliation/catalog-readback.sql',
  'docs/vps-preparation/local-01/schema-reconciliation/constraint-probes.sql',
  'docs/vps-preparation/local-01/schema-reconciliation/catalog-before.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/catalog-after.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/catalog-diff-after.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/expected-fk-only-diff-after-copy.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/fresh-diff.json',
  'docs/vps-preparation/local-01/schema-reconciliation/upgrade-diff.json',
  'docs/vps-preparation/local-01/schema-reconciliation/repeat-upgrade-diff.json',
  'docs/vps-preparation/local-01/schema-reconciliation/constraint-probes-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/client-create-probe.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/prisma-validate-after-copy.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/prisma-generate-owned.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/backend-build-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/prep01-regression-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/prep02-regression-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/auth-regression-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/integration-full-final.txt',
  'docs/vps-preparation/local-01/schema-reconciliation/cleanup-receipt.json',
  'docs/vps-preparation/local-01/logs/native-prep01-integration.txt'
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
$identity = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identityLines))).ToLowerInvariant()
$afterPath = Join-Path $outDir 'after-hashes.json'
$after = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'SCHEMA_RECONCILIATION_PASS_POSTGRESQL18_WINDOWS__LOCAL01_PARTIAL_BLOCKED_ENVIRONMENT'
  sourceIdentitySha256 = $identity
  note = 'Selected source/review identity, not a Docker image, Linux runtime, working DB, or VPS proof. No secrets or data files.'
  files = @($items)
}
[IO.File]::WriteAllText($afterPath, (($after | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))

$archivePath = Join-Path $outDir 'review-pack.zip'
if (Test-Path -LiteralPath $archivePath) { throw 'Schema review ZIP already exists; preserve the prior proof' }
$packPaths = @($paths) + @('docs/vps-preparation/local-01/schema-reconciliation/after-hashes.json')
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $packPaths) {
    $full = Join-Path $repoRoot ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $full, $relative, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }

$expected = @{}
foreach ($item in $items) { $expected[$item.path] = $item }
$afterItem = Get-Item -LiteralPath $afterPath
$expected['docs/vps-preparation/local-01/schema-reconciliation/after-hashes.json'] = [pscustomobject]@{
  path = 'docs/vps-preparation/local-01/schema-reconciliation/after-hashes.json'
  bytes = $afterItem.Length
  sha256 = (Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$readback = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($readback.Entries.Count -ne $packPaths.Count) { throw 'Review ZIP entry count mismatch' }
  $verifiedEntries = foreach ($entry in $readback.Entries) {
    if (-not $expected.ContainsKey($entry.FullName)) { throw "Unexpected ZIP entry: $($entry.FullName)" }
    $wanted = $expected[$entry.FullName]
    if ($entry.Length -ne $wanted.bytes) { throw "ZIP byte mismatch: $($entry.FullName)" }
    $stream = $entry.Open()
    try {
      $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant()
      if ($hash -ne $wanted.sha256) { throw "ZIP SHA256 mismatch: $($entry.FullName)" }
      [pscustomobject]@{ path = $entry.FullName; bytes = $entry.Length; sha256 = $hash }
    } finally { $stream.Dispose() }
  }
} finally { $readback.Dispose() }

$zip = Get-Item -LiteralPath $archivePath
$receipt = [ordered]@{
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'ALL_ENTRIES_BYTES_AND_SHA256_MATCH'
  entries = $packPaths.Count
  bytes = $zip.Length
  archiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceIdentitySha256 = $identity
  verifiedFiles = @($verifiedEntries)
}
$receiptPath = Join-Path $outDir 'review-pack-readback.json'
[IO.File]::WriteAllText($receiptPath, (($receipt | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
$receipt | Select-Object status,entries,bytes,archiveSha256,sourceIdentitySha256 | ConvertTo-Json
