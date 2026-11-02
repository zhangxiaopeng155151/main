@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel Generator - create desktop icon
echo ============================================================
echo   Create a desktop icon that starts the app and opens
echo   the "new novel" workspace directly.
echo ============================================================
echo.

set "PYEXE=python"
where py >nul 2>&1 && set "PYEXE=py -3"

%PYEXE% -c "import sys;raise SystemExit(0 if sys.version_info>=(3,11) else 1)" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.11+ was not found: https://www.python.org/downloads/
    pause
    exit /b 1
)

%PYEXE% scripts\make_icons.py
if errorlevel 1 goto FAIL
%PYEXE% scripts\create_shortcuts.py %*
if errorlevel 1 goto FAIL

echo.
echo Done. Find "AI Novel Generator" on your desktop.
pause
exit /b 0

:FAIL
echo.
echo [ERROR] Failed. Send the log above to your assistant.
pause
exit /b 1
