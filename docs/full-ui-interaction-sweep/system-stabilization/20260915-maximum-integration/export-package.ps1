# Immutable ZIP creation from an explicit hash-verified artifact plan; no services or tests.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskBatch = $PSScriptRoot
$taskPlan = Get-Content -LiteralPath (Join-Path $taskBatch 'package-plan.json') -Raw | ConvertFrom-Json
function Get-TaskSha([string]$taskPath) { (Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLowerInvariant() }
function Write-TaskUtf8New([string]$taskPath, [string]$taskText) {
  $taskBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($taskText)
  $taskStream = [System.IO.File]::Open($taskPath,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write)
  try { $taskStream.Write($taskBytes,0,$taskBytes.Length) } finally { $taskStream.Dispose() }
}
function New-TaskZip([string]$taskName, $taskEntries) {
  $taskDestination = [System.IO.Path]::GetFullPath((Join-Path $taskBatch $taskName))
  if ([System.IO.Path]::GetDirectoryName($taskDestination) -ne [System.IO.Path]::GetFullPath($taskBatch)) { throw 'Archive target outside batch' }
  $taskStream = [System.IO.File]::Open($taskDestination,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::ReadWrite)
  $taskZip = [System.IO.Compression.ZipArchive]::new($taskStream,[System.IO.Compression.ZipArchiveMode]::Create,$true)
  try {
    foreach ($taskEntry in $taskEntries) {
      if ((Get-TaskSha $taskEntry.source) -ne $taskEntry.sha256) { throw "Changed artifact: $($taskEntry.entry)" }
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip,$taskEntry.source,$taskEntry.entry,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $taskZip.Dispose(); $taskStream.Dispose() }
  $taskZipRead = [System.IO.Compression.ZipFile]::OpenRead($taskDestination)
  $taskMatched = 0
  try {
    if ($taskZipRead.Entries.Count -ne @($taskEntries).Count) { throw 'ZIP entry count mismatch' }
    foreach ($taskEntry in $taskEntries) {
      $taskItem = $taskZipRead.GetEntry($taskEntry.entry)
      if (!$taskItem -or $taskItem.Length -ne $taskEntry.bytes) { throw 'ZIP missing/length mismatch' }
      $taskRead = $taskItem.Open(); $taskHasher = [System.Security.Cryptography.SHA256]::Create()
      try { $taskHash = [System.BitConverter]::ToString($taskHasher.ComputeHash($taskRead)).Replace('-','').ToLowerInvariant() }
      finally { $taskRead.Dispose(); $taskHasher.Dispose() }
      if ($taskHash -ne $taskEntry.sha256) { throw "ZIP byte mismatch: $($taskEntry.entry)" }
      $taskMatched++
    }
  } finally { $taskZipRead.Dispose() }
  [pscustomobject]@{name=$taskName;sha256=(Get-TaskSha $taskDestination);bytes=(Get-Item -LiteralPath $taskDestination).Length;entries=$taskMatched;contentHashesVerified=$true}
}
$taskParts = @()
foreach ($taskPart in $taskPlan.parts) {
  $taskPartResult = New-TaskZip $taskPart.name $taskPart.files
  $taskParts += $taskPartResult
  $taskPartResult | ConvertTo-Json -Compress | Write-Output
}
$taskManifest = [ordered]@{productFingerprint=$taskPlan.productFingerprint;createdAtUtc=[DateTime]::UtcNow.ToString('o');parts=$taskParts;nativePng=$taskPlan.pngCount;fileManifests=@($taskPlan.parts | ForEach-Object { [ordered]@{part=$_.name;files=@($_.files | Select-Object entry,sha256,bytes)} });excluded=$taskPlan.excluded;security=$taskPlan.security;rootSelfHash='Stored externally in package-verification.json to avoid a circular self-hash';limits='No .env/cookies/storageState/DB/uploads/raw conversation/error-context; all declared329 original evidence PNG included.'}
Write-TaskUtf8New (Join-Path $taskBatch 'package-manifest.json') ($taskManifest | ConvertTo-Json -Depth 30)
$taskRows = @($taskParts | ForEach-Object { '| ['+$_.name+']('+ $_.name +') | '+$_.entries+' | '+$_.bytes+' | '+$_.sha256+' |' })
$taskIndex = @(
'# Maximum integration review package — 15.09.2026', '',
'MASTER_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS. Main UI Sweep remains PAUSED_BY_USER / NOT_ACCEPTED. FINAL_STOP=STOP.', '',
'Read final-report.md first. This root ZIP is a small review entry point; all three adjacent ZIP parts below are required for the complete329PNG/source/test/log/matrix corpus. No service or test is started by opening the package.', '',
'Final product fingerprint: '+$taskPlan.productFingerprint, '',
'| Part | Entries | ZIP bytes | SHA256 |', '|---|---:|---:|---|') + $taskRows + @('',
'All archive entries were read back and SHA256-compared to the input plan. package-manifest.json gives per-file hashes and exclusions. Root ZIP own hash is in adjacent package-verification.json (cannot contain its own cryptographic hash).', '',
'Evidence:329 native PNG total;167 final H captures;50 final frames directly reviewed. All other captures retain non-reviewed status. Failures and historical frames are included, not deleted or replaced.', '',
'Actual final outcomes: browser50PASS/1HARNESS_FAIL then11/11 same-product scoped harness recheck; backend61PASS/2known-negativeFAIL; WS3/3. Types90→80introduced0/resolved10; full React gate not passed.', '',
'MI-SEC-01/MI-PUB-01 and014/050 decisions remain. Live/physical gates pending; own preview stopped. Source snapshots describe an existing dirty worktree, not permission to apply a whole diff blindly.', '',
'Older frontend-series-review.zip remains at ../../frontend-series/20260915-autonomous-frontend/ with SHA256 a7d04c4bffb89a9cabe89d9e49e47e5178dd0688013d7c8fdc5519dd0d40bbde; its original409files/213PNG corpus is separate, unchanged and not silently merged into329.', '',
'Next: new bounded user task for MI-SEC-01 security/idempotency review. No automatic UI Sweep/Scheduler/Load/Stage68/backend/DB/physical continuation.')
Write-TaskUtf8New (Join-Path $taskBatch 'INDEX.md') ($taskIndex -join "`n")
$taskRootEntries = @()
foreach ($taskFile in @('INDEX.md','package-manifest.json') + @($taskPlan.rootFiles)) {
  $taskPath = Join-Path $taskBatch $taskFile
  $taskRootEntries += [pscustomobject]@{source=$taskPath;entry=$taskFile;sha256=(Get-TaskSha $taskPath);bytes=(Get-Item -LiteralPath $taskPath).Length}
}
$taskRootResult = New-TaskZip 'review-package-root.zip' $taskRootEntries
$taskVerification = [ordered]@{createdAtUtc=[DateTime]::UtcNow.ToString('o');root=$taskRootResult;parts=$taskParts;allContentHashesVerified=$true;nativePng=$taskPlan.pngCount;sourceFingerprint=$taskPlan.productFingerprint;status='ARTIFACTS_VERIFIED_NOT_PRODUCT_ACCEPTANCE'}
Write-TaskUtf8New (Join-Path $taskBatch 'package-verification.json') ($taskVerification | ConvertTo-Json -Depth 20)
$taskRootResult | ConvertTo-Json -Compress | Write-Output
