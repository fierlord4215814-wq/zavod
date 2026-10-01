# One bounded official HTTP range download. Preserve the prior partial byte-for-byte; no VM/app/DB actions.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Prior=Join-Path (Split-Path -Parent $r5Here) '20260918-hyperv-ubuntu24'
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5Image=(Get-Content -LiteralPath (Join-Path $r5Prior 'image-metadata-verification.json') -Raw|ConvertFrom-Json).ubuntu
$r5Partial=Join-Path $r5Runtime 'ubuntu-24.04.5-live-server-amd64.iso.part'
$r5Tail=Join-Path $r5Runtime 'ubuntu-24.04.5-live-server-amd64.iso.tail-20260920'
$r5Final=Join-Path $r5Runtime 'ubuntu-24.04.5-live-server-amd64.iso'
$r5Headers=Join-Path $r5Here 'image-range-headers.txt'
if($r5Image.sha256 -ne '97f3d7ffb032c3eb3b23d2c8be9cc76e60c2c1f2c0146ba5ba9fe01cafae0fd8' -or $r5Image.bytes -ne 4080486400 -or $r5Image.url -ne 'https://releases.ubuntu.com/24.04/ubuntu-24.04.5-live-server-amd64.iso'){throw 'Pinned official image mismatch'}
foreach($r5Target in @($r5Tail,$r5Final,$r5Headers,(Join-Path $r5Here 'image-range-request.json'))){if(Test-Path -LiteralPath $r5Target){throw ('Preserve existing image attempt: '+$r5Target)}}
foreach($r5Parent in @($r5Runtime,(Split-Path -Parent $r5Runtime),$r5Partial)){if(((Get-Item -LiteralPath $r5Parent).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse image target denied'}}
$r5PartialBytes=(Get-Item -LiteralPath $r5Partial).Length
if($r5PartialBytes -ne 3665735933){throw 'Prior partial size changed; inspect before resuming'}
$r5Need=$r5Image.bytes-$r5PartialBytes
$r5Free=(Get-PSDrive -Name C).Free
if($r5Free -lt (38GB+$r5Image.bytes+$r5Need)){throw 'Fresh bounded download/disk budget not satisfied'}
$r5PartHash=(Get-FileHash -LiteralPath $r5Partial -Algorithm SHA256).Hash.ToLowerInvariant()
$r5Args=@('--fail','--location','--proto','=https','--tlsv1.2','--connect-timeout','30','--max-time','900','--retry','0','--silent','--show-error','--range',($r5PartialBytes.ToString()+'-'+($r5Image.bytes-1).ToString()),'--max-filesize',$r5Need.ToString(),'--dump-header',$r5Headers,'--output',$r5Tail,$r5Image.url)
[IO.File]::WriteAllText((Join-Path $r5Here 'image-range-request.json'),(@{at=[DateTimeOffset]::Now.ToString('o');url=$r5Image.url;partialPath=$r5Partial;partialBytes=$r5PartialBytes;partialSha256=$r5PartHash;tailPath=$r5Tail;expectedTailBytes=$r5Need;fullExpectedBytes=$r5Image.bytes;fullExpectedSha256=$r5Image.sha256;freeDiskBefore=$r5Free;command='curl.exe';arguments=$r5Args;preserveOriginalPartial=$true;workingDbAccessed=$false}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$r5CurlExit=$null
try{
 & 'C:\Windows\System32\curl.exe' @r5Args
 $r5CurlExit=$LASTEXITCODE
 if($r5CurlExit -ne 0){throw ('Range curl exit '+$r5CurlExit+'; all original and new partial bytes retained')}
 $r5HeaderText=Get-Content -LiteralPath $r5Headers -Raw
 $r5ExpectedRange='Content-Range: bytes '+$r5PartialBytes+'-'+($r5Image.bytes-1)+'/'+$r5Image.bytes
 if($r5HeaderText -notmatch '(?m)^HTTP/[0-9.]+ 206' -or $r5HeaderText.IndexOf($r5ExpectedRange,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or (Get-Item -LiteralPath $r5Tail).Length -ne $r5Need){throw 'Exact HTTP206 Content-Range and length not proven'}
 if((Get-FileHash -LiteralPath $r5Partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r5PartHash){throw 'Original partial changed; no assembly'}
 $r5Output=[IO.File]::Open($r5Final,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{foreach($r5Source in @($r5Partial,$r5Tail)){$r5Input=[IO.File]::OpenRead($r5Source);try{$r5Input.CopyTo($r5Output,1048576)}finally{$r5Input.Dispose()}}}finally{$r5Output.Dispose()}
 $r5Hash=(Get-FileHash -LiteralPath $r5Final -Algorithm SHA256).Hash.ToLowerInvariant()
 if((Get-Item -LiteralPath $r5Final).Length -ne $r5Image.bytes -or $r5Hash -ne $r5Image.sha256){throw 'Full assembled official ISO bytes/hash mismatch; do not boot'}
 $r5Result=@{at=[DateTimeOffset]::Now.ToString('o');status='FULL_OFFICIAL_IMAGE_HASH_VERIFIED_NOT_BOOTED';path=$r5Final;bytes=$r5Image.bytes;sha256=$r5Hash;curlExit=$r5CurlExit;rangeStatus='EXACT_HTTP206_BYTES_PROVEN';partialPreserved=$true;partialSha256=$r5PartHash;tailPath=$r5Tail;tailBytes=$r5Need;freeDiskAfter=(Get-PSDrive -Name C).Free;workingDbAccessed=$false}
 [IO.File]::WriteAllText((Join-Path $r5Here 'image-download-result.json'),($r5Result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 $r5Result|ConvertTo-Json -Depth 5
}catch{
 [IO.File]::WriteAllText((Join-Path $r5Here 'image-range-failure.json'),(@{at=[DateTimeOffset]::Now.ToString('o');message=$_.Exception.Message;curlExit=$r5CurlExit;automaticRetry=$false;originalPartialPreserved=$true;guestBootAllowed=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 throw
}
