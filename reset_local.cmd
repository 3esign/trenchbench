@echo off
setlocal
REM ==============================================================
REM  trenchbench - archive local session files for a clean start
REM  Nothing is deleted. Everything moves into sessions_archive\
REM  so the old runs are still on disk if you ever want them.
REM ==============================================================
cd /d "%~dp0"

echo.
echo  ============================================================
echo   Clean start - archiving local session files
echo  ============================================================
echo.

if not exist "sessions" (
  echo  No sessions folder yet - nothing to archive.
  echo.
  pause & exit /b 0
)

set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%"
set "STAMP=%STAMP: =0%"
set "DEST=sessions_archive\%STAMP%"

md "%DEST%" 2>nul
move /y "sessions\*.json" "%DEST%\" >nul 2>&1

if errorlevel 1 (
  echo  Nothing to move - sessions folder was already empty.
) else (
  echo  Archived old runs to:  %DEST%
)

del /q "worker\.stop"    >nul 2>&1
del /q "worker\.running" >nul 2>&1

echo.
echo  ============================================================
echo   Local side is clean.
echo.
echo   Next: paste supabase\SETUP_FROM_SCRATCH.sql into Supabase
echo   and click RUN. That wipes the database side.
echo  ============================================================
echo.
pause
endlocal
