param([Parameter(Mandatory=$true)][string]$Plan, [Parameter(Mandatory=$true)][string]$Record)
$ErrorActionPreference='Stop'
$r4BatchRoot=$PSScriptRoot
$r4PinnedEngine=Join-Path $PSScriptRoot '../20260915-master-r2/package-review.ps1'
if((Get-FileHash -LiteralPath $r4PinnedEngine -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b5b5f080ea9f2d9652c0af06a730b9dcad6e196439cefc158033a03e55fa544e'){throw 'R2 package engine changed'}
$r4PackageSource=Get-Content -LiteralPath $r4PinnedEngine -Raw
$r4PackageSource=$r4PackageSource.Replace('$batchRoot=[IO.Path]::GetFullPath($PSScriptRoot)','$batchRoot=[IO.Path]::GetFullPath($r4BatchRoot)')
& ([ScriptBlock]::Create($r4PackageSource)) -Plan $Plan -Record $Record
