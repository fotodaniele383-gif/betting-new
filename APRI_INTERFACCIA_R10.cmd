@echo off
setlocal EnableExtensions
set "URL=http://127.0.0.1:3188/index-r10.html"
start "" "%URL%"
echo R10_UI_URL=%URL%
exit /b 0
