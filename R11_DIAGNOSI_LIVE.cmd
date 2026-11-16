@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
node "%ROOT%addons\data-first-r11\live.cjs" "%ROOT%" >"%LOCALAPPDATA%\BettingApp_R11_LIVE_ULTIMO.log" 2>&1
set "ERR=%ERRORLEVEL%"
type "%LOCALAPPDATA%\BettingApp_R11_LIVE_ULTIMO.log"
echo R11_EXIT_CODE=%ERR%
pause
exit /b %ERR%
