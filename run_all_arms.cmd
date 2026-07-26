@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   TRENCH BENCH - RUN ALL SEASON 2 EXPERIMENTAL ARMS
echo ============================================================
echo   This will run 10 sessions for EACH of the 5 experimental arms
echo   (s2a, s2b, s2c, s2d, s2e) for a total of 50 benchmark sessions.
echo ============================================================
echo.

set /p RUNS="Enter number of runs per arm [default: 10]: "
if "%RUNS%"=="" set "RUNS=10"

echo.
echo Running Arm S2A (Control)...
node worker\run_experimental_batch.mjs s2a %RUNS%

echo.
echo Running Arm S2B (Execution Shield)...
node worker\run_experimental_batch.mjs s2b %RUNS%

echo.
echo Running Arm S2C (Patience & Soft Timers)...
node worker\run_experimental_batch.mjs s2c %RUNS%

echo.
echo Running Arm S2D (Cognitive Priming)...
node worker\run_experimental_batch.mjs s2d %RUNS%

echo.
echo Running Arm S2E (Fully Loaded & Tuned)...
node worker\run_experimental_batch.mjs s2e %RUNS%

echo.
echo ============================================================
echo   All Season 2 Experimental Arms Completed!
echo ============================================================
echo.
pause
endlocal
