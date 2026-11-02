#!/usr/bin/env bash
# 本机开发启动脚本（macOS / Linux）。仅负责检查与启动，不下载代码、不安装数据库。
# 用法：
#   scripts/dev_local.sh setup     创建 .venv 并安装前后端依赖
#   scripts/dev_local.sh backend   前台启动后端（热重载，127.0.0.1:8200）
#   scripts/dev_local.sh frontend  前台启动前端 dev 服务（127.0.0.1:3300）
#   scripts/dev_local.sh check     只做环境自检
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv"
PY="${PYTHON:-python3}"
BACKEND_PORT="${NOVEL_GENERATOR_BACKEND_PORT:-8200}"
FRONTEND_PORT="${NOVEL_GENERATOR_FRONTEND_PORT:-3300}"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
ok() { printf '✓ %s\n' "$*"; }

python_ok() {
  local exe="$1"
  "$exe" - <<'EOF' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
EOF
}

check() {
  # 1) Python 3.12+（backend/migrations 使用 Path.is_junction）
  if [ -x "$VENV/bin/python" ]; then
    python_ok "$VENV/bin/python" && ok "venv Python $("$VENV/bin/python" -V 2>&1)" \
      || fail "venv Python 版本 < 3.12，请删除 .venv 后用 Python 3.13 重建"
  elif command -v "$PY" >/dev/null 2>&1 && python_ok "$PY"; then
    ok "系统 Python $("$PY" -V 2>&1)（尚未创建 .venv，运行 setup）"
  else
    fail "需要 Python 3.12+（推荐 3.13）：$PY 不可用或版本过低"
  fi

  # 2) Node >= 20.9
  if ! command -v node >/dev/null 2>&1; then
    fail "缺少 Node.js（需要 >= 20.9，推荐 24）"
  fi
  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]')"
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$major" -lt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -lt 9 ]; }; then
    fail "Node 版本过低（$(node -v)），需要 >= 20.9"
  fi
  ok "Node $(node -v)"

  # 3) MongoDB 副本集：只做提示，交给用户确认
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker 可用，可用 compose.mongodb.yaml 启动 MongoDB 副本集"
  else
    printf '! 未检测到可用的 Docker；请确保本地有副本集 MongoDB（需要 replicaSet，否则无法保存）\n'
  fi

  printf '  后端端口 %s / 前端端口 %s / MongoDB 默认 127.0.0.1:27017\n' "$BACKEND_PORT" "$FRONTEND_PORT"
  printf '  数据库配置：mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true  数据库名 novel_generator\n'
}

setup() {
  check
  if [ ! -x "$VENV/bin/python" ]; then
    "$PY" -m venv "$VENV"
    ok "已创建 .venv"
  fi
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install -r "$ROOT/requirements.txt"
  (cd "$ROOT/frontend" && npm ci)
  ok "依赖安装完成"
}

case "${1:-check}" in
  check) check ;;
  setup) setup ;;
  backend)
    [ -x "$VENV/bin/python" ] || fail "缺少 .venv，先运行 scripts/dev_local.sh setup"
    cd "$ROOT"
    exec "$VENV/bin/uvicorn" backend.app:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload
    ;;
  frontend)
    cd "$ROOT/frontend"
    exec npm run dev -- --hostname 127.0.0.1 --port "$FRONTEND_PORT"
    ;;
  *) fail "未知子命令：$1（可用：setup / backend / frontend / check）" ;;
esac
