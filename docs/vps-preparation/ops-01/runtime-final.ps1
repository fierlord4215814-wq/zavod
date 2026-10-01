$ErrorActionPreference='Stop'
$rows=@()
foreach($port in @(3000,5173,15437)){
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
 if($port -in @(3000,5173) -and $listeners.Count){throw "Unexpected app listener:$port"}
 foreach($l in $listeners){
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)"
  if($port -eq 15437 -and ($l.LocalAddress -ne '127.0.0.1' -or $p.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $p.CommandLine -notlike '*Zavod-Factory01/run-20260926-t1/pgdata*')){throw 'Own PG identity mismatch'}
  $rows+=[pscustomobject]@{port=$port;address=$l.LocalAddress;pid=$p.ProcessId;createdUtc=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}
 }
}
if($rows.Count -ne 1){throw 'Expected only one owned PG listener'}
$result=[pscustomobject]@{status='APPS_QUIESCED_OWN_PG_RETAINED_PENDING_REVIEW';atUtc=[DateTime]::UtcNow.ToString('o');appPortsAbsent=@(3000,5173);listeners=$rows;systemChanges=$false}
$result|ConvertTo-Json -Depth 5|Out-File -LiteralPath (Join-Path $PSScriptRoot 'runtime-final.json') -Encoding utf8
$result|ConvertTo-Json -Depth 5
