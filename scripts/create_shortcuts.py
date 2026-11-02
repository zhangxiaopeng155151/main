#!/usr/bin/env python3
"""创建"双击即开始创作"的桌面程序图标（Windows / macOS / Linux）。

做的事：
    1. 若 icons 缺失则先调用 scripts/make_icons.py 生成全部尺寸；
    2. 按当前系统创建带图标的启动入口：
        Windows → 桌面 .lnk（指向 开始创作.bat --open-workspace new，图标 assets/app-icon.ico）
        macOS   → 生成 桌面/AI 小说生成器.app（Info.plist + icns + 启动脚本）
        Linux   → 生成 .desktop 并安装到 ~/.local/share/applications 与 hicolor 图标目录
    3. 入口的参数固定为 --persist-config --open-workspace new：启动后直接进入"新建小说"。

用法：
    python scripts/create_shortcuts.py                 # 自动识别系统
    python scripts/create_shortcuts.py --no-desktop    # 只生成到项目内，不动桌面
    python scripts/create_shortcuts.py --open-workspace shelf   # 打开书架而不是新建
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
APP_NAME = "AI小说生成器"
BUNDLE_DIR_NAME = "桌面图标"


def ensure_icons() -> None:
    """确保图标产物存在，缺失时生成。

    Returns:
        无。
    """
    if not (ASSETS / "app-icon.ico").exists() or not (ASSETS / "app-icon.icns").exists():
        print("图标缺失，先运行 scripts/make_icons.py ...")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "make_icons.py")], check=True)


def launch_args(workspace: str) -> list[str]:
    """返回启动参数（固定写入数据库配置并直达指定页面）。

    Args:
        workspace: shelf 或 new。
    Returns:
        传给 quickstart.py 的参数列表。
    """
    return ["--persist-config", "--open-workspace", workspace]


# --------------------------------------------------------------------------- Windows
def create_windows_shortcut(workspace: str, to_desktop: bool) -> Path:
    """在当前用户桌面创建 .lnk 快捷方式。

    Args:
        workspace: 打开哪个页面。
        to_desktop: 是否写到桌面（否则写到项目内）。
    Returns:
        生成的快捷方式路径。
    """
    target = ROOT / f"{APP_NAME}.lnk" if not to_desktop else None
    if to_desktop:
        script = (
            "$desktop = [Environment]::GetFolderPath('Desktop');"
            "$p = Join-Path $desktop '" + APP_NAME + ".lnk';"
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p);"
            f"$s.TargetPath = '{ROOT / '开始创作.bat'}';"
            f"$s.WorkingDirectory = '{ROOT}';"
            f"$s.IconLocation = '{ASSETS / 'app-icon.ico'}';"
            "$s.Description = 'AI 小说生成器 - 双击开始创作';"
            "$s.WindowStyle = 1;"
            "$s.Save();"
            "Write-Output $p"
        )
        result = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"创建快捷方式失败：{result.stderr.strip() or result.stdout.strip()}")
        return Path(result.stdout.strip().splitlines()[-1])
    raise RuntimeError("Windows 快捷方式只在桌面创建")


# --------------------------------------------------------------------------- macOS
def create_macos_app(workspace: str, to_desktop: bool) -> Path:
    """生成 macOS .app 应用包（双击打开终端并启动服务）。

    Args:
        workspace: 打开哪个页面。
        to_desktop: 是否把 .app 复制到桌面。
    Returns:
        .app 路径。
    """
    bundle = ROOT / BUNDLE_DIR_NAME / f"{APP_NAME}.app"
    macos = bundle / "Contents" / "MacOS"
    resources = bundle / "Contents" / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ASSETS / "app-icon.icns", resources / "app-icon.icns")

    (bundle / "Contents" / "Info.plist").write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>%APP_NAME%</string>
    <key>CFBundleDisplayName</key><string>%APP_NAME%</string>
    <key>CFBundleIdentifier</key><string>local.ai-novel-generator.launcher</string>
    <key>CFBundleVersion</key><string>1.0</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleIconFile</key><string>app-icon</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
""".replace("%APP_NAME%", APP_NAME),
        encoding="utf-8",
    )

    runner = macos / "run"
    args = " ".join(launch_args(workspace))
    runner.write_text(
        f"""#!/bin/bash
# 由 scripts/create_shortcuts.py 生成：双击本应用 → 启动服务 → 打开新建小说页
cd "$(dirname "$0")/../../.." || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=/usr/bin/python3
exec "$PY" scripts/quickstart.py {args}
""",
        encoding="utf-8",
    )
    runner.chmod(0o755)

    if to_desktop:
        desktop = Path.home() / "Desktop"
        if desktop.exists():
            destination = desktop / bundle.name
            if destination.exists():
                shutil.rmtree(destination) if destination.is_dir() else destination.unlink()
            shutil.copytree(bundle, destination, symlinks=True)
            return destination
    return bundle


# --------------------------------------------------------------------------- Linux
def create_linux_entry(workspace: str, to_desktop: bool) -> Path:
    """生成 .desktop 并安装图标与菜单项。

    Args:
        workspace: 打开哪个页面。
        to_desktop: 是否把 .desktop 放一份到桌面。
    Returns:
        已安装的 .desktop 路径。
    """
    args = " ".join(launch_args(workspace))
    entry = (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Version=1.0\n"
        f"Name={APP_NAME}\n"
        "Name[en]=AI Novel Generator\n"
        "Comment=一键启动并开始创作小说\n"
        f'Exec=bash -c "cd \'{ROOT}\' && python3 scripts/quickstart.py {args}"\n'
        f"Path={ROOT}\n"
        "Icon=ai-novel-generator\n"
        "Terminal=true\n"
        "Categories=Office;Literature;\n"
        "StartupNotify=true\n"
    )

    applications = Path.home() / ".local" / "share" / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    installed = applications / "ai-novel-generator.desktop"
    installed.write_text(entry, encoding="utf-8")
    installed.chmod(0o755)

    for folder in (ASSETS / "icons" / "hicolor").glob("*/apps/ai-novel-generator.png"):
        size = folder.parent.parent.name
        target_dir = Path.home() / ".local" / "share" / "icons" / "hicolor" / size / "apps"
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(folder, target_dir / "ai-novel-generator.png")

    if shutil.which("gtk-update-icon-cache"):
        subprocess.run(["gtk-update-icon-cache", "-f", "-t",
                        str(Path.home() / ".local" / "share" / "icons" / "hicolor")],
                       capture_output=True)
    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(applications)], capture_output=True)

    if to_desktop:
        desktop = Path.home() / "Desktop"
        if desktop.exists():
            shortcut = desktop / "ai-novel-generator.desktop"
            shutil.copy2(installed, shortcut)
            shortcut.chmod(0o755)
            return shortcut
    return installed


def main() -> None:
    """解析参数并创建对应平台的启动图标。"""
    parser = argparse.ArgumentParser(description="创建'双击即开始创作'的桌面图标")
    parser.add_argument("--open-workspace", choices=("shelf", "new"), default="new")
    parser.add_argument("--no-desktop", action="store_true", help="只生成到项目内，不写桌面")
    args = parser.parse_args()

    ensure_icons()
    to_desktop = not args.no_desktop
    if sys.platform == "win32":
        path = create_windows_shortcut(args.open_workspace, to_desktop)
    elif sys.platform == "darwin":
        path = create_macos_app(args.open_workspace, to_desktop)
    else:
        path = create_linux_entry(args.open_workspace, to_desktop)

    print(f"✓ 桌面图标已就绪：{path}")
    print("  双击后会启动前后端，并直接打开「新建小说」页面。")
    if sys.platform == "darwin":
        print("  首次双击若被系统拦截：系统设置 → 隐私与安全性 → 仍要打开。")
    if sys.platform.startswith("linux"):
        print("  若桌面上的 .desktop 显示为文件：右键 → 允许运行/信任。")
    if not to_desktop:
        print("  （--no-desktop：未写入桌面，可用项目内的入口文件）")


if __name__ == "__main__":
    main()
