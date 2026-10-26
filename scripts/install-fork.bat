@echo off
rem Builds the fork (if needed), packs it to dist\, and installs it into the
rem dsh-tui profile, replacing the npm release. The profile keeps a file:
rem dependency on dist\dst-comet.tgz, so the tarball must STAY on disk —
rem future dsh plugin / pnpm operations in the profile resolve it.
rem
rem pnpm 11 + nodeLinker=hoisted is required for pack: pnpm 12 refuses
rem bundledDependencies under the default isolated linker.
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
set "FORK=%ROOT%\vendor\dsh-tui"
set "DIST=%ROOT%\dist"

where dsh >nul 2>nul || (echo [dstc-install] dsh CLI not on PATH & exit /b 1)

if not exist "%FORK%\lib\index.js" (
  echo [dstc-install] lib/ missing - building fork...
  pushd "%FORK%" && call npm install && popd
)

if not exist "%DIST%" mkdir "%DIST%"

echo [dstc-install] packing fork -^> dist\dst-comet.tgz ...
pushd "%FORK%"
if exist "%DIST%\dst-comet.tgz" del "%DIST%\dst-comet.tgz"
call npx -y pnpm@11.21.0 pack --config.nodeLinker=hoisted
if errorlevel 1 (popd & echo [dstc-install] pack failed & exit /b 1)
set "TGZ="
for /f "delims=" %%f in ('dir /b *.tgz 2^>nul') do set "TGZ=%%f"
if "!TGZ!"=="" (popd & echo [dstc-install] no tarball produced & exit /b 1)
move /y "!TGZ!" "%DIST%\dst-comet.tgz" >nul
popd

echo [dstc-install] installing dist\dst-comet.tgz into profile dsh-tui ...
call dsh plugin --profile dsh-tui add "%DIST%\dst-comet.tgz"
echo [dstc-install] done. Launch with: dstc
