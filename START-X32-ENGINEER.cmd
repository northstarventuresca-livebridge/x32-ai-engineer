@echo off
setlocal
title X32 AI Engineer - Multi Vocal Release 98
cd /d "%~dp0windows\unchanged-2026-11-01"
echo.
echo ================================================
echo    X32 AI ENGINEER - MULTI VOCAL RELEASE 98
echo ================================================
echo.
echo Dashboard: https://x32-ai-engineer-church.globalconnectionschurch.workers.dev/
echo Windows bridge: existing verified X32 32-channel bridge
echo Multi vocal: live dashboard release 98
echo.
echo NOTE: Close any other X32 AI Engineer bridge window first.
echo Starting bridge. Browser will open automatically...
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "x32_engineer_bridge.py"
) else (
  python "x32_engineer_bridge.py"
)
if errorlevel 1 (
  echo.
  echo X32 bridge stopped or could not start.
  echo Check Python 3.10+ is installed and the older bridge is closed.
  pause
)
endlocal
