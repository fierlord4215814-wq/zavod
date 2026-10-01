@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Проверяю последний контрольный снимок...
  node backend\scripts\prepilot-snapshot.js --validate-latest --output "%~dp0backups\pre-pilot"
) else (
  echo Проверяю выбранный контрольный снимок...
  node backend\scripts\prepilot-snapshot.js --validate "%~1"
)
if errorlevel 1 (
  echo.
  echo Проверка снимка не прошла. Проверьте сообщение об ошибке выше.
  pause
  exit /b 1
)
echo.
echo Проверка снимка прошла успешно.
pause
