@echo off
setlocal
cd /d "%~dp0"
title X32 AI Engineer - Unchanged Windows Bridge
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "x32_engineer_bridge.py"
) else (
  python "x32_engineer_bridge.py"
)
if errorlevel 1 (
  echo.
  echo Bridge stopped or Python 3.10+ is not installed.
  pause
)
