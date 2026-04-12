@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-flow-agent.ps1" %*
if errorlevel 1 (
  echo.
  echo Flow agent failed to stop cleanly.
  pause
  exit /b 1
)
endlocal
