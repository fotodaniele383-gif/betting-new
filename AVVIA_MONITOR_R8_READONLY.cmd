@echo off
setlocal EnableExtensions
set "ROOT=C:\Users\pc-user\Documents\Personale\BettingApp\BettingApp v2"
echo Monitor di sola lettura ogni 60 minuti. Non esegue scommesse, liquidazioni o scansioni sportive.
node "%ROOT%\addons\safe13-r8\monitor.cjs" run "%ROOT%"
pause
