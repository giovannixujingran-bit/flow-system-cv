@echo off
setlocal
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\manage-flow-system-distribution.ps1"

if not exist "%SCRIPT%" (
  echo [flow-system] Script not found: "%SCRIPT%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action update %*
exit /b %ERRORLEVEL%
