@echo off
cd /d "%~dp0"
node worker\check_rpc.mjs
echo.
pause
