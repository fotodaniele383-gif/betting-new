@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" coverage "%CD%"
exit /b %ERRORLEVEL%
