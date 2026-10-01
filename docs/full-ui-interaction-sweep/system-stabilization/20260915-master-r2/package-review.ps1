param([Parameter(Mandatory=$true)][string]$Plan, [Parameter(Mandatory=$true)][string]$Record)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$batchRoot=[IO.Path]::GetFullPath($PSScriptRoot)
$workspaceRoot=[IO.Path]::GetFullPath((Join-Path $batchRoot '../../../..'))
$planPath=[IO.Path]::GetFullPath((Join-Path $batchRoot $Plan))
$recordPath=[IO.Path]::GetFullPath((Join-Path $batchRoot $Record))
if(-not $planPath.StartsWith($batchRoot+[IO.Path]::DirectorySeparatorChar) -or -not $recordPath.StartsWith($batchRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Out-of-batch plan/record'}
if([IO.File]::Exists($recordPath)){throw 'Immutable record already exists'}
$data=Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$records=@()
foreach($part in $data.parts){
  if($part.name -notmatch '^[a-z0-9-]+\.zip$'){throw 'Invalid archive name'}
  $zipPath=Join-Path $batchRoot $part.name
  $file=[IO.File]::Open($zipPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try{
    $archive=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$true)
    try{foreach($entry in $part.entries){
      $source=[IO.Path]::GetFullPath((Join-Path $workspaceRoot $entry.source))
      if(-not $source.StartsWith($workspaceRoot+[IO.Path]::DirectorySeparatorChar) -or $entry.name -match '(^|/)\.\.(/|$)|(^|/)(\.env|uploads|node_modules|storageState|cookies)(/|\.|$)'){throw 'Unsafe archive entry'}
      if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw "Changed input: $($entry.source)"}
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source,$entry.name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }}finally{$archive.Dispose()}
  }finally{$file.Dispose()}
  $archive=[IO.Compression.ZipFile]::OpenRead($zipPath)
  try{
    if($archive.Entries.Count -ne $part.entries.Count){throw 'ZIP count mismatch'}
    foreach($expected in $part.entries){
      $entry=$archive.GetEntry($expected.name);if($null -eq $entry){throw 'Missing ZIP entry'}
      $stream=$entry.Open();$hash=[Security.Cryptography.SHA256]::Create()
      try{$actual=[Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}
      if($actual -ne $expected.sha256){throw "ZIP readback mismatch: $($expected.name)"}
    }
  }finally{$archive.Dispose()}
  $records+=@{name=$part.name;bytes=(Get-Item -LiteralPath $zipPath).Length;sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant();entries=$part.entries.Count;readback='ALL_ENTRIES_SHA256_VERIFIED'}
}
[IO.File]::WriteAllText($recordPath,(@{at=[DateTimeOffset]::Now.ToString('o');parts=$records;planSha256=(Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$records | ConvertTo-Json -Depth 6
