# The user explicitly requested a visible limited installer; do not hide this UAC window.
$ErrorActionPreference='Stop'
$r5Installer=Join-Path $PSScriptRoot 'enable-hyperv.ps1'
$r5InstallerHash=(Get-FileHash -LiteralPath $r5Installer -Algorithm SHA256).Hash.ToLowerInvariant()
$r5PreflightHash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'preflight.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$r5RequestPath=Join-Path $PSScriptRoot 'uac-request.json'
$r5TerminalPath=Join-Path $PSScriptRoot 'uac-terminal.json'
foreach($r5ReceiptPath in @($r5RequestPath,$r5TerminalPath,(Join-Path $PSScriptRoot 'install-result.json'))){if(Test-Path -LiteralPath $r5ReceiptPath){throw 'Named UAC attempt already exists; preserve receipts and inspect before any new action'}}
$r5Args='-NoProfile -File "'+$r5Installer+'" -ExpectedSha256 '+$r5InstallerHash+' -PreflightSha256 '+$r5PreflightHash
[IO.File]::WriteAllText($r5RequestPath,(@{at=[DateTimeOffset]::Now.ToString('o');installerSha256=$r5InstallerHash;preflightSha256=$r5PreflightHash;executable='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';arguments=$r5Args;verb='RunAs';windowStyle='Normal';automaticHostReboot=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
try{
 $r5Process=Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList $r5Args -WorkingDirectory $PSScriptRoot -Verb RunAs -WindowStyle Normal -PassThru
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'uac-start.json'),(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;installerSha256=$r5InstallerHash}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Write-Output ('Visible R5 Hyper-V helper started. PID='+$r5Process.Id+'. No automatic restart.')
 while(-not $r5Process.HasExited){Start-Sleep -Seconds 1;$r5Process.Refresh()}
 [IO.File]::WriteAllText($r5TerminalPath,(@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;exitCode=$r5Process.ExitCode;status='ELEVATED_PROCESS_EXITED'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $r5ResultPath=Join-Path $PSScriptRoot 'install-result.json'
 if(-not(Test-Path -LiteralPath $r5ResultPath)){throw 'Elevated process ended without install-result; not PASS'}
 $r5Result=Get-Content -LiteralPath $r5ResultPath -Raw | ConvertFrom-Json
 $r5Result|Select-Object status,commandResult,changedFeatures,unexpectedFeatures,error,exitCode,automaticHostReboot|ConvertTo-Json -Depth 6
 exit $r5Result.exitCode
}catch{
 if(-not(Test-Path -LiteralPath $r5TerminalPath)){
  [IO.File]::WriteAllText($r5TerminalPath,(@{at=[DateTimeOffset]::Now.ToString('o');status='UAC_OR_LAUNCH_ERROR';message=$_.Exception.Message;type=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult;installerSha256=$r5InstallerHash}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 }
 throw
}
