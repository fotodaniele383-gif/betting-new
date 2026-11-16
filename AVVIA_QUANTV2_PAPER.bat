@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "BETTINGAPP_QUANT_V2=1"
echo QUANTV2=MANUAL_PAPER_OPT_IN SCHEDULER=OFF SETTLEMENT_AUTO=OFF
call "%~dp0AVVIA_BETTING.bat"
exit /b %errorlevel%
