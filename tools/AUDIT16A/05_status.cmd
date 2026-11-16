@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" status "%CD%"
exit /b %ERRORLEVEL%
