# Windows PowerShell 5.1 compatibility/validation only; never invokes the installer.
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
$r5Script=Join-Path $PSScriptRoot 'enable-hyperv.ps1'
$r5Tokens=$null;$r5Errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($r5Script,[ref]$r5Tokens,[ref]$r5Errors)
$r5Result=@{version=$PSVersionTable.PSVersion.ToString();parserErrors=@($r5Errors|Select-Object Message,@{Name='Text';Expression={$_.Extent.Text}});executionPolicy=@(Get-ExecutionPolicy -List|Select-Object Scope,ExecutionPolicy);actualAdministratorToken=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);validation=@();failure=$null}
try{
 $r5PreflightPath=Join-Path $PSScriptRoot 'preflight.json'
 $r5Preflight=Get-Content -LiteralPath $r5PreflightPath -Raw | ConvertFrom-Json
 $r5Result.preflightStatus=$r5Preflight.status
 foreach($r5Evidence in $r5Preflight.evidence){$r5Hash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r5Evidence.name) -Algorithm SHA256).Hash.ToLowerInvariant();$r5Result.validation+=@{name=$r5Evidence.name;matches=($r5Hash -eq $r5Evidence.sha256)}}
 $r5Result.scriptSha256=(Get-FileHash -LiteralPath $r5Script -Algorithm SHA256).Hash.ToLowerInvariant()
 $r5Result.preflightSha256=(Get-FileHash -LiteralPath $r5PreflightPath -Algorithm SHA256).Hash.ToLowerInvariant()
}catch{$r5Result.failure=@{type=$_.Exception.GetType().FullName;message=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber}}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'helper-readonly-diagnostics.json'),($r5Result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$r5Result|ConvertTo-Json -Depth 6
