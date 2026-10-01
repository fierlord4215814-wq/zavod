# One scoped UAC: read EXACT existing VM + attached own seed; open native own VMConnect.
# No VM state change, queued control, guest input, network/policy change, or installation.
param([Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5VmId='99a158da-c247-422c-ae11-109485a92b1f';$r5VmName='Zavod-Master-R5-Ubuntu24'
$r5Terminal=Join-Path $r5Here 'observer-terminal.json';$r5Failure=$null;$r5Stage='preflight'
function Save-R5([string]$Name,$Value){
 $r5Path=Join-Path $r5Here $Name
 $r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 16))
 $r5S=[IO.File]::Open($r5Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$r5S.Write($r5Bytes,0,$r5Bytes.Length);$r5S.Flush($true)}finally{$r5S.Dispose()}
}
try{
 if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Self hash mismatch'}
 if(-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual elevation missing'}
 if(Test-Path -LiteralPath $r5Terminal){throw 'Already observed; no retry'}
 Save-R5 'observer-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;actualElevated=$true;sha256=$ExpectedSha256;vmId=$r5VmId;mutatingVmCommandsAllowed=$false}
 Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading;
public static class R5ReadDeadline {
 private static Timer timer;
 public static void Start(string p){timer=new Timer(_=>{try{using(var f=new FileStream(p,FileMode.CreateNew,FileAccess.Write,FileShare.Read))using(var w=new StreamWriter(f)){w.Write("{\"status\":\"READ_ONLY_OBSERVER_TIMEOUT\",\"vmMutation\":false}");}}finally{Environment.Exit(124);}},null,90000,Timeout.Infinite);}
 public static void Stop(){if(timer!=null)timer.Dispose();}
}
'@
 [R5ReadDeadline]::Start($r5Terminal)
 $r5Stage='exact-vm'
 $r5Vm=Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='"+$r5VmId+"'") -OperationTimeoutSec 8
 if($null -eq $r5Vm -or $r5Vm.ElementName -ne $r5VmName){throw 'Exact VM not found'}
 $r5Settings=@(Get-CimAssociatedInstance -InputObject $r5Vm -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData -OperationTimeoutSec 8)
 if($r5Settings.Count -ne 1 -or $r5Settings[0].BIOSGUID -ne 'D00FD8A4-6628-433C-BD34-00A7CB7DD174'){throw 'VM settings identity differs'}
 $r5Storage=@(Get-CimAssociatedInstance -InputObject $r5Settings[0] -ResultClassName Msvm_StorageAllocationSettingData -OperationTimeoutSec 8)
 $r5Disk=@($r5Storage|Where-Object {$_.ResourceSubType -eq 'Microsoft:Hyper-V:Virtual Hard Disk'})
 if($r5Disk.Count -ne 1 -or $r5Disk[0].HostResource.Count -ne 1 -or $r5Disk[0].HostResource[0] -ne (Join-Path $r5Runtime 'vm/ubuntu24.vhdx')){throw 'Sole owned VHDX not confirmed'}
 $r5Jobs=@(Get-CimAssociatedInstance -InputObject $r5Vm -Association Msvm_AffectedJobElement -ResultClassName Msvm_ConcreteJob -OperationTimeoutSec 8)
 Save-R5 'actual-vm.json' @{at=[DateTimeOffset]::Now.ToString('o');vm=($r5Vm|Select-Object Name,ElementName,EnabledState,RequestedState,OperationalStatus,StatusDescriptions,HealthState,OnTimeInMilliseconds,ProcessID);settings=($r5Settings[0]|Select-Object VirtualSystemIdentifier,VirtualSystemSubType,BIOSGUID);storage=@($r5Storage|Select-Object ResourceSubType,HostResource,AddressOnParent);jobs=@($r5Jobs|Select-Object InstanceID,Name,JobState,PercentComplete,ErrorCode,ErrorDescription);soleTargetVhdxConfirmed=$true}
 $r5Stage='owned-seed-read'
 $r5Seed=Join-Path $r5Runtime 'private/seed.iso'
 $r5Dvd=@($r5Storage|Where-Object {$_.ResourceSubType -eq 'Microsoft:Hyper-V:Virtual CD/DVD Disk'})
 if(-not (@($r5Dvd|ForEach-Object {$_.HostResource}) -contains $r5Seed)){throw 'Known seed not attached; do not guess active configuration'}
 if((Get-FileHash -LiteralPath $r5Seed -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7'){throw 'Attached seed hash differs'}
 $r5Tar=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\tar.exe');$r5Tar.UseShellExecute=$false;$r5Tar.CreateNoWindow=$true;$r5Tar.RedirectStandardOutput=$true;$r5Tar.RedirectStandardError=$true
 foreach($r5Arg in @('-xOf',$r5Seed,'user-data')){$r5Tar.ArgumentList.Add($r5Arg)}
 $r5Reader=[Diagnostics.Process]::Start($r5Tar);$r5Out=$r5Reader.StandardOutput.ReadToEndAsync();$r5Err=$r5Reader.StandardError.ReadToEndAsync()
 if(-not $r5Reader.WaitForExit(5000)){$r5Reader.Kill();throw 'Own seed reader timeout'}
 if($r5Reader.ExitCode -ne 0){throw 'Own seed read failed; content suppressed'}
 $r5SeedText=$r5Out.Result;$r5Reader.Dispose()
 try{$r5SeedConfig=($r5SeedText -replace '^#cloud-config\r?\n','')|ConvertFrom-Json}catch{throw 'Own seed parse failed; content suppressed'}
 $r5Late=$r5SeedConfig.autoinstall.'late-commands'
 Save-R5 'actual-seed-redacted.json' @{at=[DateTimeOffset]::Now.ToString('o');seedIsoSha256='4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7';readFromAttachedSeed=$true;lateCommands=$r5Late;argumentCounts=@($r5Late|ForEach-Object {$_.Count});shutdown=$r5SeedConfig.autoinstall.shutdown;source=$r5SeedConfig.autoinstall.source.id;credentialsExported=$false;guestAutoinstallAndLogsRead=$false}
 $r5SeedText=$null;$r5SeedConfig=$null
 $r5Stage='native-own-viewer'
 $r5Existing=@(Get-CimInstance Win32_Process -Filter "Name='vmconnect.exe'" -OperationTimeoutSec 8)
 if($r5Existing.Count){Save-R5 'viewer-launch.json' @{at=[DateTimeOffset]::Now.ToString('o');status='EXISTING_VIEWER_DO_NOT_DUPLICATE';count=$r5Existing.Count;guestInput=$false}}
 else{
  $r5ViewerPath='C:\Windows\System32\vmconnect.exe'
  $r5Signature=Get-AuthenticodeSignature -LiteralPath $r5ViewerPath
  if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Windows*'){throw 'Native viewer signature not confirmed'}
  $r5Viewer=Start-Process -FilePath $r5ViewerPath -ArgumentList @('localhost',$r5VmName) -WindowStyle Normal -PassThru
  Save-R5 'viewer-launch.json' @{at=[DateTimeOffset]::Now.ToString('o');status='OPENED_NATIVE_VIEWER_ONLY';pid=$r5Viewer.Id;vmId=$r5VmId;guestInput=$false;vmStateChange=$false}
 }
 $r5Stage='complete'
}catch{$r5Failure=$_.Exception.Message}
finally{
 if('R5ReadDeadline' -as [type]){[R5ReadDeadline]::Stop()}
 if(-not(Test-Path -LiteralPath $r5Terminal)){Save-R5 'observer-terminal.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$PID;stage=$r5Stage;status=$(if($r5Failure){'READ_ONLY_OBSERVER_FAILED'}else{'READ_ONLY_OBSERVER_COMPLETED'});error=$r5Failure;vmMutation=$false;guestInput=$false;workingDbRead=$false}}
}
if($r5Failure){Write-Error -ErrorAction Continue $r5Failure;exit 1}
