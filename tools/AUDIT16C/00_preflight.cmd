@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" preflight "%CD%"
exit /b %ERRORLEVEL%
