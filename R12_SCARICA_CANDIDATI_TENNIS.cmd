@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0R12_SCARICA_CANDIDATI_TENNIS.ps1"
set "RC=%ERRORLEVEL%"
echo R12_DOWNLOAD_EXIT_CODE=%RC%
pause
exit /b %RC%
