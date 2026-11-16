@echo off
call "%~dp0run.cmd" rollback
exit /b %errorlevel%
