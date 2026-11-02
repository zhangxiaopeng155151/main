#!/usr/bin/env python3
"""一键准备并启动 AI 小说生成器（Windows / macOS / Linux 通用）。

它只做"让项目跑起来"这件事，不改动你的运行时代码：

1. 自检 Python（>=3.12，3.11 亦可运行但官方推荐 3.13）、Node（>=20.9）、Git；
2. 用 compose.mongodb.yaml 启动 MongoDB 8.0 单节点副本集，必要时自动 rs.initiate，
   并等待其成为可写主节点（保存操作需要多文档事务，单机实例会失败）；
3. 缺少 .venv / node_modules / 前端构建产物时按需安装与构建；
4. 起后端（127.0.0.1:8200）与前端（127.0.0.1:3300），等待健康后打开浏览器。

常用：
  python scripts/quickstart.py                 # 默认：生产前端 + 自动起 MongoDB
  python scripts/quickstart.py --dev           # 开发模式：uvicorn --reload + next dev
  python scripts/quickstart.py --check         # 只做环境自检，不启动任何服务
  python scripts/quickstart.py --no-mongo      # 已有副本集，跳过 Docker 步骤
  python scripts/quickstart.py --mongo-uri "mongodb://host:27017/?replicaSet=rs0"  # 用外部库
  python scripts/quickstart.py --rebuild       # 强制重新构建前端
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
COMPOSE_FILE = ROOT / "compose.mongodb.yaml"
IS_WINDOWS = sys.platform == "win32"
DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"
DEFAULT_DB_NAME = "novel_generator"


def say(message: str) -> None:
    """打印带前缀的进度行。

    Args: message: 文本内容。
    Returns: 无。
    """
    print(f"[quickstart] {message}", flush=True)


def die(message: str, hint: str = "") -> "NoReturn":  # type: ignore[valid-type]
    """打印错误与修复建议后退出。

    Args: message: 错误描述。hint: 可选的修复建议。
    Returns: 不返回。
    """
    print(f"\n[错误] {message}", file=sys.stderr)
    if hint:
        print(f"  建议：{hint}", file=sys.stderr)
    raise SystemExit(1)


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None,
        capture: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    """执行外部命令，失败时给出可读信息。

    Args:
        cmd: 命令与参数列表。
        cwd: 工作目录。
        env: 额外环境变量，会与当前进程环境合并。
        capture: 是否捕获输出（否则直接打印到终端）。
        check: 非 0 退出码是否抛错。
    Returns: 完成的进程对象。
    """
    merged = {**os.environ, **(env or {})}
    return subprocess.run(
        cmd, cwd=str(cwd or ROOT), env=merged, check=check,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        text=True,
    )


def venv_python() -> Path:
    """返回项目虚拟环境里的解释器路径。

    Args: 无。
    Returns: 已存在或应创建的解释器路径。
    """
    return ROOT / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


def python_ok(exe: Path) -> bool:
    """判断解释器是否满足最低版本要求（3.11，推荐 3.12+）。

    Args: exe: 解释器路径。
    Returns: 版本满足要求时返回 True。
    """
    try:
        out = run([str(exe), "-c", "import sys;print(sys.version_info[:2])"], capture=True, check=False)
    except OSError:
        return False
    return out.returncode == 0 and "3, 1" in out.stdout.replace("(", "").replace(")", "")


def node_version() -> tuple[int, int] | None:
    """读取 Node 主次版本号。

    Args: 无。
    Returns: (主版本, 次版本)，未安装时为 None。
    """
    if not shutil.which("node"):
        return None
    out = run(["node", "-p", "process.versions.node"], capture=True, check=False)
    if out.returncode != 0:
        return None
    major, minor, *_ = out.stdout.strip().split(".")
    return int(major), int(minor)


def port_free(port: int) -> bool:
    """检查本机端口是否可用。

    Args: port: 端口号。
    Returns: 未被占用时返回 True。
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def check_environment() -> None:
    """自检 Python、Node、Docker 与端口。

    Args: 无。
    Returns: 无；不满足条件时抛出 SystemExit。
    """
    py = venv_python()
    exe = py if py.exists() else Path(sys.executable)
    if not python_ok(exe):
        die(f"Python 版本过低或不可用：{exe}",
            "安装 Python 3.13（https://www.python.org/downloads/），删除 .venv 后重跑本脚本")
    version = run([str(exe), "-c", "import sys;print(sys.version.split()[0])"], capture=True, check=False)
    say(f"Python {version.stdout.strip()}（{exe}）")
    if sys.version_info[:2] < (3, 12):
        say("提示：官方推荐 Python 3.13；当前 3.11 也能运行（已做 is_junction 兼容）")

    node = node_version()
    if node is None:
        die("未找到 Node.js", "安装 Node 24（https://nodejs.org），需要 >= 20.9")
    if node < (20, 9):
        die(f"Node 版本过低：{node[0]}.{node[1]}", "升级到 Node 24（最低 20.9）")
    say(f"Node {node[0]}.{node[1]}")

    if shutil.which("docker"):
        if run(["docker", "info"], capture=True, check=False).returncode == 0:
            say("Docker 已运行")
        else:
            say("警告：Docker 已安装但引擎未启动（需先用 --no-mongo 或启动 Docker Desktop）")
    else:
        say("警告：未找到 Docker，MongoDB 需要你自行准备副本集（见 --no-mongo）")


def ensure_python_deps(force: bool = False) -> Path:
    """确保 .venv 存在并安装 requirements.txt。

    Args:
        force: 是否强制重新安装依赖。
    Returns: 虚拟环境解释器路径。
    """
    py = venv_python()
    if not py.exists():
        say("创建 Python 虚拟环境 .venv ...")
        run([sys.executable, "-m", "venv", str(ROOT / ".venv")])
        py = venv_python()
    marker = ROOT / ".venv" / ".quickstart-deps"
    if force or not marker.exists():
        say("安装后端依赖 requirements.txt（首次约 1~3 分钟）...")
        run([str(py), "-m", "pip", "install", "--upgrade", "pip"], capture=True, check=False)
        run([str(py), "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])
        marker.write_text("ok\n", encoding="utf-8")
    else:
        say("后端依赖已安装（跳过；用 --reinstall 强制重装）")
    return py


def ensure_frontend_deps(force: bool = False) -> None:
    """安装前端依赖。

    Args:
        force: 是否强制重新安装。
    Returns: 无。
    """
    modules = FRONTEND / "node_modules"
    if force or not modules.exists():
        say("安装前端依赖（npm ci，首次约 1~2 分钟）...")
        run(["npm", "ci"], cwd=FRONTEND)
    else:
        say("前端依赖已安装（跳过）")


def ensure_frontend_build(backend_port: int, force: bool = False) -> None:
    """按需构建前端生产产物。

    Args:
        backend_port: 后端端口，写入 NEXT_PUBLIC_API_BASE（构建期生效）。
        force: 是否强制重新构建。
    Returns: 无。
    """
    build_id = FRONTEND / ".next" / "BUILD_ID"
    api_base = f"http://127.0.0.1:{backend_port}"
    stamp = FRONTEND / ".next" / ".quickstart-api-base"
    if force or not build_id.exists() or not stamp.exists() or stamp.read_text(encoding="utf-8").strip() != api_base:
        say(f"构建前端（NEXT_PUBLIC_API_BASE={api_base}，约 1 分钟）...")
        run(["npm", "run", "build"], cwd=FRONTEND, env={"NEXT_PUBLIC_API_BASE": api_base})
        stamp.write_text(api_base + "\n", encoding="utf-8")
    else:
        say("前端构建产物已是最新（跳过；用 --rebuild 强制重建）")


def compose(*args: str, capture: bool = True) -> subprocess.CompletedProcess:
    """以项目 compose 文件执行 docker compose 子命令。

    Args:
        *args: 传给 docker compose 的参数。
        capture: 是否捕获输出。
    Returns: 完成的进程对象。
    """
    return run(["docker", "compose", "-f", str(COMPOSE_FILE), *args], capture=capture, check=False)


def mongosh(script: str) -> subprocess.CompletedProcess:
    """在容器内执行 mongosh 脚本。

    Args: script: JavaScript 片段。
    Returns: 完成的进程对象。
    """
    return compose("exec", "-T", "mongodb", "mongosh", "--quiet", "--eval", script)


def start_mongodb() -> None:
    """启动本地 MongoDB 副本集，必要时初始化并等待可写主节点。

    Args: 无。
    Returns: 无。
    """
    if not shutil.which("docker"):
        die("需要 Docker 才能自动启动 MongoDB",
            "安装 Docker Desktop 后重试，或加 --no-mongo 使用已有副本集")
    if compose("up", "-d", capture=False).returncode != 0:
        die("docker compose 启动 MongoDB 失败",
            "确认 Docker Desktop 正在运行；若 27017 已被其他 MongoDB 占用，请改用 --no-mongo")
    say("等待 MongoDB 容器进入 healthy ...")
    for _ in range(60):
        state = run(["docker", "inspect", "-f", "{{.State.Health.Status}}", "novel-generator-mongodb"],
                    capture=True, check=False)
        if state.stdout.strip() == "healthy":
            break
        time.sleep(1)
    else:
        die("MongoDB 容器 60 秒内未就绪",
            "运行 docker compose -f compose.mongodb.yaml logs mongodb 查看原因；已有数据时不要清空数据卷")

    if mongosh("try { rs.status().ok } catch (e) { 0 }").stdout.strip().endswith("1"):
        say("副本集 rs0 已初始化（跳过 rs.initiate）")
    else:
        say("初始化副本集 rs0（仅在首次使用全新数据卷时执行）...")
        result = mongosh('rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })')
        if result.returncode != 0 and "already initialized" not in (result.stdout or ""):
            die("rs.initiate 失败", (result.stdout or "").strip()[-400:])

    say("等待副本集选出可写主节点 ...")
    for _ in range(60):
        probe = mongosh("quit(db.hello().isWritablePrimary ? 0 : 1)")
        if probe.returncode == 0:
            say("MongoDB 副本集就绪")
            return
        time.sleep(1)
    die("副本集未成为可写主节点", "运行 docker compose -f compose.mongodb.yaml ps 检查状态")


# 由虚拟环境解释器执行：脚本本身只用标准库，避免把 yaml 等依赖加到启动器上。
_PERSIST_SCRIPT = """
import sys
sys.path.insert(0, sys.argv[1])
from backend.config import config as config_module

uri, db_name = sys.argv[2], sys.argv[3]
current_uri = str(config_module.get_config_value("mongodb_url", "") or "").strip()
current_db = str(config_module.get_config_value("mongo_database_name", "") or "").strip()
if current_uri and current_uri != uri:
    print(f"配置文件已有其他数据库地址，保持不变：{current_uri}")
    raise SystemExit(0)
if current_uri == uri and current_db == db_name:
    print("配置文件中的数据库设置已是最新")
    raise SystemExit(0)
version = int(config_module.get_config_value("config_version", 1) or 1)
try:
    # 连接地址属于敏感字段，必须通过 mongodb_url_update.replace 显式提交。
    config_module.update_config(
        {
            "mongodb_url_update": {"action": "replace", "value": uri},
            "mongo_database_name": db_name,
        },
        expected_config_version=version,
    )
except Exception as exc:
    print(f"写入配置文件失败（{exc}），本次仍通过环境变量生效")
    raise SystemExit(0)
print(f"已写入 {config_module.CONFIG_PATH}（数据库 {db_name}）")
"""


def persist_config(uri: str, db_name: str) -> None:
    """把数据库地址写入 user_data/config/config.yaml，方便之后用其他方式启动。

    通过虚拟环境解释器执行，避免在启动器进程里引入后端依赖；
    原有配置已指向别的地址时保持不动。

    Args:
        uri: MongoDB 连接串。
        db_name: 数据库名。
    Returns: 无。
    """
    py = venv_python()
    if not py.exists():
        say("跳过写入配置文件（尚未创建 .venv）")
        return
    result = run([str(py), "-c", _PERSIST_SCRIPT, str(ROOT), uri, db_name],
                 cwd=ROOT, capture=True, check=False)
    lines = [line for line in (result.stdout or "").strip().splitlines() if line.strip()]
    if result.returncode != 0:
        tail = " / ".join(lines[-3:]) or f"退出码 {result.returncode}"
        say(f"跳过写入配置文件（{tail}）")
        return
    for line in lines:
        say(line)


def wait_http(url: str, seconds: int = 120, process: subprocess.Popen | None = None) -> bool:
    """轮询等待 HTTP 服务可用；被监视的进程提前退出时立即返回。

    Args:
        url: 目标地址。
        seconds: 最长等待秒数。
        process: 可选的服务进程，退出后不再继续等待。
    Returns: 在超时前可用时返回 True。
    """
    deadline = time.time() + seconds
    while time.time() < deadline:
        if process is not None and process.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status < 500:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    return False


def main() -> None:
    """解析参数并完成准备与启动。

    Args: 无。
    Returns: 无。
    """
    parser = argparse.ArgumentParser(description="一键准备并启动 AI 小说生成器")
    parser.add_argument("--check", action="store_true", help="只做环境自检")
    parser.add_argument("--dev", action="store_true", help="开发模式（后端热重载 + next dev）")
    parser.add_argument("--no-mongo", action="store_true", help="跳过 Docker，使用已有 MongoDB 副本集")
    parser.add_argument("--mongo-uri", default=os.environ.get("NOVEL_GENERATOR_MONGODB_URL", DEFAULT_MONGO_URI),
                        help="MongoDB 连接串（默认本地副本集）")
    parser.add_argument("--db-name", default=os.environ.get("NOVEL_GENERATOR_MONGO_DATABASE_NAME", DEFAULT_DB_NAME),
                        help="数据库名（默认 novel_generator）")
    parser.add_argument("--backend-port", type=int, default=int(os.environ.get("NOVEL_GENERATOR_BACKEND_PORT", 8200)))
    parser.add_argument("--frontend-port", type=int, default=int(os.environ.get("NOVEL_GENERATOR_FRONTEND_PORT", 3300)))
    parser.add_argument("--reinstall", action="store_true", help="强制重装依赖")
    parser.add_argument("--rebuild", action="store_true", help="强制重新构建前端")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--persist-config", action="store_true",
                        help="把数据库地址写入 user_data/config/config.yaml（之后用 start.bat 也能直接跑）")
    parser.add_argument("--open-workspace", choices=("shelf", "new"), default=None,
                        help="启动后自动打开的页面：shelf 书架 / new 新建小说（桌面图标默认用 new）")
    args = parser.parse_args()

    say(f"项目目录：{ROOT}")
    check_environment()
    if args.check:
        say("自检完成（未启动任何服务）")
        return

    for port, name in ((args.backend_port, "后端"), (args.frontend_port, "前端")):
        if not port_free(port):
            die(f"{name}端口 {port} 已被占用", "关掉占用进程，或用 --backend-port / --frontend-port 换端口")

    py = ensure_python_deps(force=args.reinstall)
    ensure_frontend_deps(force=args.reinstall)
    if not args.dev:
        ensure_frontend_build(args.backend_port, force=args.rebuild)

    if not args.no_mongo:
        start_mongodb()

    if args.persist_config:
        persist_config(args.mongo_uri, args.db_name)

    env = {
        "NOVEL_GENERATOR_MONGODB_URL": args.mongo_uri,
        "NOVEL_GENERATOR_MONGO_DATABASE_NAME": args.db_name,
        "NOVEL_GENERATOR_BACKEND_PORT": str(args.backend_port),
        "NOVEL_GENERATOR_FRONTEND_PORT": str(args.frontend_port),
        "PYTHONUNBUFFERED": "1",
    }

    say(f"启动后端 http://127.0.0.1:{args.backend_port} ...")
    backend_cmd = ([str(py), "main.py"] if not args.dev else
                   [str(py), "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1",
                    "--port", str(args.backend_port), "--reload"])
    backend = subprocess.Popen(backend_cmd, cwd=str(ROOT), env={**os.environ, **env})

    say(f"启动前端 http://127.0.0.1:{args.frontend_port} ...")
    frontend_cmd = (["npm", "run", "start", "--", "--hostname", "127.0.0.1", "--port", str(args.frontend_port)]
                    if not args.dev else
                    ["npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", str(args.frontend_port)])
    frontend = subprocess.Popen(frontend_cmd, cwd=str(FRONTEND), env={**os.environ, **env})

    try:
        if not wait_http(f"http://127.0.0.1:{args.backend_port}/api/startup", 120, backend):
            die("后端未能启动",
                "查看上方后端日志。若报\"这个数据目录正在使用\"，说明已有一个实例在使用同一份用户数据："
                "先关掉之前的窗口，或直接用浏览器打开应用地址")
        if not wait_http(f"http://127.0.0.1:{args.frontend_port}/", 180, frontend):
            die("前端未能启动", "查看上方前端日志（首次 dev 编译较慢）")
        url = f"http://127.0.0.1:{args.frontend_port}"
        target = url
        if args.open_workspace == "new":
            target = f"{url}/zh/writing/new"
        elif args.open_workspace == "shelf":
            target = f"{url}/zh"
        say(f"应用已启动：{url}")
        say(f"数据库：{args.mongo_uri}（库名 {args.db_name}）")
        say(f"接口文档：http://127.0.0.1:{args.backend_port}/docs")
        if not args.no_browser:
            webbrowser.open(target)
            if target != url:
                say(f"已直接打开：{target}")
        say("按 Ctrl+C 停止前后端（MongoDB 由 Docker 单独管理）")
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(1)
        say("有服务已退出，正在收尾 ...")
    except KeyboardInterrupt:
        say("收到中断，正在停止服务 ...")
    finally:
        for process in (frontend, backend):
            if process.poll() is None:
                process.terminate()
        for process in (frontend, backend):
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
