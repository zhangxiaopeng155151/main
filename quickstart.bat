@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel Generator
rem Thin wrapper: same as the Chinese-named launcher but without --persist-config.
set "PYEXE=python"
where py >nul 2>&1 && set "PYEXE=py -3"
%PYEXE% -c "import sys;raise SystemExit(0 if sys.version_info>=(3,11) else 1)" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.11+ was not found: https://www.python.org/downloads/
    pause
    exit /b 1
)
%PYEXE% scripts\quickstart.py %*
if errorlevel 1 pause
