# Read-only compatibility check; no services/process command-lines/DB/config secrets queried.
$ErrorActionPreference='Stop'
$r5Out=Join-Path $PSScriptRoot 'host-inventory.json'
if(Test-Path -LiteralPath $r5Out){throw 'Preserve existing inventory receipt'}
$r5Windows=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select-Object ProductName,EditionID,DisplayVersion,CurrentBuild,UBR,InstallationType
$r5Cpu=Get-CimInstance Win32_Processor | Select-Object Name,AddressWidth,NumberOfCores,NumberOfLogicalProcessors,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions,VMMonitorModeExtensions
$r5Os=Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,FreePhysicalMemory,LastBootUpTime,DataExecutionPrevention_Available,DataExecutionPrevention_SupportPolicy
$r5Computer=Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory,HypervisorPresent
$r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object DeviceID,FileSystem,Size,FreeSpace
$r5Features=@(Get-CimInstance Win32_OptionalFeature -Filter "Name LIKE 'Microsoft-Hyper-V%'" | Select-Object Name,InstallState)
$r5Commands=@('ssh.exe','scp.exe','ssh-keygen.exe','tar.exe','gpg.exe' | ForEach-Object {$r5Command=Get-Command $_ -ErrorAction SilentlyContinue;[PSCustomObject]@{name=$_;present=($null -ne $r5Command);path=$r5Command.Source}})
$r5Admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$r5Receipt=@{at=[DateTimeOffset]::Now.ToString('o');purpose='READ_ONLY_HYPERV_UBUNTU24_COMPATIBILITY';windows=$r5Windows;cpu=$r5Cpu;os=$r5Os;computer=$r5Computer;disk=$r5Disk;features=$r5Features;commands=$r5Commands;actualAdministratorToken=$r5Admin;workingPostgresqlServiceDataEnvUploadsRead=$false}
[IO.File]::WriteAllText($r5Out,($r5Receipt|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
$r5Receipt|ConvertTo-Json -Depth 7
