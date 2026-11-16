@echo off
setlocal EnableExtensions
cd /d "%~dp0"
node "addons\reliability-r9\audit.cjs" "%CD%" >"ESITO_R9_AUDIT_ANOMALIE.json" 2>&1
set "E=%ERRORLEVEL%"
type "ESITO_R9_AUDIT_ANOMALIE.json"
echo R9_AUDIT_EXIT_CODE=%E%
pause
exit /b %E%
