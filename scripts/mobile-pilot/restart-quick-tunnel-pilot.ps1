$stop = Join-Path $PSScriptRoot 'stop-quick-tunnel-pilot.ps1'
$start = Join-Path $PSScriptRoot 'start-quick-tunnel-pilot.ps1'
& $stop
Write-Host 'Старая случайная ссылка больше не актуальна. Создаю новый Quick Tunnel...'
& $start
exit $LASTEXITCODE
