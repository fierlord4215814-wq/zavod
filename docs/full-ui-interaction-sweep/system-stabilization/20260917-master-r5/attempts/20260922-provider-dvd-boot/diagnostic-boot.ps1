# Reviewed continuation of the retained candidate; one authorized visible UAC, immutable per-attempt receipts.
# Scoped native Hyper-V management, no UI automation, guest input, SSH, policy changes or reinstall.
param([Parameter(Mandatory=$true)][string]$ExpectedSha256,[Parameter(Mandatory=$true)][int]$LauncherPid)
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5VmId=[guid]'99a158da-c247-422c-ae11-109485a92b1f'
$r5VmName='Zavod-Master-R5-Ubuntu24'
$r5Vhd=Join-Path $r5Runtime 'vm\ubuntu24.vhdx'
$r5Iso=Join-Path $r5Runtime 'ubuntu-24.04.5-live-server-amd64.iso'
$r5Seed=Join-Path $r5Runtime 'private\seed.iso'
$r5SwitchId=[guid]'afaaea6b-1d7e-4ec7-beb2-5c7bf8750beb'
$r5SwitchName='Zavod-R5-Internal-20260920'
$r5Stage='preflight';$r5Failure=$null;$r5BootIssued=$false;$r5Mutations=@();$r5ActualElevated=$false
function Save-R5([string]$Name,$Value){
 $r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 20))
 $r5Stream=[IO.File]::Open((Join-Path $r5Here $Name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$r5Stream.Write($r5Bytes,0,$r5Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}
}
function Get-R5Vm{
 $r5Value=Get-VM -Id $r5VmId
 if($r5Value.Name -ne $r5VmName -or $r5Value.Generation -ne 2 -or -not $r5Value.Path.StartsWith((Join-Path $r5Runtime 'vm\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Exact VM identity/path mismatch'}
 $r5Disks=@(Get-VMHardDiskDrive -VM $r5Value)
 if($r5Disks.Count -ne 1 -or $r5Disks[0].Path -ne $r5Vhd){throw 'Sole target VHDX mismatch'}
 return $r5Value
}
function Get-R5ReferenceId([string]$Value) {
 $r5Match=[regex]::Match($Value,'(?i)InstanceID="((?:\\.|[^"])*)"')
 if(-not $r5Match.Success){return $null}
 return $r5Match.Groups[1].Value.Replace('\\','\').Replace('\"','"')
}
function Get-R5ProviderStorage([string]$Label) {
 $r5Record=[ordered]@{at=[DateTimeOffset]::Now.ToString('o');label=$Label;source='NEW_CIM_ROOT_VIRTUALIZATION_V2';queryPhase='computer';querySucceeded=$false;violations=@();mountedIsoPaths=@();dvd=@();state=$null}
 $r5Problems=[Collections.Generic.List[string]]::new()
 try {
  $r5Pv=@(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8)
  $r5Record.computers=@($r5Pv|Select-Object Name,ElementName,EnabledState,HealthState,OperationalStatus)
  if($r5Pv.Count -ne 1 -or $r5Pv[0].ElementName -ne $r5VmName){throw 'Exact provider VM missing/ambiguous/wrong name'}
  $r5Record.state=$r5Pv[0].EnabledState
  $r5Record.queryPhase='current-settings-association'
  $r5Ps=@(Get-CimAssociatedInstance -InputObject $r5Pv[0] -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData -OperationTimeoutSec 8)
  $r5Record.settings=@($r5Ps|Select-Object InstanceID,VirtualSystemIdentifier,VirtualSystemType,VirtualSystemSubType,ConfigurationID,ConfigurationDataRoot,ConfigurationFile,BIOSGUID,Parent,SecureBootEnabled,SecureBootTemplateId,BootSourceOrder,ConsoleMode,NetworkBootPreferredProtocol,PauseAfterBootFailure)
  if($r5Ps.Count -ne 1){throw 'Current settings association is empty or ambiguous'}
  if($r5Ps[0].VirtualSystemIdentifier -ne [string]$r5VmId -or $r5Ps[0].VirtualSystemType -ne 'Microsoft:Hyper-V:System:Realized' -or $r5Ps[0].VirtualSystemSubType -ne 'Microsoft:Hyper-V:SubType:2' -or $r5Ps[0].BIOSGUID -ne 'D00FD8A4-6628-433C-BD34-00A7CB7DD174'){throw 'Not the exact current realized Gen2 configuration'}
  $r5Record.queryPhase='all-current-setting-components'
  $r5All=@(Get-CimAssociatedInstance -InputObject $r5Ps[0] -Association Msvm_VirtualSystemSettingDataComponent -OperationTimeoutSec 8)
  $r5Record.components=@($r5All|ForEach-Object {[pscustomobject]@{class=$_.CimClass.CimClassName;InstanceID=$_.InstanceID;ResourceType=$_.ResourceType;ResourceSubType=$_.ResourceSubType;HostResource=@($_.HostResource);Parent=$_.Parent;Address=$_.Address;AddressOnParent=$_.AddressOnParent}})
  $r5Record.queryPhase='current-storage-components'
  $r5Storage=@(Get-CimAssociatedInstance -InputObject $r5Ps[0] -Association Msvm_VirtualSystemSettingDataComponent -ResultClassName Msvm_StorageAllocationSettingData -OperationTimeoutSec 8)
  $r5Record.storage=@($r5Storage|Select-Object InstanceID,ResourceType,ResourceSubType,HostResource,Parent,Address,AddressOnParent)
  $r5Record.queryPhase='associated-jobs'
  $r5JobsNow=@(Get-CimAssociatedInstance -InputObject $r5Pv[0] -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8)
  $r5Record.jobs=@($r5JobsNow|Select-Object InstanceID,Name,JobState,ErrorCode,ErrorDescription,PercentComplete,StartTime)
  $r5Record.querySucceeded=$true
  $r5Record.queryPhase='validating-complete-topology'
  $r5Controllers=@($r5All|Where-Object ResourceType -eq 6)
  $r5Hdds=@($r5All|Where-Object ResourceType -eq 17)
  $r5Dvds=@($r5All|Where-Object {$_.ResourceType -in @(15,16)})
  $r5StorAll=@($r5All|Where-Object {$_.CimClass.CimClassName -eq 'Msvm_StorageAllocationSettingData'})
  if($r5All.Count -eq 0 -or @($r5All|Where-Object ResourceType -eq 3).Count -ne 1 -or @($r5All|Where-Object ResourceType -eq 4).Count -ne 1){$r5Problems.Add('Incomplete current configuration (CPU/memory/resource walk)')}
  if($r5Controllers.Count -ne 1 -or $r5Controllers[0].ResourceSubType -ne 'Microsoft:Hyper-V:Synthetic SCSI Controller'){$r5Problems.Add('Expected sole synthetic SCSI controller missing/ambiguous')}
  if($r5Hdds.Count -ne 1 -or $r5Hdds[0].ResourceSubType -ne 'Microsoft:Hyper-V:Synthetic Disk Drive'){$r5Problems.Add('Expected sole synthetic hard disk drive missing/ambiguous')}
  if($r5Dvds.Count -ne 2 -or @($r5Dvds|Where-Object ResourceSubType -ne 'Microsoft:Hyper-V:Synthetic DVD Drive').Count){$r5Problems.Add('Expected two synthetic DVD devices missing/ambiguous')}
  if(@($r5All|Where-Object {$_.ResourceType -in @(5,7,8,14,18,19,20,32)}).Count){$r5Problems.Add('Unexpected storage/controller resource type')}
  if(@($r5Storage|Where-Object {$_.ResourceType -ne 31 -or $_.ResourceSubType -notin @('Microsoft:Hyper-V:Virtual Hard Disk','Microsoft:Hyper-V:Virtual CD/DVD Disk')}).Count){$r5Problems.Add('Unexpected storage allocation subtype')}
  if(($r5StorAll.InstanceID|Sort-Object|ConvertTo-Json -Compress) -ne ($r5Storage.InstanceID|Sort-Object|ConvertTo-Json -Compress)){$r5Problems.Add('All-components and storage-specific queries disagree')}
  $r5DiskImages=@($r5Storage|Where-Object ResourceSubType -eq 'Microsoft:Hyper-V:Virtual Hard Disk')
  if($r5DiskImages.Count -ne 1 -or @($r5DiskImages[0].HostResource).Count -ne 1 -or $r5DiskImages[0].HostResource[0] -ne $r5Vhd){$r5Problems.Add('Sole existing VHDX allocation mismatch')}
  if($r5Controllers.Count -eq 1 -and $r5Hdds.Count -eq 1){
   if((Get-R5ReferenceId $r5Hdds[0].Parent) -ne $r5Controllers[0].InstanceID -or $r5Hdds[0].AddressOnParent -ne '0'){$r5Problems.Add('Hard drive parent/address mismatch')}
   if($r5DiskImages.Count -eq 1 -and (Get-R5ReferenceId $r5DiskImages[0].Parent) -ne $r5Hdds[0].InstanceID){$r5Problems.Add('VHDX allocation not parented to the sole hard drive')}
  }
  $r5DvdRows=@(foreach($r5D in $r5Dvds){
   $r5Media=@($r5Storage|Where-Object {(Get-R5ReferenceId $_.Parent) -eq $r5D.InstanceID})
   $r5Paths=@($r5Media|ForEach-Object {$_.HostResource}|Where-Object {$_})
   if($r5Controllers.Count -ne 1 -or (Get-R5ReferenceId $r5D.Parent) -ne $r5Controllers[0].InstanceID -or $r5D.AddressOnParent -notin @('1','2')){$r5Problems.Add('DVD parent/address mismatch')}
   if($r5Media.Count -gt 1 -or @($r5Media|Where-Object ResourceSubType -ne 'Microsoft:Hyper-V:Virtual CD/DVD Disk').Count -or $r5Paths.Count -gt 1){$r5Problems.Add('Ambiguous DVD media allocation')}
   if(@($r5Paths|Where-Object {$_ -notin @($r5Iso,$r5Seed)}).Count){$r5Problems.Add('Foreign DVD media')}
   [pscustomobject]@{InstanceID=$r5D.InstanceID;Parent=$r5D.Parent;AddressOnParent=$r5D.AddressOnParent;mediaAllocations=@($r5Media.InstanceID);paths=$r5Paths}
  })
  if((($r5DvdRows.AddressOnParent|Sort-Object) -join ',') -ne '1,2'){$r5Problems.Add('DVD addresses not exactly 1 and 2')}
  $r5CdImages=@($r5Storage|Where-Object ResourceSubType -eq 'Microsoft:Hyper-V:Virtual CD/DVD Disk')
  foreach($r5Cd in $r5CdImages){if((Get-R5ReferenceId $r5Cd.Parent) -notin @($r5Dvds.InstanceID)){$r5Problems.Add('Orphan CD/DVD allocation')}}
  $r5Record.dvd=$r5DvdRows
  $r5Record.mountedIsoPaths=@($r5CdImages|ForEach-Object {$_.HostResource}|Where-Object {$_})
  $r5Record.bios=$r5Ps[0].BIOSGUID
  $r5Record.currentSettingInstanceId=$r5Ps[0].InstanceID
  $r5Record.soleVhdx=@($r5DiskImages|ForEach-Object {$_.HostResource})
  $r5Record.queryPhase='complete'
 } catch {
  $r5Record.queryError=$_.Exception.Message
  $r5Record.errorId=$_.FullyQualifiedErrorId
  $r5Problems.Add('QUERY_OR_TOPOLOGY_FAILURE: '+$_.Exception.Message)
 } finally {
  $r5Record.violations=@($r5Problems.ToArray())
  $r5Record.valid=($r5Record.querySucceeded -and $r5Problems.Count -eq 0)
  $r5Record.finishedAt=[DateTimeOffset]::Now.ToString('o')
  Save-R5 ('provider-'+$Label+'.json') $r5Record
 }
 return $r5Record
}
function Assert-R5Provider($Value) {
 if(-not $Value.valid){throw ('Provider completeness guard: '+($Value.violations -join '; '))}
}
function Get-R5Controllers([string]$Label) {
 $r5AncestorIds=@($PID);$r5Next=$LauncherPid
 for($r5Depth=0;$r5Depth -lt 8 -and $r5Next -gt 0;$r5Depth++){
  $r5A=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r5Next) -OperationTimeoutSec 8
  if(-not $r5A){break};$r5AncestorIds+=$r5A.ProcessId;$r5Next=$r5A.ParentProcessId
 }
 $r5Other=@(Get-CimInstance Win32_Process -Filter "(Name='pwsh.exe' OR Name='powershell.exe' OR Name='vmconnect.exe') AND (CommandLine LIKE '%20260917-master-r5%' OR CommandLine LIKE '%master-r5-ubuntu24%' OR CommandLine LIKE '%99a158da-c247-422c-ae11-109485a92b1f%')" -OperationTimeoutSec 8|Where-Object {$_.ProcessId -notin $r5AncestorIds})
 Save-R5 ('controllers-'+$Label+'.json') @{at=[DateTimeOffset]::Now.ToString('o');otherMatchingControllers=@($r5Other|Select-Object ProcessId,CreationDate,Name);excludedAncestors=$r5AncestorIds;processChanges=$false}
 if($r5Other.Count){throw 'Another scoped controller is present; no mutation'}
}
function Get-R5FreshTyped([string]$Label) {
 $r5FreshVm=Get-R5Vm
 $r5NewFirmware=Get-VMFirmware -VMName $r5VmName
 $r5NewDvd=@(Get-VMDvdDrive -VMName $r5VmName)
 $r5NewDisk=@(Get-VMHardDiskDrive -VMName $r5VmName)
 $r5Record=@{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5FreshVm.Id;state=$r5FreshVm.State.ToString();firmware=(Get-R5Firmware $r5NewFirmware);dvd=@($r5NewDvd|Select-Object Path,Id,ControllerNumber,ControllerLocation);disks=@($r5NewDisk|Select-Object Path,Id,DiskNumber,ControllerNumber,ControllerLocation);source='NEW_GET_VM_BY_GUID_AND_CMDLETS_BY_REVALIDATED_NAME'}
 Save-R5 ('typed-'+$Label+'.json') $r5Record
 return $r5Record
}
function Assert-R5Agreement($Provider,$Typed) {
 Assert-R5Provider $Provider
 if(($Provider.state -eq 3 -and $Typed.state -ne 'Off') -or ($Provider.state -eq 2 -and $Typed.state -ne 'Running')){throw 'Fresh VM state sources disagree'}
 if($Typed.disks.Count -ne 1 -or $Typed.disks[0].Path -ne $r5Vhd -or $null -ne $Typed.disks[0].DiskNumber){throw 'Typed sole VHDX mismatch'}
 if($Typed.dvd.Count -ne 2){throw 'Typed DVD device completeness mismatch'}
 foreach($r5D in $Provider.dvd){
  $r5T=@($Typed.dvd|Where-Object {$_.Id -eq $r5D.InstanceID -and $_.ControllerNumber -eq 0 -and [string]$_.ControllerLocation -eq $r5D.AddressOnParent})
  if($r5T.Count -ne 1){throw 'Provider/typed DVD identity/address mismatch'}
  $r5TypedPaths=@($r5T[0].Path|Where-Object {$_})
  if(($r5TypedPaths -join '|') -ne ($r5D.paths -join '|')){throw 'Fresh provider/typed DVD media disagree'}
 }
 if($Provider.settings[0].SecureBootEnabled -ne $true -or $Typed.firmware.secureBoot -ne 'On' -or $Typed.firmware.secureBootTemplate -ne 'MicrosoftUEFICertificateAuthority' -or $Typed.firmware.secureBootTemplateId -ne '272e7447-90a4-4563-a4b9-8e4ab00526ce' -or $Provider.settings[0].SecureBootTemplateId -ne $Typed.firmware.secureBootTemplateId){throw 'Secure Boot invariants disagree'}
}
function Get-R5Firmware($Value){
 @{secureBoot=$Value.SecureBoot.ToString();secureBootTemplate=$Value.SecureBootTemplate;secureBootTemplateId=$Value.SecureBootTemplateId;preferredNetworkBootProtocol=$Value.PreferredNetworkBootProtocol.ToString();consoleMode=$Value.ConsoleMode.ToString();pauseAfterBootFailure=$Value.PauseAfterBootFailure.ToString();bootOrder=@($Value.BootOrder|ForEach-Object {@{bootType=$_.BootType.ToString();description=$_.Description;firmwarePath=$_.FirmwarePath;devicePath=$_.Device.Path;deviceId=$_.Device.Id;deviceType=$(if($_.Device){$_.Device.GetType().FullName}else{$null})}})}
}
try{
 Write-Host 'MASTER R5: diagnostic helper for the existing owned VM only.'
 Save-R5 'helper-invoked.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;launcherPid=$LauncherPid;visibleWindowRequested=$true;vmMutationStarted=$false}
 $r5ActualElevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 Save-R5 'administrator-token.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualElevated=$r5ActualElevated}
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Helper hash mismatch'}
 if(-not $r5ActualElevated){throw 'Actual elevated token absent'}
 if(Test-Path -LiteralPath (Join-Path $r5Here 'helper-start.json')){throw 'Helper previously started; never repeat boot attempt'}
 Save-R5 'helper-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;launcherPid=$LauncherPid;actualElevated=$true;sha256=$ExpectedSha256;scope='ONE_EXISTING_VHDX_DIAGNOSTIC_BOOT';vmId=$r5VmId}
 Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading;
public static class R5BootDeadline {
 private static Timer timer;
 public static void Start(string p){timer=new Timer(_=>{try{using(var f=new FileStream(p,FileMode.CreateNew,FileAccess.Write,FileShare.Read))using(var w=new StreamWriter(f)){w.Write("{\"status\":\"HELPER_DEADLINE_NO_RETRY\",\"operationOutcome\":\"READ_LAST_RECEIPTS_AND_CURRENT_VM\"}");}}finally{Environment.Exit(124);}},null,360000,Timeout.Infinite);}
 public static void Stop(){if(timer!=null)timer.Dispose();}
}
'@
 [R5BootDeadline]::Start((Join-Path $r5Here 'helper-deadline.json'))
 foreach($r5Path in @($r5Runtime,(Join-Path $r5Runtime 'vm'),$r5Vhd)){
  if(((Get-Item -LiteralPath $r5Path).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Owned path is reparse point'}
 }
 $r5Ancestors=@($PID);$r5AncestorId=$LauncherPid
 for($r5Depth=0;$r5Depth -lt 8 -and $r5AncestorId -gt 0;$r5Depth++){$r5Ancestor=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r5AncestorId) -OperationTimeoutSec 8;if(-not $r5Ancestor){break};$r5Ancestors+=$r5Ancestor.ProcessId;$r5AncestorId=$r5Ancestor.ParentProcessId}
 $r5Other=@(Get-CimInstance Win32_Process -Filter "(Name='pwsh.exe' OR Name='powershell.exe') AND (CommandLine LIKE '%20260917-master-r5%' OR CommandLine LIKE '%master-r5-ubuntu24%')" -OperationTimeoutSec 8|Where-Object {$_.ProcessId -notin $r5Ancestors})
 Save-R5 'controller-preflight.json' @{at=[DateTimeOffset]::Now.ToString('o');otherMatchingControllers=@($r5Other|Select-Object ProcessId,CreationDate,Name);excludedCurrentLauncherAncestors=$r5Ancestors;oldQueueReplayed=$false;pid9056Targeted=$false}
 if($r5Other.Count){throw 'Another R5-scoped controller present; preserve and inspect'}
 Write-Host 'Administrator token confirmed; checking exact VM identity, attachments and resources.'
 $r5Vm=Get-R5Vm
 $r5Cim=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8
 $r5ProviderInitial=Get-R5ProviderStorage 'initial'
 Assert-R5Provider $r5ProviderInitial
 $r5Settings=@(Get-CimAssociatedInstance -InputObject $r5Cim -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData -OperationTimeoutSec 8)
 if($r5Settings.Count -ne 1 -or $r5Settings[0].BIOSGUID -ne 'D00FD8A4-6628-433C-BD34-00A7CB7DD174'){throw 'BIOS identity mismatch'}
 $r5Jobs=@(Get-CimAssociatedInstance -InputObject $r5Cim -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8)
 if($r5Jobs.Count){throw 'VM job present before diagnostic boot'}
 $r5Disk=@(Get-VMHardDiskDrive -VM $r5Vm)
 $r5Geometry=Get-VHD -Path $r5Vhd
 if($r5Geometry.ParentPath -or $r5Geometry.Size -ne 17179869184 -or $r5Geometry.VhdFormat.ToString() -ne 'VHDX'){throw 'Unexpected VHDX backing/geometry'}
 $r5Dvd=@(Get-VMDvdDrive -VM $r5Vm)
 if($r5Dvd.Count -ne 2 -or @($r5Dvd|Where-Object {$_.Path -and $_.Path -notin @($r5Iso,$r5Seed)}).Count){throw 'Unexpected DVD attachment'}
 $r5Nic=@(Get-VMNetworkAdapter -VM $r5Vm)
 if($r5Nic.Count -ne 1 -or $r5Nic[0].MacAddress -ne '025A56051901' -or $r5Nic[0].SwitchId -ne $r5SwitchId){throw 'Own preparation NIC mismatch'}
 $r5Switch=Get-VMSwitch -Id $r5SwitchId
 if($r5Switch.Name -ne $r5SwitchName -or $r5Switch.SwitchType.ToString() -ne 'Internal'){throw 'Own switch is not expected Internal switch'}
 $r5Endpoints=@(Get-VMNetworkAdapter -All|Where-Object {$_.SwitchId -eq $r5SwitchId})
 $r5Foreign=@($r5Endpoints|Where-Object {-not $_.IsManagementOs -and $_.VMId -ne $r5VmId})
 if($r5Foreign.Count){throw 'Foreign endpoint on own preparation switch'}
 $r5HostNic=Get-NetAdapter -Name ('vEthernet ('+$r5SwitchName+')')
 $r5Addresses=@(Get-NetIPAddress -InterfaceIndex $r5HostNic.ifIndex -AddressFamily IPv4)
 if($r5Addresses.Count -ne 1 -or $r5Addresses[0].IPAddress -ne '10.243.53.1' -or $r5Addresses[0].PrefixLength -ne 30 -or $r5Addresses[0].AddressState.ToString() -ne 'Preferred'){throw 'Own host /30 address mismatch'}
 $r5LocalConflict=@(Get-NetIPAddress -IPAddress '10.243.53.2' -ErrorAction SilentlyContinue)
 $r5Neighbors=@(Get-NetNeighbor -InterfaceIndex $r5HostNic.ifIndex -IPAddress '10.243.53.2' -ErrorAction SilentlyContinue)
 $r5WrongNeighbor=@($r5Neighbors|Where-Object {$_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00[-:]?){6}$' -and ($_.LinkLayerAddress -replace '[:-]','') -ne '025A56051901'})
 Save-R5 'network-before.json' @{at=[DateTimeOffset]::Now.ToString('o');switch=($r5Switch|Select-Object Name,Id,SwitchType,AllowManagementOS);vmNic=@($r5Nic|Select-Object Name,Id,VMId,SwitchName,SwitchId,MacAddress,IPAddresses,Status);hostNic=($r5HostNic|Select-Object Name,ifIndex,InterfaceGuid,MacAddress,Status);addresses=@($r5Addresses|Select-Object IPAddress,PrefixLength,AddressState);routes=@(Get-NetRoute -InterfaceIndex $r5HostNic.ifIndex -AddressFamily IPv4|Select-Object DestinationPrefix,NextHop,RouteMetric,InterfaceIndex);neighbors=@($r5Neighbors|Select-Object IPAddress,LinkLayerAddress,State,InterfaceIndex);localGuestAddressCollisionCount=$r5LocalConflict.Count;foreignEndpointCount=$r5Foreign.Count;wrongNeighborCount=$r5WrongNeighbor.Count;lanScan=$false;networkMutation=$false}
 if($r5LocalConflict.Count -or $r5WrongNeighbor.Count){throw 'Guest address conflict indication; no boot or connection'}
 $r5Os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 8
 $r5Host=Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 8
 $r5Space=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -OperationTimeoutSec 8
 if(-not $r5Host.HypervisorPresent -or -not $r5Os.DataExecutionPrevention_Available -or $r5Space.FreeSpace -lt 10GB){throw 'Hyper-V/DEP/disk readiness not satisfied'}
 if($r5Vm.State.ToString() -eq 'Off' -and ([double]$r5Os.FreePhysicalMemory*1024) -lt 6GB){throw 'RAM floor6GiB not satisfied before4GiB guest boot'}
 $r5Firmware=Get-VMFirmware -VM $r5Vm
 $r5FirmwareBefore=Get-R5Firmware $r5Firmware
 Save-R5 'vm-before.json' @{at=[DateTimeOffset]::Now.ToString('o');vm=($r5Vm|Select-Object Name,Id,State,Generation,Path,MemoryStartup,MemoryAssigned,ProcessorCount,AutomaticStartAction,AutomaticStopAction,CheckpointType,AutomaticCheckpointsEnabled);biosGuid=$r5Settings[0].BIOSGUID;firmware=$r5FirmwareBefore;disks=@($r5Disk|Select-Object Path,DiskNumber,ControllerType,ControllerNumber,ControllerLocation,Id);vhd=($r5Geometry|Select-Object Path,VhdFormat,VhdType,Size,FileSize,ParentPath,Attached);dvd=@($r5Dvd|Select-Object Path,ControllerNumber,ControllerLocation,Id);network=@($r5Nic|Select-Object Name,Id,SwitchId,MacAddress);jobs=@();hostBoot=$r5Os.LastBootUpTime;hypervisor=$r5Host.HypervisorPresent;dep=$r5Os.DataExecutionPrevention_Available;freeRamBytes=([double]$r5Os.FreePhysicalMemory*1024);freeDiskBytes=$r5Space.FreeSpace;hostDisksOrWorkingResourcesAttached=$false}
 $r5Firmware|Export-Clixml -LiteralPath (Join-Path $r5Here 'firmware-before.clixml') -Depth 5
 $r5Stage='redacted-own-seed-ssh-settings'
 if((Get-FileHash -LiteralPath $r5Seed -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7'){throw 'Own seed identity mismatch'}
 $r5SeedText=& 'C:\Windows\System32\tar.exe' -xOf $r5Seed 'user-data'
 if($LASTEXITCODE -ne 0){throw 'Cannot read own seed; no content exported'}
 $r5SeedConfig=(($r5SeedText -join "`n") -replace '^#cloud-config\r?\n','')|ConvertFrom-Json
 $r5Key=Join-Path $r5Runtime 'private\guest-ops-ed25519'
 $r5Fingerprint=& 'C:\Windows\System32\OpenSSH\ssh-keygen.exe' -lf ($r5Key+'.pub')
 if($LASTEXITCODE -ne 0 -or $r5Fingerprint -notmatch 'SHA256:nu9PA6m\+dmxuaubuKjJs/xLeN1y87htKxgJaOCqcIRs'){throw 'Own test client key fingerprint mismatch'}
 if($r5SeedConfig.autoinstall.identity.username -ne 'r5ops' -or $r5SeedConfig.autoinstall.identity.hostname -ne 'zavod-r5-ubuntu24' -or $r5SeedConfig.autoinstall.ssh.'allow-pw' -ne $false){throw 'Unexpected prepared SSH identity'}
 $r5Link=$r5SeedConfig.autoinstall.network.ethernets.r5link
 if($r5Link.addresses.Count -ne 1 -or $r5Link.addresses[0] -ne '10.243.53.2/30' -or $r5Link.match.macaddress -ne '02:5a:56:05:19:01'){throw 'Seed SSH network does not match own endpoint'}
 $r5Known=@(Get-ChildItem -LiteralPath (Join-Path $r5Runtime 'private') -File|Where-Object {$_.Name -match 'known[_-]?hosts'})
 Save-R5 'ssh-settings-redacted.json' @{at=[DateTimeOffset]::Now.ToString('o');seedSha256='4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7';username=$r5SeedConfig.autoinstall.identity.username;hostname=$r5SeedConfig.autoinstall.identity.hostname;sshServerRequested=$r5SeedConfig.autoinstall.ssh.'install-server';passwordAuthAllowed=$r5SeedConfig.autoinstall.ssh.'allow-pw';clientPrivateKeyPath=$r5Key;clientPrivateKeyExists=(Test-Path -LiteralPath $r5Key);clientPublicKeyFingerprint=$r5Fingerprint;preparedNetwork=$r5Link;existingOwnKnownHostsPaths=@($r5Known|Select-Object -ExpandProperty FullName);clientKeyIsNotServerHostKey=$true;secretsExported=$false;guestApplicability='UNVERIFIED_UNTIL_AUTHENTICATED_READBACK'}
 $r5SeedText=$null;$r5SeedConfig=$null
 Write-Host 'Preflight saved. Off: eject only owned ISO media, use existing VHDX first, start once. Running: leave untouched.'
 $r5Stage='configuration'
 $r5ProviderBefore=Get-R5ProviderStorage 'before-action'
 $r5TypedBefore=Get-R5FreshTyped 'before-action'
 Assert-R5Agreement $r5ProviderBefore $r5TypedBefore
 if($r5ProviderBefore.state -eq 2){
  Save-R5 'boot-not-issued.json' @{at=[DateTimeOffset]::Now.ToString('o');reason='ALREADY_RUNNING_NO_MEDIA_OR_STATE_CHANGE';vmId=$r5VmId}
 }elseif($r5ProviderBefore.state -eq 3){
  foreach($r5Drive in $r5ProviderBefore.dvd){
   if($r5Drive.paths.Count -eq 1){
    $r5Loc=[int]$r5Drive.AddressOnParent
    $r5Check=Get-R5ProviderStorage ('before-eject-'+$r5Loc)
    Assert-R5Provider $r5Check
    Get-R5Controllers ('before-eject-'+$r5Loc)
    if($r5Check.state -ne 3 -or $r5Check.jobs.Count){throw 'Not idle Off before eject'}
    $r5CurrentDrive=@($r5Check.dvd|Where-Object InstanceID -eq $r5Drive.InstanceID)
    if($r5CurrentDrive.Count -ne 1 -or ($r5CurrentDrive[0].paths -join '|') -ne ($r5Drive.paths -join '|')){throw 'DVD changed before action'}
    Save-R5 ('dvd-eject-request-'+$r5Loc+'.json') @{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5VmId;controller=0;location=$r5Loc;originalOwnPath=$r5Drive.paths[0];command='Set-VMDvdDrive -VMName exactValidatedName -ControllerNumber 0 -ControllerLocation exact -Path null';postcondition='PENDING_NOT_ASSUMED'}
    $r5Mutations+=('OWN_DVD_EJECT_REQUEST_'+$r5Loc)
    Set-VMDvdDrive -VMName $r5VmName -ControllerNumber 0 -ControllerLocation $r5Loc -Path $null
   }
  }
  # All samples use new objects; the bounded delay also permits library-cache expiry.
  $r5Agreement=$false
  foreach($r5ReadIndex in 0..2){
   if($r5ReadIndex -gt 0){Start-Sleep -Seconds 6}
   $r5ProviderAfter=Get-R5ProviderStorage ('after-media-'+$r5ReadIndex)
   $r5TypedAfter=Get-R5FreshTyped ('after-media-'+$r5ReadIndex)
   try{
    Assert-R5Agreement $r5ProviderAfter $r5TypedAfter
    if($r5ProviderAfter.state -ne 3 -or $r5ProviderAfter.mountedIsoPaths.Count){throw 'Not Off/no-media yet'}
    $r5Agreement=$true
   }catch{Save-R5 ('readback-disagreement-'+$r5ReadIndex+'.json') @{at=[DateTimeOffset]::Now.ToString('o');error=$_.Exception.Message;changesStopped=$true}}
   if($r5Agreement){break}
  }
  if(-not $r5Agreement){throw 'Fresh no-media topology/agreement not established; no boot'}
  if($r5TypedAfter.firmware.bootOrder[0].devicePath -ne $r5Vhd){
   Get-R5Controllers 'before-firmware'
   $r5BeforeFirmware=Get-R5ProviderStorage 'before-firmware'
   Assert-R5Provider $r5BeforeFirmware
   if($r5BeforeFirmware.state -ne 3 -or $r5BeforeFirmware.mountedIsoPaths.Count -or $r5BeforeFirmware.jobs.Count){throw 'Not idle Off/no-media before firmware'}
   $r5ExactVm=Get-R5Vm
   $r5ExactDisk=@(Get-VMHardDiskDrive -VM $r5ExactVm)
   Save-R5 'firmware-request.json' @{at=[DateTimeOffset]::Now.ToString('o');onlyChange='Existing sole VHDX first';vmId=$r5VmId}
   $r5Mutations+='EXISTING_VHDX_FIRST_REQUEST'
   Set-VMFirmware -VM $r5ExactVm -FirstBootDevice $r5ExactDisk[0]
   Start-Sleep -Seconds 6
  }
  # No final decision uses the old $r5Vm, $r5Dvd or initial firmware object.
  Get-R5Controllers 'before-start'
  $r5FinalProvider=Get-R5ProviderStorage 'before-start'
  $r5FinalTyped=Get-R5FreshTyped 'before-start'
  Assert-R5Agreement $r5FinalProvider $r5FinalTyped
  foreach($r5Field in @('secureBoot','secureBootTemplate','secureBootTemplateId','preferredNetworkBootProtocol','consoleMode','pauseAfterBootFailure')){if($r5FirmwareBefore[$r5Field] -ne $r5FinalTyped.firmware[$r5Field]){throw ('Unrelated firmware changed: '+$r5Field)}}
  if($r5FinalProvider.state -ne 3 -or $r5FinalProvider.mountedIsoPaths.Count -or $r5FinalProvider.jobs.Count -or $r5FinalTyped.firmware.bootOrder[0].devicePath -ne $r5Vhd){throw 'Last pre-start guard failed'}
  Save-R5 'configuration-after.json' @{at=[DateTimeOffset]::Now.ToString('o');provider=$r5FinalProvider;typed=$r5FinalTyped;mutations=$r5Mutations;isoFilesPreserved=((Test-Path -LiteralPath $r5Iso) -and (Test-Path -LiteralPath $r5Seed))}
  $r5Stage='single-start-request'
  Save-R5 'boot-request.json' @{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5VmId;command='Start-VM -Name exactFreshValidatedName -AsJob';attempt=1;vhdx=$r5Vhd;installationMediaAttached=$false;noAutomaticRetry=$true;purpose='DIAGNOSTIC_NOT_INSTALLED_OS_PROOF'}
  $r5BootIssued=$true
  $r5StartJob=Start-VM -Name $r5VmName -AsJob
  $r5StartJob|Wait-Job -Timeout 45|Out-Null
  $r5StartErrors=@();$r5StartOutput=@(Receive-Job -Job $r5StartJob -Keep -ErrorAction SilentlyContinue -ErrorVariable r5StartErrors)
  Save-R5 'boot-job.json' @{at=[DateTimeOffset]::Now.ToString('o');jobId=$r5StartJob.Id;state=$r5StartJob.State.ToString();errors=@($r5StartErrors|ForEach-Object {$_.Exception.Message});completed=($r5StartJob.State.ToString() -eq 'Completed');outputCount=$r5StartOutput.Count;timeoutIsNotCancellation=$true}
  # Even an uncertain Start result proceeds to bounded read-only observation; never another Start.
 }else{throw ('Unsupported current VM state: '+$r5ProviderBefore.state)}
 Write-Host 'Bounded read-only VM observation. No console capture or guest input.'
 $r5Stage='post-start-read-only-observation'
 foreach($r5Sample in 0..3){
  if($r5Sample -gt 0){Start-Sleep -Seconds 15}
  $r5Vm=Get-R5Vm
  $r5Cim=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8
  $r5Kvp=@(Get-CimAssociatedInstance -InputObject $r5Cim -ResultClassName Msvm_KvpExchangeComponent -OperationTimeoutSec 8)
  $r5GuestData=@(foreach($r5Xml in $r5Kvp.GuestIntrinsicExchangeItems){$r5Doc=[xml]$r5Xml;$r5Name=($r5Doc.INSTANCE.PROPERTY|Where-Object NAME -eq 'Name').VALUE;if($r5Name -in @('FullyQualifiedDomainName','OSName','OSVersion','OSBuildNumber','NetworkAddressIPv4','ProcessorArchitecture','IntegrationServicesVersion')){@{name=$r5Name;value=($r5Doc.INSTANCE.PROPERTY|Where-Object NAME -eq 'Data').VALUE}}})
  Save-R5 ('vm-observation-'+$r5Sample+'.json') @{at=[DateTimeOffset]::Now.ToString('o');vm=($r5Vm|Select-Object Name,Id,State,Status,Heartbeat,Uptime,MemoryAssigned,ProcessorCount);network=@(Get-VMNetworkAdapter -VM $r5Vm|Select-Object MacAddress,SwitchId,IPAddresses,Status);integrationServices=@(Get-VMIntegrationService -VM $r5Vm|Select-Object Name,Enabled,PrimaryStatusDescription,SecondaryStatusDescription);intrinsicGuestData=$r5GuestData;vmRunningDoesNotProveGuestReady=$true}
 }
 $r5Stage='complete'
}catch{
 $r5Failure=$_.Exception.Message
 Save-R5 'guard-error.json' @{at=[DateTimeOffset]::Now.ToString('o');stage=$r5Stage;error=$r5Failure;errorId=$_.FullyQualifiedErrorId;scriptStack=$_.ScriptStackTrace;line=$_.InvocationInfo.ScriptLineNumber;bootIssued=$r5BootIssued}
 # Within this same approved execution, exhaust bounded safe observations before exit.
 if($r5ActualElevated){
  foreach($r5DiagIndex in 0..2){
   if($r5DiagIndex -gt 0){Start-Sleep -Seconds 6}
   try{
    $null=Get-R5ProviderStorage ('guard-diagnostic-'+$r5DiagIndex)
    $null=Get-R5FreshTyped ('guard-diagnostic-'+$r5DiagIndex)
   }catch{Save-R5 ('guard-diagnostic-error-'+$r5DiagIndex+'.json') @{at=[DateTimeOffset]::Now.ToString('o');error=$_.Exception.Message;errorId=$_.FullyQualifiedErrorId}}
  }
 }
}
finally{
 if('R5BootDeadline' -as [type]){[R5BootDeadline]::Stop()}
 if(-not(Test-Path -LiteralPath (Join-Path $r5Here 'helper-terminal.json'))){Save-R5 'helper-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;stage=$r5Stage;status=$(if($r5Failure){'BOUNDED_BOOT_HELPER_STOPPED'}else{'BOUNDED_BOOT_HELPER_COMPLETED'});error=$r5Failure;bootIssued=$r5BootIssued;mutations=$r5Mutations;workingDbAccessed=$false;captureAttempted=$false;sshAttempted=$false;automaticRetry=$false;actualElevated=$r5ActualElevated}}
}
if($r5Failure){Write-Error -ErrorAction Continue $r5Failure;exit 1}
Write-Host 'Diagnostic helper completed. Receipts saved; guest readiness is not assumed.'
