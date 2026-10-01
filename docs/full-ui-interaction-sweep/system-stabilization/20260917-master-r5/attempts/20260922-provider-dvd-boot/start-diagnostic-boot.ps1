# One normal scoped UAC. A cancelled request must not be retried automatically.
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
function Save-R5([string]$Name,$Value){$r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 8));$r5Stream=[IO.File]::Open((Join-Path $r5Here $Name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$r5Stream.Write($r5Bytes,0,$r5Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}}
if(Test-Path -LiteralPath (Join-Path $r5Here 'uac-request.json')){throw 'UAC already requested; inspect saved receipts, do not retry'}
$r5Script=Join-Path $r5Here 'diagnostic-boot.ps1'
$r5Tokens=$null;$r5Errors=$null;[Management.Automation.Language.Parser]::ParseFile($r5Script,[ref]$r5Tokens,[ref]$r5Errors)|Out-Null
if($r5Errors.Count){throw 'Helper syntax errors; no UAC'}
$r5Hash=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Pwsh=Join-Path $PSHOME 'pwsh.exe';$r5Signature=Get-AuthenticodeSignature -LiteralPath $r5Pwsh
if($r5Signature.Status -ne 'Valid' -or $r5Signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*'){throw 'Microsoft PowerShell signature not confirmed'}
$r5Arguments='-NoProfile -File "'+$r5Script+'" -ExpectedSha256 '+$r5Hash+' -LauncherPid '+$PID
Save-R5 'uac-request.json' @{at=[DateTimeOffset]::Now.ToString('o');launcherPid=$PID;helperSha256=$r5Hash;authority='USER_ONE_VISIBLE_UAC_C056B875_20260922';windowStyle='Normal';scope='FRESH_GUARDED_OWN_VM_PREFLIGHT_EJECT_OWN_ISOS_VHDX_FIRST_ONE_START';vmId='99a158da-c247-422c-ae11-109485a92b1f';automaticRetry=$false;executionPolicyChanged=$false;capture=$false}
try{
 $r5Process=Start-Process -FilePath $r5Pwsh -ArgumentList $r5Arguments -WorkingDirectory $r5Here -Verb RunAs -WindowStyle Normal -PassThru
 Save-R5 'uac-start.json' @{at=[DateTimeOffset]::Now.ToString('o');pid=$r5Process.Id;actualToken='See helper-start receipt'}
 Write-Output ('Visible scoped diagnostic helper PID='+$r5Process.Id)
 # Keep launcher ancestry observable while the helper checks for competing controllers.
 $r5AckDeadline=[DateTimeOffset]::Now.AddSeconds(10)
 while([DateTimeOffset]::Now -lt $r5AckDeadline -and -not(Test-Path -LiteralPath (Join-Path $r5Here 'controller-preflight.json')) -and -not(Test-Path -LiteralPath (Join-Path $r5Here 'helper-terminal.json'))){Start-Sleep -Milliseconds 250}
}catch{Save-R5 'uac-failure.json' @{at=[DateTimeOffset]::Now.ToString('o');error=$_.Exception.Message;automaticRetry=$false};throw}
