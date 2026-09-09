@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CORE\scripts\start-studio.ps1"
if errorlevel 1 pause
