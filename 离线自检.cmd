@echo off
rem OpenMAIC offline self-check (read-only).
cd /d "%~dp0"
node "%~dp0scripts\check-dual-runtime.cjs"
pause
