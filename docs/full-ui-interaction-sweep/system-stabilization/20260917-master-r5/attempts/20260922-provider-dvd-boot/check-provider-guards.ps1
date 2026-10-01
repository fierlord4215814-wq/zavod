# Host-only checks of the provider guard functions. No Hyper-V/WMI/network operations.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Script=Join-Path $r5Here 'diagnostic-boot.ps1'
$r5T=$null;$r5E=$null
$r5Ast=[Management.Automation.Language.Parser]::ParseFile($r5Script,[ref]$r5T,[ref]$r5E)
if($r5E.Count){throw 'Parser errors'}
foreach($r5Name in @('Get-R5ReferenceId','Get-R5ProviderStorage')){
 $r5F=$r5Ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $r5Name},$true)
 . ([scriptblock]::Create($r5F.Extent.Text))
}
$r5VmId=[guid]'99a158da-c247-422c-ae11-109485a92b1f';$r5VmName='Zavod-Master-R5-Ubuntu24'
$r5Vhd='synthetic-own.vhdx';$r5Iso='synthetic-own.iso';$r5Seed='synthetic-seed.iso'
function Save-R5([string]$Name,$Value){$script:r5LastRecord=$Value}
function Ref([string]$Id){return 'Msvm_ResourceAllocationSettingData.InstanceID="'+$Id.Replace('\','\\')+'"'}
function Resource($Id,$Type,$Sub,$Parent,$Addr,$Hosts,$Class='Msvm_ResourceAllocationSettingData'){
 [pscustomobject]@{InstanceID=$Id;ResourceType=$Type;ResourceSubType=$Sub;Parent=$Parent;AddressOnParent=$Addr;HostResource=$Hosts;CimClass=[pscustomobject]@{CimClassName=$Class}}
}
$r5Settings=[pscustomobject]@{InstanceID='Microsoft:'+ $r5VmId;VirtualSystemIdentifier=[string]$r5VmId;VirtualSystemType='Microsoft:Hyper-V:System:Realized';VirtualSystemSubType='Microsoft:Hyper-V:SubType:2';BIOSGUID='D00FD8A4-6628-433C-BD34-00A7CB7DD174'}
$r5Cpu=Resource 'vm\cpu' 3 'processor' '' '' @()
$r5Mem=Resource 'vm\memory' 4 'memory' '' '' @()
$r5Ctl=Resource 'vm\scsi' 6 'Microsoft:Hyper-V:Synthetic SCSI Controller' '' '' @()
$r5Hdd=Resource 'vm\scsi\0\0\D' 17 'Microsoft:Hyper-V:Synthetic Disk Drive' (Ref $r5Ctl.InstanceID) '0' @()
$r5Dvd1=Resource 'vm\scsi\0\1\D' 16 'Microsoft:Hyper-V:Synthetic DVD Drive' (Ref $r5Ctl.InstanceID) '1' @()
$r5Dvd2=Resource 'vm\scsi\0\2\D' 16 'Microsoft:Hyper-V:Synthetic DVD Drive' (Ref $r5Ctl.InstanceID) '2' @()
$r5Image=Resource 'vm\image' 31 'Microsoft:Hyper-V:Virtual Hard Disk' (Ref $r5Hdd.InstanceID) '' @($r5Vhd) 'Msvm_StorageAllocationSettingData'
$r5Media=Resource 'vm\iso' 31 'Microsoft:Hyper-V:Virtual CD/DVD Disk' (Ref $r5Dvd1.InstanceID) '' @($r5Iso) 'Msvm_StorageAllocationSettingData'
function Get-CimInstance {param($Namespace,$ClassName,$Filter,$OperationTimeoutSec);[pscustomobject]@{Name=[string]$r5VmId;ElementName=$r5VmName;EnabledState=3}}
function Get-CimAssociatedInstance{
 param($InputObject,$Association,$ResultClassName,$OperationTimeoutSec)
 if($Association -eq 'Msvm_SettingsDefineState'){return $r5Settings}
 if($Association -eq 'Msvm_AffectedJobElement'){return}
 if($r5Case -eq 'query-error'){throw 'SYNTHETIC_ASSOCIATION_ERROR'}
 if($r5Case -eq 'empty-components'){return}
 $r5Rows=@($r5Cpu,$r5Mem,$r5Ctl,$r5Hdd,$r5Dvd1,$r5Dvd2,$r5Image)
 if($r5Case -eq 'missing-dvd'){$r5Rows=@($r5Rows|Where-Object InstanceID -ne $r5Dvd2.InstanceID)}
 if($r5Case -eq 'mounted-own'){$r5Rows+= $r5Media}
 if($r5Case -eq 'foreign-media'){$r5Rows+=Resource 'vm\foreign' 31 'Microsoft:Hyper-V:Virtual CD/DVD Disk' (Ref $r5Dvd1.InstanceID) '' @('foreign.iso') 'Msvm_StorageAllocationSettingData'}
 if($ResultClassName -eq 'Msvm_StorageAllocationSettingData'){return @($r5Rows|Where-Object {$_.CimClass.CimClassName -eq $ResultClassName})}
 return $r5Rows
}
$r5Results=@(foreach($r5Case in @('complete-empty-dvd','mounted-own','query-error','empty-components','missing-dvd','foreign-media','snapshot')){
 $r5Settings.VirtualSystemType=if($r5Case -eq 'snapshot'){'Microsoft:Hyper-V:Snapshot:Realized'}else{'Microsoft:Hyper-V:System:Realized'}
 $r5Result=Get-R5ProviderStorage $r5Case
 $r5Expected=$r5Case -in @('complete-empty-dvd','mounted-own')
 if($r5Result.valid -ne $r5Expected){throw ('Guard mismatch '+$r5Case+': '+($r5Result.violations -join ';'))}
 if($r5Case -eq 'mounted-own' -and $r5Result.mountedIsoPaths.Count -ne 1){throw 'Mounted media lost'}
 [pscustomobject]@{case=$r5Case;pass=$true;expectedValid=$r5Expected;actualValid=$r5Result.valid;querySucceeded=$r5Result.querySucceeded;violations=$r5Result.violations}
})
$r5Receipt=@{at=[DateTimeOffset]::Now.ToString('o');scope='HOST_SYNTHETIC_PROVIDER_GUARD_ONLY';helperSha256=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant();parserErrors=0;cases=$r5Results;vmCalls=0;productTests=0;runtimeReadback='NOT_YET_EXECUTED'}
$r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($r5Receipt|ConvertTo-Json -Depth 12))
$r5Stream=[IO.File]::Open((Join-Path $r5Here 'guard-checks.json'),[IO.FileMode]::CreateNew)
try{$r5Stream.Write($r5Bytes);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}
$r5Receipt|ConvertTo-Json -Depth 12
