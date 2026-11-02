@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel Generator
echo ============================================================
echo   AI Novel Generator - one click start
echo   First run: installs dependencies, starts MongoDB via Docker,
echo   builds the frontend, then opens the app in your browser.
echo ============================================================
echo.

set "PYEXE=python"
where py >nul 2>&1 && set "PYEXE=py -3"

%PYEXE% -c "import sys;raise SystemExit(0 if sys.version_info>=(3,11) else 1)" >nul 2>&1
if errorlevel 1 goto NOPY

%PYEXE% scripts\quickstart.py --persist-config %*
if errorlevel 1 goto FAIL
exit /b 0

:NOPY
echo [ERROR] Python 3.11+ was not found.
echo   Install Python 3.13: https://www.python.org/downloads/
echo   During setup tick "Add python.exe to PATH", then reopen this file.
echo.
pause
exit /b 1

:FAIL
echo.
echo [ERROR] Startup did not finish. Send the log above to your assistant.
pause
exit /b 1
