@echo off
pushd "%~dp0CORE"
node scripts\persistent-session.mjs setup --provider google
if errorlevel 1 goto done
node scripts\persistent-session.mjs setup --provider flow-music
:done
node scripts\persistent-session.mjs status
popd
pause
