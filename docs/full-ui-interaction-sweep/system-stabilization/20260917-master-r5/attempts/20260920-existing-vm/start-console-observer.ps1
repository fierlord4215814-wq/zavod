# One newly authorized visible UAC. Exact read-only helper; no execution-policy bypass or automatic retry.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Request=Join-Path $r5Here 'console-observer-uac-request.json'
if(Test-Path -LiteralPath $r5Request){throw 'Preserve previous UAC attempt; do not retry'}
$r5Script=Join-Path $r5Here 'observe-vm-console.ps1'
$r5Hash=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Tokens=$null;$r5Errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($r5Script,[ref]$r5Tokens,[ref]$r5Errors)
if($r5Errors.Count){throw 'Observer parser errors; do not launch'}
$r5Pwsh=Join-Path $PSHOME 'pwsh.exe'
$r5Signature=Get-AuthenticodeSignature -LiteralPath $r5Pwsh
if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*'){throw 'PowerShell Microsoft signature not valid'}
$r5Args='-NoProfile -File "'+$r5Script+'" -ExpectedSha256 '+$r5Hash
[IO.File]::WriteAllText($r5Request,(@{at=[DateTimeOffset]::Now.ToString('o');purpose='ONE_READ_ONLY_EXISTING_VM_OBSERVATION';executable=$r5Pwsh;arguments=$r5Args;scriptSha256=$r5Hash;launcherSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();verb='RunAs';windowStyle='Normal';vmId='99a158da-c247-422c-ae11-109485a92b1f';hostGuestMutations=$false;requestReference='continuation-request.txt';automaticRetry=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
try{
 $r5Process=Start-Process -FilePath $r5Pwsh -ArgumentList $r5Args -WorkingDirectory $r5Here -Verb RunAs -WindowStyle Normal -PassThru
 [IO.File]::WriteAllText((Join-Path $r5Here 'console-observer-uac-start.json'),(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;actualToken='Require independent observer-start proof'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Write-Output ('Read-only observer PID='+$r5Process.Id)
}catch{
 [IO.File]::WriteAllText((Join-Path $r5Here 'console-observer-uac-failure.json'),(@{at=[DateTimeOffset]::Now.ToString('o');message=$_.Exception.Message;automaticRetry=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 throw
}
