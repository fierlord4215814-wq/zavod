# Pure command construction. No filesystem, keys, media, VM, process, or guest operations.
function New-R5LateCommands {
    param(
        [Parameter(Mandatory=$true)]
        [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
        [string]$VmId
    )
    # Build ONE shell-program argument before constructing argv. A failed proof read/copy
    # must stop before writing the instance marker; never fabricate the historical proof.
    $r5ProofCommand = 'set -eu; test -f /run/r5-new-disk-proof; test "$(cat /run/r5-new-disk-proof)" = "R5_NEW_OWN_16G_DISK_ONLY"; install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "%s\n" "' + $VmId + '" > /target/etc/r5-provision-instance'
    $r5Commands = @(
        @('curtin','in-target','--target=/target','--','useradd','--create-home','--shell','/bin/bash','r5app'),
        @('curtin','in-target','--target=/target','--','useradd','--create-home','--shell','/usr/sbin/nologin','r5pg'),
        @('sh','-c','install -m 0440 /dev/null /target/etc/sudoers.d/90-r5ops; printf "r5ops ALL=(ALL) NOPASSWD:ALL\n" > /target/etc/sudoers.d/90-r5ops'),
        @('sh','-c',$r5ProofCommand)
    )
    Write-Output -NoEnumerate $r5Commands
}
