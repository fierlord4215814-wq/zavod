# Final read-only metadata of known owned PIDs/old queue, not a VM/DB/service command.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Out=Join-Path $r5Here 'final-runtime-observation.json'
if(Test-Path -LiteralPath $r5Out){throw 'Preserve existing final observation'}
$r5Old=Join-Path (Split-Path -Parent $r5Here) '20260920-vm-control'
$r5Queue='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24\control'
$r5Processes=@()
foreach($r5KnownId in @(9056,8296,9616)){
 $r5P=Get-Process -Id $r5KnownId -ErrorAction SilentlyContinue
 $r5Processes+=@{pid=$r5KnownId;exists=($null -ne $r5P);name=$(if($r5P){$r5P.ProcessName}else{$null});start=$(if($r5P){$r5P.StartTime.ToString('o')}else{$null});hasExited=$(if($r5P){$r5P.HasExited}else{$null})}
}
$r5Rows=@()
foreach($r5Id in @('000006','000007')){foreach($r5Suffix in @('request','result')){
 $r5Name=$r5Id+'.'+$r5Suffix+'.json';$r5Path=Join-Path $r5Queue $r5Name;$r5Exists=Test-Path -LiteralPath $r5Path
 $r5Rows+=@{name=$r5Name;exists=$r5Exists;sha256=$(if($r5Exists){(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null});data=$(if($r5Exists){Get-Content -LiteralPath $r5Path -Raw|ConvertFrom-Json}else{$null})}
}}
$r5VmProof=Get-Content -LiteralPath (Join-Path $r5Here 'vm-state-after.json') -Raw|ConvertFrom-Json
$r5Terminal=Get-Content -LiteralPath (Join-Path $r5Here 'console-observer-terminal.json') -Raw|ConvertFrom-Json
$r5Observation=@{
 at=[DateTimeOffset]::Now.ToString('o');processes=$r5Processes;queue=$r5Rows;
 oldTerminalExists=(Test-Path -LiteralPath (Join-Path $r5Old 'vm-control-terminal.json'));
 oldFailureExists=(Test-Path -LiteralPath (Join-Path $r5Old 'vm-control-failure.json'));
 oldControllerSha256=(Get-FileHash -LiteralPath (Join-Path $r5Old 'vm-control.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();
 observerTerminal=$r5Terminal;lastActualVmObservation=$r5VmProof;currentVmOffProven=$false;
 freeDiskBytes=(Get-PSDrive -Name C).Free;
 workingDbServiceInspected=$false;workingDataEnvUploadsChanged=$false;workingCleanup='UNKNOWN_NOT_INSPECTED';
 ownAppsDbFixtures=@();guestInputActions=0;newMutatingControllerStarted=$false;forceOrReboot=$false
}
[IO.File]::WriteAllText($r5Out,($r5Observation|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$r5Observation|Select-Object at,processes,oldTerminalExists,oldFailureExists,currentVmOffProven,freeDiskBytes|ConvertTo-Json -Depth 4
