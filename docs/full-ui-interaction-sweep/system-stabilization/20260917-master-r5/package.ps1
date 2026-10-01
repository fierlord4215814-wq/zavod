# Evidence-only ZIP writer/readback. No tests, installers, services, product code, DB or network.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$r5Batch=[IO.Path]::GetFullPath($PSScriptRoot)
$r5ZipPath=Join-Path $r5Batch 'zavod-master-r5-checkpoint.zip'
$r5ManifestPath=Join-Path $r5Batch 'package-manifest.json'
$r5ReceiptPath=Join-Path $r5Batch 'package-receipt.json'
foreach($r5Target in @($r5ZipPath,$r5ManifestPath,$r5ReceiptPath)){if(Test-Path -LiteralPath $r5Target){throw ('Preserve existing artifact; no overwrite: '+$r5Target)}}
$r5Entries=@(Get-ChildItem -LiteralPath $r5Batch -Recurse -File | ForEach-Object {
 $r5Relative=$_.FullName.Substring($r5Batch.Length+1).Replace('\','/')
 if($r5Relative -match '(?i)(^|/)(\.env(?:\.[^/]*)?|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*)(/|$)' -or $r5Relative -match '(?i)\.(pem|pfx|p12|key|dump|bak|db|sqlite|zip)$'){throw ('Excluded package path: '+$r5Relative)}
 $r5Walk=$_
 while($r5Walk.FullName -ne $r5Batch){
  if(($r5Walk.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw ('Reparse point not exportable: '+$r5Relative)}
  $r5Walk=$r5Walk.Parent
  if($null -eq $r5Walk){$r5Walk=Get-Item -LiteralPath (Split-Path -Parent $_.FullName)}
 }
 [PSCustomObject]@{name=$r5Relative;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
} | Sort-Object name)
$r5Manifest=@{at=[DateTimeOffset]::Now.ToString('o');kind='R5_ENVIRONMENT_BOUNDARY_CHECKPOINT_NOT_LIVE_ACCEPTANCE';entries=$r5Entries;selfHash='Recorded externally in package-receipt.json; no circular hash';exclusions=@('.env','uploads','credentials','cookies','storageState','private keys','DB/dumps','.git','node_modules','prior screenshot ZIPs')}
[IO.File]::WriteAllText($r5ManifestPath,($r5Manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$r5All=@($r5Entries)+@([PSCustomObject]@{name='package-manifest.json';bytes=(Get-Item -LiteralPath $r5ManifestPath).Length;sha256=(Get-FileHash -LiteralPath $r5ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()})
$r5Zip=[IO.Compression.ZipFile]::Open($r5ZipPath,[IO.Compression.ZipArchiveMode]::Create)
try{foreach($r5Item in $r5All){
 $r5Path=Join-Path $r5Batch $r5Item.name
 if((Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Item.sha256){throw ('Source changed after manifest: '+$r5Item.name)}
 [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($r5Zip,$r5Path,$r5Item.name,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
}}finally{$r5Zip.Dispose()}
$r5Archive=[IO.Compression.ZipFile]::OpenRead($r5ZipPath)
$r5Readback=@()
try{
 if($r5Archive.Entries.Count -ne $r5All.Count){throw 'ZIP entry count mismatch'}
 if(($r5Archive.Entries.FullName | Sort-Object -Unique).Count -ne $r5All.Count){throw 'Duplicate ZIP entries'}
 foreach($r5Entry in $r5Archive.Entries){
  $r5Expected=@($r5All | Where-Object name -eq $r5Entry.FullName)
  if($r5Expected.Count -ne 1){throw 'Unexpected ZIP entry'}
  $r5Stream=$r5Entry.Open();$r5Hash=[Security.Cryptography.SHA256]::Create()
  try{$r5ActualHash=[BitConverter]::ToString($r5Hash.ComputeHash($r5Stream)).Replace('-','').ToLowerInvariant()}finally{$r5Stream.Dispose();$r5Hash.Dispose()}
  $r5Match=($r5ActualHash -eq $r5Expected[0].sha256 -and $r5Entry.Length -eq $r5Expected[0].bytes)
  $r5Readback += [PSCustomObject]@{name=$r5Entry.FullName;bytes=$r5Entry.Length;sha256=$r5ActualHash;matches=$r5Match}
  if(-not $r5Match){throw ('ZIP byte mismatch: '+$r5Entry.FullName)}
 }
}finally{$r5Archive.Dispose()}
$r5Receipt=@{at=[DateTimeOffset]::Now.ToString('o');path=$r5ZipPath;bytes=(Get-Item -LiteralPath $r5ZipPath).Length;sha256=(Get-FileHash -LiteralPath $r5ZipPath -Algorithm SHA256).Hash.ToLowerInvariant();status='FULL_ENTRY_READBACK_VERIFIED';entries=$r5Readback.Count;readback=$r5Readback;productTestsExecuted=$false}
[IO.File]::WriteAllText($r5ReceiptPath,($r5Receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$r5Saved=Get-Content -LiteralPath $r5ReceiptPath -Raw | ConvertFrom-Json
if($r5Saved.sha256 -ne $r5Receipt.sha256 -or $r5Saved.entries -ne $r5All.Count){throw 'Receipt readback failed'}
$r5Saved|Select-Object path,bytes,sha256,status,entries|ConvertTo-Json
