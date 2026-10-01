# Visible, bounded Hyper-V coordinator. Only one newly created VM/internal switch and fixed owned paths.
# No arbitrary host command execution, firewall/NAT/policy changes, app/DB access, host reboot or autostart.
param([Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5VmRoot=Join-Path $r5Runtime 'vm'
$r5Vhd=Join-Path $r5VmRoot 'ubuntu24.vhdx'
$r5Queue=Join-Path $r5Runtime 'control'
$r5Name='Zavod-Master-R5-Ubuntu24'
$r5SwitchName='Zavod-R5-Internal-20260919'
$r5Mac='025A56051901'
$r5VmId=$null;$r5Switch=$null;$r5Done=$false;$r5MediaAttached=$false
function Save-R5([string]$Name,$Data){$p=Join-Path $r5Here $Name;if(Test-Path -LiteralPath $p){throw ('Receipt already exists: '+$Name)};[IO.File]::WriteAllText($p,($Data|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Number-R5([string]$Ip){$b=[Net.IPAddress]::Parse($Ip).GetAddressBytes();if($b.Length -ne 4){throw 'IPv4 required'};return ([uint64]$b[0]*16777216+[uint64]$b[1]*65536+[uint64]$b[2]*256+[uint64]$b[3])}
function Owned-R5Vm{
 if($null -eq $r5VmId){throw 'No owned VM identity'}
 $v=Get-VM -Id $r5VmId
 if($v.Name -ne $r5Name -or $v.Generation -ne 2 -or -not ($v.Path -eq $r5VmRoot -or $v.Path.StartsWith($r5VmRoot+'\',[StringComparison]::OrdinalIgnoreCase))){throw 'VM identity/path changed'}
 $d=@(Get-VMHardDiskDrive -VM $v);$n=@(Get-VMNetworkAdapter -VM $v)
 if($d.Count -ne 1 -or $d[0].Path -ne $r5Vhd -or $n.Count -ne 1 -or $n[0].MacAddress -ne $r5Mac -or ($n[0].SwitchName -and $n[0].SwitchName -ne $r5SwitchName)){throw 'Unexpected own VM disks/network'}
 return $v
}
function State-R5Vm{
 $v=Owned-R5Vm
 return @{at=[DateTimeOffset]::Now.ToString('o');vm=($v|Select-Object Name,Id,State,Generation,Path,MemoryStartup,MemoryAssigned,ProcessorCount,AutomaticStartAction,AutomaticStopAction,CheckpointType,AutomaticCheckpointsEnabled);disks=@(Get-VMHardDiskDrive -VM $v|Select-Object Path,ControllerType,ControllerNumber,ControllerLocation);network=@(Get-VMNetworkAdapter -VM $v|Select-Object Name,Id,MacAddress,SwitchName,SwitchId,Status);freeDiskBytes=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace;freeRamBytes=([double](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1024)}
}
try{
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Coordinator self hash mismatch'}
 $r5Admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 if(-not $r5Admin){throw 'Actual administrator token missing; no mutations'}
 if(Test-Path -LiteralPath (Join-Path $r5Here 'vm-created.json')){throw 'VM already created; never create another as a retry'}
 if(-not(Test-Path -LiteralPath $r5Runtime) -or (Test-Path -LiteralPath $r5VmRoot) -or (Test-Path -LiteralPath $r5Queue)){throw 'Runtime ownership/preexisting path guard'}
 if((Get-VM -Name $r5Name -ErrorAction SilentlyContinue) -or (Get-VMSwitch -Name $r5SwitchName -ErrorAction SilentlyContinue)){throw 'VM/switch name exists; preserve and inspect'}
 if(@(Get-VMNetworkAdapter -All|Where-Object MacAddress -eq $r5Mac).Count){throw 'Chosen private MAC collision'}
 $r5Host=Get-CimInstance Win32_ComputerSystem;$r5Os=Get-CimInstance Win32_OperatingSystem;$r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
 if(-not $r5Host.HypervisorPresent -or -not $r5Os.DataExecutionPrevention_Available -or ([double]$r5Os.FreePhysicalMemory*1024) -lt 6GB -or $r5Disk.FreeSpace -lt 38GB){throw 'Host readiness/resource budget not satisfied'}
 $r5Routes=@(Get-NetRoute -AddressFamily IPv4 | Where-Object {$_.DestinationPrefix -ne '0.0.0.0/0'} | Select-Object -ExpandProperty DestinationPrefix -Unique)
 $r5Chosen=$null
 foreach($c in @(@{prefix='10.243.53.0/30';hostIp='10.243.53.1';guestIp='10.243.53.2'},@{prefix='172.31.254.0/30';hostIp='172.31.254.1';guestIp='172.31.254.2'},@{prefix='192.168.253.0/30';hostIp='192.168.253.1';guestIp='192.168.253.2'})){
  $lo=Number-R5 ($c.prefix.Split('/')[0]);$hi=$lo+3;$collision=$false
  foreach($route in $r5Routes){$s=$route.Split('/');$width=[Math]::Pow(2,32-[int]$s[1]);$start=[Math]::Floor((Number-R5 $s[0])/$width)*$width;$end=$start+$width-1;if($lo -le $end -and $hi -ge $start){$collision=$true;break}}
  if(-not $collision){$r5Chosen=$c;break}
 }
 if($null -eq $r5Chosen){throw 'No collision-free bounded private link; do not change existing routes/VPN'}
 Save-R5 'vm-control-before.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualTokenElevated=$r5Admin;scriptSha256=$ExpectedSha256;vmCount=@(Get-VM).Count;switchCount=@(Get-VMSwitch).Count;existingRouteCount=$r5Routes.Count;selectedNetwork=$r5Chosen;freeRamBytes=([double]$r5Os.FreePhysicalMemory*1024);freeDiskBytes=$r5Disk.FreeSpace;workingDbAccessed=$false;noFirewallNatOrPolicyChange=$true}
 New-Item -ItemType Directory -Path $r5VmRoot,$r5Queue | Out-Null
 $r5Switch=New-VMSwitch -Name $r5SwitchName -SwitchType Internal -Notes 'Owned MASTER R5 synthetic Linux preparation link; no external adapter/NAT'
 $r5Interface=@(Get-NetAdapter | Where-Object Name -eq ('vEthernet ('+$r5SwitchName+')'))
 if($r5Interface.Count -ne 1){throw 'Own internal adapter not uniquely found'}
 New-NetIPAddress -InterfaceIndex $r5Interface[0].ifIndex -IPAddress $r5Chosen.hostIp -PrefixLength 30 -AddressFamily IPv4 | Out-Null
 $r5IpInterface=Get-NetIPInterface -InterfaceIndex $r5Interface[0].ifIndex -AddressFamily IPv4
 if($r5IpInterface.Forwarding -ne 'Disabled'){throw 'Own interface forwarding unexpectedly enabled; no modification/bypass'}
 $r5Vm=New-VM -Name $r5Name -Generation 2 -MemoryStartupBytes 4GB -Path $r5VmRoot -NewVHDPath $r5Vhd -NewVHDSizeBytes 16GB -SwitchName $r5SwitchName
 $r5VmId=$r5Vm.Id
 Set-VM -VM $r5Vm -ProcessorCount 2 -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -CheckpointType Disabled -AutomaticCheckpointsEnabled $false -Notes 'Own MASTER R5 isolated synthetic test guest. Never start product tests while management NIC connected.'
 Set-VMMemory -VM $r5Vm -DynamicMemoryEnabled $false -StartupBytes 4GB
 Set-VMNetworkAdapter -VM $r5Vm -StaticMacAddress $r5Mac -MacAddressSpoofing Off -DhcpGuard On -RouterGuard On
 Set-VMFirmware -VM $r5Vm -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
 $r5VhdState=Get-VHD -Path $r5Vhd
 if($r5VhdState.Size -ne 16GB -or $r5VhdState.VhdType -ne 'Dynamic' -or $r5VhdState.ParentPath){throw 'Own bounded VHDX geometry failed'}
 $r5Cs=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'")
 $r5Settings=@(Get-CimAssociatedInstance -InputObject $r5Cs -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData)
 Save-R5 'vm-created.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualTokenElevated=$true;vmId=$r5VmId.ToString();name=$r5Name;runtime=$r5Runtime;vhd=$r5Vhd;vhdGeometry=($r5VhdState|Select-Object Size,FileSize,VhdType,VhdFormat,ParentPath);switchId=$r5Switch.Id.ToString();switchName=$r5SwitchName;switchType=$r5Switch.SwitchType.ToString();interfaceIndex=$r5Interface[0].ifIndex;network=$r5Chosen;mac=$r5Mac;bios=@($r5Settings|Select-Object BIOSGUID,VirtualSystemIdentifier);state=(State-R5Vm);appStack='NOT_RUN';isolationProof='NOT_RUN_PREPARATION_LINK_CONNECTED';noNatFirewallPolicyChanges=$true;hostReboot=$false}
 Write-Host ('Owned VM created OFF: '+$r5VmId+'. Visible limited coordinator ready; no guest/app bootstrap yet.')
 $r5Deadline=[DateTime]::UtcNow.AddHours(8)
 while(-not $r5Done -and [DateTime]::UtcNow -lt $r5Deadline){
  foreach($file in @(Get-ChildItem -LiteralPath $r5Queue -File -Filter '*.request.json'|Sort-Object Name)){
   if($file.Name -notmatch '^([0-9]{6})\.request\.json$'){continue};$r5Id=$Matches[1];$r5ResultPath=Join-Path $r5Queue ($r5Id+'.result.json')
   if(Test-Path -LiteralPath $r5ResultPath){continue}
   $r5Response=$null
   try{
    if($file.Length -gt 4096 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid bounded request file'}
    $r=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
    if($r.vmId -ne $r5VmId.ToString()){throw 'Foreign VM target denied'}
    $v=Owned-R5Vm
    switch($r.operation){
     'STATUS' {$r5Response=State-R5Vm}
     'ATTACH_BOOT_MEDIA' {
      if($v.State -ne 'Off' -or @(Get-VMDvdDrive -VM $v).Count -ne 0){throw 'Media attach requires pristine OFF own VM'}
      $i=Get-Content -LiteralPath (Join-Path $r5Here 'image-download-result.json') -Raw|ConvertFrom-Json
      $s=Get-Content -LiteralPath (Join-Path $r5Here 'seed-media-receipt.json') -Raw|ConvertFrom-Json
      if($i.status -ne 'FULL_OFFICIAL_IMAGE_HASH_VERIFIED_NOT_BOOTED' -or $i.path -ne (Join-Path $r5Runtime 'ubuntu-24.04.5-live-server-amd64.iso') -or $s.path -ne (Join-Path $r5Runtime 'private/seed.iso')){throw 'Unexpected image/seed target'}
      foreach($media in @($i,$s)){if((Get-FileHash -LiteralPath $media.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $media.sha256){throw 'Boot media hash mismatch'}}
      $dvd=Add-VMDvdDrive -VM $v -ControllerNumber 0 -ControllerLocation 1 -Path $i.path -Passthru
      Add-VMDvdDrive -VM $v -ControllerNumber 0 -ControllerLocation 2 -Path $s.path|Out-Null
      Set-VMFirmware -VM $v -FirstBootDevice $dvd
      $r5MediaAttached=$true
      $r5Response=@{status='OWN_VERIFIED_BOOT_MEDIA_ATTACHED';dvdCount=@(Get-VMDvdDrive -VM $v).Count}
     }
     'BOOT' {if($v.State -ne 'Off'){throw 'BOOT requires OFF'};if(-not $r5MediaAttached -or -not(Test-Path -LiteralPath (Join-Path $r5Here 'seed-media-receipt.json'))){throw 'Verified preparation/media prerequisite missing'};if(([double](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1024) -lt 6GB -or (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace -lt 10GB){throw 'Resource boundary'};Start-VM -VM $v|Out-Null;$r5Response=State-R5Vm}
     'CAPTURE' {
      $cs=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'")
      $setting=@(Get-CimAssociatedInstance -InputObject $cs -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData)
      if($setting.Count -ne 1){throw 'VM settings not unique'}
      $svc=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_VirtualSystemManagementService
      $thumb=Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage -Arguments @{TargetSystem=$setting[0];WidthPixels=[uint16]1024;HeightPixels=[uint16]768}
      if($thumb.ReturnValue -ne 0 -or $thumb.ImageData.Length -ne 1572864){throw ('VM thumbnail failed: '+$thumb.ReturnValue)}
      Add-Type -AssemblyName System.Drawing
      $bmp=[Drawing.Bitmap]::new(1024,768,[Drawing.Imaging.PixelFormat]::Format16bppRgb565)
      try{$lock=$bmp.LockBits([Drawing.Rectangle]::new(0,0,1024,768),[Drawing.Imaging.ImageLockMode]::WriteOnly,[Drawing.Imaging.PixelFormat]::Format16bppRgb565);try{[Runtime.InteropServices.Marshal]::Copy([byte[]]$thumb.ImageData,0,$lock.Scan0,$thumb.ImageData.Length)}finally{$bmp.UnlockBits($lock)};$png=Join-Path $r5Here ('vm-console-'+$r5Id+'.png');if(Test-Path -LiteralPath $png){throw 'Preserve existing console evidence'};$bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png)}finally{$bmp.Dispose()}
      $r5Response=@{status='OWN_VM_NATIVE_CONSOLE_CAPTURED_NOT_YET_VIEWED';path=$png;sha256=(Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()}
     }
     'KEYS' {
      if($v.State -ne 'Running' -or -not $r.text -or $r.text.Length -gt 512 -or $r.text -match '[^\x08\x09\x0A\x0D\x1B\x20-\x7E]'){throw 'Invalid own-guest keyboard text'}
      $cs=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'")
      $kbd=@(Get-CimAssociatedInstance -InputObject $cs -ResultClassName Msvm_Keyboard)
      if($kbd.Count -ne 1){throw 'Own VM keyboard not unique'}
      $typed=Invoke-CimMethod -InputObject $kbd[0] -MethodName TypeText -Arguments @{asciiText=[string]$r.text}
      if($typed.ReturnValue -ne 0){throw ('Guest keyboard failed: '+$typed.ReturnValue)}
      $r5Response=@{status='OWN_GUEST_KEYS_SENT';characters=$r.text.Length}
     }
     'DETACH_INSTALL_MEDIA' {if($v.State -ne 'Off'){throw 'Media detach requires cleanly OFF guest'};Get-VMDvdDrive -VM $v|Set-VMDvdDrive -Path $null;Set-VMFirmware -VM $v -FirstBootDevice (Get-VMHardDiskDrive -VM $v);$r5Response=State-R5Vm}
     'CLOSE_NETWORK' {Get-VMNetworkAdapter -VM $v|Disconnect-VMNetworkAdapter;$r5Response=State-R5Vm}
     'OPEN_NETWORK' {if($v.State -ne 'Off'){throw 'Network reconnect denied until whole VM is OFF; no running product process may regain host access'};Get-VMNetworkAdapter -VM $v|Connect-VMNetworkAdapter -SwitchName $r5SwitchName;$r5Response=State-R5Vm}
     'SHUTDOWN' {if($v.State -eq 'Running'){Stop-VM -VM $v -Confirm:$false};$r5Response=State-R5Vm}
     'EXIT_COORDINATOR' {$r5Done=$true;$r5Response=@{status='COORDINATOR_EXIT_REQUESTED_VM_PRESERVED';state=(State-R5Vm)}}
     default {throw 'Operation not allowlisted; arbitrary host commands are forbidden'}
    }
    $r5Envelope=@{at=[DateTimeOffset]::Now.ToString('o');requestId=$r5Id;operation=$r.operation;vmId=$r5VmId.ToString();status='COMPLETED';result=$r5Response;requestSha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
   }catch{$r5Envelope=@{at=[DateTimeOffset]::Now.ToString('o');requestId=$r5Id;vmId=$r5VmId.ToString();status='FAILED_PRESERVED';message=$_.Exception.Message}}
   [IO.File]::WriteAllText($r5ResultPath,($r5Envelope|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
   Write-Host ($r5Id+' '+$r5Envelope.status)
  }
  if(-not $r5Done){Start-Sleep -Milliseconds 500}
 }
 Save-R5 'vm-control-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');status='EXITED_VM_AND_EVIDENCE_PRESERVED';pid=$PID;vmId=$r5VmId.ToString();state=(State-R5Vm);deadlineReached=(-not $r5Done);hostReboot=$false;workingDbAccessed=$false}
}catch{
 Save-R5 'vm-control-failure.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;message=$_.Exception.Message;vmId=$(if($r5VmId){$r5VmId.ToString()}else{$null});switchId=$(if($r5Switch){$r5Switch.Id.ToString()}else{$null});automaticRetry=$false;automaticCleanup=$false;workingDbAccessed=$false}
 Write-Error $_
 exit 1
}
