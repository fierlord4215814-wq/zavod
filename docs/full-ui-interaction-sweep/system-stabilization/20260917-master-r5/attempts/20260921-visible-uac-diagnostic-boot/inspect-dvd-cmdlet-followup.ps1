# Read-only managed metadata/IL of the installed Microsoft cmdlet, no VM access or cmdlet invocation.
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
if(Test-Path -LiteralPath (Join-Path $r5Here 'dvd-cmdlet-followup.json')){throw 'Inspection already saved'}
$r5Set=(Get-Command Set-VMDvdDrive).ImplementingType
$r5Get=(Get-Command Get-VMDvdDrive).ImplementingType
$r5Flags=[Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$r5Opcodes=@{}
foreach($r5Field in [Reflection.Emit.OpCodes].GetFields([Reflection.BindingFlags]'Public,Static')){$r5Op=$r5Field.GetValue($null);$r5Opcodes[([int]$r5Op.Value -band 65535)]=$r5Op}
function Read-R5Method($r5Method){
 $r5Body=$r5Method.GetMethodBody();if(-not $r5Body){return @{method=$r5Method.ToString();bodyAbsent=$true}}
 $r5Bytes=$r5Body.GetILAsByteArray();$r5Offset=0;$r5Lines=@()
 while($r5Offset -lt $r5Bytes.Length){
  $r5Start=$r5Offset;$r5Code=[int]$r5Bytes[$r5Offset++];if($r5Code -eq 254){$r5Code=65024+[int]$r5Bytes[$r5Offset++]};$r5Op=$r5Opcodes[$r5Code];$r5Operand=''
  switch($r5Op.OperandType.ToString()){
   'InlineNone' {}
   'ShortInlineI' {$r5Operand=[string][sbyte][BitConverter]::ToInt16([byte[]]@($r5Bytes[$r5Offset],$(if($r5Bytes[$r5Offset] -gt 127){255}else{0})),0);$r5Offset++}
   'ShortInlineVar' {$r5Operand=[string]$r5Bytes[$r5Offset++]}
   'InlineVar' {$r5Operand=[string][BitConverter]::ToUInt16($r5Bytes,$r5Offset);$r5Offset+=2}
   'InlineI' {$r5Operand=[string][BitConverter]::ToInt32($r5Bytes,$r5Offset);$r5Offset+=4}
   'InlineI8' {$r5Operand=[string][BitConverter]::ToInt64($r5Bytes,$r5Offset);$r5Offset+=8}
   'ShortInlineR' {$r5Operand=[string][BitConverter]::ToSingle($r5Bytes,$r5Offset);$r5Offset+=4}
   'InlineR' {$r5Operand=[string][BitConverter]::ToDouble($r5Bytes,$r5Offset);$r5Offset+=8}
   'ShortInlineBrTarget' {$r5Delta=[int]$r5Bytes[$r5Offset++];if($r5Delta -gt 127){$r5Delta-=256};$r5Operand=('IL_{0:x4}' -f ($r5Offset+$r5Delta))}
   'InlineBrTarget' {$r5Delta=[BitConverter]::ToInt32($r5Bytes,$r5Offset);$r5Offset+=4;$r5Operand=('IL_{0:x4}' -f ($r5Offset+$r5Delta))}
   'InlineSwitch' {$r5N=[BitConverter]::ToInt32($r5Bytes,$r5Offset);$r5Offset+=4;$r5Base=$r5Offset+4*$r5N;$r5Targets=@();for($r5I=0;$r5I -lt $r5N;$r5I++){$r5Targets+=('IL_{0:x4}' -f ($r5Base+[BitConverter]::ToInt32($r5Bytes,$r5Offset)));$r5Offset+=4};$r5Operand=$r5Targets -join ','}
   default {
    $r5Token=[BitConverter]::ToInt32($r5Bytes,$r5Offset);$r5Offset+=4
    try{if($r5Op.OperandType.ToString() -eq 'InlineString'){$r5Operand='"'+$r5Method.Module.ResolveString($r5Token)+'"'}else{$r5Member=$r5Method.Module.ResolveMember($r5Token,$r5Method.DeclaringType.GetGenericArguments(),$r5Method.GetGenericArguments());$r5Operand=$r5Member.DeclaringType.FullName+'::'+$r5Member.ToString()}}catch{$r5Operand=('UNRESOLVED_TOKEN_0x{0:x8}' -f $r5Token)}
   }
  }
  $r5Lines+=('IL_{0:x4}: {1} {2}' -f $r5Start,$r5Op.Name,$r5Operand)
 }
 @{type=$r5Method.DeclaringType.FullName;method=$r5Method.ToString();ilBytes=$r5Bytes.Length;instructions=$r5Lines}
}
$r5BaseType=$r5Set.Assembly.GetType('Microsoft.HyperV.PowerShell.Commands.VirtualizationCmdletBase')
$r5Resolver=$r5Set.Assembly.GetType('Microsoft.HyperV.PowerShell.Commands.ParameterResolvers')
$r5Methods=@($r5BaseType.GetMethod('IsParameterSpecified',$r5Flags))
$r5Methods+=@($r5Resolver.GetMethods($r5Flags)|Where-Object {$_.Name -eq 'ResolveVirtualMachines' -and $_.GetParameters()[0].ParameterType.Name -eq 'IVirtualMachineCmdlet'})
$r5Methods+=@([Microsoft.HyperV.PowerShell.VirtualMachineBase].GetMethods($r5Flags)|Where-Object {$_.Name -eq 'FindDrives'})

$r5Result=@{at=[DateTimeOffset]::Now.ToString('o');source='Installed Microsoft.HyperV.PowerShell.Cmdlets assembly, metadata/IL only';assembly=$r5Set.Assembly.Location;sha256=(Get-FileHash -LiteralPath $r5Set.Assembly.Location -Algorithm SHA256).Hash.ToLowerInvariant();methods=@($r5Methods|ForEach-Object {Read-R5Method $_});vmCallsExecuted=0;assemblyPatched=$false;firstMetadataListingError='Earlier non-mutating listing looked for DvdDrive in Cmdlets assembly (wrong assembly), null method-list lookup; no VM call or change'}
$r5Json=$r5Result|ConvertTo-Json -Depth 12
$r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes($r5Json);$r5Stream=[IO.File]::Open((Join-Path $r5Here 'dvd-cmdlet-followup.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$r5Stream.Write($r5Bytes,0,$r5Bytes.Length)}finally{$r5Stream.Dispose()}
$r5Json
