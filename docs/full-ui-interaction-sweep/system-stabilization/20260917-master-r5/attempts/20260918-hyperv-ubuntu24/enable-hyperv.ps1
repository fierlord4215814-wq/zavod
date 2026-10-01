param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$PreflightSha256
)
# Limited visible elevated helper. No VM/network/app/DB/bootstrap/reboot actions.
$ErrorActionPreference='Stop'
$r5Attempt=[IO.Path]::GetFullPath($PSScriptRoot)
$r5PreflightPath=Join-Path $r5Attempt 'preflight.json'
if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Installer hash mismatch'}
if((Get-FileHash -LiteralPath $r5PreflightPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PreflightSha256){throw 'Preflight hash mismatch'}
$r5Preflight=Get-Content -LiteralPath $r5PreflightPath -Raw | ConvertFrom-Json
if($r5Preflight.status -ne 'PLATFORM_COMPATIBILITY_READY_FOR_STANDARD_UAC_NOT_RUNTIME_PROOF'){throw 'Compatibility review required'}
foreach($r5Evidence in $r5Preflight.evidence){
 if((Get-FileHash -LiteralPath (Join-Path $r5Attempt $r5Evidence.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Evidence.sha256){throw ('Evidence changed: '+$r5Evidence.name)}
}
$r5Admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $r5Admin){throw 'Actual administrator token required; no bypass'}
$r5ResultPath=Join-Path $r5Attempt 'install-result.json'
if(Test-Path -LiteralPath $r5ResultPath){throw 'Preserve existing result; this attempt is not repeatable'}
function Save-R5Receipt([string]$Name,$Data){
 $r5Dest=Join-Path $r5Attempt $Name
 if(Test-Path -LiteralPath $r5Dest){throw ('Immutable receipt exists: '+$Name)}
 [IO.File]::WriteAllText($r5Dest,($Data|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
$r5Start=[DateTimeOffset]::Now.ToString('o')
$r5Targets=@('Microsoft-Hyper-V','Microsoft-Hyper-V-Management-PowerShell')
$r5ExactCommand='Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V,Microsoft-Hyper-V-Management-PowerShell -All -NoRestart'
$r5Log=Join-Path $r5Attempt 'install-dism.log'
$r5Before=@();$r5After=@();$r5CommandResult=@();$r5Error=$null;$r5Exit=0;$r5Status='PRECONDITIONS';$r5Phase='fresh preconditions';$r5HostBefore=$null;$r5Os=$null
Write-Host 'MASTER R5: enable ONLY Hyper-V platform and PowerShell management.'
Write-Host 'No automatic restart. No Sandbox/WSL/Docker. No project database access.'
try{
 $r5Windows=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
 $r5Cpu=Get-CimInstance Win32_Processor
 $r5Os=Get-CimInstance Win32_OperatingSystem
 $r5HostBefore=Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent,TotalPhysicalMemory
 $r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
 if($r5Windows.EditionID -ne 'Professional' -or [int]$r5Windows.CurrentBuild -lt 19045){throw 'Unexpected host edition/build; stop'}
 if(-not ($r5Cpu | Where-Object {$_.AddressWidth -eq 64 -and $_.VirtualizationFirmwareEnabled -and $_.SecondLevelAddressTranslationExtensions -and $_.VMMonitorModeExtensions})){throw 'Virtualization/SLAT requirement not met; no BIOS changes'}
 if(-not $r5Os.DataExecutionPrevention_Available){throw 'DEP not available; no security changes'}
 if([double]$r5Os.FreePhysicalMemory*1024 -lt [double]$r5Preflight.resources.minimumFreeRamBeforeVmBytes){throw 'Free RAM below reviewed budget'}
 if([double]$r5Disk.FreeSpace -lt [double]$r5Preflight.resources.minimumFreeDiskBeforeInstallBytes){throw 'Free disk below reviewed budget; no cleanup'}
 $r5Phase='before feature snapshot'
 $r5Before=@(Get-WindowsOptionalFeature -Online -LogPath $r5Log | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})
 Save-R5Receipt 'install-before.json' @{at=$r5Start;pid=$PID;actualAdministratorToken=$r5Admin;scriptSha256=$ExpectedSha256;preflightSha256=$PreflightSha256;exactCommand=$r5ExactCommand;features=$r5Before;lastBootUpTime=$r5Os.LastBootUpTime.ToString('o');hypervisor=$r5HostBefore;freeRamBytes=([double]$r5Os.FreePhysicalMemory*1024);freeDiskBytes=$r5Disk.FreeSpace;automaticHostReboot=$false}
 $r5CurrentTargets=@($r5Before|Where-Object {$_.FeatureName -in $r5Targets})
 if($r5CurrentTargets.Count -ne 2){throw 'Required Hyper-V feature not exposed by Windows'}
 if(@($r5CurrentTargets|Where-Object State -eq 'EnablePending').Count -gt 0){$r5Status='REBOOT_REQUIRED_ALREADY_PENDING'}
 elseif(@($r5CurrentTargets|Where-Object State -eq 'Enabled').Count -eq 2){$r5Status='ALREADY_ENABLED_NO_INSTALL'}
 elseif(@($r5CurrentTargets|Where-Object {$_.State -notin @('Enabled','Disabled','DisabledWithPayloadRemoved')}).Count -gt 0){throw 'Unexpected feature state; no repair'}
 else{
  $r5Phase='Enable-WindowsOptionalFeature'
  Write-Host $r5ExactCommand
  $r5CommandResult=@(Enable-WindowsOptionalFeature -Online -FeatureName $r5Targets -All -NoRestart -LogPath $r5Log -ErrorAction Stop | Select-Object Online,RestartNeeded)
  $r5Status='ENABLE_COMMAND_COMPLETED'
 }
 $r5Phase='after feature snapshot'
 $r5After=@(Get-WindowsOptionalFeature -Online -LogPath $r5Log | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})
 $r5AfterTargets=@($r5After|Where-Object {$_.FeatureName -in $r5Targets})
 if(@($r5CommandResult|Where-Object RestartNeeded).Count -gt 0 -or @($r5AfterTargets|Where-Object State -eq 'EnablePending').Count -gt 0){$r5Status='REBOOT_REQUIRED'}
 elseif(@($r5AfterTargets|Where-Object State -eq 'Enabled').Count -ne 2){throw 'Hyper-V targets not enabled after command'}
 elseif(-not $r5HostBefore.HypervisorPresent){$r5Status='ENABLED_HYPERVISOR_NOT_ACTIVE_REVIEW_REQUIRED'}
 else{$r5Status='READY_NO_REBOOT_REQUIRED'}
}catch{
 $r5Exit=1;$r5Status='FAILED_EXACT_ERROR_NO_REPAIR'
 $r5Error=@{phase=$r5Phase;type=$_.Exception.GetType().FullName;message=$_.Exception.Message;hresult=$_.Exception.HResult}
 try{$r5After=@(Get-WindowsOptionalFeature -Online -LogPath $r5Log | Select-Object FeatureName,@{Name='State';Expression={$_.State.ToString()}})}catch{}
}finally{
 $r5Changed=@(foreach($r5Feature in $r5After){$r5Old=$r5Before|Where-Object FeatureName -eq $r5Feature.FeatureName;if($null -ne $r5Old -and $r5Old.State -ne $r5Feature.State){[PSCustomObject]@{name=$r5Feature.FeatureName;before=$r5Old.State;after=$r5Feature.State}}})
 $r5Unexpected=@($r5Changed|Where-Object {$_.name -notlike 'Microsoft-Hyper-V*'})
 if($r5Unexpected.Count -gt 0){$r5Exit=1;$r5Status='UNEXPECTED_FEATURE_DELTA_REVIEW_REQUIRED'}
 Save-R5Receipt 'install-result.json' @{startedAt=$r5Start;finishedAt=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualAdministratorToken=$r5Admin;installerSha256=$ExpectedSha256;preflightSha256=$PreflightSha256;exactCommand=$r5ExactCommand;status=$r5Status;commandResult=$r5CommandResult;afterFeatures=$r5After;changedFeatures=$r5Changed;unexpectedFeatures=$r5Unexpected;error=$r5Error;exitCode=$r5Exit;automaticHostReboot=$false;vmCreated=$false;networkConfigured=$false;workingPostgresqlServiceDbEnvUploadsAccessed=$false;otherRuntimesInstalled=$false;lastBootUpTime=$(if($null -ne $r5Os){$r5Os.LastBootUpTime.ToString('o')}else{$null})}
 Write-Host ('R5 result: '+$r5Status)
 Write-Host ('Receipt: '+$r5ResultPath)
 Write-Host 'The computer will NOT restart automatically.'
}
Start-Sleep -Seconds 2
exit $r5Exit
