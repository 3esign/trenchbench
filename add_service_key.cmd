@echo off
setlocal enabledelayedexpansion
REM ==============================================================
REM  trenchbench - add your Supabase service_role key to config.txt
REM  The key goes straight from your clipboard into the file.
REM  It is never printed in full and never leaves this machine.
REM ==============================================================
cd /d "%~dp0"

echo.
echo  ============================================================
echo   Add your Supabase service_role key
echo  ============================================================
echo.
echo   Where to find it:
echo     1. https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/settings/api
echo     2. scroll to "Project API keys"
echo     3. find the row marked  service_role   (NOT anon / publishable)
echo     4. click Reveal, then Copy
echo.
echo   Then right-click here to paste it, and press Enter.
echo.

if not exist "config.txt" (
  echo  [X] config.txt not found. Are you running this from the trenchbench folder?
  echo.
  pause & exit /b 1
)

set "KEY="
set /p "KEY=service_role key: "

if "!KEY!"=="" (
  echo.
  echo  Nothing pasted - config.txt was not changed.
  echo.
  pause & exit /b 1
)

REM sanity check: service keys are long. anon keys are too, but the common
REM mistake is pasting something truncated.
set "LEN=0"
for /l %%i in (12,1,400) do if not "!KEY:~%%i,1!"=="" set /a LEN=%%i+1
if !LEN! LSS 30 (
  echo.
  echo  [X] That looks too short to be a real key ^(!LEN! characters^).
  echo      Nothing was changed. Try the Copy button again.
  echo.
  pause & exit /b 1
)

REM drop any previous line, then append the new one
findstr /v /b /c:"SUPABASE_SERVICE_KEY=" config.txt > config.new 2>nul
echo SUPABASE_SERVICE_KEY=!KEY!>> config.new
move /y config.new config.txt >nul

echo.
echo  ============================================================
echo   Saved to config.txt  ^(!LEN! characters, ending ...!KEY:~-6!^)
echo.
echo   config.txt is git-ignored, so this key will never be pushed.
echo   Your next session will write to Supabase normally.
echo  ============================================================
echo.
pause
endlocal
