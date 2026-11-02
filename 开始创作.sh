#!/usr/bin/env bash
# Linux：双击或在终端执行本文件即可启动。
# 等价于：python3 scripts/quickstart.py --persist-config
set -euo pipefail
cd "$(dirname "$0")"
echo "============================================"
echo "  AI 小说生成器 - 一键开始创作"
echo "  首次运行会自动安装依赖、启动 MongoDB 并构建前端"
echo "============================================"
exec "${PYTHON:-python3}" scripts/quickstart.py --persist-config "$@"
