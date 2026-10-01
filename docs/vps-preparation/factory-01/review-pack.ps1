$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$reviewRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$prefix='docs/vps-preparation/factory-01/'
$zipPath=Join-Path $PSScriptRoot 'review-pack-factory01-20260927.zip'
$receiptPath=Join-Path $PSScriptRoot 'review-pack-readback.json'
foreach($target in @($zipPath,$receiptPath)){if(Test-Path -LiteralPath $target){throw "Refusing overwrite: $target"}}
function Resolve-ReviewFile([string]$relative){
 $resolved=[IO.Path]::GetFullPath((Join-Path $reviewRoot $relative))
 if(-not $resolved.StartsWith($reviewRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Outside canonical root'}
 $entry=Get-Item -LiteralPath $resolved
 if($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Not a plain file'}
 return $resolved
}
$manifestRelative=$prefix+'review-pack-manifest.json'
$manifest=Get-Content -LiteralPath (Resolve-ReviewFile $manifestRelative) -Raw | ConvertFrom-Json
$expected=@{}
foreach($item in $manifest.entries){
 if($expected.ContainsKey($item.path)){throw 'Duplicate manifest entry'}
 $source=Resolve-ReviewFile $item.path
 if((Get-Item -LiteralPath $source).Length -ne $item.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha256){throw "Changed since preflight: $($item.path)"}
 $expected[$item.path]=$item
}
if($expected.Count -ne $manifest.count){throw 'Manifest count mismatch'}
$mf=Resolve-ReviewFile $manifestRelative
$expected[$manifestRelative]=[pscustomobject]@{path=$manifestRelative;bytes=(Get-Item -LiteralPath $mf).Length;sha256=(Get-FileHash -LiteralPath $mf -Algorithm SHA256).Hash.ToLowerInvariant()}
$zip=[IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Create)
try{foreach($relative in @($expected.Keys|Sort-Object)){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Resolve-ReviewFile $relative),$relative,[IO.Compression.CompressionLevel]::Optimal)|Out-Null}}finally{$zip.Dispose()}
$archive=[IO.Compression.ZipFile]::OpenRead($zipPath);$readback=@();$seen=@{}
try{
 if($archive.Entries.Count -ne $expected.Count){throw 'ZIP count mismatch'}
 foreach($item in $archive.Entries){
  if($seen.ContainsKey($item.FullName) -or -not $expected.ContainsKey($item.FullName)){throw 'Duplicate/unexpected ZIP entry'}
  $seen[$item.FullName]=$true;$stream=$item.Open();$hasher=[Security.Cryptography.SHA256]::Create()
  try{$digest=[Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant()}finally{$hasher.Dispose();$stream.Dispose()}
  $source=$expected[$item.FullName]
  if($item.Length -ne $source.bytes -or $digest -cne $source.sha256){throw "Full read mismatch: $($item.FullName)"}
  if((Get-FileHash -LiteralPath (Resolve-ReviewFile $item.FullName) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest){throw 'Source changed during packing'}
  $readback+=[pscustomobject]@{path=$item.FullName;bytes=$item.Length;sha256=$digest}
 }
}finally{$archive.Dispose()}
$result=[pscustomobject]@{status='PASS_FULL_ZIP_ENTRY_BYTE_SHA_READBACK';atUtc=[DateTime]::UtcNow.ToString('o');zip=$prefix+'review-pack-factory01-20260927.zip';bytes=(Get-Item -LiteralPath $zipPath).Length;sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant();entryCount=$readback.Count;fullStreamReadback=$true;duplicateOrUnexpectedEntries=0;finalSourceIdentity=$manifest.finalSourceIdentity;manifestIncluded=$true;entries=$readback}
$result|ConvertTo-Json -Depth 8|Out-File -LiteralPath $receiptPath -Encoding utf8
$result|Select-Object status,zip,bytes,sha256,entryCount,fullStreamReadback|ConvertTo-Json
