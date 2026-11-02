#!/usr/bin/env bash
# 一键启动入口（macOS / Linux）。等价于 python scripts/quickstart.py，参数原样透传。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec "${PYTHON:-python3}" scripts/quickstart.py "$@"
