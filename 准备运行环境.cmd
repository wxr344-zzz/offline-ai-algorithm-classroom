@echo off
rem First-time setup on a new computer (needs internet once). Extra options, e.g. -ContextLength 8192, are passed through.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-runtime.ps1" %*
pause
