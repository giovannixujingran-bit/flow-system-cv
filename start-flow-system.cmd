@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-flow-system.ps1" %*
if errorlevel 1 (
  echo.
  echo Flow System failed to start.
  pause
  exit /b 1
)
endlocal
