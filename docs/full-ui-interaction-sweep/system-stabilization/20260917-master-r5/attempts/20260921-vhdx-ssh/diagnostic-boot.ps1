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
$r5Stage='preflight';$r5Failure=$null;$r5BootIssued=$false;$r5Mutations=@()
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
function Get-R5Firmware($Value){
 @{secureBoot=$Value.SecureBoot.ToString();secureBootTemplate=$Value.SecureBootTemplate;secureBootTemplateId=$Value.SecureBootTemplateId;preferredNetworkBootProtocol=$Value.PreferredNetworkBootProtocol.ToString();consoleMode=$Value.ConsoleMode.ToString();pauseAfterBootFailure=$Value.PauseAfterBootFailure.ToString();bootOrder=@($Value.BootOrder|ForEach-Object {@{bootType=$_.BootType.ToString();description=$_.Description;firmwarePath=$_.FirmwarePath;devicePath=$_.Device.Path;deviceId=$_.Device.Id;deviceType=$(if($_.Device){$_.Device.GetType().FullName}else{$null})}})}
}
try{
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Helper hash mismatch'}
 if(-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual elevated token absent'}
 if(Test-Path -LiteralPath (Join-Path $r5Here 'helper-start.json')){throw 'Helper previously started; never repeat boot attempt'}
 Save-R5 'helper-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;launcherPid=$LauncherPid;actualElevated=$true;sha256=$ExpectedSha256;scope='ONE_EXISTING_VHDX_DIAGNOSTIC_BOOT';vmId=$r5VmId}
 Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading;
public static class R5BootDeadline {
 private static Timer timer;
 public static void Start(string p){timer=new Timer(_=>{try{using(var f=new FileStream(p,FileMode.CreateNew,FileAccess.Write,FileShare.Read))using(var w=new StreamWriter(f)){w.Write("{\"status\":\"HELPER_DEADLINE_NO_RETRY\",\"operationOutcome\":\"READ_LAST_RECEIPTS_AND_CURRENT_VM\"}");}}finally{Environment.Exit(124);}},null,180000,Timeout.Infinite);}
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
 $r5Vm=Get-R5Vm
 $r5Cim=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8
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
 $r5Stage='configuration'
 $r5Vm=Get-R5Vm
 if($r5Vm.State.ToString() -eq 'Running'){
  Save-R5 'boot-not-issued.json' @{at=[DateTimeOffset]::Now.ToString('o');reason='ALREADY_RUNNING_NO_MEDIA_OR_STATE_CHANGE';vmId=$r5VmId}
 }elseif($r5Vm.State.ToString() -eq 'Off'){
  foreach($r5Drive in $r5Dvd){if($r5Drive.Path){Set-VMDvdDrive -VMDvdDrive $r5Drive -Path $null;$r5Mutations+=('EJECT_OWN_DVD_'+$r5Drive.ControllerNumber+'_'+$r5Drive.ControllerLocation)}}
  Set-VMFirmware -VM $r5Vm -FirstBootDevice $r5Disk[0]
  $r5Mutations+='EXISTING_VHDX_FIRST'
  $r5FirmwareAfter=Get-R5Firmware (Get-VMFirmware -VM $r5Vm)
  $r5DvdAfter=@(Get-VMDvdDrive -VM $r5Vm)
  Save-R5 'configuration-after.json' @{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5VmId;firmware=$r5FirmwareAfter;dvd=@($r5DvdAfter|Select-Object Path,ControllerNumber,ControllerLocation,Id);mutations=$r5Mutations;isoFilesPreserved=((Test-Path -LiteralPath $r5Iso) -and (Test-Path -LiteralPath $r5Seed))}
  foreach($r5Field in @('secureBoot','secureBootTemplate','secureBootTemplateId','preferredNetworkBootProtocol','consoleMode','pauseAfterBootFailure')){if($r5FirmwareBefore[$r5Field] -ne $r5FirmwareAfter[$r5Field]){throw ('Unrelated firmware changed: '+$r5Field)}}
  if(@($r5DvdAfter|Where-Object Path).Count -or $r5FirmwareAfter.bootOrder[0].devicePath -ne $r5Vhd){throw 'No-media/VHDX-first readback failed; no boot issued'}
  $r5Vm=Get-R5Vm
  if($r5Vm.State.ToString() -ne 'Off'){throw 'VM state changed before Start; no boot issued'}
  $r5Stage='single-start-request'
  Save-R5 'boot-request.json' @{at=[DateTimeOffset]::Now.ToString('o');vmId=$r5VmId;command='Start-VM -VM exactValidatedVm -AsJob';attempt=1;vhdx=$r5Vhd;installationMediaAttached=$false;noAutomaticRetry=$true;purpose='DIAGNOSTIC_NOT_INSTALLED_OS_PROOF'}
  $r5BootIssued=$true
  $r5StartJob=Start-VM -VM $r5Vm -AsJob
  $r5StartJob|Wait-Job -Timeout 45|Out-Null
  $r5StartErrors=@();$r5StartOutput=@(Receive-Job -Job $r5StartJob -Keep -ErrorAction SilentlyContinue -ErrorVariable r5StartErrors)
  Save-R5 'boot-job.json' @{at=[DateTimeOffset]::Now.ToString('o');jobId=$r5StartJob.Id;state=$r5StartJob.State.ToString();errors=@($r5StartErrors|ForEach-Object {$_.Exception.Message});completed=($r5StartJob.State.ToString() -eq 'Completed');outputCount=$r5StartOutput.Count}
  if($r5StartJob.State.ToString() -ne 'Completed'){throw 'Start job not completed; do not retry or stop VM'}
 }
 else{throw ('Unsupported current VM state: '+$r5Vm.State.ToString())}
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
}catch{$r5Failure=$_.Exception.Message}
finally{
 if('R5BootDeadline' -as [type]){[R5BootDeadline]::Stop()}
 if(-not(Test-Path -LiteralPath (Join-Path $r5Here 'helper-terminal.json'))){Save-R5 'helper-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;stage=$r5Stage;status=$(if($r5Failure){'BOUNDED_BOOT_HELPER_STOPPED'}else{'BOUNDED_BOOT_HELPER_COMPLETED'});error=$r5Failure;bootIssued=$r5BootIssued;mutations=$r5Mutations;workingDbAccessed=$false;captureAttempted=$false;sshAttempted=$false;automaticRetry=$false}}
}
if($r5Failure){Write-Error -ErrorAction Continue $r5Failure;exit 1}
