# Evidence/read-only identity finalization only; no product, VM, network or service execution.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work';$r5Here=$PSScriptRoot
$r5Batch=(Get-Item -LiteralPath $r5Here).Parent.Parent.FullName
$r5Prior=Join-Path (Split-Path $r5Here -Parent) '20260921-guest-recovery'
$r5Git='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
if(Test-Path -LiteralPath (Join-Path $r5Here 'final-identities.json')){throw 'Final identities already exist'}
function Hash-R5([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save-R5([string]$Name,[byte[]]$Bytes){
 $r5Path=Join-Path $r5Here $Name;[IO.Directory]::CreateDirectory((Split-Path $r5Path -Parent))|Out-Null
 if(Test-Path -LiteralPath $r5Path){
  if((Hash-R5 $r5Path) -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()){throw ('Immutable partial differs: '+$Name)}
 }else{
  $r5S=[IO.File]::Open($r5Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$r5S.Write($Bytes,0,$Bytes.Length);$r5S.Flush($true)}finally{$r5S.Dispose()}
 }
 return @{path=[IO.Path]::GetRelativePath($r5Root,$r5Path).Replace('\','/');sha256=(Hash-R5 $r5Path);bytes=$Bytes.Length}
}
function Json-R5([string]$Name,$Value){return Save-R5 $Name ([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 25)))}
$r5Base=Get-Content -LiteralPath (Join-Path $r5Here 'baseline.json') -Raw|ConvertFrom-Json
$r5Owners=@($r5Base.before|ForEach-Object{
 $r5Owner=Join-Path $r5Root $_.owner
 $r5After=Save-R5 ('after/'+$_.owner) ([IO.File]::ReadAllBytes($r5Owner))
 $r5I=[Diagnostics.ProcessStartInfo]::new($r5Git);$r5I.UseShellExecute=$false;$r5I.CreateNoWindow=$true;$r5I.RedirectStandardOutput=$true;$r5I.RedirectStandardError=$true
 foreach($r5Arg in @('diff','--no-index','--no-ext-diff','--ignore-space-at-eol','--',(Join-Path $r5Root $_.copy.path),$r5Owner)){$r5I.ArgumentList.Add($r5Arg)}
 $r5P=[Diagnostics.Process]::Start($r5I);$r5Out=$r5P.StandardOutput.ReadToEndAsync();$r5Err=$r5P.StandardError.ReadToEndAsync()
 if(-not $r5P.WaitForExit(5000)){$r5P.Kill();throw 'Own evidence diff deadline exceeded'}
 if($r5P.ExitCode -notin @(0,1)){throw 'Evidence diff failed'}
 $r5DiffCode=$r5P.ExitCode;$r5P.Dispose()
 $r5Diff=Save-R5 ('diffs/'+$_.owner+'.diff') ([Text.UTF8Encoding]::new($false).GetBytes($r5Out.Result))
 @{owner=$_.owner;before=$_.copy;after=$r5After;changed=($_.copy.sha256 -ne $r5After.sha256);diff=$r5Diff;gitExitCode=$r5DiffCode;gitStderr=$r5Err.Result}
})
Json-R5 'source-delta-manifest.json' @{at=[DateTimeOffset]::Now.ToString('o');existingOwners=$r5Owners;newOwners=@();newEvidence='attempts/20260921-channel-recheck plus additive previous-attempt/run-04-official-install';productChanges=0;generatorChanges=0;harnessChanges=0;guestChanges=0;historicalDirtyNotAttributed=$true}|Out-Null
$r5Groups=@($r5Base.groups|ForEach-Object{
 foreach($r5F in $_.files){if((Hash-R5 (Join-Path $r5Root $r5F.owner)) -ne $r5F.sha256){throw ('Frozen source changed: '+$r5F.owner)}}
 @{kind=$_.kind;count=$_.files.Count;allUnchanged=$true;files=$_.files}
})
$r5Matrices=@($r5Base.matrices|ForEach-Object{
 if((Hash-R5 (Join-Path $r5Root $_.path)) -ne $_.sha256){throw 'Main matrix drift'}
 $r5Copy=Save-R5 ('retained-main-matrices/'+[IO.Path]::GetFileName($_.path)) ([IO.File]::ReadAllBytes((Join-Path $r5Root $_.path)))
 @{path=$_.path;sha256=$_.sha256;unchanged=$true;copy=$r5Copy}
})
$r5Zips=@($r5Base.priorZips|ForEach-Object{
 if((Hash-R5 (Join-Path $r5Root $_.path)) -ne $_.sha256){throw 'Prior ZIP drift'}
 @{path=$_.path;sha256=$_.sha256;bytes=(Get-Item -LiteralPath (Join-Path $r5Root $_.path)).Length;unchanged=$true}
})
$r5Checks=Get-Content -LiteralPath (Join-Path $r5Prior 'run-04-official-install/generator-results.json') -Raw|ConvertFrom-Json
if($r5Checks.cases -ne 10 -or $r5Checks.passed -ne 10 -or $r5Checks.failed -ne 0 -or $r5Checks.blocked -ne 0 -or $r5Checks.guestRepairExecuted){throw 'Provisioning count/scope mismatch'}
$r5Run=Get-Content -LiteralPath (Join-Path $r5Here 'generator-run.json') -Raw|ConvertFrom-Json
$r5PriorPackage=Get-Content -LiteralPath (Join-Path $r5Prior 'package-receipt.json') -Raw|ConvertFrom-Json
$r5Harness=Join-Path $r5Prior 'check-generator.cjs'
$r5PriorHarness=@($r5PriorPackage.readback|Where-Object name -eq 'attempts/20260921-guest-recovery/check-generator.cjs')
if($r5PriorHarness.Count -ne 1 -or (Hash-R5 $r5Harness) -ne $r5PriorHarness[0].sha256 -or (Hash-R5 $r5Harness) -ne $r5Run.harnessSha256 -or $r5Run.command.exitCode -ne 0){throw 'Unchanged harness/execution claim mismatch'}
$r5Generator=Join-Path (Split-Path $r5Here -Parent) '20260920-vm-control/create-seed-media.ps1'
$r5Pure=Join-Path $r5Root $r5Base.priorSourceHelper.owner
if((Hash-R5 $r5Generator) -ne $r5Checks.generatorSha256 -or (Hash-R5 $r5Pure) -ne $r5Checks.pureHelperSha256 -or (Hash-R5 $r5Pure) -ne $r5Base.priorSourceHelper.sha256){throw 'Provisioning source drift'}
$r5Utility=Get-Content -LiteralPath (Join-Path $r5Here 'utility-download.json') -Raw|ConvertFrom-Json
if((Hash-R5 (Join-Path $r5Root $r5Utility.binary.path)) -ne $r5Utility.binary.sha256){throw 'Own utility bytes changed'}
foreach($r5F in $r5Utility.existingRuntimeDlls){if((Hash-R5 $r5F.path) -ne $r5F.sha256){throw 'Existing Codex runtime DLL drift'}}
$r5Gate=Get-Content -LiteralPath (Join-Path $r5Batch 'live-gate-matrix.json') -Raw|ConvertFrom-Json
$r5Journey=Get-Content -LiteralPath (Join-Path $r5Batch 'journey-matrix.json') -Raw|ConvertFrom-Json
$r5Expected=Get-Content -LiteralPath (Join-Path $r5Batch 'expected-actual.json') -Raw|ConvertFrom-Json
if($r5Gate.gates.Count -ne 5 -or @($r5Gate.gates|Where-Object {$_.liveTestStack.cases -ne 0 -or $_.liveTestStack.status -ne 'NOT_RUN_BLOCKED_TOOL_CAPABILITY'}).Count){throw 'Live gate mismatch'}
if($r5Journey.count -ne 32 -or $r5Journey.journeys.Count -ne 32 -or $r5Journey.edgeDenominator -ne 1407 -or $r5Journey.newRealJourneys -ne 0){throw 'Journey mismatch'}
if($r5Expected.executedR5Node -ne 0 -or $r5Expected.executedR5Browser -ne 0 -or $r5Expected.executedR5Live -ne 0){throw 'Product result mismatch'}
$r5Parsers=@(Get-ChildItem -LiteralPath $r5Here -File -Filter '*.ps1'|ForEach-Object{
 $r5Tokens=$null;$r5Errors=$null
 [Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
 if($r5Errors.Count){throw ('Artifact script parser error: '+$_.Name)}
 @{name=$_.Name;parserErrors=0}
})
$r5Channel=Get-Content -LiteralPath (Join-Path $r5Here 'channel-observations.json') -Raw|ConvertFrom-Json
$r5Viewer=Get-CimInstance Win32_Process -Filter 'ProcessId=14364' -OperationTimeoutSec 5
$r5OwnViewer=($null -ne $r5Viewer -and $r5Viewer.Name -eq 'vmconnect.exe' -and $r5Viewer.CreationDate.ToString('o').StartsWith('2026-09-21T17:00:57'))
$r5Version=Get-Content -LiteralPath (Join-Path $r5Here 'install-version.json') -Raw|ConvertFrom-Json
$r5Runtime=@{observationAt=[DateTimeOffset]::Now.ToString('o');currentVmOffProven=$false;lastKnownVmOffProven=$true;vmObservationAt='2026-09-21T16:09:11.5995329+03:00';vmStateFreshlyRequeried=$false;vmMutation=$false;guestInputs=0;newUacAttempts=0;newSshProbes=0;ownViewer=@{pid=14364;present=($null -ne $r5Viewer);sameOwnedIdentityStillRunning=$r5OwnViewer;force=$false};hostUtilityExited=$r5Version.exited;hostUtilityExitCode=$r5Version.exitCode;hostHarnessExited=$r5Run.command.exited;hostHarnessExitCode=$r5Run.command.exitCode;oldQueueReplayed=$false;shutdown=@{status='NO_NEW_VM_STATE_COMMANDS'};channel='BLOCKED_TOOL_CAPABILITY';userRestartAnswer='PENDING';ownAppDbFixturesCreated=0;workingDbOrServiceRead=$false;workingDataCleanup='UNKNOWN_NOT_INSPECTED';validNewScreenshots=0;globalPathChanged=$false;codexRuntimeChanged=$false;finalStop='STOP'}
Json-R5 'environment-runtime-receipt.json' $r5Runtime|Out-Null
$r5Changed=@($r5Owners|Where-Object changed|ForEach-Object{$_.owner})
Save-R5 'changed-files.txt' ([Text.UTF8Encoding]::new($false).GetBytes(("Current continuation only; historical dirty changes not attributed.`n"+($r5Changed -join "`n")+"`nNew evidence: attempts/20260921-channel-recheck; additive previous-attempt/run-04-official-install.`nGenerator/purehelper/harness/product unchanged. Own utility file outside product: .r5-runtime/provisioning-install-087bc8f10ba3/install.exe.`n")))|Out-Null
$r5Final=@{at=[DateTimeOffset]::Now.ToString('o');status='BLOCKED_TOOL_CAPABILITY';groups=$r5Groups;matrices=$r5Matrices;priorZips=$r5Zips;trackedExistingOwners=$r5Owners.Count;changedExistingOwners=$r5Changed.Count;generatorUnchanged=$true;pureHelperUnchanged=$true;hostHarnessUnchanged=$true;provisioningChecks=@{passed=10;failed=0;blocked=0;scope='HOST_SYNTHETIC_GUEST_PENDING'};diagnosticParsers=$r5Parsers;newProductCases=0;newLiveCases=0;newRealJourneys=0;productChanges=0;gates=@($r5Gate.gates|ForEach-Object{@{id=$_.id;cases=0;status=$_.liveTestStack.status}});guestRepairExecuted=$false;actualSeedRegenerated=$false;mainSweep='PAUSED_BY_USER / NOT_ACCEPTED';finalStop='STOP'}
Json-R5 'final-identities.json' $r5Final|Out-Null
@{status=$r5Final.status;changedExistingOwners=$r5Changed.Count;frozen=@($r5Groups|ForEach-Object{@{kind=$_.kind;count=$_.count;unchanged=$true}});mainMatrices=$r5Matrices.Count;priorZips=$r5Zips.Count;hostChecks='10PASS';ownViewerStillRunning=$r5OwnViewer;newLiveCases=0;guestRepairExecuted=$false}|ConvertTo-Json -Depth 5
