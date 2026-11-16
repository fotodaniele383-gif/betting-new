@echo off
start "" "http://127.0.0.1:3188"
if errorlevel 1 (echo Apertura automatica non riuscita. Copia http://127.0.0.1:3188 nel browser.& pause)
