@echo off
setlocal
for %%I in ("%~dp0..") do set "AUDIT_TARGET=%%~fI"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo STOP: Node.js non disponibile nel PATH.
  exit /b 2
)
node "%~dp0run.cjs" "%~1" "%AUDIT_TARGET%"
exit /b %errorlevel%
