$ErrorActionPreference='Stop'
$factory01Runtime='C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1'
$factory01Owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@{$factory01Owner='current Windows owner';'S-1-5-18'='SYSTEM';'S-1-5-32-544'='Administrators'}
$observations=@()
foreach($relative in @('','secrets','credential-index.json','pair-restore','pair-restore\protected-config','pair-restore\protected-config\secrets','pair-handoverrestore\protected-config')){
 $target=if($relative){Join-Path $factory01Runtime $relative}else{$factory01Runtime}
 $resolved=(Resolve-Path -LiteralPath $target).Path
 if($resolved -cne $factory01Runtime -and -not $resolved.StartsWith($factory01Runtime+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside owned runtime'}
 $acl=Get-Acl -LiteralPath $resolved
 $rules=@()
 foreach($rule in $acl.Access){
  $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($rule.AccessControlType -eq 'Allow' -and -not $allowed.ContainsKey($sid)){throw "Unexpected allowed identity on owned protected path: $relative"}
  $rules+=[pscustomobject]@{principal=$allowed[$sid];type=$rule.AccessControlType.ToString();rights=$rule.FileSystemRights.ToString();inherited=$rule.IsInherited}
 }
 $observations+=[pscustomobject]@{relative=$relative;rules=$rules}
}
$result=[pscustomobject]@{status='PASS_OWN_RUNTIME_PAIR_CONFIG_ACL_OWNER_SYSTEM_ADMIN_ONLY';atUtc=[DateTime]::UtcNow.ToString('o');observations=$observations;secretValuesRead=$false;permissionsChanged=$false}
$result|ConvertTo-Json -Depth 8|Out-File -LiteralPath (Join-Path $PSScriptRoot 'protected-pair-acl.json') -Encoding utf8
$result|Select-Object status,secretValuesRead,permissionsChanged|ConvertTo-Json
