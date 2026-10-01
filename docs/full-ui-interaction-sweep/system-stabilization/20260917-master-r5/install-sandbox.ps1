param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'R5 installer bytes changed'}
$r5Principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $r5Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Standard administrator/UAC token required; no bypass'}
$r5Batch=[IO.Path]::GetFullPath($PSScriptRoot)
$r5Receipt=Join-Path $r5Batch 'install-result.json'
if(Test-Path -LiteralPath $r5Receipt){throw 'Existing install result; inspect it before any new attempt'}
function Save-R5Install([string]$Name,$Data){$r5File=Join-Path $r5Batch $Name;if(Test-Path -LiteralPath $r5File){throw ('Immutable install receipt exists: '+$Name)};[IO.File]::WriteAllText($r5File,($Data|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
$r5Started=[DateTimeOffset]::Now.ToString('o')
$r5Before=@();$r5After=@();$r5Result=$null;$r5Status='NOT_STARTED';$r5Failure=$null;$r5ExitCode=0
$r5DismLog=Join-Path $r5Batch 'install-dism.log'
try{
 $r5Win=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
 $r5Cpu=Get-CimInstance Win32_Processor
 if($r5Win.EditionID -notin @('Professional','Enterprise','Education','ProfessionalEducation','ProfessionalWorkstation') -or [int]$r5Win.CurrentBuildNumber -lt 18362){throw 'Unsupported edition/build; do not patch around requirements'}
 if(-not ($r5Cpu|Where-Object {$_.VirtualizationFirmwareEnabled -and $_.SecondLevelAddressTranslationExtensions})){throw 'Virtualization/SLAT precondition failed; do not change BIOS'}
 $r5Before=@(Get-WindowsOptionalFeature -Online -LogPath $r5DismLog | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})
 Save-R5Install 'install-before-features.json' @{at=$r5Started;scriptSha256=$ExpectedSha256;pid=$PID;features=$r5Before;command='Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All -NoRestart';automaticReboot=$false}
 $r5Target=@($r5Before|Where-Object FeatureName -eq 'Containers-DisposableClientVM')
 if($r5Target.Count -ne 1){throw 'Windows Sandbox feature not available; no unofficial workaround'}
 if($r5Target[0].State -eq 'EnablePending'){$r5Status='REBOOT_REQUIRED_ALREADY_PENDING'}
 elseif($r5Target[0].State -eq 'Enabled'){$r5Status='ALREADY_ENABLED_NO_INSTALL'}
 elseif($r5Target[0].State -in @('Disabled','DisabledWithPayloadRemoved')){
  $r5Status='ENABLE_STARTED'
  $r5Result=Enable-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM' -All -NoRestart -LogPath $r5DismLog -ErrorAction Stop | Select-Object Online,RestartNeeded
  $r5Status='ENABLE_COMMAND_COMPLETED'
 }else{throw ('Unexpected pending feature state '+$r5Target[0].State)}
 $r5After=@(Get-WindowsOptionalFeature -Online -LogPath $r5DismLog | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})
 $r5FinalTarget=$r5After|Where-Object FeatureName -eq 'Containers-DisposableClientVM'
 if($r5Result.RestartNeeded -or $r5FinalTarget.State -eq 'EnablePending'){$r5Status='REBOOT_REQUIRED'}
 elseif($r5FinalTarget.State -ne 'Enabled'){throw ('Feature not enabled: '+$r5FinalTarget.State)}
}catch{$r5Failure=@{type=$_.Exception.GetType().FullName;message=$_.Exception.Message;hresult=$_.Exception.HResult};$r5Status='FAILED_EXACT_ERROR_NO_REPAIR';$r5ExitCode=1
 try{$r5After=@(Get-WindowsOptionalFeature -Online -LogPath $r5DismLog | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})}catch{}
}finally{
 $r5Changes=@(foreach($r5Item in $r5After){$r5Old=$r5Before|Where-Object FeatureName -eq $r5Item.FeatureName;if($r5Old.State -ne $r5Item.State){@{FeatureName=$r5Item.FeatureName;before=$r5Old.State;after=$r5Item.State}}})
 Save-R5Install 'install-result.json' @{startedAt=$r5Started;finishedAt=[DateTimeOffset]::Now.ToString('o');pid=$PID;installerSha256=$ExpectedSha256;status=$r5Status;commandResult=$r5Result;failure=$r5Failure;exitCode=$r5ExitCode;afterFeatures=$r5After;changedFeatures=$r5Changes;sandboxExecutablePresent=(Test-Path -LiteralPath 'C:\Windows\System32\WindowsSandbox.exe');automaticReboot=$false;workingPgServiceDbEnvUploadsAccessed=$false;otherRuntimesInstalled=$false;noSecurityPolicyPowerClockChange=$true}
}
exit $r5ExitCode
