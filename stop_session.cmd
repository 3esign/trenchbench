@echo off
REM ===== trenchbench - stop the running session early (it saves automatically) =====
cd /d "%~dp0"
echo stop> worker\.stop
echo.
echo Stop signal sent. The running session will finish and save within ~2 seconds.
timeout /t 3 >nul
