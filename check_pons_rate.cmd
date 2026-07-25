@echo off
cd /d "%~dp0"
node worker\pons_rate.mjs %1
echo.
pause
