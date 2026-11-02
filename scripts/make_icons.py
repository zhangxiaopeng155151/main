#!/usr/bin/env python3
"""从源图生成桌面程序图标的全部尺寸（Windows .ico / macOS .icns / Linux PNG）。

源图要求：正方形、圆角方块图标、外部背景为纯色或棋盘格（本脚本会从四角泛洪去背）。

用法：
    python scripts/make_icons.py                     # 使用 assets/app-icon-source.png
    python scripts/make_icons.py --source 某图.png --out assets

产物：
    assets/app-icon.png                1024×1024 透明底
    assets/app-icon-{512,256,128,64,32}.png
    assets/app-icon.ico                16/24/32/48/64/128/256 多尺寸（Windows 快捷方式）
    assets/app-icon.icns               macOS 图标（缺少 icnsutil 时跳过并提示）
    assets/app-icon.iconset/           macOS iconutil 可用的 iconset 目录
    assets/icons/hicolor/<n>x<n>/apps/ai-novel-generator.png   Linux 主题图标
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_SIZES = (512, 256, 128, 64, 32)
ICONSET = (
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
)
LINUX_SIZES = (16, 24, 32, 48, 64, 128, 256, 512)


def is_background(pixel: tuple[int, int, int], threshold: int = 30) -> bool:
    """判断像素是否属于"可去背"的浅色背景。

    Args:
        pixel: RGB 三元组。
        threshold: 三通道差值容忍度（棋盘格两种灰阶相差约 20）。
    Returns:
        三通道都接近且足够亮时返回 True。
    """
    low, high = min(pixel), max(pixel)
    return high - low <= threshold and low >= 200


def _largest_component_mask(width: int, height: int, content: bytearray) -> bytearray:
    """返回 content 中最大连通块的掩码（4 邻接），用于剔除背景碎点。

    Args:
        width: 图像宽。
        height: 图像高。
        content: 长度 width*height 的字节数组，1 表示前景候选。
    Returns:
        与 content 同长度的掩码，1 表示属于最大连通块。
    """
    seen = bytearray(width * height)
    best: list[int] = []
    best_size = 0
    for start_index in range(width * height):
        if not content[start_index] or seen[start_index]:
            continue
        stack = [start_index]
        seen[start_index] = 1
        members: list[int] = []
        while stack:
            index = stack.pop()
            members.append(index)
            x, y = index % width, index // width
            for neighbour in (
                index - 1 if x > 0 else -1,
                index + 1 if x < width - 1 else -1,
                index - width if y > 0 else -1,
                index + width if y < height - 1 else -1,
            ):
                if neighbour >= 0 and content[neighbour] and not seen[neighbour]:
                    seen[neighbour] = 1
                    stack.append(neighbour)
        if len(members) > best_size:
            best, best_size = members, len(members)
    mask = bytearray(width * height)
    for index in best:
        mask[index] = 1
    return mask


def strip_checkerboard(image: Image.Image, threshold: int = 30) -> Image.Image:
    """去除棋盘格/纯色背景并只保留主体图标，返回带 alpha 的图。

    做法：先把"三通道接近且足够亮"的像素判为背景候选，剩下的前景取最大连通块，
    这样即使棋盘格有深浅两种灰阶也不会在四角留下碎点。

    Args:
        image: 源图（RGB 或 RGBA）。
        threshold: 判定背景时允许的通道差值。
    Returns:
        背景透明、按内容裁边后的 RGBA 图。
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()

    content = bytearray(width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            if not is_background(pixels[x, y], threshold):
                content[row + x] = 1

    mask = _largest_component_mask(width, height, content)

    alpha = Image.new("L", (width, height), 0)
    alpha_pixels = alpha.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if mask[row + x]:
                alpha_pixels[x, y] = 255

    # 轻微扩张再收缩，抹掉抗锯齿造成的白边
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))

    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    box = result.getbbox()
    if box:
        left, top, right, bottom = box
        pad = max(2, round(min(width, height) * 0.01))
        result = result.crop((max(0, left - pad), max(0, top - pad),
                              min(width, right + pad), min(height, bottom + pad)))
    return result


def square(image: Image.Image, size: int) -> Image.Image:
    """把图像居中放入正方形画布并缩放（保持比例、透明填充）。

    Args:
        image: 输入图。
        size: 目标边长。
    Returns:
        指定边长的 RGBA 图。
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min(size / image.width, size / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                           Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def build_icns(master: Image.Image, iconset_dir: Path, target: Path) -> bool:
    """生成 macOS .icns（优先 icnsutil，缺失时保留 iconset 供 iconutil 使用）。

    Args:
        master: 1024 边长主图。
        iconset_dir: iconset 输出目录。
        target: .icns 目标路径。
    Returns:
        成功写出 .icns 时返回 True。
    """
    if iconset_dir.exists():
        shutil.rmtree(iconset_dir)
    iconset_dir.mkdir(parents=True)
    for name, size in ICONSET:
        square(master, size).save(iconset_dir / name)

    try:
        from icnsutil import IcnsFile  # type: ignore
    except ImportError:
        helper = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "icnsutil"],
                                capture_output=True, text=True)
        if helper.returncode != 0:
            print("! 未安装 icnsutil，跳过 .icns（macOS 上可执行：iconutil -c icns app-icon.iconset）")
            return False
        from icnsutil import IcnsFile  # type: ignore

    icns = IcnsFile()
    for name, size in ICONSET:
        icns.add_media(file=str(iconset_dir / name))
    icns.write(str(target))
    return True


def main() -> None:
    """解析参数并生成全部图标产物。"""
    parser = argparse.ArgumentParser(description="生成桌面程序图标")
    parser.add_argument("--source", default=str(ROOT / "assets" / "app-icon-source.png"))
    parser.add_argument("--out", default=str(ROOT / "assets"))
    args = parser.parse_args()

    source = Path(args.source)
    out = Path(args.out)
    if not source.exists():
        raise SystemExit(f"找不到源图：{source}")
    out.mkdir(parents=True, exist_ok=True)

    raw = Image.open(source)
    transparent = strip_checkerboard(raw)
    master = square(transparent, 1024)
    master.save(out / "app-icon.png")
    print(f"✓ app-icon.png 1024×1024（去背后 {transparent.size[0]}×{transparent.size[1]}）")

    for size in PNG_SIZES:
        square(master, size).save(out / f"app-icon-{size}.png")
    print("✓ PNG 尺寸：" + ", ".join(str(s) for s in PNG_SIZES))

    square(master, 256).save(out / "app-icon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print("✓ app-icon.ico（" + "/".join(str(s) for s in ICO_SIZES) + "）")

    for size in LINUX_SIZES:
        folder = out / "icons" / "hicolor" / f"{size}x{size}" / "apps"
        folder.mkdir(parents=True, exist_ok=True)
        square(master, size).save(folder / "ai-novel-generator.png")
    print("✓ Linux hicolor 图标：" + ", ".join(str(s) for s in LINUX_SIZES))

    if build_icns(master, out / "app-icon.iconset", out / "app-icon.icns"):
        print("✓ app-icon.icns")


if __name__ == "__main__":
    main()
