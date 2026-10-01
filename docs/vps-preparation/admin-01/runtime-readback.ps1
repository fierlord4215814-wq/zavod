$ErrorActionPreference='Stop'
$listeners=foreach($port in 3000,5173,15436){
  $rows=@(Get-NetTCPConnection -State Listen -LocalPort $port)
  if($rows.Count -ne 1 -or $rows[0].LocalAddress -ne '127.0.0.1'){throw "Unexpected listener at $port"}
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($rows[0].OwningProcess)"
  [pscustomobject]@{port=$port;address=$rows[0].LocalAddress;pid=$proc.ProcessId;createdUtc=$proc.CreationDate.ToUniversalTime().ToString('o');executable=$proc.ExecutablePath;command=$proc.CommandLine}
}
if(($listeners|Where-Object port -eq 15436).command -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'Own pgdata mismatch'}
if((Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne 'LOCAL03-20260924-C1'){throw 'C1 version mismatch'}
$syntaxErrors=$null;$tokens=$null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'stop-stand.ps1'),[ref]$tokens,[ref]$syntaxErrors)|Out-Null
if($syntaxErrors.Count){throw 'Stop script parse error'}
$result=[pscustomobject]@{atUtc=[DateTime]::UtcNow.ToString('o');listeners=$listeners;stopScript='docs/vps-preparation/admin-01/stop-stand.ps1';stopScriptSyntaxErrors=0;stopExecuted=$false}
$result|ConvertTo-Json -Depth 5|Out-File -LiteralPath (Join-Path $PSScriptRoot 'runtime-readback.json') -Encoding utf8
$result|ConvertTo-Json -Depth 5
