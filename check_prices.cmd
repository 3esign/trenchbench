@echo off
REM ==============================================================
REM  BENCHHOOD - compare every free price source side by side.
REM  Shows which one actually moves. Reads only public data.
REM ==============================================================
cd /d "%~dp0"
echo.
echo  Checking price sources - takes about a minute.
echo.
node worker\check_prices.mjs
echo.
echo  Copy this whole window and paste it back to Claude.
echo.
pause
