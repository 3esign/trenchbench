@echo off
setlocal enabledelayedexpansion
REM ==============================================================
REM  BENCHHOOD - push this folder to github.com/3esign/benchhood
REM  Safe to double-click. Safe to run again and again.
REM  It refuses to push if a secret file ever ends up staged.
REM ==============================================================
cd /d "%~dp0"

set "REPO_URL=https://github.com/3esign/benchhood.git"
set "REPO_SLUG=3esign/benchhood"
set "BRANCH=main"

echo.
echo  ============================================================
echo   BENCHHOOD  -  push to GitHub  (%REPO_SLUG%)
echo  ============================================================
echo.

REM ---------- 0. is git installed? ------------------------------
git --version >nul 2>&1
if errorlevel 1 (
  echo  [X] Git is not installed on this PC.
  echo      Install it from https://git-scm.com/download/win  then run this again.
  echo.
  pause & exit /b 1
)

REM ---------- 1. first time? initialise -------------------------
if not exist ".git" (
  echo  [1/6] First run - creating the local repository...
  git init -q
  git symbolic-ref HEAD refs/heads/%BRANCH%
) else (
  echo  [1/6] Local repository already exists.
)

REM make sure we are on main
git rev-parse --verify %BRANCH% >nul 2>&1
if errorlevel 1 (
  git checkout -q -b %BRANCH% 2>nul
) else (
  git checkout -q %BRANCH% 2>nul
)

REM ---------- 2. point at your GitHub repo -----------------------
echo  [2/6] Pointing 'origin' at %REPO_URL%
git remote remove origin >nul 2>&1
git remote add origin "%REPO_URL%"

REM ---------- 3. stage everything git is allowed to see ----------
echo  [3/6] Staging files (.gitignore keeps secrets out)...
git add -A

REM ---------- 4. SECRET GUARD -----------------------------------
echo  [4/6] Checking that no secret is about to be pushed...
set "LEAK="
REM  Matching the exact filename was not enough: a config.txt.bak, a
REM  "config - Copy.txt" or a sessions_archive folder all sailed straight
REM  through. Match the SHAPE of a secret, not one spelling of it.
for /f "delims=" %%F in ('git diff --cached --name-only 2^>nul') do (
  if /i "%%F"=="config.txt"      set "LEAK=%%F"
  if /i "%%F"==".env"            set "LEAK=%%F"
  echo %%F| findstr /i /r "\.env$ \.env\. /\.vercel/ ^\.vercel/" >nul && set "LEAK=%%F"
  echo %%F| findstr /i /r "^config.*\.txt$ /config.*\.txt$" >nul && set "LEAK=%%F"
  echo %%F| findstr /i /r "\.bak$ \.key$ \.pem$ secret credential password token" >nul && set "LEAK=%%F"
  echo %%F| findstr /i /r "^sessions_archive/ /sessions_archive/" >nul && set "LEAK=%%F"
)
REM  config.example.txt is the one config file that SHOULD ship
if /i "!LEAK!"=="config.example.txt" set "LEAK="
if defined LEAK (
  echo.
  echo  [X] STOPPED - a secret file is staged:  !LEAK!
  echo      Nothing was pushed. Your keys are safe.
  echo      Fix: make sure .gitignore in this folder is the current one,
  echo      then run:   git rm --cached "!LEAK!"
  echo      and run this script again.
  echo.
  pause & exit /b 1
)
echo       OK - no secrets staged.

REM ---------- 5. commit ------------------------------------------
set "MSG=%*"
if "%MSG%"=="" set "MSG=update: benchhood session runner + arena"
git diff --cached --quiet
if errorlevel 1 (
  echo  [5/6] Committing: %MSG%
  git -c user.name="3esign" -c user.email="poturaksemir@gmail.com" commit -q -m "%MSG%"
) else (
  echo  [5/6] Nothing new to commit - pushing what is already here.
)

REM ---------- 6. push --------------------------------------------
echo  [6/6] Pushing to GitHub...
echo.
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo  ... push was rejected. This normally means the GitHub repo already
  echo      has a commit on it ^(a README created on the website^).
  echo      Merging that in and retrying...
  echo.
  git pull --rebase origin %BRANCH%
  if errorlevel 1 (
    echo.
    echo  [X] Could not merge automatically. Paste this whole window to Claude.
    echo.
    pause & exit /b 1
  )
  git push -u origin %BRANCH%
  if errorlevel 1 (
    echo.
    echo  [X] Push still failed. Usually this is sign-in.
    echo      Windows will normally pop a GitHub login window the first time.
    echo      If it did not, install GitHub CLI ^(https://cli.github.com^),
    echo      run:  gh auth login    then run this script again.
    echo.
    pause & exit /b 1
  )
)

REM ---------- private-visibility check ---------------------------
echo.
where gh >nul 2>&1
if not errorlevel 1 (
  echo  Checking the repo is PRIVATE...
  for /f "delims=" %%V in ('gh repo view %REPO_SLUG% --json visibility -q .visibility 2^>nul') do set "VIS=%%V"
  if /i "!VIS!"=="PUBLIC" (
    echo  [!] The repo is PUBLIC. Making it private now...
    gh repo edit %REPO_SLUG% --visibility private --accept-visibility-change-consequences
    echo      Done - it is private.
  ) else (
    if defined VIS ( echo      OK - visibility is !VIS!. ) else ( echo      Could not read visibility ^(not signed in to gh^). )
  )
) else (
  echo  NOTE: GitHub CLI is not installed, so I cannot verify visibility.
  echo        Open https://github.com/%REPO_SLUG%/settings and confirm it says
  echo        "This repository is currently private" near the bottom.
)

echo.
echo  ============================================================
echo   Pushed.  https://github.com/%REPO_SLUG%
echo.
echo   NOT pushed ^(on purpose^): config.txt, any .env, .vercel,
echo   .deploy and your sessions folder. Your keys and your data
echo   stayed on this machine.
echo  ============================================================
echo.
pause
endlocal
