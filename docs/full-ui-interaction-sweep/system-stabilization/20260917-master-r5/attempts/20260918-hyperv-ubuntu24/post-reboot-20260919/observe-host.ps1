# Read only host readiness/network collision metadata. Never query working PostgreSQL or app credentials.
$ErrorActionPreference='Stop'
$r5Output=Join-Path $PSScriptRoot 'host-observation.json'
if(Test-Path -LiteralPath $r5Output){throw 'Preserve existing host observation'}
$r5Os=Get-CimInstance Win32_OperatingSystem
$r5Cpu=Get-CimInstance Win32_Processor
$r5Host=Get-CimInstance Win32_ComputerSystem
$r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$r5Service=Get-Service -Name vmms
$r5Features=@(Get-CimInstance Win32_OptionalFeature|Where-Object Name -like 'Microsoft-Hyper-V*'|Select-Object Name,InstallState)
$r5VmHost=$null;$r5VmError=$null
try{$r5VmHost=Get-VMHost|Select-Object LogicalProcessorCount,MemoryCapacity}catch{$r5VmError=$_.Exception.Message}
$r5Result=@{at=[DateTimeOffset]::Now.ToString('o');lastBoot=$r5Os.LastBootUpTime.ToString('o');edition=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID;build=$r5Os.BuildNumber;dep=$r5Os.DataExecutionPrevention_Available;hypervisorPresent=$r5Host.HypervisorPresent;cpuReported=($r5Cpu|Select-Object Name,AddressWidth,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions,VMMonitorModeExtensions);cpuReportInterpretation='Hypervisor already running; do not treat hidden capability flags as a request to modify firmware';totalRamBytes=$r5Host.TotalPhysicalMemory;freeRamBytes=([double]$r5Os.FreePhysicalMemory*1024);freeDiskBytes=$r5Disk.FreeSpace;vmmsStatus=$r5Service.Status.ToString();features=$r5Features;hyperVModuleAvailable=[bool](Get-Module -ListAvailable Hyper-V);vmHostRead=$r5VmHost;vmHostReadError=$r5VmError;actualAdminToken=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);powershellExecutable=(Join-Path $PSHOME 'pwsh.exe');executionPolicy=(Get-ExecutionPolicy).ToString();disMRepeated=$false;workingPostgresqlQueried=$false;systemChanges=$false}
[IO.File]::WriteAllText($r5Output,($r5Result|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$r5Result|Select-Object at,lastBoot,dep,hypervisorPresent,freeRamBytes,freeDiskBytes,vmmsStatus,vmHostRead,vmHostReadError,actualAdminToken|ConvertTo-Json -Depth 5
if(-not $r5Host.HypervisorPresent -or -not $r5Os.DataExecutionPrevention_Available -or $r5Service.Status -ne 'Running' -or $r5Os.LastBootUpTime -le [datetime]'2026-09-19T14:05:30'){throw 'Host readiness/reboot not established; no repair or install'}
