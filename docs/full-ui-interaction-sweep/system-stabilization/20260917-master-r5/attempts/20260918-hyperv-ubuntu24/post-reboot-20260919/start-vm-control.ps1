# Standard visible UAC; only this fixed coordinator receives an elevated token.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Request=Join-Path $r5Here 'vm-control-uac-request.json'
if(Test-Path -LiteralPath $r5Request){throw 'Prior UAC attempt exists; preserve and inspect, no automatic repeat'}
$r5Script=Join-Path $r5Here 'vm-control.ps1'
$r5Sha=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Pwsh=Join-Path $PSHOME 'pwsh.exe'
$r5Signature=Get-AuthenticodeSignature -LiteralPath $r5Pwsh
if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*'){throw 'PowerShell binary authenticity not established'}
$r5Arguments='-NoProfile -File "'+$r5Script+'" -ExpectedSha256 '+$r5Sha
[IO.File]::WriteAllText($r5Request,(@{at=[DateTimeOffset]::Now.ToString('o');executable=$r5Pwsh;arguments=$r5Arguments;scriptSha256=$r5Sha;verb='RunAs';windowStyle='Normal';noExecutionPolicyChange=$true;scope='One own Gen2 VM/internal switch, fixed storage/limits, finite allowlisted own-VM controls; no host firewall/NAT or arbitrary commands'}|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
try{
 $r5Process=Start-Process -FilePath $r5Pwsh -ArgumentList $r5Arguments -WorkingDirectory $r5Here -Verb RunAs -WindowStyle Normal -PassThru
 [IO.File]::WriteAllText((Join-Path $r5Here 'vm-control-uac-start.json'),(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;actualTokenProof='Must come from coordinator vm-control-before.json, not inferred from RunAs'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Write-Output ('Visible limited VM coordinator started, PID='+$r5Process.Id+'. Inspect actual readiness receipt; not yet guest/isolation proof.')
}catch{
 [IO.File]::WriteAllText((Join-Path $r5Here 'vm-control-uac-failure.json'),(@{at=[DateTimeOffset]::Now.ToString('o');status='UAC_OR_LAUNCH_FAILED';message=$_.Exception.Message;automaticRepeat=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 throw
}
