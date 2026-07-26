@echo off
REM ===== trenchbench - deploy the site and put it on trenchbench.vercel.app =====
cd /d "%~dp0"
for /f "usebackq tokens=1,* delims==" %%A in ("config.txt") do set "%%A=%%B"
cd web
echo.
echo Linking to the "trenchbench" project...
call npx --yes vercel@latest link --yes --project trenchbench --token %VERCEL_TOKEN%
echo.
echo Deploying (this is your live site)...
call npx --yes vercel@latest deploy --prod --yes --token %VERCEL_TOKEN% > "%TEMP%\bh_prod.txt" 2>nul
set "PROD_URL="
set /p PROD_URL=<"%TEMP%\bh_prod.txt"
echo Deployed at: %PROD_URL%
echo.
echo Claiming and pointing trenchbench.vercel.app at it...
call npx --yes vercel@latest alias set %PROD_URL% trenchbench.vercel.app --token %VERCEL_TOKEN%
echo.
echo ============================================================
echo  Your site should now be live at:
echo        https://trenchbench.vercel.app      (give it up to ~1 min)
echo.
echo  Also always live at the address shown after "Deployed at:".
echo  If the "Claiming..." line printed an error, paste this whole
echo  window to me and I'll fix it in one step.
echo ============================================================
pause
