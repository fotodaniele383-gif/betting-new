@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
node "%ROOT%addons\reconciliation-r12\cli.cjs" "%ROOT%" --http
set "RC=%ERRORLEVEL%"
echo R12_EXIT_CODE=%RC%
pause
exit /b %RC%
