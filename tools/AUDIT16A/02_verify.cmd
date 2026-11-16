@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" verify "%CD%"
exit /b %ERRORLEVEL%
