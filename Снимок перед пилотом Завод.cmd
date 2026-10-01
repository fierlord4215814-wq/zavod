@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Создаю контрольный снимок перед ручным пилотом...
echo Папка: %~dp0backups\pre-pilot
node backend\scripts\prepilot-snapshot.js --create --output "%~dp0backups\pre-pilot"
if errorlevel 1 (
  echo.
  echo Снимок не создан. Проверьте сообщение об ошибке выше.
  pause
  exit /b 1
)
echo.
echo Снимок создан и проверен.
pause
