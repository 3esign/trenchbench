@echo off
REM ===== Trench Bench - HIGHCAP memecoin session =====
cd /d "%~dp0"
echo.
echo Starting a HIGHCAP Solana memecoin session.
echo   Roster focuses on the highest market cap memecoins (e.g. WIF, BONK, etc.).
echo   Control tokens (SOL, USDC, WIF, BONK) are always included.
echo.
node worker\run_session.mjs highcap
echo.
pause
