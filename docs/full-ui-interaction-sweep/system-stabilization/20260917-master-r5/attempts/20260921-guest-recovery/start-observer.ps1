# One normal UAC request, no execution-policy override or automatic retry.
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
$r5Request=Join-Path $r5Here 'uac-request.json'
if(Test-Path -LiteralPath $r5Request){throw 'A UAC attempt already exists; never repeat cancellation'}
$r5Script=Join-Path $r5Here 'observe-existing-guest.ps1';$r5Hash=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Tokens=$null;$r5Errors=$null;[Management.Automation.Language.Parser]::ParseFile($r5Script,[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
if($r5Errors.Count){throw 'Observer parse failed'}
$r5Pwsh=Join-Path $PSHOME 'pwsh.exe';$r5Signature=Get-AuthenticodeSignature -LiteralPath $r5Pwsh
if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*'){throw 'PowerShell signature not confirmed'}
$r5Args='-NoProfile -File "'+$r5Script+'" -ExpectedSha256 '+$r5Hash
[IO.File]::WriteAllText($r5Request,(@{at=[DateTimeOffset]::Now.ToString('o');purpose='READ_OWN_VM_AND_REDACTED_ATTACHED_SEED_OPEN_NATIVE_OWN_CONSOLE';vmId='99a158da-c247-422c-ae11-109485a92b1f';helperSha256=$r5Hash;hostGuestMutation=$false;windowStyle='Hidden helper; visible interactive native VMConnect';approval='User continuation-request.txt; native UAC still required';automaticRetry=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
try{
 $r5P=Start-Process -FilePath $r5Pwsh -ArgumentList $r5Args -WorkingDirectory $r5Here -Verb RunAs -WindowStyle Hidden -PassThru
 [IO.File]::WriteAllText((Join-Path $r5Here 'uac-start.json'),(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5P.Id;actualToken='Verify observer-start receipt'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Write-Output ('Scoped observer PID='+$r5P.Id)
}catch{
 [IO.File]::WriteAllText((Join-Path $r5Here 'uac-failure.json'),(@{at=[DateTimeOffset]::Now.ToString('o');error=$_.Exception.Message;automaticRetry=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 throw
}
