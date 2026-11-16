@echo off
setlocal
cd /d "%~dp0"
echo Aggiornamento manuale delle CSV pubbliche Calcio nel solo workspace pulito.
node "AGGIORNA_DATI.cjs" --force
set "RC=%ERRORLEVEL%"
echo.
echo AGGIORNAMENTO_CODE=%RC%
pause
exit /b %RC%
