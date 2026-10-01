# Non-elevated, exact /30 guest endpoint only. No authentication, key acceptance, proxy or LAN scan.
$ErrorActionPreference='Stop';$r5Here=$PSScriptRoot
function Save-R5([string]$Name,$Value){$r5Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 12));$r5Stream=[IO.File]::Open((Join-Path $r5Here $Name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$r5Stream.Write($r5Bytes,0,$r5Bytes.Length);$r5Stream.Flush($true)}finally{$r5Stream.Dispose()}}
if(Test-Path -LiteralPath (Join-Path $r5Here 'ssh-probe-result.json')){throw 'Exact bounded probe already has a terminal result'}
$r5Done=Get-Content -LiteralPath (Join-Path $r5Here 'helper-terminal.json') -Raw|ConvertFrom-Json
if($r5Done.status -ne 'BOUNDED_BOOT_HELPER_COMPLETED'){throw 'Boot helper incomplete: no probe until current configuration is understood'}
$r5Network=Get-Content -LiteralPath (Join-Path $r5Here 'network-before.json') -Raw|ConvertFrom-Json
$r5Config=Get-Content -LiteralPath (Join-Path $r5Here 'ssh-settings-redacted.json') -Raw|ConvertFrom-Json
if($r5Config.username -ne 'r5ops' -or $r5Network.foreignEndpointCount -ne 0 -or $r5Network.localGuestAddressCollisionCount -ne 0 -or $r5Network.wrongNeighborCount -ne 0){throw 'Exact endpoint identity prerequisites not met'}
$r5Admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($r5Admin){throw 'Do not elevate network probe to bypass a transport denial'}
$r5Latest=Get-Content -LiteralPath (Join-Path $r5Here 'vm-observation-3.json') -Raw|ConvertFrom-Json
if($r5Latest.vm.State -ne 2 -and $r5Latest.vm.State -ne 'Running'){throw 'Latest saved VM observation is not Running; do not assume SSH readiness'}
$r5Route=@(Find-NetRoute -RemoteIPAddress '10.243.53.2' -LocalIPAddress '10.243.53.1')
$r5CurrentHost=@(Get-NetIPAddress -InterfaceIndex $r5Network.hostNic.ifIndex -AddressFamily IPv4)
$r5Safe=($r5CurrentHost.Count -eq 1 -and $r5CurrentHost[0].IPAddress -eq '10.243.53.1' -and $r5CurrentHost[0].PrefixLength -eq 30 -and @($r5Route|Where-Object {$_.InterfaceIndex -ne $r5Network.hostNic.ifIndex}).Count -eq 0 -and $r5Route.Count -gt 0)
Save-R5 'ssh-route.json' @{at=[DateTimeOffset]::Now.ToString('o');exactDestination='10.243.53.2:22';boundSource='10.243.53.1';interfaceIndex=$r5Network.hostNic.ifIndex;route=@($r5Route|Select-Object IPAddress,DestinationPrefix,NextHop,InterfaceIndex,RouteMetric);safeOwnInterface=$r5Safe;networkChanged=$false;elevated=$r5Admin}
if(-not $r5Safe){Save-R5 'ssh-probe-result.json' @{at=[DateTimeOffset]::Now.ToString('o');status='NO_CONFIRMED_OWN_ROUTE';attempts=0;authenticationAttempted=$false;guestSshBroken=$null};exit 2}
$r5Results=@();$r5Status='UNVERIFIED';$r5Watch=[Diagnostics.Stopwatch]::StartNew()
foreach($r5Attempt in 1..3){
 if($r5Attempt -gt 1){Start-Sleep -Seconds 10}
 $r5Socket=[Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Stream,[Net.Sockets.ProtocolType]::Tcp)
 $r5Stage='bind';$r5Result=@{attempt=$r5Attempt;at=[DateTimeOffset]::Now.ToString('o');destination='10.243.53.2:22';boundSource='10.243.53.1';connected=$false;authenticationAttempted=$false}
 try{
  $r5Socket.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse('10.243.53.1'),0))
  $r5Stage='connect';$r5Connect=$r5Socket.ConnectAsync([Net.IPEndPoint]::new([Net.IPAddress]::Parse('10.243.53.2'),22))
  if(-not $r5Connect.Wait(5000)){$r5Status='CONNECTION_TIMEOUT';$r5Result.status=$r5Status}
  else{
   $r5Connect.GetAwaiter().GetResult();$r5Result.connected=$true
   $r5Stage='read-public-banner';$r5Socket.ReceiveTimeout=3000;$r5Buffer=New-Object byte[] 512
   $r5Count=$r5Socket.Receive($r5Buffer)
   $r5Banner=([Text.Encoding]::ASCII.GetString($r5Buffer,0,$r5Count) -replace '[^\x20-\x7e\r\n]','?').Trim()
   $r5Result.publicBanner=$r5Banner
   $r5Status=$(if($r5Banner -match '^SSH-2\.0-'){'SSH_BANNER_REACHED_HOSTKEY_NOT_VERIFIED'}else{'TCP_CONNECTED_PROTOCOL_UNVERIFIED'})
   $r5Result.status=$r5Status
  }
 }catch{
  $r5Error=$_.Exception;while($r5Error.InnerException){$r5Error=$r5Error.InnerException}
  $r5Result.error=$r5Error.Message;$r5Result.exceptionType=$r5Error.GetType().FullName;$r5Result.stage=$r5Stage
  if($r5Error -is [Net.Sockets.SocketException]){
   $r5Result.socketError=$r5Error.SocketErrorCode.ToString();$r5Result.nativeErrorCode=$r5Error.NativeErrorCode
   $r5Status=switch($r5Error.SocketErrorCode.ToString()){'AccessDenied'{'WSAEACCES_BEFORE_SSH'};'ConnectionRefused'{'CONNECTION_REFUSED'};'TimedOut'{'CONNECTION_TIMEOUT'};'NetworkUnreachable'{'NETWORK_UNREACHABLE'};'HostUnreachable'{'HOST_UNREACHABLE'};default{'SOCKET_ERROR_UNCLASSIFIED'}}
  }else{$r5Status='LOCAL_PROBE_ERROR'}
  $r5Result.status=$r5Status
 }finally{$r5Socket.Dispose()}
 $r5Results+=$r5Result;Save-R5 ('ssh-probe-'+$r5Attempt+'.json') $r5Result
 if($r5Result.connected -or $r5Status -notin @('CONNECTION_TIMEOUT','CONNECTION_REFUSED')){break}
}
Save-R5 'ssh-probe-result.json' @{at=[DateTimeOffset]::Now.ToString('o');status=$r5Status;attempts=$r5Results.Count;elapsedMs=$r5Watch.ElapsedMilliseconds;results=$r5Results;authenticationAttempted=$false;serverHostKeyVerified=$false;hostKeyCheckingDisabled=$false;guestSshBroken=$null;nativeApprovalAvailable='No per-destination escalation API in current exec tool/approval never; no security bypass attempted';workingDbAccessed=$false}
Get-Content -LiteralPath (Join-Path $r5Here 'ssh-probe-result.json') -Raw
