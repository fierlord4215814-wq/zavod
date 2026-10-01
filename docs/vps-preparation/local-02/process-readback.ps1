$ErrorActionPreference = 'Stop'
$expected = @{ 3000 = 39312; 5173 = 55816; 15436 = 67088 }
$rows = foreach ($port in 3000,5173,15436) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port
  if ($listener.LocalAddress -ne '127.0.0.1' -or $listener.OwningProcess -ne $expected[$port]) { throw "Unexpected listener on $port" }
  $item = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  [PSCustomObject]@{ port=$port; address=$listener.LocalAddress; pid=$item.ProcessId; createdUtc=$item.CreationDate.ToUniversalTime().ToString('o'); executable=$item.ExecutablePath; commandLine=$item.CommandLine }
}
$receipt = [PSCustomObject]@{ observedUtc=[DateTime]::UtcNow.ToString('o'); processes=@($rows) }
$json = $receipt | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'processes.json'), $json)
$json
