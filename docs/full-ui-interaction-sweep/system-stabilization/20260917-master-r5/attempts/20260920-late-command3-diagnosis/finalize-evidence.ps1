# Evidence-only finalization: no product execution, guest access, or service operations.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work'
$r5Here=$PSScriptRoot
$r5Git='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
if(Test-Path -LiteralPath (Join-Path $r5Here 'final-evidence.json')){throw 'Evidence exists; preserve it'}
function Write-R5New([string]$Name,[byte[]]$Bytes){
 $r5Path=Join-Path $r5Here $Name
 [IO.Directory]::CreateDirectory((Split-Path $r5Path -Parent))|Out-Null
 # A prior attempt stopped on Git's line-ending warning after its first immutable copy.
 # Resume only byte-identical partial evidence; never overwrite any existing result.
 if(Test-Path -LiteralPath $r5Path){
  $r5Expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
  $r5Actual=(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if($r5Actual -ne $r5Expected){throw ('Existing partial evidence differs: '+$Name)}
  return @{path=[IO.Path]::GetRelativePath($r5Root,$r5Path);bytes=$Bytes.Length;sha256=$r5Actual;reusedIdenticalPartial=$true}
 }
 $r5Stream=[IO.File]::Open($r5Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$r5Stream.Write($Bytes,0,$Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}
 return @{path=[IO.Path]::GetRelativePath($r5Root,$r5Path);bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function Write-R5Json([string]$Name,$Value){return Write-R5New $Name ([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 25)))}
function Get-R5Hash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
$r5Base=Get-Content -LiteralPath (Join-Path $r5Here 'baseline.json') -Raw|ConvertFrom-Json
$r5Owners=@($r5Base.before|ForEach-Object{
 $r5Owner=Join-Path $r5Root $_.owner
 $r5After=Write-R5New ('after/'+$_.owner) ([IO.File]::ReadAllBytes($r5Owner))
 $r5Args=[Diagnostics.ProcessStartInfo]::new($r5Git)
 $r5Args.UseShellExecute=$false;$r5Args.CreateNoWindow=$true;$r5Args.RedirectStandardOutput=$true;$r5Args.RedirectStandardError=$true
 foreach($r5Argument in @('diff','--no-index','--no-ext-diff','--ignore-space-at-eol','--',(Join-Path $r5Root $_.copy.path),$r5Owner)){$r5Args.ArgumentList.Add($r5Argument)}
 $r5Process=[Diagnostics.Process]::Start($r5Args)
 $r5Out=$r5Process.StandardOutput.ReadToEndAsync();$r5Err=$r5Process.StandardError.ReadToEndAsync()
 if(-not $r5Process.WaitForExit(5000)){$r5Process.Kill();throw 'Own evidence diff process exceeded bound'}
 # git diff --no-index: 0=same, 1=differences. Retain stderr (including CRLF warnings).
 if($r5Process.ExitCode -notin @(0,1)){throw ('Evidence diff failed: '+$r5Err.Result)}
 $r5Process.Dispose()
 $r5Diff=Write-R5New ('diffs/'+$_.owner+'.diff') ([Text.UTF8Encoding]::new($false).GetBytes($r5Out.Result))
 @{owner=$_.owner;before=$_.copy;after=$r5After;changed=($_.copy.sha256 -ne $r5After.sha256);diff=$r5Diff;gitStderr=$r5Err.Result}
})
$r5Frozen=@($r5Base.groups|ForEach-Object{
 $r5Group=$_
 foreach($r5File in $r5Group.files){if((Get-R5Hash (Join-Path $r5Root $r5File.owner)) -ne $r5File.sha256){throw ('Frozen-file drift: '+$r5File.owner)}}
 @{kind=$r5Group.kind;count=$r5Group.files.Count;allUnchanged=$true}
})
foreach($r5File in @($r5Base.matrices)+@($r5Base.priorZips)){
 if((Get-R5Hash (Join-Path $r5Root $r5File.path)) -ne $r5File.sha256){throw ('Retention drift: '+$r5File.path)}
}
$r5Source=Join-Path (Split-Path $r5Here -Parent) '20260920-vm-control/create-seed-media.ps1'
if((Get-R5Hash $r5Source) -ne $r5Base.generator.sha256){throw 'Original generator changed'}
$r5Batch=Split-Path (Split-Path $r5Here -Parent) -Parent
$r5Gate=Get-Content -LiteralPath (Join-Path $r5Batch 'live-gate-matrix.json') -Raw|ConvertFrom-Json
if($r5Gate.gates.Count -ne 5 -or @($r5Gate.gates|Where-Object {$_.liveTestStack.cases -ne 0 -or $_.liveTestStack.status -ne 'NOT_RUN_ENVIRONMENT_GUEST_LATE_COMMAND_FAILURE'}).Count){throw 'Gate semantics mismatch'}
$r5Journey=Get-Content -LiteralPath (Join-Path $r5Batch 'journey-matrix.json') -Raw|ConvertFrom-Json
if($r5Journey.count -ne 32 -or $r5Journey.edgeDenominator -ne 1407 -or $r5Journey.newRealJourneys -ne 0){throw 'Journey semantics mismatch'}
$r5Expected=Get-Content -LiteralPath (Join-Path $r5Batch 'expected-actual.json') -Raw|ConvertFrom-Json
if($r5Expected.executedR5Node -ne 0 -or $r5Expected.executedR5Browser -ne 0 -or $r5Expected.executedR5Live -ne 0){throw 'Unexpected product execution claim'}
$r5SourceDiag=Get-Content -LiteralPath (Join-Path $r5Here 'source-diagnosis.json') -Raw|ConvertFrom-Json
if($r5SourceDiag.original.syntax.exitCode -ne 2 -or $r5SourceDiag.candidate.syntax.exitCode -ne 0 -or $r5SourceDiag.candidate.appliedToGenerator){throw 'Diagnosis mismatch'}
$r5Parse=@('diagnose-source.ps1','finalize-evidence.ps1')|ForEach-Object{
 $r5Tokens=$null;$r5Errors=$null
 [Management.Automation.Language.Parser]::ParseFile((Join-Path $r5Here $_),[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
 if($r5Errors.Count){throw 'Diagnostic script parser error'}
 @{file=$_;parserErrors=$r5Errors.Count}
}
$r5Changed=@($r5Owners|Where-Object changed|ForEach-Object {$_.owner})
Write-R5New 'changed-files.txt' ([Text.UTF8Encoding]::new($false).GetBytes(("Current continuation only; inherited dirty changes are not attributed here.`n"+($r5Changed -join "`n")+"`nNew evidence directory: docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/attempts/20260920-late-command3-diagnosis/`nProduct/generator/seed/guest modifications: none. Candidate NOT_APPLIED.`n")))|Out-Null
$r5Result=@{at=[DateTimeOffset]::Now.ToString('o');status='WAITING_MANUAL_GUEST_SHELL';existingOwners=$r5Owners;frozen=$r5Frozen;parentMatricesUnchanged=$r5Base.matrices.Count;priorZipsUnchanged=$r5Base.priorZips.Count;generatorUnchanged=$true;diagnosticParsers=$r5Parse;gates=@($r5Gate.gates|ForEach-Object {@{id=$_.id;cases=$_.liveTestStack.cases;status=$_.liveTestStack.status}});journeys=$r5Journey.count;newRealJourneys=0;productChanges=0;productTests=0;guestInputs=0;guestWrites=0;vmMutation=$false;candidateApplied=$false;mainSweep='PAUSED_BY_USER / NOT_ACCEPTED';newZipCreated=$false;next='One manual Help > Enter shell action in existing own VMConnect; screenshot prompt only, no command'}
Write-R5Json 'final-evidence.json' $r5Result|Out-Null
@{status=$r5Result.status;changedDocumentOwners=$r5Changed.Count;frozen=$r5Frozen;parentMatrices=$r5Result.parentMatricesUnchanged;oldZips=$r5Result.priorZipsUnchanged;guestInputs=0;productTests=0;generatorUnchanged=$true;candidateApplied=$false}|ConvertTo-Json -Depth 5
