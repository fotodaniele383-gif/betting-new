@echo off
setlocal EnableExtensions
set "ROOT=C:\Users\pc-user\Documents\Personale\BettingApp\BettingApp v2"
if not exist "%ROOT%\backend\public\index-r9.html" (echo R9_UI_NOT_INSTALLED&pause&exit /b 2)
start "" "http://127.0.0.1:3188/index-r9.html"
echo R9_UI_OPEN_COMMAND_SENT. Server BettingApp 3188 deve essere attivo.
pause
