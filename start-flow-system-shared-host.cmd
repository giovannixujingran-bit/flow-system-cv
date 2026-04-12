@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-flow-system-shared-host.ps1" %*
if errorlevel 1 (
  echo.
  echo Shared host startup failed.
  pause
  exit /b 1
)
endlocal
