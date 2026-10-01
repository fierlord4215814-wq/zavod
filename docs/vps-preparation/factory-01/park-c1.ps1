$ErrorActionPreference='Stop'
$expected=@{3000=@('C:\Program Files\nodejs\node.exe','"C:\Program Files\nodejs\node.exe" backend/dist/main.js');5173=@('C:\Program Files\nodejs\node.exe','"C:\Program Files\nodejs\node.exe" docs/vps-preparation/local-03/frontend-preview.cjs')}
$seen=@()
foreach($port in 3000,5173,15436){
 $l=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
 if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1'){throw "C1 loopback mismatch:$port"}
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($l[0].OwningProcess)"
 if($port -eq 15436){if($p.ExecutablePath -cne 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -or $p.CommandLine -notlike '*run-20260924-0b9b24e0/pgdata*'){throw 'C1 pgdata mismatch'}}
 else{if($p.ExecutablePath -cne $expected[$port][0] -or $p.CommandLine.Trim() -cne $expected[$port][1]){throw "C1 process mismatch:$port"}}
 $seen+= [pscustomobject]@{port=$port;pid=$p.ProcessId;created=$p.CreationDate;command=$p.CommandLine}
}
if((Invoke-RestMethod 'http://127.0.0.1:3000/version').version -ne 'LOCAL03-20260924-C1'){throw 'C1 version mismatch'}
$seen | ConvertTo-Json -Depth 4 | Out-File -LiteralPath (Join-Path $PSScriptRoot 'c1-before-park.json') -Encoding utf8
foreach($r in $seen){$fresh=Get-CimInstance Win32_Process -Filter "ProcessId=$($r.pid)";if($fresh.CreationDate -ne $r.created -or $fresh.CommandLine -cne $r.command){throw 'C1 identity changed before stop'}
 if($r.port -ne 15436){Stop-Process -Id $r.pid;Wait-Process -Id $r.pid -Timeout 15 -ErrorAction SilentlyContinue}
 else{& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' stop -D 'C:\Users\79164\AppData\Local\Zavod-Local01-Functional\run-20260924-0b9b24e0\pgdata' -m fast -w -t 25;if($LASTEXITCODE -ne 0){throw 'C1 pg stop failed'}}
}
'C1_PARKED_NO_DATA_FILES_DELETED_OR_CHANGED_BY_FACTORY01'
