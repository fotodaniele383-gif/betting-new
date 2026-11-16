@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" apply "%CD%"
exit /b %ERRORLEVEL%
