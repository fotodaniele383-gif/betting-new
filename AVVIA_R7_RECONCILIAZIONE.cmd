@echo off
setlocal
cd /d "%~dp0"
set "BETTINGAPP_ROOT=%~dp0"
set "BETTINGAPP_R7_OPEN_BROWSER=1"
node "%~dp0addons\reliability-r7\server.cjs"
set "RC=%ERRORLEVEL%"
echo R7_SERVER_EXIT_CODE=%RC%
echo Premi un tasto dopo aver letto i messaggi.
pause
exit /b %RC%
