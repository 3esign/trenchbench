@echo off
REM ==============================================================
REM  trenchbench - EMERGENCY STOP
REM  Kills every running session immediately. Use this if you are
REM  not sure whether something is still burning model calls.
REM  Nothing is lost that was already written to Supabase.
REM ==============================================================
cd /d "%~dp0"

echo.
echo  ============================================================
echo   EMERGENCY STOP - killing every trenchbench runner
echo  ============================================================
echo.

REM 1. ask nicely first, so a session that is mid-round saves itself
echo  [1/3] Signalling every session to stop and save...
if not exist "worker" mkdir "worker"
echo stop > "worker\.stop"

REM 2. give it a couple of seconds to close cleanly
echo  [2/3] Waiting 3 seconds for a clean shutdown...
ping -n 4 127.0.0.1 >nul

REM 3. then kill anything still alive
echo  [3/3] Killing any remaining node processes...
taskkill /F /IM node.exe >nul 2>&1
if errorlevel 1 (
  echo       Nothing left running - you are clear.
) else (
  echo       Killed. Nothing is running now.
)

del /q "worker\.running" >nul 2>&1
del /q "worker\.stop"    >nul 2>&1

echo.
echo  ============================================================
echo   All stopped. No further model calls can be billed.
echo.
echo   To check for yourself: Ctrl+Shift+Esc, Details tab,
echo   look for node.exe. There should be none.
echo  ============================================================
echo.
pause
