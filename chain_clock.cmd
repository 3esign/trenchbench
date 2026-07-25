@echo off
cd /d "%~dp0"
node worker\chain_clock.mjs
echo.
pause
