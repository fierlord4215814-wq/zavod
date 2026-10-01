param([Parameter(Mandatory=$true)][string]$Receipt)
$ErrorActionPreference='Stop'
$r5Batch=[IO.Path]::GetFullPath($PSScriptRoot)
$r5ReceiptPath=[IO.Path]::GetFullPath((Join-Path $r5Batch $Receipt))
if(-not $r5ReceiptPath.StartsWith($r5Batch+[IO.Path]::DirectorySeparatorChar) -or (Test-Path -LiteralPath $r5ReceiptPath)){throw 'Expected a new in-batch receipt'}
$r5Errors=[System.Collections.Generic.List[object]]::new()
function Read-R5Inventory([string]$Name,[scriptblock]$Query){try{&$Query}catch{$r5Errors.Add(@{section=$Name;type=$_.Exception.GetType().FullName;message=$_.Exception.Message});return $null}}
$r5Registry=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$r5Principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$r5Features=@('Containers-DisposableClientVM','Microsoft-Hyper-V-All','VirtualMachinePlatform','Microsoft-Windows-Subsystem-Linux','HypervisorPlatform')
$r5Data=[ordered]@{
 at=[DateTimeOffset]::Now.ToString('o');purpose='READ_ONLY_TARGETED_COMPATIBILITY_NO_WORKING_DB_SERVICE_DATA_ACCESS';elevated=$r5Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 windows=@{EditionID=$r5Registry.EditionID;ProductName=$r5Registry.ProductName;DisplayVersion=$r5Registry.DisplayVersion;CurrentBuild=$r5Registry.CurrentBuildNumber;UBR=$r5Registry.UBR;InstallationType=$r5Registry.InstallationType}
 cpu=Read-R5Inventory 'cpu' {Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions,VMMonitorModeExtensions}
 computer=Read-R5Inventory 'computer' {Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent,TotalPhysicalMemory}
 os=Read-R5Inventory 'os' {Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,FreePhysicalMemory,LastBootUpTime}
 disk=Read-R5Inventory 'disk' {Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object DeviceID,FileSystem,Size,FreeSpace}
 features=@(foreach($r5Feature in $r5Features){Read-R5Inventory ('feature:'+ $r5Feature) {Get-WindowsOptionalFeature -Online -FeatureName $r5Feature | Select-Object FeatureName,State,RestartRequired}})
 sandboxExecutable=Test-Path -LiteralPath 'C:\Windows\System32\WindowsSandbox.exe'
 sandboxPolicy=Read-R5Inventory 'sandboxPolicy' {if(Test-Path -LiteralPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Sandbox'){Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Sandbox' | Select-Object AllowNetworking,AllowMappedFolders,AllowWriteToMappedFolders,AllowClipboardRedirection}}
 commandAvailability=@(foreach($r5Command in @('docker','podman','wsl','WindowsSandbox','node')){$r5Found=Get-Command $r5Command -ErrorAction SilentlyContinue;@{name=$r5Command;path=$r5Found.Source;present=[bool]$r5Found}})
 errors=$r5Errors
}
[IO.File]::WriteAllText($r5ReceiptPath,($r5Data|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
$r5Data|ConvertTo-Json -Depth 7
