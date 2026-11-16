@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" regression "%CD%"
exit /b %ERRORLEVEL%
