@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "OUT=%LOCALAPPDATA%\BettingApp_R10_Diagnostica"
if not exist "%OUT%" mkdir "%OUT%"
node "%ROOT%addons\data-audit-r10\cli.cjs" "%ROOT%" "%OUT%" --http
set "RC=%ERRORLEVEL%"
echo R10_DATA_AUDIT_EXIT_CODE=%RC%
echo I report (senza credenziali) si trovano in: "%OUT%"
pause
exit /b %RC%
