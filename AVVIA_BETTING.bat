@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BettingApp - Manuale sicura - 3188
color 0A
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START_BETTING.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo ERRORE AVVIO: controlla i messaggi qui sopra.
  pause
)
exit /b %RC%
