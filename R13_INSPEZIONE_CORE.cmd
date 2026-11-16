@echo off
setlocal EnableExtensions
title BETTINGAPP R13 - INSPEZIONE STATICA CORE
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
node "%ROOT%\addons\r13-ddri\cli.cjs" inspect --root "%ROOT%"
set "RC=%ERRORLEVEL%"
echo R13_INSPECT_EXIT_CODE=%RC%
pause
exit /b %RC%
