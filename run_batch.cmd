@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   TRENCH BENCH - SEASON 2 MULTI-ARM BATCH RUNNER
echo ============================================================
echo.
echo Available Experimental Arms:
echo   s2a - Control (Original S1 rules, raw sizing, 2%% liquidation)
echo   s2b - Execution (Slippage Shield 5%% cap + Volatility Sizing)
echo   s2c - Patience (Slippage Shield + Spot Rules + 5-Round Soft Hold)
echo   s2d - Cognitive (Slippage Shield + Spot Rules + Cognitive Prompts)
echo   s2e - Fully Loaded (Slippage Shield + Spot Rules + Cognitive + Tuned Risk)
echo.

set /p ARM="Enter Arm to run (s2a/s2b/s2c/s2d/s2e) [default: s2e]: "
if "%ARM%"=="" set "ARM=s2e"

set /p RUNS="Enter number of sessions to run [default: 10]: "
if "%RUNS%"=="" set "RUNS=10"

echo.
echo Starting %RUNS% session(s) for Arm %ARM%...
echo ============================================================
echo.

node worker\run_experimental_batch.mjs %ARM% %RUNS%

echo.
echo ============================================================
echo   Batch Execution Finished!
echo ============================================================
echo.
pause
endlocal
