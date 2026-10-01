# Pinned pure-JS parser for provisioning-fixture verification only. No npm install/hooks.
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
$r5Root='C:\Users\79164\Documents\work\.r5-runtime\provisioning-checks-yaml-2.8.1'
$r5Receipt=Join-Path $r5Here 'yaml-parser-receipt.json'
if((Test-Path -LiteralPath $r5Root) -or (Test-Path -LiteralPath $r5Receipt)){throw 'Preserve existing parser preparation'}
New-Item -ItemType Directory -Path $r5Root|Out-Null
$r5Archive=Join-Path $r5Root 'yaml-2.8.1.tgz'
$r5Url='https://registry.npmjs.org/yaml/-/yaml-2.8.1.tgz'
Invoke-WebRequest -Uri $r5Url -OutFile $r5Archive -TimeoutSec 30
$r5Digest=[Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($r5Archive))
$r5Integrity='sha512-'+[Convert]::ToBase64String($r5Digest)
if($r5Integrity -ne 'sha512-lcYcMxX2PO9XMGvAJkJ3OsNMw+/7FKes7/hgerGUYWIoWu5j/+YQqcZr5JnPZWzOsEBgMbSbiSTn/dv/69Mkpw=='){throw 'Official registry integrity mismatch'}
$r5Entries=@(& 'C:\Windows\System32\tar.exe' -tzf $r5Archive)
if($LASTEXITCODE -ne 0){throw 'Archive listing failed'}
foreach($r5Entry in $r5Entries){if($r5Entry -notmatch '^package/[A-Za-z0-9_.@/-]+$' -or $r5Entry -match '(^|/)\.\.(/|$)'){throw 'Unexpected archive path'}}
$r5Verbose=@(& 'C:\Windows\System32\tar.exe' -tvzf $r5Archive)
if($LASTEXITCODE -ne 0 -or @($r5Verbose|Where-Object {$_ -notmatch '^[-d]'}).Count){throw 'Unexpected non-file/directory archive entry'}
& 'C:\Windows\System32\tar.exe' -xzf $r5Archive -C $r5Root
if($LASTEXITCODE -ne 0){throw 'Parser extraction failed'}
if(@(Get-ChildItem -LiteralPath $r5Root -Recurse -Force|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Unexpected parser reparse point'}
$r5Manifest=Get-Content -LiteralPath (Join-Path $r5Root 'package/package.json') -Raw|ConvertFrom-Json
if($r5Manifest.name -ne 'yaml' -or $r5Manifest.version -ne '2.8.1' -or $r5Manifest.license -ne 'ISC'){throw 'Parser identity mismatch'}
$r5Result=@{at=[DateTimeOffset]::Now.ToString('o');status='PINNED_PURE_PARSER_READY';url=$r5Url;integrity=$r5Integrity;archiveSha256=(Get-FileHash -LiteralPath $r5Archive -Algorithm SHA256).Hash.ToLowerInvariant();entries=$r5Entries.Count;path=(Join-Path $r5Root 'package');license='ISC';installScriptsExecuted=$false;globalInstall=$false;productDependencyChanged=$false}
[IO.File]::WriteAllText($r5Receipt,($r5Result|ConvertTo-Json),[Text.UTF8Encoding]::new($false));$r5Result|ConvertTo-Json
