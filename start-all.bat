@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

node "%~dp0scripts\start-all.mjs"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
