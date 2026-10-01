# Evidence-only boundary finalizer: no VM/service/network/product execution.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work';$r5Here=$PSScriptRoot
$r5Batch=(Get-Item -LiteralPath $r5Here).Parent.Parent.FullName
function Save-R5Bytes([string]$Path,[byte[]]$Bytes){[IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null;$r5Stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$r5Stream.Write($Bytes,0,$Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()};return @{path=[IO.Path]::GetRelativePath($r5Root,$Path).Replace('\','/');bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}}
function Save-R5Json([string]$Name,$Value){return Save-R5Bytes (Join-Path $r5Here $Name) ([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 30)))}
if(Test-Path -LiteralPath (Join-Path $r5Here 'final-identities.json')){throw 'Finalization exists; preserve instead of overwrite'}
$r5Baseline=Get-Content -LiteralPath (Join-Path $r5Here 'baseline.json') -Raw|ConvertFrom-Json
$r5Failure=Get-Content -LiteralPath (Join-Path $r5Here 'uac-failure.json') -Raw|ConvertFrom-Json
$r5Request=Get-Content -LiteralPath (Join-Path $r5Here 'uac-request.json') -Raw|ConvertFrom-Json
if($r5Failure.error -notmatch 'Операция была отменена пользователем'){throw 'Unexpected UAC outcome; do not manufacture cancellation report'}
foreach($r5Unexpected in @('uac-start.json','helper-start.json','boot-request.json','ssh-probe-result.json')){if(Test-Path -LiteralPath (Join-Path $r5Here $r5Unexpected)){throw 'Unexpected operational receipt; review runtime before finalizing'}}
$r5Launcher=@(Get-CimInstance Win32_Process -Filter ('ProcessId='+$r5Request.launcherPid) -OperationTimeoutSec 8|Select-Object ProcessId,Name,CreationDate)
$r5Parsers=@(foreach($r5Name in @('begin-attempt.ps1','diagnostic-boot.ps1','start-diagnostic-boot.ps1','probe-preparation-ssh.ps1','finalize-evidence.ps1','package-boundary.ps1')){
 $r5Tokens=$null;$r5Errors=$null;[Management.Automation.Language.Parser]::ParseFile((Join-Path $r5Here $r5Name),[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
 if($r5Errors.Count){throw ('Source parser errors: '+$r5Name)}
 @{file=$r5Name;syntaxErrors=0;meaning='Syntax only, not operational execution'}
})
$r5Runtime=@{observationAt=[DateTimeOffset]::Now.ToString('o');status='BLOCKED_UAC_CANCELLED_DIAGNOSTIC_BOOT';callerSession=30272;callerExitCode=1;launcherPid=$r5Request.launcherPid;currentPidObservation=$r5Launcher;launcherPidAbsent=($r5Launcher.Count -eq 0);uacCancelledAt=$r5Failure.at;elevatedPidObtained=$false;helperStartReceiptPresent=$false;helperActualToken='NOT_OBTAINED';diagnosticBoot='NOT_RUN_UAC_CANCELLED';vmMutationCommandsExecuted=0;currentVmState='UNKNOWN_NOT_REQUERIED';currentVmOffProven=$false;lastKnownVmState=@{state='Off';at='2026-09-21T16:09:11.5995329+03:00';source='../20260921-guest-recovery/actual-vm.json'};ssh=@{status='NOT_RUN_UAC_CANCELLED';newConnectAttempts=0;authenticationAttempts=0;serverHostKeyVerified=$false};captureAttempts=0;codexRestart='USER_CONFIRMED_NO_TIMESTAMP';oldHelperRestarted=$false;oldQueueReplayed=$false;newGuestWriter=$false;newBackendFrontendPgBrowserProxy=0;shutdown=@{status='NOT_REQUESTED_VM_UNTOUCHED_BY_THIS_ATTEMPT'};workingDbServiceRead=$false;workingDataEnvUploadsChanged=$false;workingCleanup='UNKNOWN_NOT_INSPECTED';ownApplicationFixturesCreated=0;retainedSyntheticFixtures='PRIOR_HOST_PROVISIONING_FILES_UNCHANGED';automaticRetry=$false;nextAction='NEW_EXPLICIT_CONSENT_FOR_ONE_NATIVE_UAC';appFullElevation=$false}
Save-R5Json 'environment-runtime-receipt.json' $r5Runtime|Out-Null
foreach($r5Group in $r5Baseline.groups){foreach($r5Entry in $r5Group.files){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Entry.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Entry.sha256){throw ('Source/build/harness drift: '+$r5Entry.owner)}}}
foreach($r5Entry in @($r5Baseline.matrices)+@($r5Baseline.priorZips)){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Entry.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Entry.sha256){throw ('Matrix/archive changed: '+$r5Entry.path)}}
$r5FixedSources=@(
 @{path='attempts/20260920-vm-control/create-seed-media.ps1';sha256='b843cd35eb10d0b206de4256795024b12e498d7d7f5c61f80cf7946e048611d0'},
 @{path='attempts/20260920-vm-control/r5-late-commands.ps1';sha256='84333c54deca7ec8356a738510d16c619ef70b697d72fa84b929c2fe60ae38cb'},
 @{path='attempts/20260921-guest-recovery/check-generator.cjs';sha256='b11030479e22e8a9abc907e8a854b10e83acb1461a74bbd7f8040ca2e30f0631'}
)
foreach($r5Entry in $r5FixedSources){if((Get-FileHash -LiteralPath (Join-Path $r5Batch $r5Entry.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Entry.sha256){throw 'Previous fixed generator/helper/check changed'}}
$r5Gates=Get-Content -LiteralPath (Join-Path $r5Batch 'live-gate-matrix.json') -Raw|ConvertFrom-Json
$r5Journeys=Get-Content -LiteralPath (Join-Path $r5Batch 'journey-matrix.json') -Raw|ConvertFrom-Json
$r5Expected=Get-Content -LiteralPath (Join-Path $r5Batch 'expected-actual.json') -Raw|ConvertFrom-Json
if($r5Gates.gates.Count -ne 5 -or @($r5Gates.gates|Where-Object {$_.liveTestStack.cases -ne 0 -or $_.liveTestStack.status -ne 'NOT_RUN_UAC_CANCELLED_DIAGNOSTIC_BOOT'}).Count -or $r5Journeys.count -ne 32 -or $r5Journeys.edgeDenominator -ne 1407 -or $r5Journeys.newRealJourneys -ne 0 -or $r5Expected.executedR5Live -ne 0){throw 'Current matrix semantics differ from reported boundary'}
$r5Git='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$r5Owners=@(foreach($r5Entry in $r5Baseline.before){
 $r5Current=Join-Path $r5Root $r5Entry.owner;$r5Before=Join-Path $r5Here ('before/'+$r5Entry.owner)
 $r5After=Save-R5Bytes (Join-Path $r5Here ('after/'+$r5Entry.owner)) ([IO.File]::ReadAllBytes($r5Current))
 $r5Diff=& $r5Git --no-pager diff --no-index --no-ext-diff -- $r5Before $r5Current 2>&1
 if($LASTEXITCODE -notin @(0,1)){throw 'Own delta diff failed'}
 $r5DiffFile=Save-R5Bytes (Join-Path $r5Here ('diffs/'+$r5Entry.owner+'.diff')) ([Text.UTF8Encoding]::new($false).GetBytes(($r5Diff -join "`n")))
 @{owner=$r5Entry.owner;before=$r5Entry.copy;after=$r5After;changed=($r5Entry.copy.sha256 -ne $r5After.sha256);diff=$r5DiffFile}
})
$r5New=@(foreach($r5Name in @('begin-attempt.ps1','diagnostic-boot.ps1','start-diagnostic-boot.ps1','probe-preparation-ssh.ps1','finalize-evidence.ps1','package-boundary.ps1','result.md','continuation-request.txt')){
 $r5Path=Join-Path $r5Here $r5Name
 @{owner=[IO.Path]::GetRelativePath($r5Root,$r5Path).Replace('\','/');before='ABSENT';after=@{bytes=(Get-Item -LiteralPath $r5Path).Length;sha256=(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}}
})
Save-R5Json 'source-delta-manifest.json' @{at=[DateTimeOffset]::Now.ToString('o');existingOwners=$r5Owners;newOwners=$r5New;productChanges=0;reportOnlyPlusUnexecutedOperationalHelpers=$true;libraryAccountMemory='NOT_WRITTEN';sourceSync='REPO_LOCAL_ONLY'}|Out-Null
Save-R5Json 'final-identities.json' @{at=[DateTimeOffset]::Now.ToString('o');status='SOURCE_RETENTION_VERIFIED_NOT_GUEST_OR_PRODUCT_TEST';groups=$r5Baseline.groups;matrices=$r5Baseline.matrices;priorZips=$r5Baseline.priorZips;trackedExistingOwners=$r5Owners.Count;changedExistingOwners=@($r5Owners|Where-Object changed).Count;fixedSources=$r5FixedSources;diagnosticParsers=$r5Parsers;productChanges=0;newProductCases=0;newLiveCases=0;newRealJourneys=0;gates=@($r5Gates.gates|ForEach-Object @{id=$_.id;live=$_.liveTestStack});diagnosticBootExecuted=$false;sshExecuted=$false;mainSweep='PAUSED_BY_USER / NOT_ACCEPTED';finalStop='STOP_AT_UAC_CANCELLED'}|Out-Null
$r5Changed=@($r5Owners|Where-Object changed|ForEach-Object {$_.owner})+@($r5New|ForEach-Object {$_.owner})
Save-R5Bytes (Join-Path $r5Here 'changed-files.txt') ([Text.UTF8Encoding]::new($false).GetBytes((@('Own delta only; other dirty-worktree files are not attributed to this continuation.')+$r5Changed -join "`n")))|Out-Null
[pscustomobject]@{status='EVIDENCE_FINALIZED';changedExisting=@($r5Owners|Where-Object changed).Count;operationalHelpersExecuted=$false;productChanges=0;newLiveCases=0;launcherPidAbsent=$r5Runtime.launcherPidAbsent;priorZips=$r5Baseline.priorZips.Count;matrices=$r5Baseline.matrices.Count}|ConvertTo-Json
