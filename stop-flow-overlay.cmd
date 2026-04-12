@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-flow-overlay.ps1" %*
