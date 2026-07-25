@echo off
REM ==============================================================
REM  BENCHHOOD - is there a live market on this chain?
REM  Reads Uniswap v4 swap logs over your Alchemy RPC. Read-only.
REM ==============================================================
cd /d "%~dp0"
echo.
echo  Scanning recent blocks for swaps - takes a minute or two.
echo.
node worker\check_pools.mjs
echo.
echo  Copy this whole window and paste it back to Claude.
echo.
pause
