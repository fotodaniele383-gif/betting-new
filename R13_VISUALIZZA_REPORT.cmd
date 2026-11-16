@echo off
setlocal
title BETTINGAPP R13 - REPORT VIEWER
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\addons\r13-ddri\viewer.html" (
 echo R13_VIEWER_MISSING
 pause
 exit /b 1
)
start "" "%ROOT%\addons\r13-ddri\viewer.html"
exit /b 0
