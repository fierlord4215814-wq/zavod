$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Receipt=Join-Path $r5Here 'console-observer-uac-request.json'
if(Test-Path -LiteralPath $r5Receipt){throw 'Prior console UAC attempt exists; preserve and stop'}
$r5Script=Join-Path $r5Here 'observe-vm-console.ps1'
$r5Hash=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Pwsh=Join-Path $PSHOME 'pwsh.exe'
$r5Sig=Get-AuthenticodeSignature -LiteralPath $r5Pwsh
if($r5Sig.Status -ne 'Valid' -or $r5Sig.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*'){throw 'Current PowerShell signature not valid'}
$r5Args='-NoProfile -File "'+$r5Script+'" -ExpectedSha256 '+$r5Hash
[IO.File]::WriteAllText($r5Receipt,(@{at=[DateTimeOffset]::Now.ToString('o');executable=$r5Pwsh;arguments=$r5Args;scriptSha256=$r5Hash;verb='RunAs';windowStyle='Normal';readOnlyHyperV=$true;vmId='99a158da-c247-422c-ae11-109485a92b1f';settingsOrGuestCommands=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
try{$r5Process=Start-Process -FilePath $r5Pwsh -ArgumentList $r5Args -WorkingDirectory $r5Here -Verb RunAs -WindowStyle Normal -PassThru;[IO.File]::WriteAllText((Join-Path $r5Here 'console-observer-uac-start.json'),(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;actualToken='Require independent observer start receipt'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false));Write-Output ('Own VM read-only observer PID='+$r5Process.Id)}catch{[IO.File]::WriteAllText((Join-Path $r5Here 'console-observer-uac-failure.json'),(@{at=[DateTimeOffset]::Now.ToString('o');message=$_.Exception.Message;automaticRepeat=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false));throw}
