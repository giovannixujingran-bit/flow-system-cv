@echo off
setlocal
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\publish-flow-system-to-github.ps1"

if not exist "%SCRIPT%" (
  echo [publish] Script not found: "%SCRIPT%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
