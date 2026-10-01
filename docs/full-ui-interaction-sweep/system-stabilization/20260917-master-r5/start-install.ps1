$ErrorActionPreference='Stop'
$r5Installer=Join-Path $PSScriptRoot 'install-sandbox.ps1'
$r5InstallerHash=(Get-FileHash -LiteralPath $r5Installer -Algorithm SHA256).Hash.ToLowerInvariant()
$r5StartReceipt=Join-Path $PSScriptRoot 'install-uac-start.json'
$r5TerminalReceipt=Join-Path $PSScriptRoot 'install-uac-terminal.json'
if((Test-Path -LiteralPath $r5StartReceipt) -or (Test-Path -LiteralPath $r5TerminalReceipt)){throw 'Existing UAC attempt; inspect before starting another'}
$r5Started=[DateTimeOffset]::Now.ToString('o')
try{
 $r5Process=Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoProfile -File "'+$r5Installer+'" -ExpectedSha256 '+$r5InstallerHash) -PassThru
 [IO.File]::WriteAllText($r5StartReceipt,(@{at=$r5Started;pid=$r5Process.Id;scriptSha256=$r5InstallerHash;request='STANDARD_UAC_ENABLE_WINDOWS_SANDBOX_NO_RESTART';automaticReboot=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Write-Output ('R5 installer started, PID='+$r5Process.Id+'; wait for recorded result. No automatic reboot.')
 while(-not $r5Process.HasExited){Start-Sleep -Seconds 1;$r5Process.Refresh()}
 [IO.File]::WriteAllText($r5TerminalReceipt,(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;exitCode=$r5Process.ExitCode}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'install-result.json')){Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-result.json') -Raw | ConvertFrom-Json | Select-Object status,commandResult,changedFeatures,failure,exitCode,automaticReboot,sandboxExecutablePresent | ConvertTo-Json -Depth 5}else{throw 'No install-result receipt; do not infer installation success'}
}catch{
 if(-not (Test-Path -LiteralPath $r5TerminalReceipt)){[IO.File]::WriteAllText($r5TerminalReceipt,(@{at=[DateTimeOffset]::Now.ToString('o');startedAt=$r5Started;status='UAC_OR_LAUNCH_ERROR';message=$_.Exception.Message;scriptSha256=$r5InstallerHash}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))}
 throw
}
