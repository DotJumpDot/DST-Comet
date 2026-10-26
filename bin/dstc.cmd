@echo off
rem dstc — DST Comet launcher.
rem Boots dsh with the dsh-tui profile; the profile carries OUR fork
rem (see VENDORED.md). Equivalent to: dsh --profile dsh-tui <args>
rem   --resume: restore the session id written to %USERPROFILE%\.dsh-tui\resume.txt
rem Prereq: dsh CLI on PATH (npm i -g @deepseek-ai/dsh), profile initialized
rem         with the DST-Comet fork (scripts\install-fork.bat).
setlocal
if not defined NODE_ENV set "NODE_ENV=production"
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
  if exist "%USERPROFILE%\.dsh-tui\resume.txt" (
    set /p DSH_TUI_RESUME_SESSION=<"%USERPROFILE%\.dsh-tui\resume.txt"
  )
) else (
  set "ARGS=%ARGS% "%~1""
)
shift
goto :parse

:run
@dsh --profile dsh-tui %ARGS%
endlocal
