# Evidence-only snapshot of the known own PID/queue/artifact metadata. No VM/DB/service mutations or working data reads.
$ErrorActionPreference='Stop'
$r5Here=$PSScriptRoot
$r5Output=Join-Path $r5Here 'final-runtime-observation.json'
if(Test-Path -LiteralPath $r5Output){throw 'Preserve existing runtime observation'}
$r5Runtime='C:\Users\79164\Documents\work\.r5-runtime\master-r5-ubuntu24'
$r5Process=Get-Process -Id 9056 -ErrorAction SilentlyContinue
$r5ProcessRecord=if($null -eq $r5Process){@{pid=9056;status='NOT_PRESENT'}}else{@{pid=$r5Process.Id;name=$r5Process.ProcessName;start=$r5Process.StartTime.ToString('o');hasExited=$r5Process.HasExited;status='PRESENT_VERIFY_RECORDED_START_IDENTITY'}}
$r5Queue=@()
foreach($r5Id in @('000001','000002','000003','000004','000005','000006','000007')){
 foreach($r5Suffix in @('request','result')){$r5Name=$r5Id+'.'+$r5Suffix+'.json';$r5Path=Join-Path (Join-Path $r5Runtime 'control') $r5Name;$r5Exists=Test-Path -LiteralPath $r5Path;$r5Queue+=@{name=$r5Name;exists=$r5Exists;bytes=$(if($r5Exists){(Get-Item -LiteralPath $r5Path).Length}else{$null});sha256=$(if($r5Exists){(Get-FileHash -LiteralPath $r5Path -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null})}}
}
$r5Artifacts=@()
foreach($r5Relative in @('ubuntu-24.04.5-live-server-amd64.iso','ubuntu-24.04.5-live-server-amd64.iso.part','ubuntu-24.04.5-live-server-amd64.iso.tail-20260920','clean-source-20260920-01.tar','vm/ubuntu24.vhdx')){$r5Path=Join-Path $r5Runtime $r5Relative;$r5File=Get-Item -LiteralPath $r5Path;$r5Artifacts+=@{relative=$r5Relative;bytes=$r5File.Length;lastWrite=$r5File.LastWriteTime.ToString('o');contentRead=$false}}
$r5Result=@{at=[DateTimeOffset]::Now.ToString('o');ownCoordinator=$r5ProcessRecord;queue=$r5Queue;artifacts=$r5Artifacts;observerUacRequestExists=(Test-Path -LiteralPath (Join-Path $r5Here 'console-observer-uac-request.json'));observerStarted=(Test-Path -LiteralPath (Join-Path $r5Here 'console-observer-start.json'));coordinatorTerminalExists=(Test-Path -LiteralPath (Join-Path $r5Here 'vm-control-terminal.json'));prepProxyStarted=(Test-Path -LiteralPath (Join-Path $r5Here 'prep-proxy-start.json'));freeDiskBytes=(Get-PSDrive -Name C).Free;guestInstallation='UNVERIFIED_NO_CONSOLE';isolation='NOT_RUN';ownAppDbFixtures=@();workingDbServiceQueried=$false;workingCleanup='UNKNOWN_NOT_INSPECTED';newForceOrKill=$false}
[IO.File]::WriteAllText($r5Output,($r5Result|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
$r5Result|Select-Object at,ownCoordinator,observerUacRequestExists,observerStarted,coordinatorTerminalExists,prepProxyStarted,freeDiskBytes,guestInstallation,isolation|ConvertTo-Json -Depth 5
