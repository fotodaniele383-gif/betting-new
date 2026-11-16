@echo off
setlocal EnableExtensions
set "ROOT=C:\Users\pc-user\Documents\Personale\BettingApp\BettingApp v2"
if not exist "%ROOT%\backend\public\index-r8.html" (
 echo R8_UI_NOT_INSTALLED
 pause
 exit /b 2
)
start "" "http://127.0.0.1:3188/index-r8.html"
echo R8_UI_OPEN_COMMAND_SENT - server 3188 deve essere gia avviato
