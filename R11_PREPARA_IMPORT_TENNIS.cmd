@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
echo R11 - Import di un CSV annuale CANONICO verificato per Tennis.
echo Non scrive nel database e non attiva i dati nel motore.
echo WTA_MAIN / ATP_MAIN / ATP_QUAL_CHALL
set /p "TARGET=Target: "
set /p "CSV=Percorso completo CSV da importare: "
set /p "SRC=URL HTTPS della fonte esatta: "
set /p "LIC=Licenza dichiarata (CC-BY-4.0 / CC-BY-NC-SA-4.0 / USER_LICENSED / RIGHTS_VERIFIED / UNKNOWN_REVIEW_REQUIRED): "
node "%ROOT%addons\data-first-r11\tennis-intake.cjs" check "%ROOT%" "%TARGET%" "%CSV%" "%SRC%" "%LIC%"
if errorlevel 1 (echo VERIFICA FALLITA. NESSUNA MODIFICA.&pause&exit /b 1)
set /p "CONF=Per preparare il CSV nel provider locale, digita PREPARA: "
if not "%CONF%"=="PREPARA" (echo ANNULLATO&pause&exit /b 2)
node "%ROOT%addons\data-first-r11\tennis-intake.cjs" stage "%ROOT%" "%TARGET%" "%CSV%" "%SRC%" "%LIC%"
set "RC=%ERRORLEVEL%"
echo R11_IMPORT_EXIT_CODE=%RC%
pause
exit /b %RC%
