# Evidence-only ZIP creation and full byte readback. Run in the existing permitted PowerShell host.
# No installers, reboot, app/DB processes, network or product tests.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$r5Attempt=[IO.Path]::GetFullPath($PSScriptRoot)
$r5Batch=(Get-Item -LiteralPath $r5Attempt).Parent.Parent.FullName
$r5Prefix='attempts/20260918-hyperv-ubuntu24/'
$r5ZipPath=Join-Path $r5Batch 'zavod-master-r5-hyperv-reboot-20260919.zip'
$r5ManifestPath=Join-Path $r5Attempt 'package-manifest.json'
$r5ReceiptPath=Join-Path $r5Attempt 'package-receipt.json'
foreach($r5Target in @($r5ZipPath,$r5ManifestPath,$r5ReceiptPath)){if(Test-Path -LiteralPath $r5Target){throw ('Preserve existing artifact; no automatic overwrite: '+$r5Target)}}
$r5Prior=Get-Content -LiteralPath (Join-Path $r5Batch 'package-receipt.json') -Raw | ConvertFrom-Json
if((Get-FileHash -LiteralPath (Join-Path $r5Batch 'zavod-master-r5-checkpoint.zip') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Prior.sha256){throw 'Historical ZIP changed'}
$r5Entries=@();$r5Excluded=@();$r5SecretFindings=@()
foreach($r5File in (Get-ChildItem -LiteralPath $r5Batch -Recurse -File | Sort-Object FullName)){
 $r5Relative=$r5File.FullName.Substring($r5Batch.Length+1).Replace('\','/')
 $r5Reason=$null
 if($r5Relative -match '(?i)\.(zip|tgz|tar|iso|vhd|vhdx)$'){$r5Reason='Retain original archive/image outside new review ZIP'}
 if($r5Relative.StartsWith($r5Prefix+'public-metadata/package/dist/')){$r5Reason='Third-party verifier executable excluded; official integrity metadata and license included'}
 if($null -ne $r5Reason){$r5Excluded+=@{path=$r5Relative;bytes=$r5File.Length;reason=$r5Reason};continue}
 if($r5Relative -match '(?i)(^|/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*)(/|$)' -or $r5Relative -match '(?i)\.(pem|pfx|p12|key|dump|bak|db|sqlite)$'){throw ('Prohibited package path: '+$r5Relative)}
 $r5Walk=$r5File.FullName
 while($r5Walk -ne $r5Batch){if(((Get-Item -LiteralPath $r5Walk).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw ('Reparse path: '+$r5Relative)};$r5Walk=Split-Path -Parent $r5Walk}
 if($r5File.Length -gt 20MB){throw ('Unexpected large evidence file; review before packaging: '+$r5Relative)}
 if($r5File.Extension -notin @('.md','.txt','.json','.cjs','.ps1','.csv','.diff','.log','.asc','.gpg','.sig','.sha256') -and $r5File.Name -notin @('LICENSE','SHA256SUMS','ubuntu-SHA256SUMS')){throw ('Unreviewed file type: '+$r5Relative)}
 $r5Content=[IO.File]::ReadAllText($r5File.FullName)
 $r5Patterns=@{
  privateKey='-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----';
  databaseCredentialUrl='postgres(?:ql)?://[^\s/:"''<>]+:[^\s@"''<>]+@';
  jwtValue='\beyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\b';
  knownProviderSecret='\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b'
 }
 foreach($r5Kind in $r5Patterns.Keys){if($r5Content -match $r5Patterns[$r5Kind]){$r5SecretFindings+=@{path=$r5Relative;kind=$r5Kind}}}
 $r5Entries+=[PSCustomObject]@{name=$r5Relative;bytes=$r5File.Length;sha256=(Get-FileHash -LiteralPath $r5File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
if($r5SecretFindings.Count -gt 0){$r5SecretFindings|ConvertTo-Json -Depth 4;throw 'Potential sensitive bytes found; ZIP not created; values never emitted'}
$r5Manifest=@{at=[DateTimeOffset]::Now.ToString('o');kind='SAME_MASTER_R5_HYPERV_MANUAL_REBOOT_BOUNDARY_NOT_LIVE_ACCEPTANCE';entries=$r5Entries;excluded=$r5Excluded;priorZipSha256=$r5Prior.sha256;scan=@{allowedEvidencePaths=$true;reparsePaths=0;potentialSecretMatches=0;scope='Targeted private-key/credential-URL/JWT/provider-key scan, plus evidence-only allowlist; not a complete product security audit'};selfHash='Recorded externally in package-receipt.json; no circular self-hash';noProductTests=$true}
[IO.File]::WriteAllText($r5ManifestPath,($r5Manifest|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$r5All=@($r5Entries)+@([PSCustomObject]@{name=$r5Prefix+'package-manifest.json';bytes=(Get-Item -LiteralPath $r5ManifestPath).Length;sha256=(Get-FileHash -LiteralPath $r5ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()})
$r5Archive=[IO.Compression.ZipFile]::Open($r5ZipPath,[IO.Compression.ZipArchiveMode]::Create)
try{foreach($r5Item in $r5All){
 $r5Path=Join-Path $r5Batch $r5Item.name
 if((Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Item.sha256){throw ('Payload changed after manifest: '+$r5Item.name)}
 [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($r5Archive,$r5Path,$r5Item.name,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
}}finally{$r5Archive.Dispose()}
$r5Zip=[IO.Compression.ZipFile]::OpenRead($r5ZipPath);$r5Readback=@()
try{
 if($r5Zip.Entries.Count -ne $r5All.Count -or ($r5Zip.Entries.FullName|Sort-Object -Unique).Count -ne $r5All.Count){throw 'ZIP count/uniqueness mismatch'}
 foreach($r5Entry in $r5Zip.Entries){
  $r5Expected=@($r5All|Where-Object name -eq $r5Entry.FullName)
  if($r5Expected.Count -ne 1){throw 'Unexpected ZIP entry'}
  $r5Stream=$r5Entry.Open();$r5Hasher=[Security.Cryptography.SHA256]::Create()
  try{$r5Actual=[BitConverter]::ToString($r5Hasher.ComputeHash($r5Stream)).Replace('-','').ToLowerInvariant()}finally{$r5Stream.Dispose();$r5Hasher.Dispose()}
  if($r5Actual -ne $r5Expected[0].sha256 -or $r5Entry.Length -ne $r5Expected[0].bytes){throw ('ZIP byte mismatch: '+$r5Entry.FullName)}
  $r5Readback+=[PSCustomObject]@{name=$r5Entry.FullName;bytes=$r5Entry.Length;sha256=$r5Actual;matches=$true}
 }
}finally{$r5Zip.Dispose()}
$r5Receipt=@{at=[DateTimeOffset]::Now.ToString('o');path=$r5ZipPath;bytes=(Get-Item -LiteralPath $r5ZipPath).Length;sha256=(Get-FileHash -LiteralPath $r5ZipPath -Algorithm SHA256).Hash.ToLowerInvariant();status='FULL_ENTRY_READBACK_VERIFIED';entries=$r5Readback.Count;readback=$r5Readback;priorZipUnchanged=((Get-FileHash -LiteralPath (Join-Path $r5Batch 'zavod-master-r5-checkpoint.zip') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $r5Prior.sha256);productTestsExecuted=$false;automaticReboot=$false;finalStop='STOP_AT_MANUAL_REBOOT_BOUNDARY'}
[IO.File]::WriteAllText($r5ReceiptPath,($r5Receipt|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$r5Saved=Get-Content -LiteralPath $r5ReceiptPath -Raw | ConvertFrom-Json
if($r5Saved.sha256 -ne $r5Receipt.sha256 -or $r5Saved.entries -ne $r5All.Count -or -not $r5Saved.priorZipUnchanged){throw 'Final receipt/retention readback mismatch'}
$r5Saved|Select-Object path,bytes,sha256,status,entries,priorZipUnchanged|ConvertTo-Json
