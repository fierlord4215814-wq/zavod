$ErrorActionPreference='Stop'
$tnRuntime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$tnOwner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$tnAllowed=@{$tnOwner='current Windows owner';'S-1-5-18'='SYSTEM';'S-1-5-32-544'='Administrators'}
$tnResults=@()
foreach($part in @('pair-notify02','pair-notify02\t1.dump','pair-notify02\uploads','notify02','notify02\uploads')){
 $resolved=(Resolve-Path -LiteralPath (Join-Path $tnRuntime $part)).Path
 if(-not $resolved.StartsWith($tnRuntime+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside owned runtime'}
 $rules=@();foreach($rule in (Get-Acl -LiteralPath $resolved).Access){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($rule.AccessControlType -eq 'Allow' -and -not $tnAllowed.ContainsKey($sid)){throw 'Unexpected ACL principal'};$rules+=[pscustomobject]@{principal=$tnAllowed[$sid];type=$rule.AccessControlType.ToString();rights=$rule.FileSystemRights.ToString();inherited=$rule.IsInherited}}
 $tnResults+=[pscustomobject]@{relative=$part;rules=$rules}
}
$tnResult=[pscustomobject]@{status='PASS_OWN_COPY_PAIR_OWNER_SYSTEM_ADMIN_ONLY';secretValuesRead=$false;permissionsChanged=$false;observations=$tnResults}
$tnResult|ConvertTo-Json -Depth 8|Out-File -LiteralPath (Join-Path $PSScriptRoot 'acl-readback.json') -Encoding utf8
$tnResult.status
