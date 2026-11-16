@echo off
setlocal EnableExtensions
title BETTINGAPP R13 - AUDIT READ ONLY
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
echo R13_ROOT=%ROOT%
if not exist "%ROOT%\addons\r13-ddri\cli.cjs" goto :ERROR
node "%ROOT%\addons\r13-ddri\cli.cjs" audit --root "%ROOT%" --run-r12
set "RC=%ERRORLEVEL%"
goto :DONE
:ERROR
set "RC=1"
echo R13_CLI_MISSING
:DONE
echo R13_EXIT_CODE=%RC%
pause
exit /b %RC%
