$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PilotExecutionState {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
$continuous = [uint32]2147483648
$systemRequired = [uint32]1
$requiredState = [uint32]2147483649
[PilotExecutionState]::SetThreadExecutionState($requiredState) | Out-Null
try {
  while ($true) { Start-Sleep -Seconds 30 }
} finally {
  [PilotExecutionState]::SetThreadExecutionState($continuous) | Out-Null
}
