@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\disable-flow-system-lan.ps1" %*
if errorlevel 1 (
  echo.
  echo Flow System LAN proxy cleanup failed.
  pause
  exit /b 1
)
endlocal
