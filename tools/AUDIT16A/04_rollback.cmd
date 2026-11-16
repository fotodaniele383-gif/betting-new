@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0run.cjs" rollback "%CD%"
exit /b %ERRORLEVEL%
