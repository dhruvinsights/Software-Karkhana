@echo off
rem Double-click launcher for run-backend-windows.ps1 (bypasses the execution policy).
rem Extra args pass through, e.g.:  run-backend-windows.bat -Web -SkipInstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-backend-windows.ps1" %*
pause
