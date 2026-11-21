@echo off
rem Build an offline distribution package (no dependencies, no local secrets).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\offline\pack.ps1" %*
pause
