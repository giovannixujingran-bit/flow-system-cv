@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-flow-overlay.ps1" %*
