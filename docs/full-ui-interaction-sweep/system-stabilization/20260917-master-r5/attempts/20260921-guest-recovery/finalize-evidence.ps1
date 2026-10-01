# Evidence-only finalization: no guest/VM state commands, network probes, services, or product execution.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work'
$r5Here=[IO.Path]::GetFullPath($PSScriptRoot)
$r5Batch=(Get-Item -LiteralPath $r5Here).Parent.Parent.FullName
$r5Git='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
if(Test-Path -LiteralPath (Join-Path $r5Here 'final-identities.json')){throw 'Final identities exist; preserve checkpoint'}
function Get-R5Hash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save-R5([string]$Name,[byte[]]$Bytes){
 $r5Path=Join-Path $r5Here $Name
 [IO.Directory]::CreateDirectory((Split-Path $r5Path -Parent))|Out-Null
 if(Test-Path -LiteralPath $r5Path){
  $r5Expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
  if((Get-R5Hash $r5Path) -ne $r5Expected){throw ('Immutable partial evidence differs: '+$Name)}
 }else{
  $r5Stream=[IO.File]::Open($r5Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$r5Stream.Write($Bytes,0,$Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}
 }
 return @{path=[IO.Path]::GetRelativePath($r5Root,$r5Path).Replace('\','/');bytes=$Bytes.Length;sha256=(Get-R5Hash $r5Path)}
}
function Save-R5Json([string]$Name,$Value){return Save-R5 $Name ([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 25)))}
$r5Base=Get-Content -LiteralPath (Join-Path $r5Here 'baseline.json') -Raw|ConvertFrom-Json
$r5AllBefore=@($r5Base.before)+@($r5Base.generatorBefore)
$r5Owners=@($r5AllBefore|ForEach-Object{
 $r5Owner=Join-Path $r5Root $_.owner
 $r5After=Save-R5 ('after/'+$_.owner) ([IO.File]::ReadAllBytes($r5Owner))
 $r5Info=[Diagnostics.ProcessStartInfo]::new($r5Git)
 $r5Info.UseShellExecute=$false;$r5Info.CreateNoWindow=$true;$r5Info.RedirectStandardOutput=$true;$r5Info.RedirectStandardError=$true
 foreach($r5Arg in @('diff','--no-index','--no-ext-diff','--ignore-space-at-eol','--',(Join-Path $r5Root $_.copy.path),$r5Owner)){$r5Info.ArgumentList.Add($r5Arg)}
 $r5Process=[Diagnostics.Process]::Start($r5Info)
 $r5Out=$r5Process.StandardOutput.ReadToEndAsync();$r5Err=$r5Process.StandardError.ReadToEndAsync()
 if(-not $r5Process.WaitForExit(5000)){$r5Process.Kill();throw 'Own diff process exceeded bound'}
 if($r5Process.ExitCode -notin @(0,1)){throw 'Evidence diff failed'}
 $r5Code=$r5Process.ExitCode;$r5Process.Dispose()
 $r5Diff=Save-R5 ('diffs/'+$_.owner+'.diff') ([Text.UTF8Encoding]::new($false).GetBytes($r5Out.Result))
 @{owner=$_.owner;before=$_.copy;after=$r5After;changed=($_.copy.sha256 -ne $r5After.sha256);diff=$r5Diff;gitExitCode=$r5Code;gitStderr=$r5Err.Result}
})
$r5PureOwner='docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/attempts/20260920-vm-control/r5-late-commands.ps1'
$r5NewHelper=Save-R5 ('after/'+$r5PureOwner) ([IO.File]::ReadAllBytes((Join-Path $r5Root $r5PureOwner)))
$r5Delta=@{at=[DateTimeOffset]::Now.ToString('o');kind='CURRENT_CONTINUATION_NOT_INHERITED_DIRTY_CHANGES';existingOwners=$r5Owners;newOwners=@(@{owner=$r5PureOwner;after=$r5NewHelper});newEvidenceDirectory=[IO.Path]::GetRelativePath($r5Root,$r5Here).Replace('\','/');productChanges=0;actualSeedRegenerated=$false;guestRepairExecuted=$false}
Save-R5Json 'source-delta-manifest.json' $r5Delta|Out-Null
$r5Groups=@($r5Base.groups|ForEach-Object{
 $r5Group=$_
 foreach($r5File in $r5Group.files){if((Get-R5Hash (Join-Path $r5Root $r5File.owner)) -ne $r5File.sha256){throw ('Frozen file drift: '+$r5File.owner)}}
 @{kind=$r5Group.kind;count=$r5Group.files.Count;allUnchanged=$true;files=$r5Group.files}
})
$r5Matrices=@($r5Base.matrices|ForEach-Object{
 if((Get-R5Hash (Join-Path $r5Root $_.path)) -ne $_.sha256){throw ('Main matrix drift: '+$_.path)}
 $r5Copy=Save-R5 ('retained-main-matrices/'+[IO.Path]::GetFileName($_.path)) ([IO.File]::ReadAllBytes((Join-Path $r5Root $_.path)))
 @{path=$_.path;sha256=$_.sha256;unchanged=$true;copy=$r5Copy}
})
$r5PriorZips=@($r5Base.priorZips|ForEach-Object{
 if((Get-R5Hash (Join-Path $r5Root $_.path)) -ne $_.sha256){throw ('Prior ZIP drift: '+$_.path)}
 @{path=$_.path;sha256=$_.sha256;bytes=(Get-Item -LiteralPath (Join-Path $r5Root $_.path)).Length;unchanged=$true}
})
$r5Checks=Get-Content -LiteralPath (Join-Path $r5Here 'run-03-consistent-status/generator-results.json') -Raw|ConvertFrom-Json
if($r5Checks.cases -ne 10 -or $r5Checks.passed -ne 7 -or $r5Checks.failed -ne 0 -or $r5Checks.blocked -ne 3 -or -not $r5Checks.sourceCorrectionApplied -or $r5Checks.guestRepairExecuted){throw 'Current provisioning result mismatch'}
if((Get-R5Hash (Join-Path $r5Root $r5Base.generatorBefore.owner)) -ne $r5Checks.generatorSha256 -or (Get-R5Hash (Join-Path $r5Root $r5PureOwner)) -ne $r5Checks.pureHelperSha256){throw 'Verified provisioning source drift'}
foreach($r5Row in $r5Checks.results){
 if(($r5Row.detail.blocked -eq $true) -ne ($r5Row.status -eq 'BLOCKED_ENV_PREREQUISITE')){throw 'Current per-case classification mismatch'}
}
$r5Gate=Get-Content -LiteralPath (Join-Path $r5Batch 'live-gate-matrix.json') -Raw|ConvertFrom-Json
$r5Journey=Get-Content -LiteralPath (Join-Path $r5Batch 'journey-matrix.json') -Raw|ConvertFrom-Json
$r5Expected=Get-Content -LiteralPath (Join-Path $r5Batch 'expected-actual.json') -Raw|ConvertFrom-Json
if($r5Gate.gates.Count -ne 5 -or @($r5Gate.gates|Where-Object {$_.liveTestStack.cases -ne 0 -or $_.liveTestStack.status -ne 'NOT_RUN_BLOCKED_TOOL_CAPABILITY'}).Count){throw 'Live gate semantics mismatch'}
if($r5Journey.count -ne 32 -or $r5Journey.journeys.Count -ne 32 -or $r5Journey.edgeDenominator -ne 1407 -or $r5Journey.newRealJourneys -ne 0){throw 'Journey semantics mismatch'}
if($r5Expected.executedR5Node -ne 0 -or $r5Expected.executedR5Browser -ne 0 -or $r5Expected.executedR5Live -ne 0){throw 'Product execution claim mismatch'}
$r5ParsePaths=@(Get-ChildItem -LiteralPath $r5Here -File -Filter '*.ps1'|ForEach-Object {$_.FullName})+@((Join-Path $r5Root $r5Base.generatorBefore.owner),(Join-Path $r5Root $r5PureOwner))
$r5Parsers=@($r5ParsePaths|ForEach-Object{
 $r5Tokens=$null;$r5Errors=$null
 [Management.Automation.Language.Parser]::ParseFile($_,[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
 if($r5Errors.Count){throw ('Evidence script syntax error: '+$_)}
 @{path=[IO.Path]::GetRelativePath($r5Root,$_).Replace('\','/');parserErrors=0;executed=$false}
})
$r5Vm=Get-Content -LiteralPath (Join-Path $r5Here 'actual-vm.json') -Raw|ConvertFrom-Json
$r5Observer=Get-Content -LiteralPath (Join-Path $r5Here 'observer-terminal.json') -Raw|ConvertFrom-Json
$r5Viewer=Get-Content -LiteralPath (Join-Path $r5Here 'viewer-launch.json') -Raw|ConvertFrom-Json
$r5Now=[DateTimeOffset]::Now.ToString('o')
$r5Processes=@(foreach($r5Id in @([int]$r5Observer.pid,[int]$r5Viewer.pid)){
 $r5P=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r5Id) -OperationTimeoutSec 5
 $r5Matches=($r5Id -eq [int]$r5Viewer.pid -and $null -ne $r5P -and $r5P.Name -eq 'vmconnect.exe' -and $r5P.CreationDate.ToString('o').StartsWith('2026-09-21T16:09:11'))
 @{pid=$r5Id;present=($null -ne $r5P);name=$r5P.Name;start=$r5P.CreationDate;ownViewerIdentityMatches=$r5Matches;commandLineExported=$false;terminationPerformed=$false}
})
$r5Runtime=@{
 observationAt=$r5Now;vmObservationAt=$r5Vm.at;currentVmOffProven=($r5Vm.vm.EnabledState -eq 3);vmStateFreshlyRequeried=$false;vmState='Off at recorded CIM observation; no continuous monitor';vmId=$r5Vm.vm.Name;soleTargetVhdxConfirmed=$r5Vm.soleTargetVhdxConfirmed;associatedJobs=$r5Vm.jobs;
 hostBoot=$r5Base.runtime.boot;oldHelper='Completed before host reboot; 9056 reused foreign PID not terminated';oldQueueReplayed=$false;shutdown=@{status='NO_NEW_SHUTDOWN; old N/Running receipt is not Off proof'};observerTerminal=$r5Observer;processes=$r5Processes;viewerClose='Alt+F4 attempted; close not proven, do not force';channel='BLOCKED_TOOL_CAPABILITY; see channel-observations.json';guestInputs=0;guestWrites=0;vmMutation=$false;validNewScreenshots=0;ownApplicationProcessesStarted=0;ownPgCreated=$false;ownApplicationFixturesCreated=0;syntheticFilesystemFixtures='RETAINED_WITHIN_THIS_ATTEMPT';workingDbOrServiceInspected=$false;workingDataCleanup='UNKNOWN_NOT_INSPECTED';nativeUacAttempts=1;appRestartPerformed=$false;finalStop='STOP'
}
Save-R5Json 'environment-runtime-receipt.json' $r5Runtime|Out-Null
$r5Changed=@($r5Owners|Where-Object changed|ForEach-Object {$_.owner})
$r5ChangedText="Current continuation only; historical dirty worktree changes are not attributed here.`nExisting owners (15 docs/matrices plus own generator):`n"+($r5Changed -join "`n")+"`nNew pure helper:`n"+$r5PureOwner+"`nNew evidence directory:`n"+[IO.Path]::GetRelativePath($r5Root,$r5Here).Replace('\','/')+"`nProduct/schema/dependency/build/harness changes: 0. Actual seed/VM/guest writes: 0.`n"
Save-R5 'changed-files.txt' ([Text.UTF8Encoding]::new($false).GetBytes($r5ChangedText))|Out-Null
$r5Final=@{at=[DateTimeOffset]::Now.ToString('o');status='BLOCKED_TOOL_CAPABILITY';groups=$r5Groups;matrices=$r5Matrices;priorZips=$r5PriorZips;changedExistingOwners=$r5Changed.Count;newHelper=@{owner=$r5PureOwner;sha256=$r5NewHelper.sha256};provisioningChecks=@{passed=7;blocked=3;failed=0;source='run-03-consistent-status/generator-results.json'};diagnosticParsers=$r5Parsers;productCasesExecuted=0;productChanges=0;newRealJourneys=0;journeys=32;edgeDenominator=1407;gates=@($r5Gate.gates|ForEach-Object{@{id=$_.id;cases=$_.liveTestStack.cases;status=$_.liveTestStack.status}});guestRepairExecuted=$false;actualSeedRegenerated=$false;workingProtectedDataInspected=$false;mainSweep='PAUSED_BY_USER / NOT_ACCEPTED';libraryAccountMemory='NOT_WRITTEN';finalStop='STOP'}
Save-R5Json 'final-identities.json' $r5Final|Out-Null
@{status=$r5Final.status;changedExistingOwners=$r5Changed.Count;frozen=@($r5Groups|ForEach-Object{@{kind=$_.kind;count=$_.count;allUnchanged=$_.allUnchanged}});mainMatrices=$r5Matrices.Count;oldZips=$r5PriorZips.Count;checks=@{pass=7;blocked=3};processes=$r5Processes;vmOffObservation=$r5Vm.at}|ConvertTo-Json -Depth 6
