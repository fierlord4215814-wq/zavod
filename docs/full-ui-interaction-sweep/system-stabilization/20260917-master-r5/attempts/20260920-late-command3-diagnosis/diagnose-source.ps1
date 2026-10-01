# Same MASTER R5: host-only source reconstruction and shell syntax checking.
# NEVER executes the provisioning generator, installer, payload, guest, or a shell without -n.
$ErrorActionPreference = 'Stop'
$r5Root = 'C:\Users\79164\Documents\work'
$r5Here = $PSScriptRoot
$r5Batch = Split-Path (Split-Path $r5Here -Parent) -Parent
$r5Prior = Join-Path $r5Batch 'attempts/20260920-existing-vm'
$r5Control = Join-Path $r5Batch 'attempts/20260920-vm-control'
$r5SourcePath = Join-Path $r5Control 'create-seed-media.ps1'
$r5Shell = 'C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\usr\bin\sh.exe'
if (Test-Path -LiteralPath (Join-Path $r5Here 'baseline.json')) { throw 'Preserve existing diagnosis; do not rerun' }
function Write-R5New([string]$Name, [byte[]]$Bytes) {
    $r5Output = Join-Path $r5Here $Name
    [IO.Directory]::CreateDirectory((Split-Path $r5Output -Parent)) | Out-Null
    $r5Stream = [IO.File]::Open($r5Output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $r5Stream.Write($Bytes, 0, $Bytes.Length); $r5Stream.Flush($true) } finally { $r5Stream.Dispose() }
    return [ordered]@{path=[IO.Path]::GetRelativePath($r5Root,$r5Output);bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $r5Output -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function Write-R5Json([string]$Name, $Value) {
    return Write-R5New $Name ([Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 25)))
}
function Get-R5Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$r5Identity = Get-Content -LiteralPath (Join-Path $r5Prior 'final-identities.json') -Raw | ConvertFrom-Json
$r5Delta = Get-Content -LiteralPath (Join-Path $r5Prior 'source-delta-manifest.json') -Raw | ConvertFrom-Json
$r5Before = @($r5Delta.existingOwners | ForEach-Object {
    $r5Owner = Join-Path $r5Root $_.owner
    $r5Record = Write-R5New ('before/' + $_.owner) ([IO.File]::ReadAllBytes($r5Owner))
    if ($r5Record.sha256 -ne $_.after.sha256) { throw ('Unexpected checkpoint drift: '+$_.owner) }
    [ordered]@{owner=$_.owner;copy=$r5Record}
})
$r5Groups = @($r5Identity.groups | ForEach-Object {
    $r5Group = $_
    $r5Files = @($r5Group.files | ForEach-Object {
        if ($_.owner -match '(^|[\\/])(\.env[^\\/]*|uploads|private|storageState|node_modules)([\\/]|$)') { throw 'Out-of-scope manifest path' }
        $r5Hash = Get-R5Hash (Join-Path $r5Root $_.owner)
        if ($r5Hash -ne $_.sha256) { throw ('Unexpected frozen-file drift: '+$_.owner) }
        [ordered]@{owner=$_.owner;sha256=$r5Hash;unchanged=$true}
    })
    [ordered]@{kind=$r5Group.kind;files=$r5Files}
})
$r5Matrices = @($r5Identity.matrices | ForEach-Object {
    $r5Hash = Get-R5Hash (Join-Path $r5Root $_.path)
    if ($r5Hash -ne $_.sha256) { throw 'Parent matrix drift' }
    [ordered]@{path=$_.path;sha256=$r5Hash;unchanged=$true}
})
$r5PriorPackage = Get-Content -LiteralPath (Join-Path $r5Prior 'package-receipt.json') -Raw | ConvertFrom-Json
$r5Zips = @(@($r5Identity.priorZips) + @([pscustomobject]@{path=$r5PriorPackage.path;sha256=$r5PriorPackage.sha256;bytes=$r5PriorPackage.bytes}) | ForEach-Object {
    $r5Path = if ([IO.Path]::IsPathRooted($_.path)) { $_.path } else { Join-Path $r5Root $_.path }
    $r5Hash = Get-R5Hash $r5Path
    if ($r5Hash -ne $_.sha256) { throw 'Prior package drift' }
    [ordered]@{path=[IO.Path]::GetRelativePath($r5Root,$r5Path);bytes=(Get-Item -LiteralPath $r5Path).Length;sha256=$r5Hash;unchanged=$true}
})
$r5SourceCopy = Write-R5New 'references/create-seed-media.ps1' ([IO.File]::ReadAllBytes($r5SourcePath))
$r5ArchivedSource = @($r5PriorPackage.readback | Where-Object name -eq 'attempts/20260920-vm-control/create-seed-media.ps1')
if ($r5ArchivedSource.Count -ne 1 -or $r5ArchivedSource[0].sha256 -ne $r5SourceCopy.sha256) { throw 'Generator no longer matches retained package' }
$r5SeedReceipt = Get-Content -LiteralPath (Join-Path $r5Control 'seed-media-receipt.json') -Raw | ConvertFrom-Json
$r5Vm = Get-Content -LiteralPath (Join-Path $r5Control 'vm-created.json') -Raw | ConvertFrom-Json
if ($r5Vm.vmId -ne '99a158da-c247-422c-ae11-109485a92b1f' -or $r5SeedReceipt.vmId -ne $r5Vm.vmId) { throw 'Unexpected owned VM identity' }
$r5RuntimeReceipts = @('vm-created.json','seed-media-receipt.json','vm-control-terminal.json') | ForEach-Object {
    Write-R5New ('references/'+$_) ([IO.File]::ReadAllBytes((Join-Path $r5Control $_)))
}
Write-R5New 'references/000006.result.json' ([IO.File]::ReadAllBytes((Join-Path $r5Root '.r5-runtime/master-r5-ubuntu24/control/000006.result.json'))) | Out-Null
$r5Baseline = [ordered]@{at=[DateTimeOffset]::Now.ToString('o');before=$r5Before;groups=$r5Groups;matrices=$r5Matrices;priorZips=$r5Zips;generator=$r5SourceCopy;matchesPriorPackage=$true;runtimeReceipts=$r5RuntimeReceipts;productExecuted=$false;guestInput=$false;protectedRuntimeRead=$false}
Write-R5Json 'baseline.json' $r5Baseline | Out-Null

# This is the EXACT inert expression from create-seed-media.ps1. Only its strings are constructed.
$r5OriginalExpression = @'
@('sh','-c','install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance')
'@
$r5Source = [IO.File]::ReadAllText($r5SourcePath)
$r5Line = @($r5Source -split '\r?\n' | Where-Object { $_.Trim() -eq $r5OriginalExpression.Trim() })
if ($r5Line.Count -ne 1) { throw 'Exact source expression not found once' }
$r5Original = @('sh','-c','install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance')
$r5CandidateExpression = @'
@('sh','-c',('install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance'))
'@
$r5Candidate = @('sh','-c',('install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance'))
if ($r5Original.Count -ne 5 -or $r5Candidate.Count -ne 3) { throw 'Unexpected PowerShell reconstruction' }
function Test-R5ShellSyntax([object[]]$Command) {
    if ($Command[0] -ne 'sh' -or $Command[1] -ne '-c') { throw 'Unexpected command' }
    $r5Start = [Diagnostics.ProcessStartInfo]::new()
    $r5Start.FileName = $r5Shell
    $r5Start.UseShellExecute = $false
    $r5Start.CreateNoWindow = $true
    $r5Start.WorkingDirectory = $r5Here
    $r5Start.RedirectStandardOutput = $true
    $r5Start.RedirectStandardError = $true
    $r5Start.ArgumentList.Add('-n') # REQUIRED: parse only; install/printf/redirection NEVER run.
    for ($r5Arg = 1; $r5Arg -lt $Command.Count; $r5Arg++) { $r5Start.ArgumentList.Add([string]$Command[$r5Arg]) }
    foreach ($r5EnvName in @('BASH_ENV','ENV','SHELLOPTS','BASHOPTS')) { $r5Start.Environment.Remove($r5EnvName) | Out-Null }
    $r5Process = [Diagnostics.Process]::Start($r5Start)
    $r5Out = $r5Process.StandardOutput.ReadToEndAsync()
    $r5Err = $r5Process.StandardError.ReadToEndAsync()
    if (-not $r5Process.WaitForExit(5000)) { $r5Process.Kill(); throw 'Own syntax-only subprocess timed out' }
    $r5Result = [ordered]@{pid=$r5Process.Id;arguments=@($r5Start.ArgumentList);exitCode=$r5Process.ExitCode;stdout=$r5Out.Result;stderr=$r5Err.Result;parseOnly=$true;payloadExecuted=$false;guestShell=$false;normalExit=$true}
    $r5Process.Dispose()
    return $r5Result
}
$r5Bad = Test-R5ShellSyntax $r5Original
$r5Good = Test-R5ShellSyntax $r5Candidate
if ($r5Bad.exitCode -ne 2 -or $r5Good.exitCode -ne 0) { throw 'Syntax reproduction does not match expected failure/candidate' }
$r5Result = [ordered]@{
    at=[DateTimeOffset]::Now.ToString('o');status='SOURCE_ARRAY_QUOTING_DEFECT_CONFIRMED_GUEST_BINDING_PENDING';
    source=[ordered]@{path=[IO.Path]::GetRelativePath($r5Root,$r5SourcePath);sha256=$r5SourceCopy.sha256;lineNumber=1+[array]::IndexOf(($r5Source -split '\r?\n'),$r5Line[0]);expression=$r5OriginalExpression.Trim()};
    powershell=$PSVersionTable.PSVersion.ToString();vmId=$r5Vm.vmId;
    original=[ordered]@{argumentCount=$r5Original.Count;argv=$r5Original;syntax=$r5Bad};
    candidate=[ordered]@{expression=$r5CandidateExpression.Trim();argumentCount=$r5Candidate.Count;argv=$r5Candidate;syntax=$r5Good;appliedToGenerator=$false;appliedToSeed=$false;executedInGuest=$false};
    shell=[ordered]@{path=$r5Shell;sha256=(Get-R5Hash $r5Shell);scope='Host Git sh, Bash sh-mode; NOT Ubuntu guest /bin/sh'};
    knownInputs=@('vm-created.json:vmId','installer:/run/r5-new-disk-proof from early-command','installer:mounted /target','installer:install and printf');
    privateSeedActualRead='ACCESS_DENIED_PREVIOUS_READ_IN_SAME_TURN; no ACL changes or retry';
    guestConfigurationAndStderr='NOT_YET_READ';guestCommands0to2='USER_REPORTED_SUCCESS; actual target files/users NOT_YET_READ';
    productChanges=0;productTests=0;vmMutation=$false;guestInput=$false;uac=$false;reboot=$false;reinstall=$false
}
Write-R5Json 'source-diagnosis.json' $r5Result | Out-Null
$r5OldProcess = Get-Process -Id 9056 -ErrorAction SilentlyContinue
Write-R5Json 'runtime-observation.json' ([ordered]@{at=[DateTimeOffset]::Now.ToString('o');oldPid9056Present=[bool]$r5OldProcess;terminal=(Get-Content -LiteralPath (Join-Path $r5Control 'vm-control-terminal.json') -Raw|ConvertFrom-Json);exitRequest007Exists=(Test-Path -LiteralPath (Join-Path $r5Root '.r5-runtime/master-r5-ubuntu24/control/000007.request.json'));exitResult007Exists=(Test-Path -LiteralPath (Join-Path $r5Root '.r5-runtime/master-r5-ubuntu24/control/000007.result.json'));newVmObservation=$false;freshHyperVJobsObserved=$false;vmMutation=$false;guestInput=$false;hostDbInspected=$false}) | Out-Null
[ordered]@{status=$r5Result.status;sourceLine=$r5Result.source.lineNumber;sourceSha256=$r5SourceCopy.sha256;original=$r5Result.original;candidate=$r5Result.candidate;beforeOwners=$r5Before.Count;frozenGroups=@($r5Groups|ForEach-Object {@{kind=$_.kind;count=$_.files.Count}});matrices=$r5Matrices.Count;oldZips=$r5Zips.Count} | ConvertTo-Json -Depth 9
