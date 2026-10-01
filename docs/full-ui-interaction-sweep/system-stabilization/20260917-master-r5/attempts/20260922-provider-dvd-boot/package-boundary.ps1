# Evidence-only review ZIP. No installers, VM commands, services, network, product tests or overwrites.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$r5Attempt=[IO.Path]::GetFullPath($PSScriptRoot)
$r5Batch=(Get-Item -LiteralPath $r5Attempt).Parent.Parent.FullName
$r5Prefix='attempts/20260922-provider-dvd-boot/'
$r5ZipPath=Join-Path $r5Batch 'zavod-master-r5-provider-readback-20260922.zip'
$r5ManifestPath=Join-Path $r5Attempt 'package-manifest.json'
$r5ReceiptPath=Join-Path $r5Attempt 'package-receipt.json'
foreach($r5Target in @($r5ZipPath,$r5ManifestPath,$r5ReceiptPath)){
 if(Test-Path -LiteralPath $r5Target){throw ('Preserve existing artifact; no overwrite: '+$r5Target)}
}
$r5Identities=Get-Content -LiteralPath (Join-Path $r5Attempt 'final-identities.json') -Raw | ConvertFrom-Json
$r5Runtime=Get-Content -LiteralPath (Join-Path $r5Attempt 'environment-runtime-receipt.json') -Raw | ConvertFrom-Json
$r5Delta=Get-Content -LiteralPath (Join-Path $r5Attempt 'source-delta-manifest.json') -Raw | ConvertFrom-Json
$r5Root=[IO.Path]::GetFullPath((Join-Path $r5Batch '../../../..'))
foreach($r5Prior in $r5Identities.priorZips){
 if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Prior.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Prior.sha256){throw 'Historical ZIP changed'}
}
foreach($r5Owner in $r5Delta.existingOwners){
 if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Owner.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Owner.after.sha256){throw 'Frozen report/matrix changed'}
}
foreach($r5Owner in $r5Delta.newOwners){
 if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5Owner.owner) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Owner.after.sha256){throw 'New source/report changed after freeze'}
}
foreach($r5File in $r5Identities.matrices){
 if((Get-FileHash -LiteralPath (Join-Path $r5Root $r5File.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5File.sha256){throw 'Main matrix retention drift'}
}
$r5Entries=@();$r5Excluded=@();$r5SecretFindings=@()
foreach($r5File in (Get-ChildItem -LiteralPath $r5Batch -Recurse -File | Sort-Object FullName)){
 $r5Relative=$r5File.FullName.Substring($r5Batch.Length+1).Replace('\','/')
 $r5Reason=$null
 if($r5Relative -match '/synthetic-target-[^/]+/'){$r5Reason='Own synthetic filesystem fixture retained on disk; raw test inputs/outputs and source included; not guest proof'}
 if($r5Relative -match '(?i)\.(zip|tgz|tar|iso|vhd|vhdx)$'){$r5Reason='Retain original archive/image outside new review ZIP'}
 if($r5Relative.StartsWith('attempts/20260918-hyperv-ubuntu24/public-metadata/package/dist/')){$r5Reason='Third-party verifier executable excluded; integrity metadata and license retained'}
 if($null -ne $r5Reason){$r5Excluded+=@{path=$r5Relative;bytes=$r5File.Length;reason=$r5Reason;sha256=(Get-FileHash -LiteralPath $r5File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()};continue}
 if($r5Relative -match '(?i)(^|/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*|private)(/|$)' -or $r5Relative -match '(?i)\.(pem|pfx|p12|key|dump|bak|db|sqlite)$'){throw ('Prohibited package path: '+$r5Relative)}
 $r5Walk=$r5File.FullName
 while($r5Walk -ne $r5Batch){
  if(((Get-Item -LiteralPath $r5Walk).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw ('Reparse path: '+$r5Relative)}
  $r5Walk=Split-Path -Parent $r5Walk
 }
 if($r5File.Length -gt 20MB){throw ('Unexpected large evidence file: '+$r5Relative)}
 if($r5File.Extension -notin @('.md','.txt','.json','.yaml','.cjs','.ps1','.csv','.diff','.log','.asc','.gpg','.sig','.sha256','.clixml') -and $r5File.Name -notin @('LICENSE','SHA256SUMS','ubuntu-SHA256SUMS')){throw ('Unreviewed file type: '+$r5Relative)}
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
if($r5SecretFindings.Count -gt 0){$r5SecretFindings|ConvertTo-Json -Depth 4;throw 'Potential sensitive bytes; no ZIP; values not emitted'}
$r5Manifest=@{
 at=[DateTimeOffset]::Now.ToString('o');kind='SAME_MASTER_R5_PROVIDER_READBACK_UAC_CANCELLED_NO_HELPER';
 entries=$r5Entries;excluded=$r5Excluded;priorZips=$r5Identities.priorZips;
 scan=@{allowedEvidencePaths=$true;reparsePaths=0;potentialSecretMatches=0;scope='Targeted private-key/credential-URL/JWT/provider-key scan and evidence allowlist; not product security audit'};
 selfHash='Recorded externally in package-receipt.json; no circular self-hash';
 noProductTests=$true;runtimeObservationAt=$r5Runtime.observationAt;currentVmOffProven=$r5Runtime.currentVmOffProven;
 runtimeCaution='Native UAC22Sep returned cancellation; cause unknown, launcher exited1, elevated helper/token absent. No new VM/DVD/firmware/boot/SSH/guest operations. LastVMOff21Sep231111 is historical, actualDVDstate unknown. Provider helper reviewed with7host synthetic checks only; further native UAC requires new consent.'
}
[IO.File]::WriteAllText($r5ManifestPath,($r5Manifest|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$r5All=@($r5Entries)+@([PSCustomObject]@{name=$r5Prefix+'package-manifest.json';bytes=(Get-Item -LiteralPath $r5ManifestPath).Length;sha256=(Get-FileHash -LiteralPath $r5ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()})
$r5Archive=[IO.Compression.ZipFile]::Open($r5ZipPath,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($r5Item in $r5All){
  $r5Path=Join-Path $r5Batch $r5Item.name
  if((Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Item.sha256){throw ('Payload changed after manifest: '+$r5Item.name)}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($r5Archive,$r5Path,$r5Item.name,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }
}finally{$r5Archive.Dispose()}
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
$r5PriorVerified=@()
foreach($r5Prior in $r5Identities.priorZips){
 $r5Match=(Get-FileHash -LiteralPath (Join-Path $r5Root $r5Prior.path) -Algorithm SHA256).Hash.ToLowerInvariant() -eq $r5Prior.sha256
 if(-not $r5Match){throw 'Historical ZIP changed during packaging'}
 $r5PriorVerified+=@{path=$r5Prior.path;sha256=$r5Prior.sha256;unchanged=$r5Match}
}
$r5Receipt=@{
 at=[DateTimeOffset]::Now.ToString('o');path=$r5ZipPath;bytes=(Get-Item -LiteralPath $r5ZipPath).Length;
 sha256=(Get-FileHash -LiteralPath $r5ZipPath -Algorithm SHA256).Hash.ToLowerInvariant();status='FULL_ENTRY_READBACK_VERIFIED';
 entries=$r5Readback.Count;readback=$r5Readback;priorZipsUnchanged=$r5PriorVerified;
 productTestsExecuted=$false;automaticReboot=$false;currentVmOffProven=$r5Runtime.currentVmOffProven;
 runtimeObservationAt=$r5Runtime.observationAt;shutdown=$r5Runtime.shutdown.status;
 finalStop='STOP_AT_UAC_CANCELLED_PROVIDER_READBACK'
}
[IO.File]::WriteAllText($r5ReceiptPath,($r5Receipt|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$r5Saved=Get-Content -LiteralPath $r5ReceiptPath -Raw | ConvertFrom-Json
if($r5Saved.sha256 -ne $r5Receipt.sha256 -or $r5Saved.entries -ne $r5All.Count -or @($r5Saved.priorZipsUnchanged|Where-Object {-not $_.unchanged}).Count){throw 'Final receipt/retention mismatch'}
$r5Saved|Select-Object path,bytes,sha256,status,entries,priorZipsUnchanged,currentVmOffProven,shutdown|ConvertTo-Json -Depth 4
