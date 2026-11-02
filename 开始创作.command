#!/usr/bin/env bash
# macOS：在 Finder 里双击本文件即可启动（首次可能需要在"系统设置 → 隐私与安全性"里允许）。
# 等价于：python3 scripts/quickstart.py --persist-config
set -euo pipefail
cd "$(dirname "$0")"
echo "============================================"
echo "  AI 小说生成器 - 一键开始创作"
echo "  首次运行会自动安装依赖、启动 MongoDB 并构建前端"
echo "============================================"
PYTHON_BIN="${PYTHON:-python3}"
if ! "$PYTHON_BIN" -c 'import sys;raise SystemExit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
  echo "[错误] 未找到 Python 3.11+，请先安装 Python 3.13：https://www.python.org/downloads/"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi
"$PYTHON_BIN" scripts/quickstart.py --persist-config "$@" || {
  echo
  echo "[失败] 启动未完成，请把上面的报错信息发给助手。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}
