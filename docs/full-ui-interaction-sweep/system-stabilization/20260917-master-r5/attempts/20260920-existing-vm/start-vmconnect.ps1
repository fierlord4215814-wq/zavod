# Open the existing Microsoft viewer for the already observed exact VM name. No RunAs retry or guest input.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Receipt=Join-Path $r5Here 'vmconnect-launch.json'
if(Test-Path -LiteralPath $r5Receipt){throw 'Preserve previous viewer launch; do not duplicate'}
$r5Observed=Get-Content -LiteralPath (Join-Path $r5Here 'vm-state-after.json') -Raw|ConvertFrom-Json
if($r5Observed.vm.Name -ne '99a158da-c247-422c-ae11-109485a92b1f' -or $r5Observed.vm.ElementName -ne 'Zavod-Master-R5-Ubuntu24'){throw 'Observed VM identity mismatch'}
$r5Exe='C:\Windows\System32\vmconnect.exe'
$r5Sig=Get-AuthenticodeSignature -LiteralPath $r5Exe
if($r5Sig.Status -ne 'Valid' -or $r5Sig.SignerCertificate.Subject -notlike '*Microsoft*'){throw 'VMConnect signature invalid'}
$r5Start=@{at=[DateTimeOffset]::Now.ToString('o');executable=$r5Exe;sha256=(Get-FileHash -LiteralPath $r5Exe -Algorithm SHA256).Hash.ToLowerInvariant();arguments='localhost "Zavod-Master-R5-Ubuntu24"';vmId=$r5Observed.vm.Name;viewOnlyIntent=$true;runAsRequested=$false;enhancedResourcesRequested=$false;inputActions=0}
try{$r5Process=Start-Process -FilePath $r5Exe -ArgumentList $r5Start.arguments -WindowStyle Normal -PassThru;$r5Start.pid=$r5Process.Id;$r5Start.status='PROCESS_LAUNCHED_CONSOLE_NOT_YET_OBSERVED'}catch{$r5Start.status='LAUNCH_FAILED_NO_RETRY';$r5Start.message=$_.Exception.Message}
[IO.File]::WriteAllText($r5Receipt,($r5Start|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$r5Start|ConvertTo-Json
if($r5Start.status -eq 'LAUNCH_FAILED_NO_RETRY'){exit 1}
