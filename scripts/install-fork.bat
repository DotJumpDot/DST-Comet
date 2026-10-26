@echo off
rem Builds the fork (if needed), packs it, and installs it into the dsh-tui
rem profile, replacing the npm release. The profile's own dependency
rem resolution stays on the npm release line (dev overrides are not used).
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
set "FORK=%ROOT%\vendor\dsh-tui"

where dsh >nul 2>nul || (echo [dstc-install] dsh CLI not on PATH & exit /b 1)
where pnpm >nul 2>nul || (echo [dstc-install] pnpm not on PATH & exit /b 1)

if not exist "%FORK%\lib\index.js" (
  echo [dstc-install] lib/ missing - building fork...
  pushd "%FORK%" && pnpm install && popd
)

echo [dstc-install] packing fork...
pushd "%FORK%"
for /f "delims=" %%f in ('pnpm pack 2^>nul ^| findstr /r "\.tgz"') do set "TGZ=%%f"
popd
if "!TGZ!"=="" (echo [dstc-install] pnpm pack failed & exit /b 1)

echo [dstc-install] installing %TGZ% into profile dsh-tui ...
call dsh plugin --profile dsh-tui add "%FORK%\%TGZ%"
set "RC=%ERRORLEVEL%"
del "%FORK%\%TGZ%" 2>nul
echo [dstc-install] done (exit %RC%). Launch with: dstc
exit /b %RC%
