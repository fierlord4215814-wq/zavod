# Generate own guest setup media only after owned-VM receipt and fully verified official ISO.
# Private key and media live outside evidence; never export their contents or any working configuration.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
. (Join-Path $r5Here 'r5-late-commands.ps1')
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5Private=Join-Path $r5Runtime 'private'
$r5SeedDir=Join-Path $r5Private 'seed-config'
$r5SeedIso=Join-Path $r5Private 'seed.iso'
$r5Vm=Get-Content -LiteralPath (Join-Path $r5Here 'vm-created.json') -Raw|ConvertFrom-Json
$r5Image=Get-Content -LiteralPath (Join-Path $r5Here 'image-download-result.json') -Raw|ConvertFrom-Json
if($r5Vm.runtime -ne $r5Runtime -or $r5Vm.name -ne 'Zavod-Master-R5-Ubuntu24' -or $r5Vm.vmId -notmatch '^[0-9a-fA-F-]{36}$' -or $r5Image.status -ne 'FULL_OFFICIAL_IMAGE_HASH_VERIFIED_NOT_BOOTED'){throw 'Owned guest/image prerequisites absent'}
if((Test-Path -LiteralPath $r5Private) -or (Test-Path -LiteralPath (Join-Path $r5Here 'seed-media-receipt.json'))){throw 'Existing private/media state; preserve and inspect'}
$r5SourceMetadata=& 'C:\Windows\System32\tar.exe' -xOf $r5Image.path 'casper/install-sources.yaml'
if($LASTEXITCODE -ne 0 -or -not ($r5SourceMetadata -match 'id: ubuntu-server$')){throw 'Actual ISO install source not confirmed'}
New-Item -ItemType Directory -Path $r5Private | Out-Null
$r5Acl=Get-Acl -LiteralPath $r5Private
$r5Acl.SetAccessRuleProtection($true,$false)
foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){$r5Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))}
Set-Acl -LiteralPath $r5Private -AclObject $r5Acl
New-Item -ItemType Directory -Path $r5SeedDir | Out-Null
$r5Key=Join-Path $r5Private 'guest-ops-ed25519'
& 'C:\Windows\System32\OpenSSH\ssh-keygen.exe' -q -t ed25519 -f $r5Key -N '' -C 'zavod-r5-own-guest-ops'
if($LASTEXITCODE -ne 0){throw 'Own SSH key generation failed; never overwrite partial keys'}
$r5Public=(Get-Content -LiteralPath ($r5Key+'.pub') -Raw).Trim()
if($r5Public -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ zavod-r5-own-guest-ops$'){throw 'Unexpected own public key format'}
$r5Mac=($r5Vm.mac -replace '(.{2})(?=.)','$1:').ToLowerInvariant()
$r5Preflight='set -eu; test "$(cat /sys/class/dmi/id/sys_vendor)" = "Microsoft Corporation"; test "$(cat /sys/class/dmi/id/product_name)" = "Virtual Machine"; test "$(lsblk -dn -o TYPE | grep -cx disk)" = 1; test "$(blockdev --getsize64 /dev/sda)" = 17179869184; test -z "$(blkid /dev/sda 2>/dev/null || true)"; printf "R5_NEW_OWN_16G_DISK_ONLY\n" > /run/r5-new-disk-proof'
$r5Storage=@{
 swap=@{size=0};config=@(
 @{id='r5-disk';type='disk';path='/dev/sda';ptable='gpt';preserve=$false;wipe='superblock';grub_device=$false},
 @{id='r5-efi';type='partition';device='r5-disk';number=1;size='512M';flag='boot';grub_device=$true;preserve=$false},
 @{id='r5-efi-fs';type='format';volume='r5-efi';fstype='fat32';preserve=$false},
 @{id='r5-efi-mount';type='mount';device='r5-efi-fs';path='/boot/efi'},
 @{id='r5-root';type='partition';device='r5-disk';number=2;size=-1;preserve=$false},
 @{id='r5-root-fs';type='format';volume='r5-root';fstype='ext4';preserve=$false},
 @{id='r5-root-mount';type='mount';device='r5-root-fs';path='/'}
 )
}
$r5Autoinstall=@{
 version=1;locale='en_US.UTF-8';keyboard=@{layout='us'};'refresh-installer'=@{update=$false};source=@{id='ubuntu-server';search_drivers=$false};
 identity=@{hostname='zavod-r5-ubuntu24';username='r5ops';realname='R5 isolated guest coordinator';password='!'};
 ssh=@{'install-server'=$true;'allow-pw'=$false;'authorized-keys'=@($r5Public)};
 network=@{version=2;ethernets=@{r5link=@{match=@{macaddress=$r5Mac};'set-name'='r5link';dhcp4=$false;dhcp6=$false;'accept-ra'=$false;addresses=@($r5Vm.network.guestIp+'/30')}}};
 apt=@{geoip=$false;fallback='offline-install';'mirror-selection'=@{primary=@(@{uri='http://archive.ubuntu.com/ubuntu'})}};
 storage=$r5Storage;'early-commands'=@($r5Preflight);
 'late-commands'=(New-R5LateCommands -VmId $r5Vm.vmId);
 'user-data'=@{package_update=$false;package_upgrade=$false;ssh_pwauth=$false;disable_root=$true};shutdown='poweroff'
}
$r5Config=@{autoinstall=$r5Autoinstall}
[IO.File]::WriteAllText((Join-Path $r5SeedDir 'user-data'),("#cloud-config`n"+($r5Config|ConvertTo-Json -Depth 20)+"`n"),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $r5SeedDir 'meta-data'),(@{'instance-id'=$r5Vm.vmId;'local-hostname'='zavod-r5-ubuntu24'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class R5OwnIsoWriter {
 public static void Save(string path,object comStream) {
  var stream=(IStream)comStream; var count=Marshal.AllocHGlobal(4);
  try {using(var output=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
   var buffer=new byte[65536]; for(;;){stream.Read(buffer,buffer.Length,count);int n=Marshal.ReadInt32(count);if(n==0)break;output.Write(buffer,0,n);}output.Flush(true);
  }} finally {Marshal.FreeHGlobal(count);}
 }
}
'@
$r5Fsi=New-Object -ComObject IMAPI2FS.MsftFileSystemImage
try{$r5Fsi.FileSystemsToCreate=3;$r5Fsi.VolumeName='cidata';$r5Fsi.Root.AddTree($r5SeedDir,$false);$r5Media=$r5Fsi.CreateResultImage();[R5OwnIsoWriter]::Save($r5SeedIso,$r5Media.ImageStream)}finally{[Runtime.InteropServices.Marshal]::FinalReleaseComObject($r5Fsi)|Out-Null}
$r5List=& 'C:\Windows\System32\tar.exe' -tf $r5SeedIso
if($LASTEXITCODE -ne 0 -or -not($r5List -contains 'user-data') -or -not($r5List -contains 'meta-data')){throw 'Own configuration media readback failed; preserve for inspection'}
$r5Receipt=@{at=[DateTimeOffset]::Now.ToString('o');status='OWN_CONFIG_MEDIA_CREATED_NOT_GUEST_INSTALLED';path=$r5SeedIso;bytes=(Get-Item -LiteralPath $r5SeedIso).Length;sha256=(Get-FileHash -LiteralPath $r5SeedIso -Algorithm SHA256).Hash.ToLowerInvariant();volume='cidata';vmId=$r5Vm.vmId;diskGuard='Microsoft VM, exactly one blank 16GiB disk /dev/sda, before partitioning';source='ubuntu-server confirmed from actual ISO';guestIp=$r5Vm.network.guestIp;defaultGateway=$null;dnsServers=@();sshPasswordAuth=$false;rootSsh=$false;appUser='r5app without sudo';pgOsUser='r5pg';opsUser='r5ops separate privileged preparation only';keyFingerprint=(& 'C:\Windows\System32\OpenSSH\ssh-keygen.exe' -lf ($r5Key+'.pub'));privateKeysExported=$false;hostFirewallChanged=$false;hostReboot=$false;productStarted=$false}
[IO.File]::WriteAllText((Join-Path $r5Here 'seed-media-receipt.json'),($r5Receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$r5Receipt|Select-Object status,path,bytes,sha256,vmId,guestIp,defaultGateway,productStarted|ConvertTo-Json
