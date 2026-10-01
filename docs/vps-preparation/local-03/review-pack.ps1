$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$zipPath = Join-Path $PSScriptRoot 'review-pack-local03-20260926.zip'
$manifestPath = Join-Path $PSScriptRoot 'review-pack-manifest.json'
$readbackPath = Join-Path $PSScriptRoot 'review-pack-readback.json'
foreach ($target in @($zipPath, $manifestPath, $readbackPath)) {
  if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite $target" }
}

$selected = @(
  'backend/src/modules/attachments/attachments.service.ts',
  'backend/src/modules/people/people.service.ts',
  'backend/src/modules/returns/returns.service.ts',
  'backend/src/modules/stock/stock.service.ts',
  'backend/src/ws/events.ts',
  'frontend/src/navigation/permissions.ts',
  'frontend/src/screens/ChatsScreen.tsx',
  'frontend/src/screens/PeopleScreen.tsx',
  'frontend/src/screens/ReturnsScreen.tsx',
  'frontend/src/screens/StockScreen.tsx',
  'frontend/src/ws/client.ts',
  'backend/scripts/local03-chat-ui-state.test.js',
  'backend/scripts/local03-people-presence.test.js',
  'backend/scripts/local03-quality-realtime.test.js',
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/20260924190000_local02_chat_and_checklist_reference/migration.sql',
  'docs/vps-preparation/local-03/role-matrix.md',
  'docs/vps-preparation/local-03/five-gate-matrix.md',
  'docs/vps-preparation/local-03/report.md',
  'docs/vps-preparation/local-01/plan.md',
  'docs/vps-preparation/handoff.md',
  'docs/full-ui-interaction-sweep/visual-gap-register.md',
  'docs/vps-preparation/local-03/stop-stand.ps1',
  'docs/vps-preparation/local-03/final-integrity.json',
  'docs/vps-preparation/local-03/final-build-checks.json',
  'docs/vps-preparation/local-03/final57.json',
  'docs/vps-preparation/local-03/late-pair.json',
  'docs/vps-preparation/local-03/late-pair-safe-identity.json',
  'docs/vps-preparation/local-03/restore-user-readback.json',
  'docs/vps-preparation/local-03/native-restart-20260926-112729-938.json',
  'docs/vps-preparation/local-03/native-restart-readback.json',
  'docs/vps-preparation/local-03/final-c0-setup.json',
  'docs/vps-preparation/local-03/final-c0-browser.json',
  'docs/vps-preparation/local-03/final-c0-after-restart.json',
  'docs/vps-preparation/local-03/close-owned-fixtures.json',
  'docs/vps-preparation/local-03/final-live-state.json',
  'docs/vps-preparation/local-03/role-screens.json',
  'docs/vps-preparation/local-03/orders-role-ui.json',
  'docs/vps-preparation/local-03/checklist-roles-ui.json',
  'docs/vps-preparation/local-03/checklist-ui.json',
  'docs/vps-preparation/local-03/checklist-reference-integration.json',
  'docs/vps-preparation/local-03/tasks-ui.json',
  'docs/vps-preparation/local-03/chat-group-ui.json',
  'docs/vps-preparation/local-03/chat-late-file-late-after-lead-final.json',
  'docs/vps-preparation/local-03/people-presence-live.json',
  'docs/vps-preparation/local-03/quality-files-ui.json',
  'docs/vps-preparation/local-03/okk-photo-after.json',
  'docs/vps-preparation/local-03/okk-export-readback.json',
  'docs/vps-preparation/local-03/sec-sql-http.json',
  'docs/vps-preparation/local-03/publications-ui-remainder.json',
  'docs/vps-preparation/local-03/journal-role-ui.json',
  'docs/vps-preparation/local-03/access-036-sec.json',
  'docs/vps-preparation/local-03/factory-b-remainder.json',
  'docs/vps-preparation/local-03/ui063-precondition.json',
  'docs/vps-preparation/local-03/final-c0-mobile.png',
  'docs/vps-preparation/local-03/final-c0-desktop.png',
  'docs/vps-preparation/local-03/checklist-closed.png',
  'docs/vps-preparation/local-03/task-management.png',
  'docs/vps-preparation/local-03/wash-completed.png',
  'docs/vps-preparation/local-03/defrost-calendar-completed.png',
  'docs/vps-preparation/local-03/okk-photo-archive.png',
  'docs/vps-preparation/local-03/return-file-archive.png',
  'docs/vps-preparation/local-03/chat-member-revoked.png',
  'docs/vps-preparation/local-03/ui063-current-precondition.png',
  'docs/vps-preparation/local-03/final-check-logs/chat-policy.txt',
  'docs/vps-preparation/local-03/final-check-logs/checklists.txt',
  'docs/vps-preparation/local-03/final-check-logs/foundation-auth.txt',
  'docs/vps-preparation/local-03/final-check-logs/chat-ui-state.txt',
  'docs/vps-preparation/local-03/final-check-logs/people-presence.txt',
  'docs/vps-preparation/local-03/final-check-logs/quality-realtime.txt',
  'docs/vps-preparation/local-03/final-check-logs/quality-consumers.txt',
  'docs/vps-preparation/local-03/final-check-logs/frontend-build.txt'
)
if (@($selected | Select-Object -Unique).Count -ne $selected.Count) { throw 'Duplicate pack entry' }
$manifestEntries = @()
foreach ($relative in $selected) {
  if ($relative -match '(^|/)(?:secrets|uploads|node_modules)(/|$)|\.env|\.dump$|password|recovery') { throw "Forbidden path: $relative" }
  $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside root: $relative" }
  $item = Get-Item -LiteralPath $full -ErrorAction Stop
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Not a plain file: $relative" }
  $manifestEntries += [pscustomobject]@{ path = $relative; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [pscustomobject]@{
  kind = 'LOCAL03_WINDOWS_FUNCTIONAL_REVIEW_NOT_BACKUP'
  count = $manifestEntries.Count
  entries = $manifestEntries
  excludes = @('credentials', 'secrets', 'database dumps', 'uploads', 'runtime configuration values')
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$all = @($selected) + @('docs/vps-preparation/local-03/review-pack-manifest.json')
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $all) {
    $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }

$readback = @()
$zipRead = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($zipRead.Entries.Count -ne $all.Count) { throw 'ZIP entry count mismatch' }
  foreach ($entry in $zipRead.Entries) {
    if ($entry.FullName -notin $all) { throw "Unexpected ZIP entry: $($entry.FullName)" }
    $source = [IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceBytes = (Get-Item -LiteralPath $source).Length
    $stream = $entry.Open()
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $entryHash = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
    finally { $hasher.Dispose(); $stream.Dispose() }
    if ($entry.Length -ne $sourceBytes -or $entryHash -ne $sourceHash) { throw "ZIP byte/SHA mismatch: $($entry.FullName)" }
    $readback += [pscustomobject]@{ path = $entry.FullName; bytes = $entry.Length; sha256 = $entryHash }
  }
} finally { $zipRead.Dispose() }
$result = [pscustomobject]@{
  status = 'PASS_FULL_ZIP_ENTRY_BYTE_SHA_READBACK'
  zip = 'docs/vps-preparation/local-03/review-pack-local03-20260926.zip'
  bytes = (Get-Item -LiteralPath $zipPath).Length
  sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  entryCount = $readback.Count
  entries = $readback
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $readbackPath -Encoding utf8
$result | Select-Object status, zip, bytes, sha256, entryCount
