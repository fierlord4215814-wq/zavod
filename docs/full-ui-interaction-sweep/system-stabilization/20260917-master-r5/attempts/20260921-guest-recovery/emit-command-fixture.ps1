# Pure fake-object reconstruction only. Never invoke create-seed-media.ps1.
param([string]$VmId='11111111-2222-4333-8444-555555555555')
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) '20260920-vm-control/r5-late-commands.ps1')
$r5Vm=[pscustomobject]@{vmId=$VmId}
$r5Fixed=New-R5LateCommands -VmId $r5Vm.vmId
$r5Legacy=@('sh','-c','install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance')
$r5RoundTrip=@{autoinstall=@{'late-commands'=$r5Fixed}}|ConvertTo-Json -Depth 10|ConvertFrom-Json
@{vmId=$VmId;legacyArgv=$r5Legacy;config=$r5RoundTrip;types=@($r5Fixed|ForEach-Object {@{count=$_.Count;argv=@($_|ForEach-Object {@{type=$_.GetType().FullName;value=$_}})}});powershellVersion=$PSVersionTable.PSVersion.ToString();sideEffects=$false}|ConvertTo-Json -Depth 12
