# Narrow trusted host utility, not VM repair, SDK installation, or product bootstrap.
$ErrorActionPreference='Stop'
$r5Root='C:\Users\79164\Documents\work'
$r5Here=[IO.Path]::GetFullPath($PSScriptRoot)
$r5Prior=Join-Path (Split-Path $r5Here -Parent) '20260921-guest-recovery'
$r5Batch=(Get-Item -LiteralPath $r5Here).Parent.Parent.FullName
$r5Utility='C:\Users\79164\Documents\work\.r5-runtime\provisioning-install-087bc8f10ba3'
$r5GitBin='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\usr\bin'
$r5Node='C:\Users\79164\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$r5Commit='7bce035fdd241ad7d8aa9aa073a22ec6dfb64f05'
$r5Blob='087bc8f10ba3166e4694d57c06010329286d97dd'
$r5Url='https://raw.githubusercontent.com/git-for-windows/git-sdk-64/'+$r5Commit+'/usr/bin/install.exe'
if(Test-Path -LiteralPath (Join-Path $r5Here 'baseline.json')){throw 'Attempt already started; do not repeat downloads/checks'}
if(Test-Path -LiteralPath $r5Utility){throw 'Own utility directory already exists; preserve it'}
function Save-R5Bytes([string]$Path,[byte[]]$Bytes){
 [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
 $r5S=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$r5S.Write($Bytes,0,$Bytes.Length);$r5S.Flush($true)}finally{$r5S.Dispose()}
 return @{path=[IO.Path]::GetRelativePath($r5Root,$Path).Replace('\','/');bytes=$Bytes.Length;sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function Save-R5Json([string]$Name,$Value){return Save-R5Bytes (Join-Path $r5Here $Name) ([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 25)))}
function Run-R5([string]$Exe,[string[]]$Arguments,[int]$TimeoutMs){
 $r5I=[Diagnostics.ProcessStartInfo]::new($Exe);$r5I.UseShellExecute=$false;$r5I.CreateNoWindow=$true;$r5I.RedirectStandardOutput=$true;$r5I.RedirectStandardError=$true
 $r5I.WorkingDirectory=$r5Here
 $r5I.Environment['PATH']=$r5GitBin+';'+$r5Utility+';'+$r5I.Environment['PATH']
 foreach($r5Arg in $Arguments){$r5I.ArgumentList.Add($r5Arg)}
 $r5P=[Diagnostics.Process]::Start($r5I);$r5Out=$r5P.StandardOutput.ReadToEndAsync();$r5Err=$r5P.StandardError.ReadToEndAsync()
 if(-not $r5P.WaitForExit($TimeoutMs)){$r5P.Kill($true);throw 'Own host-only diagnostic process timed out'}
 $r5Result=@{pid=$r5P.Id;exe=$Exe;args=$Arguments;exitCode=$r5P.ExitCode;stdout=$r5Out.Result;stderr=$r5Err.Result;exited=$r5P.HasExited;hostOnly=$true;guestTouched=$false}
 $r5P.Dispose();return $r5Result
}
$r5OldIdent=Get-Content -LiteralPath (Join-Path $r5Prior 'final-identities.json') -Raw|ConvertFrom-Json
$r5OldDelta=Get-Content -LiteralPath (Join-Path $r5Prior 'source-delta-manifest.json') -Raw|ConvertFrom-Json
$r5Before=@($r5OldDelta.existingOwners|ForEach-Object{
 $r5Copy=Save-R5Bytes (Join-Path $r5Here ('before/'+$_.owner)) ([IO.File]::ReadAllBytes((Join-Path $r5Root $_.owner)))
 if($r5Copy.sha256 -ne $_.after.sha256){throw ('Existing owner drift before continuation: '+$_.owner)}
 @{owner=$_.owner;copy=$r5Copy}
})
foreach($r5Group in $r5OldIdent.groups){foreach($r5F in $r5Group.files){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5F.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5F.sha256){throw ('Frozen source drift: '+$r5F.owner)}}}
$r5OldPackage=Get-Content -LiteralPath (Join-Path $r5Prior 'package-receipt.json') -Raw|ConvertFrom-Json
$r5PriorZips=@($r5OldIdent.priorZips)+@(@{path=[IO.Path]::GetRelativePath($r5Root,$r5OldPackage.path).Replace('\','/');sha256=$r5OldPackage.sha256;bytes=$r5OldPackage.bytes})
foreach($r5F in @($r5OldIdent.matrices)+$r5PriorZips){if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5F.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5F.sha256){throw 'Matrix/archive retention drift'}}
Save-R5Bytes (Join-Path $r5Here 'continuation-request.txt') ([IO.File]::ReadAllBytes('C:\Users\79164\.codex\attachments\4576acc6-c0d7-42ad-931e-ea82e045f8ef\Вставленный текст.txt'))|Out-Null
Save-R5Json 'baseline.json' @{at=[DateTimeOffset]::Now.ToString('o');before=$r5Before;groups=$r5OldIdent.groups;matrices=$r5OldIdent.matrices;priorZips=$r5PriorZips;newOwners=@();priorSourceHelper=$r5OldIdent.newHelper;vmMutation=$false;productExecution=$false}|Out-Null
$r5Http=[Net.Http.HttpClient]::new();$r5Http.Timeout=[TimeSpan]::FromSeconds(20)
try{
 $r5License=$r5Http.GetStringAsync('https://www.gnu.org/licenses/gpl-3.0.txt').GetAwaiter().GetResult()
 if($r5License -notmatch 'Version 3, 29 June 2007' -or $r5License -notmatch 'permission\s+to\s+run\s+the\s+unmodified\s+Program'){throw 'GPL3 source/license validation failed'}
 $r5LicenseReceipt=Save-R5Bytes (Join-Path $r5Here 'references/GPL-3.0.txt') ([Text.UTF8Encoding]::new($false).GetBytes($r5License))
 $r5Bytes=$r5Http.GetByteArrayAsync($r5Url).GetAwaiter().GetResult()
}finally{$r5Http.Dispose()}
if($r5Bytes.Length -ne 148448 -or $r5Bytes[0] -ne 77 -or $r5Bytes[1] -ne 90){throw 'Pinned PE size/header mismatch'}
$r5BlobHeader=[Text.Encoding]::ASCII.GetBytes(('blob '+$r5Bytes.Length+[char]0))
$r5GitBlob=[Convert]::ToHexString([Security.Cryptography.SHA1]::HashData([byte[]]($r5BlobHeader+$r5Bytes))).ToLowerInvariant()
if($r5GitBlob -ne $r5Blob){throw 'Official pinned Git blob mismatch'}
$r5Binary=Save-R5Bytes (Join-Path $r5Utility 'install.exe') $r5Bytes
$r5RuntimeDll=@('msys-2.0.dll','msys-intl-8.dll','msys-iconv-2.dll')|ForEach-Object{@{path=(Join-Path $r5GitBin $_);sha256=(Get-FileHash -LiteralPath (Join-Path $r5GitBin $_) -Algorithm SHA256).Hash.ToLowerInvariant()}}
Save-R5Json 'utility-download.json' @{at=[DateTimeOffset]::Now.ToString('o');url=$r5Url;officialRepository='git-for-windows/git-sdk-64';commit=$r5Commit;expectedGitBlob=$r5Blob;actualGitBlob=$r5GitBlob;binary=$r5Binary;license=$r5LicenseReceipt;licenseId='GPL-3.0-or-later; unmodified local use, binary not redistributed in review ZIP';existingRuntimeDlls=$r5RuntimeDll;installedSdk=$false;globalPathChanged=$false;codexRuntimeChanged=$false;guestTouched=$false}|Out-Null
$r5Version=Run-R5 (Join-Path $r5Utility 'install.exe') @('--version') 8000
Save-R5Json 'install-version.json' $r5Version|Out-Null
if($r5Version.exitCode -ne 0 -or $r5Version.stdout -notmatch 'install \(GNU coreutils\)'){throw 'Official GNU install not executable in existing host runtime'}
$r5Script=Join-Path $r5Prior 'check-generator.cjs'
$r5CheckHash=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Run=Run-R5 $r5Node @($r5Script,'run-04-official-install') 45000
Save-R5Json 'generator-run.json' @{at=[DateTimeOffset]::Now.ToString('o');command=$r5Run;harnessSha256=$r5CheckHash;harnessUnmodified=$true;impact='Only host install dependency added on child PATH; same 10-case provisioning suite, not product tests';sourceGeneratorChanged=$false;actualSeedRegenerated=$false;guestRepairExecuted=$false}|Out-Null
$r5Run.stdout
if($r5Run.exitCode -ne 0){exit $r5Run.exitCode}
