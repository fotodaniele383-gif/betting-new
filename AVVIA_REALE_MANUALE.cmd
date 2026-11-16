@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BettingApp - REALE MANUALE - 3188
set "BETTING_RUN_MODE=REAL_MANUAL"
rem Utilizza il launcher esistente per preservare .env, Node, porte e configurazioni gia collaudate.
start "" "http://127.0.0.1:3188/real-manual.html"
if exist "%~dp0AVVIA_BETTING.bat" (
  call "%~dp0AVVIA_BETTING.bat"
  exit /b %ERRORLEVEL%
)
rem Fallback per installazioni senza launcher precedente.
set "SAFE13_MANUAL_PAPER=1"
set "BETTING_DB_PATH=%CD%\backend\database_betting.db"
set "PORT=3188"
set "HOST=127.0.0.1"
node "%CD%\backend\server.js"
if errorlevel 1 echo [ERRORE] Chiudere gli altri server BettingApp prima di avviare il programma.
pause
