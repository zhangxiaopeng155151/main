@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel Generator - environment check
echo ============================================================
echo   Environment check (read only, starts nothing)
echo ============================================================
echo.

set "PYEXE=python"
where py >nul 2>&1 && set "PYEXE=py -3"

echo --- Versions ----------------------------------------------
%PYEXE% --version 2>nul || echo Python: NOT FOUND
node --version 2>nul || echo Node: NOT FOUND
docker --version 2>nul || echo Docker: NOT FOUND
docker info >nul 2>&1 && echo Docker engine: RUNNING || echo Docker engine: NOT RUNNING
echo.

echo --- Ports 8200 / 3300 / 27017 ------------------------------
netstat -ano | findstr /C:":8200" /C:":3300" /C:":27017"
if errorlevel 1 echo (none of the three ports is in use)
echo.

echo --- MongoDB container --------------------------------------
docker compose -f compose.mongodb.yaml ps 2>nul || echo (docker compose unavailable)
echo.

echo --- Project self check -------------------------------------
%PYEXE% scripts\quickstart.py --check
echo.
echo Copy this whole window when asking for help.
pause
