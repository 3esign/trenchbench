@echo off
REM ===== Trench Bench - MIXED memecoin session =====
cd /d "%~dp0"
echo.
echo Starting a MIXED Solana memecoin session.
echo   Roster is a balanced random draw across high and low market cap memecoins.
echo   Control tokens (SOL, USDC, WIF, BONK) are always included.
echo.
node worker\run_session.mjs mixed
echo.
pause
