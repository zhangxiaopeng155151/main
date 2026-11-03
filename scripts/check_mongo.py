"""检查一个 MongoDB 连接（本地副本集或 MongoDB Atlas）能不能跑这个 app。

app 对数据库有硬要求：必须是副本集（要有 setName），必须支持多文档事务。
MongoDB Atlas 免费层也是三节点副本集，满足要求，所以可以完全替代本机 Docker。

用法：
    python scripts/check_mongo.py                                  # 读项目配置里的地址
    python scripts/check_mongo.py --uri "mongodb+srv://user:pass@cluster0.xxx.mongodb.net/"
    MONGO_URI="mongodb+srv://..." python scripts/check_mongo.py
    python scripts/check_mongo.py --uri ... --database novel_generator

检查四件事：
    1. 能否连上，握手是否返回 setName（副本集）/ msg=isdbgrid（分片）；
    2. 服务端版本是否 ≥ 5（app 需要会话与事务）；
    3. 能否在临时集合里跑一次真实事务并回滚（证明事务真的可用）；
    4. 目标库现有小说数量，方便导入前确认。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "user_data" / "config" / "config.yaml"


def resolve_uri(cli_uri: str | None) -> str:
    """按 命令行 → 环境变量 → 项目配置 的顺序解析连接串。

    Args:
        cli_uri: 命令行传入的地址。
    Returns:
        连接串。
    """
    if cli_uri:
        return cli_uri
    import os
    env_uri = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
    if env_uri:
        return env_uri
    if CONFIG.exists():
        for match in re.finditer(r"(?m)^\s*mongodb_url\s*:\s*[\"']?([^\"'\n]*)", CONFIG.read_text(encoding="utf-8")):
            value = match.group(1).strip()
            if value:
                return value
    return "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"


def mask(uri: str) -> str:
    """把连接串里的密码打码后返回，便于安全打印。

    Args:
        uri: 原始连接串。
    Returns:
        已打码的连接串。
    """
    return re.sub(r"//([^:/@]+):([^@/]+)@", r"//\1:***@", uri)


def main() -> None:
    """执行四项检查并给出结论。"""
    parser = argparse.ArgumentParser(description="检查 MongoDB 是否满足 app 的要求")
    parser.add_argument("--uri", default=None, help="连接串；默认读环境变量或 user_data/config/config.yaml")
    parser.add_argument("--database", default="novel_generator", help="目标库名")
    parser.add_argument("--timeout", type=int, default=10000, help="连接超时毫秒")
    args = parser.parse_args()

    try:
        from pymongo import MongoClient
        from pymongo.errors import ConfigurationError, PyMongoError
    except ImportError:
        print("[错误] 缺少 pymongo，请先运行：python scripts/quickstart.py --check")
        sys.exit(1)

    uri = resolve_uri(args.uri)
    print(f"检查：{mask(uri)}")
    if not uri or "@" in uri and uri.split("@")[0].rstrip("/").endswith("//"):
        print("[失败] 连接串是空的：请在 --uri、MONGO_URI 或 user_data/config/config.yaml 里填地址")
        sys.exit(1)
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=args.timeout, connectTimeoutMS=args.timeout,
                             socketTimeoutMS=20000)
        hello = client.admin.command("hello")
    except ConfigurationError as exc:
        print(f"[失败] 连接串不合法或 SRV 解析失败：{exc}")
        print("       Atlas 的地址形如 mongodb+srv://用户:密码@cluster0.xxxxx.mongodb.net/")
        print("       注意：Atlas 不要带 directConnection=true 或 replicaSet=rs0 参数")
        sys.exit(1)
    except PyMongoError as exc:
        print(f"[失败] 连不上：{exc.__class__.__name__}")
        print("       本地：双击 开始创作.bat 拉起副本集")
        print("       Atlas：检查 Database Access 用户密码、Network Access 白名单、SRV 地址是否完整")
        sys.exit(1)

    set_name = hello.get("setName")
    is_shard = hello.get("msg") == "isdbgrid"
    print(f"  副本集：{set_name or '无'}{'（分片集群）' if is_shard else ''}")

    version = hello.get("maxWireVersion", 0)
    print(f"  maxWireVersion：{version}（app 需要 ≥ 13，对应 MongoDB 5.0+）")

    problems: list[str] = []
    if not set_name and not is_shard:
        problems.append("不是副本集：app 的写入依赖事务，单机 mongod 会报 WRITING_TRANSACTION_REQUIRED")
    if version < 13:
        problems.append("服务端版本过低（< MongoDB 5.0）：缺少会话与事务支持")

    db = client[args.database]
    probe = db["__agent_probe__"]
    try:
        with client.start_session() as session:
            with session.start_transaction():
                probe.insert_one({"_id": "probe", "ok": True}, session=session)
                session.abort_transaction()
        leftover = probe.count_documents({"_id": "probe"})
        print(f"  事务：可用（已回滚，残留文档 {leftover} 条）")
        if leftover:
            problems.append("临时探测文档未回滚成功，请手动删除 __agent_probe__ 集合")
    except PyMongoError as exc:
        print(f"  事务：不可用（{exc.__class__.__name__}）")
        problems.append("事务不可用，导入与 AI 写正文都会失败")
    finally:
        try:
            probe.drop()
        except PyMongoError:
            pass

    try:
        novels = db["novels"].count_documents({"is_deleted": {"$ne": True}})
        print(f"  目标库 `{args.database}`：已有小说 {novels} 本")
    except PyMongoError:
        print(f"  目标库 `{args.database}`：读不了（可能是用户权限不含该库）")

    print()
    if problems:
        print("[不合格] 这个数据库跑不了这个 app：")
        for item in problems:
            print(f"  · {item}")
        print()
        print("Atlas 排查顺序：Network Access 加白名单 → Database Access 用户对库有 readWrite 权限")
        print("连接串用 SRV 形式，且不要带 directConnection=true / replicaSet=rs0 这两个参数。")
        sys.exit(1)

    print("✓ 合格：这个数据库可以用于导入与 AI 写正文。")
    print("  下一步：python scripts/import_book_plan.py --mongo-uri \"" + mask(uri) + "\"")


if __name__ == "__main__":
    main()
