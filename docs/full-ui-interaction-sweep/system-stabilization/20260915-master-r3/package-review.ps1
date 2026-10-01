param([Parameter(Mandatory=$true)][string]$Plan, [Parameter(Mandatory=$true)][string]$Record)
$ErrorActionPreference='Stop'
$r3BatchRoot=$PSScriptRoot
$r2PackagePath=Join-Path $PSScriptRoot '../20260915-master-r2/package-review.ps1'
if((Get-FileHash -LiteralPath $r2PackagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b5b5f080ea9f2d9652c0af06a730b9dcad6e196439cefc158033a03e55fa544e'){throw 'R2 package engine changed'}
$r2PackageSource=Get-Content -LiteralPath $r2PackagePath -Raw
$r2PackageSource=$r2PackageSource.Replace('$batchRoot=[IO.Path]::GetFullPath($PSScriptRoot)','$batchRoot=[IO.Path]::GetFullPath($r3BatchRoot)')
& ([ScriptBlock]::Create($r2PackageSource)) -Plan $Plan -Record $Record
