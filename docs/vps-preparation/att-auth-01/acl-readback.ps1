$ErrorActionPreference='Stop'
$aaRuntime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$aaOwner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$aaAllowed=@{$aaOwner='current Windows owner';'S-1-5-18'='SYSTEM';'S-1-5-32-544'='Administrators'}
$aaRows=@()
foreach($part in @('pair-attauth01','pair-attauth01\t1.dump','pair-attauth01\uploads','attauth01','attauth01\uploads')){
 $resolved=(Resolve-Path -LiteralPath (Join-Path $aaRuntime $part)).Path
 if(-not $resolved.StartsWith($aaRuntime+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside owned runtime'}
 $rules=@();foreach($rule in (Get-Acl -LiteralPath $resolved).Access){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($rule.AccessControlType -eq 'Allow' -and -not $aaAllowed.ContainsKey($sid)){throw 'Unexpected ACL principal'};$rules+=[pscustomobject]@{principal=$aaAllowed[$sid];type=$rule.AccessControlType.ToString();rights=$rule.FileSystemRights.ToString();inherited=$rule.IsInherited}}
 $aaRows+=[pscustomobject]@{relative=$part;rules=$rules}
}
[pscustomobject]@{status='PASS_OWNER_SYSTEM_ADMIN_ONLY';secretValuesRead=$false;permissionsChanged=$false;observations=$aaRows}|ConvertTo-Json -Depth 8|Out-File -LiteralPath (Join-Path $PSScriptRoot 'acl-readback.json') -Encoding utf8
'PASS_OWNER_SYSTEM_ADMIN_ONLY'
