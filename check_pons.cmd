@echo off
cd /d "%~dp0"
node worker\check_pons.mjs
echo.
pause
