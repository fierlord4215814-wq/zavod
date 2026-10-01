# Run this non-elevated coordinator under the existing permitted PowerShell host.
# Elevate only Microsoft's signed DISM.exe with fixed scoped arguments; never change execution policy.
$ErrorActionPreference='Stop'
$r5Attempt=$PSScriptRoot
$r5Parent=Split-Path -Parent $r5Attempt
$r5PreflightPath=Join-Path $r5Parent 'preflight.json'
$r5Preflight=Get-Content -LiteralPath $r5PreflightPath -Raw | ConvertFrom-Json
function Save-R5Native([string]$Name,$Data){$r5Path=Join-Path $r5Attempt $Name;if(Test-Path -LiteralPath $r5Path){throw ('Preserve existing receipt '+$Name)};[IO.File]::WriteAllText($r5Path,($Data|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))}
if(Test-Path -LiteralPath (Join-Path $r5Attempt 'request.json')){throw 'This native attempt already exists; no automatic repeat'}
if($r5Preflight.status -ne 'PLATFORM_COMPATIBILITY_READY_FOR_STANDARD_UAC_NOT_RUNTIME_PROOF'){throw 'Missing compatibility review'}
foreach($r5Evidence in $r5Preflight.evidence){if((Get-FileHash -LiteralPath (Join-Path $r5Parent $r5Evidence.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Evidence.sha256){throw 'Preflight evidence changed'}}
$r5Windows=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$r5Os=Get-CimInstance Win32_OperatingSystem
$r5Cpu=Get-CimInstance Win32_Processor
$r5Host=Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent,TotalPhysicalMemory
$r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if($r5Windows.EditionID -ne 'Professional' -or -not $r5Os.DataExecutionPrevention_Available){throw 'Host edition/DEP changed'}
if(-not($r5Cpu|Where-Object {$_.VirtualizationFirmwareEnabled -and $_.SecondLevelAddressTranslationExtensions -and $_.VMMonitorModeExtensions -and $_.AddressWidth -eq 64})){throw 'Virtualization requirements changed'}
if([double]$r5Os.FreePhysicalMemory*1024 -lt $r5Preflight.resources.minimumFreeRamBeforeVmBytes -or [double]$r5Disk.FreeSpace -lt $r5Preflight.resources.minimumFreeDiskBeforeInstallBytes){throw 'Fresh resources below reviewed budget; no cleanup'}
$r5Before=@(Get-CimInstance Win32_OptionalFeature | Select-Object Name,InstallState)
$r5Dism='C:\Windows\System32\Dism.exe'
$r5Signature=Get-AuthenticodeSignature -LiteralPath $r5Dism
if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Windows,*'){throw 'Native DISM signature not verified'}
$r5Log=Join-Path $r5Attempt 'dism.log'
$r5Arguments='/Online /Enable-Feature /FeatureName:Microsoft-Hyper-V /FeatureName:Microsoft-Hyper-V-Management-PowerShell /All /NoRestart /English /LogPath:"'+$r5Log+'"'
$r5Request=@{at=[DateTimeOffset]::Now.ToString('o');coordinatorSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();executable=$r5Dism;binarySha256=(Get-FileHash -LiteralPath $r5Dism -Algorithm SHA256).Hash.ToLowerInvariant();signatureStatus=$r5Signature.Status.ToString();signer=$r5Signature.SignerCertificate.Subject;arguments=$r5Arguments;verb='RunAs';windowStyle='Normal';preflightSha256=(Get-FileHash -LiteralPath $r5PreflightPath -Algorithm SHA256).Hash.ToLowerInvariant();beforeFeatures=$r5Before;beforeHypervisor=$r5Host;freeDiskBytes=$r5Disk.FreeSpace;freeRamBytes=([double]$r5Os.FreePhysicalMemory*1024);lastBootUpTime=$r5Os.LastBootUpTime.ToString('o');automaticHostReboot=$false;executionPolicyChanged=$false}
Save-R5Native 'request.json' $r5Request
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R5ElevationReadOnly {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,out int value,int size,out int returned);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static bool Observe(int pid) {
  IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;
  if(process==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  try {if(!OpenProcessToken(process,0x0008,out token))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   int elevated,len;if(!GetTokenInformation(token,20,out elevated,4,out len))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return elevated!=0;
  } finally {if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
 }
}
'@
$r5Process=$null;$r5Elevation=$null;$r5ElevationError=$null
try{
 $r5Process=Start-Process -FilePath $r5Dism -ArgumentList $r5Arguments -WorkingDirectory $r5Attempt -Verb RunAs -WindowStyle Normal -PassThru
 try{$r5Elevation=[R5ElevationReadOnly]::Observe($r5Process.Id)}catch{$r5ElevationError=$_.Exception.Message}
 Save-R5Native 'process-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;actualTokenElevated=$r5Elevation;tokenObservationError=$r5ElevationError;observation='Read only newly launched DISM token elevation flag, not token contents'}
 Write-Output ('Visible Microsoft DISM started, PID='+$r5Process.Id+'; observed elevated='+$r5Elevation+'. No automatic reboot.')
 while(-not $r5Process.HasExited){Start-Sleep -Seconds 1;$r5Process.Refresh()}
 $r5Exit=$r5Process.ExitCode
 $r5After=@(Get-CimInstance Win32_OptionalFeature | Select-Object Name,InstallState)
 $r5Changes=@(foreach($r5Feature in $r5After){$r5Old=$r5Before|Where-Object Name -eq $r5Feature.Name;if($null -ne $r5Old -and $r5Old.InstallState -ne $r5Feature.InstallState){[PSCustomObject]@{name=$r5Feature.Name;before=$r5Old.InstallState;after=$r5Feature.InstallState}}})
 $r5Unexpected=@($r5Changes|Where-Object {$_.name -notlike 'Microsoft-Hyper-V*'})
 $r5Status=if($r5Exit -eq 3010){'REBOOT_REQUIRED'}elseif($r5Exit -eq 0){'ENABLE_COMMAND_SUCCEEDED_CHECK_FEATURES'}else{'FAILED_EXACT_EXIT_NO_REPAIR'}
 if($r5Unexpected.Count -gt 0){$r5Status='UNEXPECTED_FEATURE_DELTA_REVIEW_REQUIRED'}
 $r5Result=@{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;exitCode=$r5Exit;status=$r5Status;actualTokenElevated=$r5Elevation;tokenObservationError=$r5ElevationError;afterFeatures=$r5After;changedFeatures=$r5Changes;unexpectedFeatures=$r5Unexpected;afterHypervisor=(Get-CimInstance Win32_ComputerSystem|Select-Object HypervisorPresent);freeDiskBytes=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace;automaticHostReboot=$false;executionPolicyChanged=$false;vmCreated=$false;networkConfigured=$false;workingPostgresqlServiceDataEnvUploadsAccessed=$false}
 Save-R5Native 'result.json' $r5Result
 $r5Result|Select-Object status,pid,exitCode,actualTokenElevated,tokenObservationError,changedFeatures,unexpectedFeatures,afterHypervisor,freeDiskBytes,automaticHostReboot|ConvertTo-Json -Depth 6
 if($r5Exit -notin @(0,3010)){exit 1}
}catch{
 Save-R5Native 'failure.json' @{at=[DateTimeOffset]::Now.ToString('o');status='NATIVE_UAC_OR_COORDINATOR_ERROR';message=$_.Exception.Message;type=$_.Exception.GetType().FullName;pid=$(if($null -ne $r5Process){$r5Process.Id}else{$null});automaticRepeat=$false}
 throw
}
