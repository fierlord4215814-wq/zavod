$ErrorActionPreference='Stop'
$opsRuntime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$opsOwner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$opsAllowed=@{$opsOwner='current Windows owner';'S-1-5-18'='SYSTEM';'S-1-5-32-544'='Administrators'}
$opsRows=@()
foreach($part in @('pair-ops01','pair-ops01\t1.dump','pair-ops01\uploads','ops01','ops01\uploads','ops01\error-reports-export')){
 $resolved=(Resolve-Path -LiteralPath (Join-Path $opsRuntime $part)).Path
 if(-not $resolved.StartsWith($opsRuntime+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside owned runtime'}
 $rules=@();foreach($rule in (Get-Acl -LiteralPath $resolved).Access){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($rule.AccessControlType -eq 'Allow' -and -not $opsAllowed.ContainsKey($sid)){throw 'Unexpected ACL principal'};$rules+=[pscustomobject]@{principal=$opsAllowed[$sid];type=$rule.AccessControlType.ToString();rights=$rule.FileSystemRights.ToString();inherited=$rule.IsInherited}}
 $opsRows+=[pscustomobject]@{relative=$part;rules=$rules}
}
[pscustomobject]@{status='PASS_OWNER_SYSTEM_ADMIN_ONLY';secretValuesRead=$false;permissionsChanged=$false;observations=$opsRows}|ConvertTo-Json -Depth 8|Out-File -LiteralPath (Join-Path $PSScriptRoot 'acl-readback.json') -Encoding utf8
'PASS_OWNER_SYSTEM_ADMIN_ONLY'
