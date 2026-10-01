# Read-only native Hyper-V observation of exactly the already created R5 VM. No VM/guest/host setting changes.
param([Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5VmId='99a158da-c247-422c-ae11-109485a92b1f'
$r5ExpectedName='Zavod-Master-R5-Ubuntu24'
$r5Queue='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24\control'
$r5Root='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24\vm'
function Save-Observe([string]$Name,$Data){$p=Join-Path $r5Here $Name;if(Test-Path -LiteralPath $p){throw ('Preserve existing observation: '+$Name)};[IO.File]::WriteAllText($p,($Data|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))}
try{
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Observer self hash mismatch'}
 $r5Elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 if(-not $r5Elevated){throw 'No actual administrator token; observation not performed'}
 $r5Vm=Get-VM -Id $r5VmId
 if($r5Vm.Name -ne $r5ExpectedName -or $r5Vm.Generation -ne 2 -or -not $r5Vm.Path.StartsWith($r5Root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Own VM identity mismatch'}
 Save-Observe 'console-observer-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualTokenElevated=$true;vmId=$r5VmId;scriptSha256=$ExpectedSha256;readOnlyHyperV=$true;hostGuestMutations=$false}
 Add-Type -AssemblyName System.Drawing
 Add-Type -AssemblyName System.Management
 function Save-R5Thumb([byte[]]$Bytes,[int]$Width,[int]$Height,[string]$Path){
  if($Bytes.Length -ne $Width*$Height*2){throw 'RGB565 length mismatch'}
  $r5Colors=[int[]]::new($Width*$Height)
  for($r5Pixel=0;$r5Pixel -lt $r5Colors.Length;$r5Pixel++){
   $r5Packed=[int]$Bytes[2*$r5Pixel] -bor ([int]$Bytes[2*$r5Pixel+1] -shl 8)
   $r5Red=[int][Math]::Floor((($r5Packed -shr 11) -band 31)*255/31)
   $r5Green=[int][Math]::Floor((($r5Packed -shr 5) -band 63)*255/63)
   $r5Blue=[int][Math]::Floor(($r5Packed -band 31)*255/31)
   $r5Colors[$r5Pixel]=(-16777216) -bor ($r5Red -shl 16) -bor ($r5Green -shl 8) -bor $r5Blue
  }
  $r5Bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try{$r5Bits=$r5Bitmap.LockBits([Drawing.Rectangle]::new(0,0,$Width,$Height),[Drawing.Imaging.ImageLockMode]::WriteOnly,[Drawing.Imaging.PixelFormat]::Format32bppArgb);try{[Runtime.InteropServices.Marshal]::Copy($r5Colors,0,$r5Bits.Scan0,$r5Colors.Length)}finally{$r5Bitmap.UnlockBits($r5Bits)};$r5Bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)}finally{$r5Bitmap.Dispose()}
 }
 $r5Deadline=[DateTime]::UtcNow.AddHours(8);$r5Done=$false
 while(-not $r5Done -and [DateTime]::UtcNow -lt $r5Deadline){
  foreach($r5File in @(Get-ChildItem -LiteralPath $r5Queue -File -Filter '*.observe.json'|Sort-Object Name)){
   if($r5File.Name -notmatch '^([0-9]{6})\.observe\.json$'){continue};$r5Id=$Matches[1];$r5Receipt='console-observation-'+$r5Id+'.json'
   if(Test-Path -LiteralPath (Join-Path $r5Here $r5Receipt)){continue}
   try{
    if($r5File.Length -gt 4096 -or ($r5File.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unexpected observer request'}
    $r5Request=Get-Content -LiteralPath $r5File.FullName -Raw|ConvertFrom-Json
    if($r5Request.vmId -ne $r5VmId -or $r5Request.operation -notin @('OBSERVE','EXIT')){throw 'Foreign/unapproved observation denied'}
    if($r5Request.operation -eq 'EXIT'){$r5Done=$true;Save-Observe $r5Receipt @{at=[DateTimeOffset]::Now.ToString('o');status='OBSERVER_EXIT_REQUESTED_VM_PRESERVED';vmId=$r5VmId};break}
    $r5Vm=Get-VM -Id $r5VmId
    if($r5Vm.Name -ne $r5ExpectedName -or -not $r5Vm.Path.StartsWith($r5Root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Own VM identity changed'}
    $r5Cs=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'")
    $r5Settings=@(Get-CimAssociatedInstance -InputObject $r5Cs -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData)
    if($r5Settings.Count -ne 1){throw 'Own VM settings not unique'}
    $r5Service=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_VirtualSystemManagementService
    $r5Probes=@();$r5Captures=@()
    foreach($r5Size in @(@{w=640;h=480},@{w=320;h=240},@{w=1024;h=768})){
     $r5Result=Invoke-CimMethod -InputObject $r5Service -MethodName GetVirtualSystemThumbnailImage -Arguments @{TargetSystem=$r5Settings[0];WidthPixels=[uint16]$r5Size.w;HeightPixels=[uint16]$r5Size.h}
     $r5Data=$r5Result.ImageData
     $r5Properties=@($r5Result.PSObject.Properties|ForEach-Object {@{name=$_.Name;type=$(if($null -eq $_.Value){'null'}else{$_.Value.GetType().FullName});count=$(if($_.Value -is [Array]){$_.Value.Length}else{$null})}})
     $r5Probes+=@{api='CIM';requested=$r5Size;returnValue=$r5Result.ReturnValue;actualBytes=$(if($null -eq $r5Data){$null}else{$r5Data.Length});properties=$r5Properties}
     if($r5Result.ReturnValue -eq 0 -and $null -ne $r5Data -and $r5Data.Length -eq $r5Size.w*$r5Size.h*2){
      $r5Png=Join-Path $r5Here ('vm-observed-'+$r5Id+'-'+$r5Size.w+'x'+$r5Size.h+'.png');if(Test-Path -LiteralPath $r5Png){throw 'Capture path exists'}
      Save-R5Thumb ([byte[]]$r5Data) $r5Size.w $r5Size.h $r5Png
      $r5Captures+=@{path=$r5Png;width=$r5Size.w;height=$r5Size.h;sha256=(Get-FileHash -LiteralPath $r5Png -Algorithm SHA256).Hash.ToLowerInvariant();viewed=$false};break
     }
    }
    Save-Observe $r5Receipt @{at=[DateTimeOffset]::Now.ToString('o');status=$(if($r5Captures.Count){'OWN_VM_CONSOLE_CAPTURED_NOT_YET_VIEWED'}else{'THUMBNAIL_NO_VALID_IMAGE_RAW_METADATA_RETAINED'});vmId=$r5VmId;state=$r5Vm.State.ToString();probes=$r5Probes;captures=$r5Captures;videoHeads=@(Get-CimAssociatedInstance -InputObject $r5Cs -ResultClassName Msvm_VideoHead|Select-Object DeviceID,CurrentBitsPerPixel,CurrentHorizontalResolution,CurrentVerticalResolution,EnabledState);readOnly=$true}
   }catch{Save-Observe $r5Receipt @{at=[DateTimeOffset]::Now.ToString('o');status='READ_ONLY_OBSERVER_FAILED';message=$_.Exception.Message;vmId=$r5VmId}}
  }
  if(-not $r5Done){Start-Sleep -Milliseconds 500}
 }
 Save-Observe 'console-observer-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;status='EXITED_VM_PRESERVED';vmId=$r5VmId;hostGuestMutations=$false}
}catch{Save-Observe 'console-observer-failure.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;message=$_.Exception.Message;vmId=$r5VmId;automaticRetry=$false;hostGuestMutations=$false};Write-Error $_;exit 1}
