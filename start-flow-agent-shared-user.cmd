@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-flow-agent-shared-user.ps1" %*
if errorlevel 1 (
  echo.
  echo Shared user agent startup failed.
  pause
  exit /b 1
)
endlocal
