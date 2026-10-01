# Preserve current documentation/source identities before the explicitly authorized diagnostic boot.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work'
$r5Here=$PSScriptRoot
$r5Prior=Join-Path (Split-Path $r5Here -Parent) '20260921-visible-uac-diagnostic-boot'
function Save-R5Bytes([string]$Path,[byte[]]$Bytes){
 [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
 $r5Stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$r5Stream.Write($Bytes,0,$Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}
 return @{path=[IO.Path]::GetRelativePath($r5Root,$Path).Replace('\','/');bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
if(Test-Path -LiteralPath (Join-Path $r5Here 'baseline.json')){throw 'Attempt already begun; preserve and resume'}
$r5Old=Get-Content -LiteralPath (Join-Path $r5Prior 'final-identities.json') -Raw|ConvertFrom-Json
$r5Delta=Get-Content -LiteralPath (Join-Path $r5Prior 'source-delta-manifest.json') -Raw|ConvertFrom-Json
$r5Before=@(foreach($r5Entry in $r5Delta.existingOwners){
 if($r5Entry.owner -match '(^|/)(\.env|uploads|private)(/|$)'){throw 'Protected path not allowed in baseline'}
 $r5Copy=Save-R5Bytes (Join-Path $r5Here ('before/'+$r5Entry.owner)) ([IO.File]::ReadAllBytes((Join-Path $r5Root $r5Entry.owner)))
 @{owner=$r5Entry.owner;copy=$r5Copy;matchesPrior=($r5Copy.sha256 -eq $r5Entry.after.sha256)}
})
foreach($r5Group in $r5Old.groups){foreach($r5Entry in $r5Group.files){
 if($r5Entry.owner -match '(^|/)(\.env|uploads|private)(/|$)'){throw 'Protected path not allowed'}
 if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Entry.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Entry.sha256){throw ('Source drift: preserve and inspect '+$r5Entry.owner)}
}}
$r5Package=Get-Content -LiteralPath (Join-Path $r5Prior 'package-receipt.json') -Raw|ConvertFrom-Json
$r5Zips=@($r5Old.priorZips)+@(@{path=[IO.Path]::GetRelativePath($r5Root,$r5Package.path).Replace('\','/');bytes=$r5Package.bytes;sha256=$r5Package.sha256})
foreach($r5Entry in @($r5Old.matrices)+$r5Zips){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Entry.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Entry.sha256){throw 'Retained matrix/archive drift'}}
if(-not(Test-Path -LiteralPath (Join-Path $r5Here 'continuation-request.txt'))){throw 'Explicit new authority file missing'}
$r5Git='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$r5Branch=& $r5Git -C $r5Root branch --show-current
$r5Head=& $r5Git -C $r5Root rev-parse HEAD
$r5Dirty=& $r5Git -C $r5Root status --porcelain=v1 --untracked-files=normal
Save-R5Bytes (Join-Path $r5Here 'dirty-baseline.txt') ([Text.UTF8Encoding]::new($false).GetBytes(($r5Dirty -join "`n")))|Out-Null
$r5Baseline=@{at=[DateTimeOffset]::Now.ToString('o');branch=$r5Branch;head=$r5Head;before=$r5Before;groups=$r5Old.groups;matrices=$r5Old.matrices;priorZips=$r5Zips;codexRestart='USER_CONFIRMED_WITHOUT_TIMESTAMP';authority='USER_ONE_VISIBLE_UAC_C056B875_20260922';diagnosticBootAllowance=1;bootExecuted=$false;workingDataAccessed=$false}
Save-R5Bytes (Join-Path $r5Here 'baseline.json') ([Text.UTF8Encoding]::new($false).GetBytes(($r5Baseline|ConvertTo-Json -Depth 30)))|Out-Null
[pscustomobject]@{status='BASELINE_SAVED';owners=$r5Before.Count;productBuildHarnessCounts=@($r5Old.groups|ForEach-Object {$_.files.Count});retainedZips=$r5Zips.Count;retainedMatrices=$r5Old.matrices.Count;bootExecuted=$false}|ConvertTo-Json
