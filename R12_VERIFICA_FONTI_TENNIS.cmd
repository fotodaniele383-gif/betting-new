@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
echo R12: verifica manuale del CSV, senza attivazione o scrittura DB.
echo Validare prima data, licenza, provenienza, copertura e download consentito.
call "%ROOT%R11_PREPARA_IMPORT_TENNIS.cmd"
exit /b %ERRORLEVEL%
