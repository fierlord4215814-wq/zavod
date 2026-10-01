# Download only the previously authenticated official Ubuntu image into a new owned runtime directory.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Attempt=Split-Path -Parent $r5Here
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5Evidence=Get-Content -LiteralPath (Join-Path $r5Attempt 'image-metadata-verification.json') -Raw | ConvertFrom-Json
$r5Image=$r5Evidence.ubuntu
if($r5Evidence.status -ne 'OFFICIAL_METADATA_VERIFIED_IMAGE_NOT_DOWNLOADED' -or $r5Image.signingKeyFingerprint -ne '843938df228d22f7b3742bc0d94aa3f0efe21092' -or $r5Image.signatures[0].verified -ne $true -or $r5Image.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Image verification prerequisite absent'}
if($r5Image.url -ne 'https://releases.ubuntu.com/24.04/ubuntu-24.04.5-live-server-amd64.iso' -or $r5Image.filename -ne 'ubuntu-24.04.5-live-server-amd64.iso'){throw 'Unexpected image target'}
foreach($r5Record in $r5Evidence.records){if((Get-FileHash -LiteralPath (Join-Path (Join-Path $r5Attempt 'public-metadata') $r5Record.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5Record.sha256){throw ('Authenticated metadata changed: '+$r5Record.name)}}
$r5Disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$r5Minimum=[double]$r5Image.bytes+16GB+4GB+256MB+1GB+10GB
if($r5Disk.FreeSpace -lt $r5Minimum){throw ('Resource boundary: need '+$r5Minimum+' free bytes, have '+$r5Disk.FreeSpace)}
$r5Request=Join-Path $r5Here 'image-download-request.json'
if(Test-Path -LiteralPath $r5Request){throw 'Prior download attempt exists; inspect before resuming'}
if(Test-Path -LiteralPath $r5Runtime){throw 'Runtime path already exists; preserve and inspect ownership'}
New-Item -ItemType Directory -Path $r5Runtime | Out-Null
$r5Part=Join-Path $r5Runtime ($r5Image.filename+'.part')
$r5Final=Join-Path $r5Runtime $r5Image.filename
$r5Args=@('--fail','--location','--proto','=https','--tlsv1.2','--connect-timeout','30','--max-time','1800','--retry','0','--max-filesize',$r5Image.bytes.ToString(),'--output',$r5Part,$r5Image.url)
$r5Plan=@{at=[DateTimeOffset]::Now.ToString('o');runtimeBefore='ABSENT';runtime=$r5Runtime;url=$r5Image.url;expectedBytes=$r5Image.bytes;expectedSha256=$r5Image.sha256;freeDiskBefore=$r5Disk.FreeSpace;minimumFreeDiskBefore=$r5Minimum;scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();command='curl.exe';arguments=$r5Args;vmCreated=$false;workingDbAccessed=$false}
[IO.File]::WriteAllText($r5Request,($r5Plan|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
$r5Exit=$null
try{
 & 'C:\Windows\System32\curl.exe' @r5Args
 $r5Exit=$LASTEXITCODE
 if($r5Exit -ne 0){throw ('Official image download exit '+$r5Exit+'; partial bytes retained')}
 $r5ActualBytes=(Get-Item -LiteralPath $r5Part).Length
 $r5Hash=(Get-FileHash -LiteralPath $r5Part -Algorithm SHA256).Hash.ToLowerInvariant()
 if($r5ActualBytes -ne $r5Image.bytes -or $r5Hash -ne $r5Image.sha256){throw 'Downloaded image bytes/hash mismatch; do not boot, preserve file'}
 $r5ResolvedPart=(Resolve-Path -LiteralPath $r5Part).Path
 if(-not $r5ResolvedPart.StartsWith($r5Runtime+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($r5Final) -ne $r5Runtime -or (Test-Path -LiteralPath $r5Final)){throw 'Final image path ownership not verified'}
 Move-Item -LiteralPath $r5ResolvedPart -Destination $r5Final
 $r5Result=@{at=[DateTimeOffset]::Now.ToString('o');status='FULL_OFFICIAL_IMAGE_HASH_VERIFIED_NOT_BOOTED';path=$r5Final;bytes=$r5ActualBytes;sha256=$r5Hash;curlExit=$r5Exit;freeDiskAfter=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace;vmCreated=$false;workingDbAccessed=$false}
 [IO.File]::WriteAllText((Join-Path $r5Here 'image-download-result.json'),($r5Result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 $r5Result|ConvertTo-Json
}catch{
 $r5Failure=@{at=[DateTimeOffset]::Now.ToString('o');status='IMAGE_DOWNLOAD_OR_VERIFY_FAILED_NO_BOOT';message=$_.Exception.Message;curlExit=$r5Exit;partialPath=$r5Part;partialExists=(Test-Path -LiteralPath $r5Part);automaticRetry=$false}
 [IO.File]::WriteAllText((Join-Path $r5Here 'image-download-failure.json'),($r5Failure|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 throw
}
