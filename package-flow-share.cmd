@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-flow-share.ps1" %*
if errorlevel 1 (
  echo.
  echo Flow share package failed.
  pause
  exit /b 1
)
endlocal
