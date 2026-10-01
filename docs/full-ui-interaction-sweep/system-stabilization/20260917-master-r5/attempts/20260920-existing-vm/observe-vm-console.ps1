# Minimal bounded continuation of the saved read-only observer. Exact existing VM; no guest/VM mutations.
param([Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5VmId='99a158da-c247-422c-ae11-109485a92b1f'
$r5OldHere=Join-Path (Split-Path -Parent $r5Here) '20260920-vm-control'
$r5Queue='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24\control'
$r5Terminal=Join-Path $r5Here 'console-observer-terminal.json'
$r5Seq=0;$r5WatchdogStarted=$false;$r5FinalStatus='FAILED_BEFORE_OBSERVATION';$r5Failure=$null
function Save-R5Observe([string]$Name,$Data){
 $r5Path=Join-Path $r5Here $Name
 if(Test-Path -LiteralPath $r5Path){throw ('Preserve existing observation: '+$Name)}
 [IO.File]::WriteAllText($r5Path,($Data|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function Read-R5Bounded([string]$Label,[scriptblock]$Read){
 $script:r5Seq++;$r5Step=$script:r5Seq.ToString('00')
 Save-R5Observe ('read-'+$r5Step+'-start.json') @{at=[DateTimeOffset]::Now.ToString('o');label=$Label;cimTimeoutSeconds=8;readOnly=$true}
 $r5Value=& $Read
 Save-R5Observe ('read-'+$r5Step+'-done.json') @{at=[DateTimeOffset]::Now.ToString('o');label=$Label;status='RETURNED'}
 return $r5Value
}
function Save-R5Thumb([byte[]]$Bytes,[int]$Width,[int]$Height,[string]$Path){
 if($Bytes.Length -ne $Width*$Height*2){throw 'RGB565 length mismatch; never pad or truncate'}
 $r5Colors=[int[]]::new($Width*$Height)
 for($r5Pixel=0;$r5Pixel -lt $r5Colors.Length;$r5Pixel++){
  $r5Packed=[int]$Bytes[2*$r5Pixel] -bor ([int]$Bytes[2*$r5Pixel+1] -shl 8)
  $r5Red=[int][Math]::Floor((($r5Packed -shr 11) -band 31)*255/31)
  $r5Green=[int][Math]::Floor((($r5Packed -shr 5) -band 63)*255/63)
  $r5Blue=[int][Math]::Floor(($r5Packed -band 31)*255/31)
  $r5Colors[$r5Pixel]=(-16777216) -bor ($r5Red -shl 16) -bor ($r5Green -shl 8) -bor $r5Blue
 }
 $r5Bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
 try{
  $r5Bits=$r5Bitmap.LockBits([Drawing.Rectangle]::new(0,0,$Width,$Height),[Drawing.Imaging.ImageLockMode]::WriteOnly,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try{if($r5Bits.Stride -ne $Width*4){throw 'Unexpected bitmap stride'};[Runtime.InteropServices.Marshal]::Copy($r5Colors,0,$r5Bits.Scan0,$r5Colors.Length)}finally{$r5Bitmap.UnlockBits($r5Bits)}
  $r5Bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
 }finally{$r5Bitmap.Dispose()}
}
function Read-R5Queue{
 $r5Rows=@()
 foreach($r5Id in @('000006','000007')){foreach($r5Suffix in @('request','result')){
  $r5Name=$r5Id+'.'+$r5Suffix+'.json';$r5Path=Join-Path $r5Queue $r5Name;$r5Exists=Test-Path -LiteralPath $r5Path
  $r5Rows+=@{name=$r5Name;exists=$r5Exists;sha256=$(if($r5Exists){(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null});data=$(if($r5Exists){Get-Content -LiteralPath $r5Path -Raw|ConvertFrom-Json}else{$null})}
 }}
 return @{at=[DateTimeOffset]::Now.ToString('o');requests=$r5Rows;oldTerminalExists=(Test-Path -LiteralPath (Join-Path $r5OldHere 'vm-control-terminal.json'));oldFailureExists=(Test-Path -LiteralPath (Join-Path $r5OldHere 'vm-control-failure.json'))}
}
try{
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Observer self hash mismatch'}
 $r5Admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 if(-not $r5Admin){throw 'Actual administrator token missing'}
 if(Test-Path -LiteralPath $r5Terminal){throw 'Prior observer terminal exists'}
 Save-R5Observe 'console-observer-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualTokenElevated=$true;scriptSha256=$ExpectedSha256;vmId=$r5VmId;readOnly=$true;maximumSeconds=100;individualCimTimeoutSeconds=8;hostGuestMutations=$false}
 # A CLR watchdog ends ONLY this read-only observer, even if a native read ignores its CIM timeout.
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
public static class R5ObservationDeadline {
 private static Timer timer;
 public static void Start(string terminal) {
  timer = new Timer(_ => {
   try { using(var s = new FileStream(terminal,FileMode.CreateNew,FileAccess.Write,FileShare.Read)) using(var w = new StreamWriter(s))
    w.Write("{\"status\":\"READ_ONLY_OBSERVER_DEADLINE\",\"at\":\""+DateTimeOffset.Now.ToString("o")+"\",\"exitCode\":124,\"hostGuestMutations\":false}"); }
   finally { Environment.Exit(124); }
  },null,100000,Timeout.Infinite);
 }
 public static void Stop() { if(timer != null) timer.Dispose(); }
}
'@
 [R5ObservationDeadline]::Start($r5Terminal);$r5WatchdogStarted=$true
 $r5OldProcess=Read-R5Bounded 'Exact old helper process identity' {Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=9056' -OperationTimeoutSec 8}
 $r5ProcessProof=@{at=[DateTimeOffset]::Now.ToString('o');pid=9056;exists=($null -ne $r5OldProcess);commandLineVerified=$false}
 if($null -ne $r5OldProcess){
  $r5Start=$r5OldProcess.CreationDate.ToString('o');$r5ExpectedScript=Join-Path $r5OldHere 'vm-control.ps1'
  $r5Match=$r5Start.StartsWith('2026-09-20T08:26:22.464087') -and $r5OldProcess.Name -eq 'pwsh.exe' -and $r5OldProcess.CommandLine -like ('*'+$r5ExpectedScript+'*') -and $r5OldProcess.CommandLine -like '*4f22e068a0d5f20a68a8b2070e89646424dea17a5dc62f1ecf996814e5beec9e*'
  $r5ProcessProof.name=$r5OldProcess.Name;$r5ProcessProof.start=$r5Start;$r5ProcessProof.commandLineVerified=$r5Match
  if($r5Match){$r5ProcessProof.executable=$r5OldProcess.ExecutablePath;$r5ProcessProof.commandLine=$r5OldProcess.CommandLine}
  else{$r5ProcessProof.commandLine='NOT_DISCLOSED_UNVERIFIED_IDENTITY'}
 }
 Save-R5Observe 'old-helper-identity.json' $r5ProcessProof
 Save-R5Observe 'old-queue-before.json' (Read-R5Queue)
 $r5Cs=Read-R5Bounded 'Exact existing VM' {Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8}
 if($null -eq $r5Cs -or $r5Cs.Name -ne $r5VmId -or $r5Cs.ElementName -ne 'Zavod-Master-R5-Ubuntu24'){throw 'Existing VM identity not confirmed'}
 $r5Settings=@(Read-R5Bounded 'Existing VM current settings' {Get-CimAssociatedInstance -InputObject $r5Cs -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData -OperationTimeoutSec 8})
 if($r5Settings.Count -ne 1 -or $r5Settings[0].VirtualSystemIdentifier -ne $r5VmId -or $r5Settings[0].BIOSGUID -ne 'D00FD8A4-6628-433C-BD34-00A7CB7DD174'){throw 'Existing VM settings identity not confirmed'}
 $r5Storage=@(Read-R5Bounded 'Own VM attached storage metadata' {Get-CimAssociatedInstance -InputObject $r5Settings[0] -ResultClassName Msvm_StorageAllocationSettingData -OperationTimeoutSec 8})
 Save-R5Observe 'vm-state-before.json' @{at=[DateTimeOffset]::Now.ToString('o');vm=($r5Cs|Select-Object Name,ElementName,EnabledState,OtherEnabledState,RequestedState,OperationalStatus,StatusDescriptions,HealthState,OnTimeInMilliseconds,ProcessID);settings=($r5Settings[0]|Select-Object VirtualSystemIdentifier,VirtualSystemSubType,BIOSGUID,ConfigurationDataRoot,ConfigurationFile);storage=@($r5Storage|Select-Object ResourceSubType,HostResource,AddressOnParent);readOnly=$true}
 $r5Jobs=@(Read-R5Bounded 'Jobs associated only with own VM' {Get-CimAssociatedInstance -InputObject $r5Cs -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8})
 Save-R5Observe 'vm-jobs-before.json' @{at=[DateTimeOffset]::Now.ToString('o');association='Msvm_AffectedJobElement';vmId=$r5VmId;jobs=@($r5Jobs|Select-Object InstanceID,Name,ElementName,JobType,JobState,PercentComplete,ErrorCode,ErrorDescription,StatusDescriptions,StartTime,TimeSubmitted,ElapsedTime);noneDoesNotProveQueuedCommandCancelled=$true}
 if($r5ProcessProof.commandLineVerified){$r5Threads=@(Read-R5Bounded 'Only verified old helper threads' {Get-CimInstance -ClassName Win32_Thread -Filter 'ProcessHandle="9056"' -OperationTimeoutSec 8});Save-R5Observe 'old-helper-threads.json' @{at=[DateTimeOffset]::Now.ToString('o');threads=@($r5Threads|Select-Object Handle,ThreadState,ThreadWaitReason);notManagedStackOrExecutionLineProof=$true}}
 $r5Heads=@(Read-R5Bounded 'Own VM video heads' {Get-CimAssociatedInstance -InputObject $r5Cs -ResultClassName Msvm_VideoHead -OperationTimeoutSec 8})
 Save-R5Observe 'vm-video-heads.json' @{at=[DateTimeOffset]::Now.ToString('o');heads=@($r5Heads|Select-Object DeviceID,CurrentBitsPerPixel,CurrentHorizontalResolution,CurrentVerticalResolution,EnabledState)}
 $r5Service=Read-R5Bounded 'Hyper-V read-only thumbnail service' {Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_VirtualSystemManagementService -OperationTimeoutSec 8}
 $r5Captures=@();$r5Probes=@();$r5ProbeId=0
 foreach($r5Size in @(@{w=640;h=480},@{w=320;h=240})){
  $r5ProbeId++;$r5Probe=@{at=[DateTimeOffset]::Now.ToString('o');requested=$r5Size;vmEnabledState=$r5Cs.EnabledState;formatContract='uint8[] raw RGB565';acquisitionError=$null;decodingError=$null}
  try{
   $r5Result=Read-R5Bounded ('Thumbnail '+$r5Size.w+'x'+$r5Size.h) {Invoke-CimMethod -InputObject $r5Service -MethodName GetVirtualSystemThumbnailImage -Arguments @{TargetSystem=$r5Settings[0];WidthPixels=[uint16]$r5Size.w;HeightPixels=[uint16]$r5Size.h} -OperationTimeoutSec 8}
   $r5Data=$r5Result.ImageData
   $r5Probe.returnValue=$r5Result.ReturnValue;$r5Probe.imageDataPresent=($null -ne $r5Data)
   $r5Probe.actualType=$(if($null -ne $r5Data){$r5Data.GetType().FullName}else{$null})
   $r5Probe.actualArrayLength=$(if($r5Data -is [Array]){$r5Data.Length}else{$null});$r5Probe.expectedBytes=$r5Size.w*$r5Size.h*2
   $r5Probe.properties=@($r5Result.PSObject.Properties|ForEach-Object {@{name=$_.Name;type=$(if($null -eq $_.Value){'null'}else{$_.Value.GetType().FullName})}})
   if($r5Result.ReturnValue -eq 4096){
    $r5Probe.status='ASYNC_NOT_IMAGE_COMPLETION'
    $r5Async=@(Read-R5Bounded 'Observe associated jobs after asynchronous thumbnail' {Get-CimAssociatedInstance -InputObject $r5Cs -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8})
    $r5Probe.jobs=@($r5Async|Select-Object InstanceID,JobType,JobState,PercentComplete,ErrorCode,ErrorDescription)
   }elseif($r5Result.ReturnValue -eq 0 -and $r5Data -is [byte[]] -and $r5Data.Length -eq $r5Probe.expectedBytes){
    try{
     Add-Type -AssemblyName System.Drawing
     $r5Png=Join-Path $r5Here ('vm-observed-'+$r5ProbeId+'-'+$r5Size.w+'x'+$r5Size.h+'.png')
     if(Test-Path -LiteralPath $r5Png){throw 'Preserve existing capture'}
     Save-R5Thumb $r5Data $r5Size.w $r5Size.h $r5Png
     $r5Captures+=@{path=$r5Png;width=$r5Size.w;height=$r5Size.h;sha256=(Get-FileHash -LiteralPath $r5Png -Algorithm SHA256).Hash.ToLowerInvariant();viewed=$false}
     $r5Probe.status='VALID_RGB565_DECODED_NOT_YET_VIEWED'
    }catch{$r5Probe.decodingError=$_.Exception.Message;$r5Probe.status='DECODING_FAILED'}
   }else{$r5Probe.status='NO_VALID_IMAGE_CONTRACT_NOT_SATISFIED'}
  }catch{$r5Probe.acquisitionError=$_.Exception.Message;$r5Probe.status='ACQUISITION_FAILED'}
  $r5Probes+= $r5Probe;Save-R5Observe ('thumbnail-probe-'+$r5ProbeId+'.json') $r5Probe
  if($r5Captures.Count -or $r5Probe.returnValue -eq 4096){break}
 }
 Save-R5Observe 'console-observation.json' @{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5VmId;captures=$r5Captures;probes=$r5Probes;status=$(if($r5Captures.Count){'CAPTURED_NOT_YET_VIEWED'}else{'NO_VALID_CAPTURE_PREFER_VMCONNECT'});readOnly=$true}
 Start-Sleep -Seconds 3
 $r5After=Read-R5Bounded 'Final exact VM state' {Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8}
 $r5JobsAfter=@(Read-R5Bounded 'Final associated own VM jobs' {Get-CimAssociatedInstance -InputObject $r5After -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8})
 Save-R5Observe 'vm-state-after.json' @{at=[DateTimeOffset]::Now.ToString('o');vm=($r5After|Select-Object Name,ElementName,EnabledState,RequestedState,OperationalStatus,StatusDescriptions,HealthState,ProcessID);jobs=@($r5JobsAfter|Select-Object InstanceID,Name,JobType,JobState,PercentComplete,ErrorCode,ErrorDescription,StartTime,ElapsedTime)}
 Save-R5Observe 'old-queue-after.json' (Read-R5Queue)
 $r5FinalStatus='READ_ONLY_OBSERVER_COMPLETED_VM_UNCHANGED'
}catch{$r5Failure=$_.Exception.Message;$r5FinalStatus='READ_ONLY_OBSERVER_FAILED';Write-Error -ErrorAction Continue $_}
finally{
 if($r5WatchdogStarted){[R5ObservationDeadline]::Stop()}
 if(-not(Test-Path -LiteralPath $r5Terminal)){Save-R5Observe 'console-observer-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;status=$r5FinalStatus;message=$r5Failure;vmId=$r5VmId;hostGuestMutations=$false}}
}
if($r5Failure){exit 1}
