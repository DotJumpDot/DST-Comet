@echo off
rem dstc — DST Comet launcher.
rem Boots dsh with the dsh-tui profile; the profile carries OUR fork
rem (see VENDORED.md). Equivalent to: dsh --profile dsh-tui <args>
rem   --resume: restore the session id written to the state dir's resume.txt
rem Prereq: dsh CLI on PATH (npm i -g @deepseek-ai/dsh), profile initialized
rem         with the DST-Comet fork (scripts\install-fork.bat).
setlocal
if not defined NODE_ENV set "NODE_ENV=production"
rem Fork isolation (2026-10-30): every dsh-tui-family build hard-codes the
rem same %USERPROFILE%\.dsh-tui state dir, so a second fork profile (DST-Moon)
rem rewrote comet's settings/theme/session state and back. Comet pins its OWN
rem dir (the fork migrates the legacy dir once on first use); other builds
rem keep the default and the two never share state again.
if not defined DSH_TUI_STATE_DIR set "DSH_TUI_STATE_DIR=%USERPROFILE%\.dsh-tui-comet"
set "WORKSPACE=%DSH_TUI_WORKSPACE%"
if "%WORKSPACE%"=="" set "WORKSPACE=%CD%"
cd /d "%WORKSPACE%"

where dsh >nul 2>nul
if errorlevel 1 (
  echo [dstc] dsh CLI not found. Install it first: npm install -g @deepseek-ai/dsh 1>&2
  exit /b 1
)

set "ARGS="
:parse
if "%~1"=="" goto :run
if /i "%~1"=="--resume" (
  if exist "%DSH_TUI_STATE_DIR%\resume.txt" (
    set /p DSH_TUI_RESUME_SESSION=<"%DSH_TUI_STATE_DIR%\resume.txt"
  )
) else (
  set "ARGS=%ARGS% "%~1""
)
shift
goto :parse

:run
@dsh --profile dsh-tui %ARGS%
endlocal
