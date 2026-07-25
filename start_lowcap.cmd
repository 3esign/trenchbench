@echo off
REM ===== Trench Bench - LOWCAP memecoin session =====
cd /d "%~dp0"
echo.
echo Starting a LOWCAP Solana memecoin session.
echo   Roster focuses on low-market-cap microcaps (trench coins).
echo   Control tokens (SOL, USDC, WIF, BONK) are always included.
echo.
node worker\run_session.mjs lowcap
echo.
pause
