@echo off
setlocal EnableExtensions
cd /d "%~dp0"
node "addons\reliability-r9\editor-audit.cjs" "%CD%" >"ESITO_R9_EDITOR_READONLY.json" 2>&1
set "E=%ERRORLEVEL%"
type "ESITO_R9_EDITOR_READONLY.json"
echo R9_EDITOR_EXIT_CODE=%E%
pause
exit /b %E%
