@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
echo ATTENZIONE: ATTIVAZIONE ESPLICITA DATI TECNICI TENNIS.
echo Fermare prima BettingApp. Usa il provider originale Patch21, con il suo backup dei CSV attivi.
echo Nessuna scommessa automatica o scrittura nel DB.
set /p "CONF=Digita ATTIVA_DATI per proseguire: "
if not "%CONF%"=="ATTIVA_DATI" (echo ANNULLATO&pause&exit /b 2)
node "%ROOT%addons\data-first-r11\tennis-intake.cjs" activate "%ROOT%"
set "RC=%ERRORLEVEL%"
echo R11_ACTIVATE_EXIT_CODE=%RC%
pause
exit /b %RC%
