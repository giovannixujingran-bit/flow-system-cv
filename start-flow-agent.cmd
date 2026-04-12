@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-flow-agent.ps1" %*
if errorlevel 1 (
  echo.
  echo Flow agent failed to start.
  pause
  exit /b 1
)
endlocal
