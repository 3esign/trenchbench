@echo off
REM ==============================================================
REM  BENCHHOOD - diagnostic
REM  Finds out WHY the models are not answering and whether the
REM  chain prices actually move. Makes at most 3 model calls.
REM  Changes nothing, saves nothing.
REM ==============================================================
cd /d "%~dp0"
echo.
echo  Running diagnostic - takes about a minute (it waits 45s to
echo  see whether any price ticks).
echo.
node worker\diagnose.mjs
echo.
echo  Copy this whole window and paste it back to Claude.
echo.
pause
