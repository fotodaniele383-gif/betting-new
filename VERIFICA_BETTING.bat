@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START_BETTING.ps1" --check
set "RC=%ERRORLEVEL%"
echo.
echo PRECHECK_CODE=%RC%
pause
exit /b %RC%
