@echo off
REM ===== trenchbench - view the site locally (no deploy) =====
cd /d "%~dp0web"
echo Opening a local preview at http://localhost:3000
echo (close this window to stop the preview)
start "" http://localhost:3000
call npx --yes serve -l 3000 .
pause
