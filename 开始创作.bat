@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo   AI 小说生成器 - 一键开始创作
echo   首次运行会自动安装依赖、启动 MongoDB 并构建前端
echo ============================================
echo.

set PYEXE=python
where py >nul 2>&1 && set PYEXE=py -3

%PYEXE% -c "import sys;raise SystemExit(0 if sys.version_info>=(3,11) else 1)" >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到可用的 Python 3.11+。
    echo 请先安装 Python 3.13：https://www.python.org/downloads/
    echo 安装时记得勾选 "Add python.exe to PATH"。
    pause
    exit /b 1
)

%PYEXE% scripts\quickstart.py --persist-config %*
if errorlevel 1 (
    echo.
    echo [失败] 启动未完成，请把上面的报错信息发给助手。
    pause
)
