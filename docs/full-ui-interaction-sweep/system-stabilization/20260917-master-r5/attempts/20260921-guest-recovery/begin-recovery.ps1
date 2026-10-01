# Same R5 baseline; no product execution or protected data access.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work';$r5Here=$PSScriptRoot
$r5Prior=Join-Path (Split-Path $r5Here -Parent) '20260920-late-command3-diagnosis'
if(Test-Path -LiteralPath (Join-Path $r5Here 'baseline.json')){throw 'Baseline already exists'}
function Save-R5([string]$Name,[byte[]]$Bytes){
 $r5Path=Join-Path $r5Here $Name;[IO.Directory]::CreateDirectory((Split-Path $r5Path -Parent))|Out-Null
 $r5S=[IO.File]::Open($r5Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$r5S.Write($Bytes,0,$Bytes.Length);$r5S.Flush($true)}finally{$r5S.Dispose()}
 return @{path=[IO.Path]::GetRelativePath($r5Root,$r5Path);bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$r5Old=Get-Content -LiteralPath (Join-Path $r5Prior 'final-evidence.json') -Raw|ConvertFrom-Json
$r5OldBase=Get-Content -LiteralPath (Join-Path $r5Prior 'baseline.json') -Raw|ConvertFrom-Json
$r5Before=@($r5Old.existingOwners|ForEach-Object{
 $r5Copy=Save-R5 ('before/'+$_.owner) ([IO.File]::ReadAllBytes((Join-Path $r5Root $_.owner)))
 if($r5Copy.sha256 -ne $_.after.sha256){throw ('Unexpected doc drift: '+$_.owner)}
 @{owner=$_.owner;copy=$r5Copy}
})
$r5Source='docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/attempts/20260920-vm-control/create-seed-media.ps1'
$r5SourceBefore=Save-R5 ('before/'+$r5Source) ([IO.File]::ReadAllBytes((Join-Path $r5Root $r5Source)))
foreach($r5Group in $r5OldBase.groups){foreach($r5File in $r5Group.files){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5File.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5File.sha256){throw ('Frozen source drift: '+$r5File.owner)}}}
foreach($r5File in @($r5OldBase.matrices)+@($r5OldBase.priorZips)){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5File.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5File.sha256){throw 'Retained matrix/package drift'}}
Save-R5 'continuation-request.txt' ([IO.File]::ReadAllBytes('C:\Users\79164\.codex\attachments\647d785a-ff7f-431b-a02a-b406e68d06eb\Вставленный текст.txt'))|Out-Null
Save-R5 'references/previous-autonomy-request.txt' ([IO.File]::ReadAllBytes('C:\Users\79164\.codex\attachments\1ea6dc6d-79f5-4f2d-a22c-f1c69f32df49\Вставленный текст.txt'))|Out-Null
$r5Os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
$r5OldProcess=Get-CimInstance Win32_Process -Filter 'ProcessId=9056' -OperationTimeoutSec 5
$r5OwnOld=($null -ne $r5OldProcess -and $r5OldProcess.Name -eq 'pwsh.exe' -and $r5OldProcess.CreationDate.ToString('o').StartsWith('2026-09-20T08:26:22.464087') -and $r5OldProcess.CommandLine -like '*20260920-vm-control\vm-control.ps1*')
$r5Runtime=@{at=[DateTimeOffset]::Now.ToString('o');boot=$r5Os.LastBootUpTime;freeRamBytes=([long]$r5Os.FreePhysicalMemory*1024);freeDiskBytes=(Get-PSDrive C).Free;oldPidPresent=($null -ne $r5OldProcess);oldOwnedHelperIdentityMatches=$r5OwnOld;pidReused=($null -ne $r5OldProcess -and -not $r5OwnOld);foreignProcessCommandLine='NOT_RECORDED';newVmState='REQUIRES_PRIVILEGED_READ';boundSshProbe='WSAEACCES_NO_AUTHENTICATION';workingDbInspected=$false}
$r5Data=@{at=[DateTimeOffset]::Now.ToString('o');before=$r5Before;generatorBefore=@{owner=$r5Source;copy=$r5SourceBefore};groups=$r5OldBase.groups;matrices=$r5OldBase.matrices;priorZips=$r5OldBase.priorZips;runtime=$r5Runtime;productExecuted=$false;guestInput=$false}
Save-R5 'baseline.json' ([Text.UTF8Encoding]::new($false).GetBytes(($r5Data|ConvertTo-Json -Depth 20)))|Out-Null
$r5Runtime|ConvertTo-Json
