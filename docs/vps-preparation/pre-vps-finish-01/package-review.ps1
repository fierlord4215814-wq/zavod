$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$stage = Join-Path $env:TEMP ('zavod-pre-vps-review-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
$changed = @(
  'AGENTS.md', 'docs/vps-preparation/handoff.md',
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/20260930210000_pre_vps_login_throttle/migration.sql',
  'backend/prisma/migrations/20260930211000_pre_vps_chambers/migration.sql',
  'backend/src/common/password.ts', 'backend/src/common/first-admin-bootstrap.ts',
  'backend/src/modules/auth/auth.service.ts', 'backend/src/modules/auth/login-throttle.ts',
  'backend/src/modules/admin/admin.service.ts',
  'backend/src/modules/defrost/chamber-visibility.ts', 'backend/src/modules/defrost/chamber.service.ts',
  'backend/src/modules/defrost/defrost.service.ts', 'backend/src/modules/defrost/defrost.controller.ts',
  'backend/src/modules/defrost/defrost.module.ts', 'backend/src/modules/line/line.service.ts',
  'backend/src/modules/notifications/notifications.service.ts',
  'backend/src/modules/archive/archive.service.ts', 'backend/src/modules/archive/archive-xlsx.service.ts',
  'backend/src/modules/ops/ops.service.ts',
  'frontend/src/components/ChamberPanel.tsx', 'frontend/src/screens/DefrostScreen.tsx',
  'frontend/src/screens/FactorySelectScreen.tsx', 'frontend/src/App.tsx',
  'frontend/Dockerfile.production', 'frontend/nginx.production.conf', 'frontend/nginx.https.example.conf',
  'docker-compose.production.yml', 'setup/zavod-setup.js', 'setup/vps-tech-01-r1.test.cjs',
  'backend/scripts/pre-vps-login-throttle.test.cjs', 'backend/scripts/pre-vps-auth-sql.test.cjs',
  'backend/scripts/pre-vps-chambers-sql.test.cjs', 'backend/scripts/pre-vps-chamber-manager-sql.test.cjs',
  'backend/scripts/pre-vps-chamber-export.test.cjs',
  'docs/vps-preparation/pre-vps-finish-01/package-source.cjs',
  'docs/vps-preparation/pre-vps-finish-01/package-review.ps1',
  'docs/vps-preparation/pre-vps-finish-01/report.md',
  'docs/vps-preparation/pre-vps-finish-01/evidence.md',
  'docs/vps-preparation/pre-vps-finish-01/migration-impact.md',
  'docs/vps-preparation/pre-vps-finish-01/VPS-FIRST-RUN.md',
  'docs/vps-preparation/pre-vps-finish-01/DATA-AND-RELEASE.md'
)
$prior = @(
  'docs/factory-09-ui/people-service-chats-06/review-pack-factory09-service06-resume-20260930.zip',
  'docs/factory-09-ui/shift-multifactory-05/review-pack-factory09-shift05-20260929.zip',
  'docs/factory-09-ui/functional-closure-04/review-pack-factory09-functional-closure04-20260929.zip',
  'docs/vps-preparation/vps-tech-01/r1/review-pack-vps-tech01-r1-checklist-20260928.zip',
  'docs/vps-preparation/vps-tech-01/review-pack-vps-tech01-20260928.zip',
  'docs/vps-preparation/ops-01/review-pack-ops01-20260927.zip',
  'docs/vps-preparation/att-auth-01/review-pack-attauth01-20260927.zip',
  'docs/vps-preparation/notify-02/review-pack-notify02-20260927.zip',
  'docs/vps-preparation/admin-01/review-pack-admin01-20260926.zip',
  'docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/zavod-master-r4-full-review.zip'
)
$opened = @()
foreach ($relative in $prior) {
  $candidate = Join-Path $root $relative
  if (Test-Path -LiteralPath $candidate) {
    $opened += [pscustomobject]@{ Name = $relative; Zip = [IO.Compression.ZipFile]::OpenRead($candidate) }
  }
}
$entries = @()
$patch = New-Object System.Text.StringBuilder
foreach ($relative in $changed) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing changed file: $relative" }
  $after = Join-Path $stage ('after/' + $relative)
  [IO.Directory]::CreateDirectory((Split-Path $after -Parent)) | Out-Null
  [IO.File]::WriteAllBytes($after, [IO.File]::ReadAllBytes($source))
  $before = Join-Path $stage ('before/' + $relative)
  $origin = $null
  foreach ($item in $opened) {
    foreach ($prefix in @('source-after/', '', 'after/')) {
      $entry = $item.Zip.GetEntry($prefix + $relative)
      if ($null -eq $entry) { continue }
      [IO.Directory]::CreateDirectory((Split-Path $before -Parent)) | Out-Null
      $inputStream = $entry.Open()
      $outputStream = [IO.File]::Create($before)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
      $origin = "$($item.Name)#$($entry.FullName)"
      break
    }
    if ($origin) { break }
  }
  $entries += [pscustomobject]@{ path = $relative; beforeOrigin = $origin; beforeKind = $(if ($origin) { 'PRIOR_REAL_SNAPSHOT_NOT_CLAIMED_IMMEDIATE' } else { 'NEW_FILE' }) }
  Push-Location $stage
  try {
    if ($origin) { $diff = & git diff --no-index --no-ext-diff --text -- ('before/' + $relative) ('after/' + $relative) 2>$null }
    else { $diff = & git diff --no-index --no-ext-diff --text -- /dev/null ('after/' + $relative) 2>$null }
  } finally { Pop-Location }
  if ($LASTEXITCODE -gt 1) { throw "Diff failed: $relative" }
  $fragment = ($diff -join "`n") + "`n"
  $fragment = $fragment.Replace('a/before/' + $relative, 'a/' + $relative).Replace('a/after/' + $relative, 'a/' + $relative).Replace('b/after/' + $relative, 'b/' + $relative)
  [void]$patch.Append($fragment)
}
foreach ($item in $opened) { $item.Zip.Dispose() }
[IO.File]::WriteAllText((Join-Path $stage 'changes.patch'), $patch.ToString(), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $stage 'before-origin.json'), ($entries | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$payloads = @()
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  $payloads += [pscustomobject]@{ path = $relative; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() }
}
$manifest = [pscustomobject]@{ kind = 'PRE_VPS_FINISH_01_REVIEW'; status = 'SOURCE_ISOLATED_ONLY'; payloadCount = $payloads.Count;
  beforeCaveat = 'Prior real review snapshots are historical, not guaranteed immediate pre-edit; unavailable entries are not invented.';
  payloads = @($payloads | Sort-Object path) }
[IO.File]::WriteAllText((Join-Path $stage 'REVIEW-MANIFEST.json'), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Output $stage
