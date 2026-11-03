"""把 book-plan.json 写入 AI_NovelGenerator 的 MongoDB，导入后即可在界面里续写。

用法：
    python scripts/import_book_plan.py --dry-run          # 只校验，不连数据库
    python scripts/import_book_plan.py                     # 连默认数据库导入
    python scripts/import_book_plan.py --mongo-uri "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"
    python scripts/import_book_plan.py --replace           # 先删掉同名小说再导入

说明：
    · 只写 novels / volumes / arcs / scenes / chapters 五个集合，字段与项目自身的创建逻辑一致；
    · 章节的 content 为空、word_count 为 0，因此导入后界面会把它当作"待写的第一章"继续生成；
    · 不写人物、势力等事实集合（那些用界面里的 AI 任务生成效果更好），设定集见 docs。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "books" / "刻天" / "book-plan.json"
CONFIG = ROOT / "user_data" / "config" / "config.yaml"
DEFAULT_URI = "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"
DEFAULT_DB = "novel_generator"

# 与后端契约一致的长度上限
LIMITS = {
    "novel.title": 200,
    "novel.subtitle": 500,
    "novel.genre": 100,
    "novel.introduction": 20000,
    "novel.summary": 20000,
    "novel.core_seed": 20000,
    "novel.worldview": 20000,
    "novel.writing_style": 10000,
    "novel.era_background": 10000,
    "novel.plot": 40000,
    "novel.tone": 500,
    "novel.target_audience": 1000,
    "novel.narrative_pov": 200,
    "volume.title": 120,
    "volume.goal": 2000,
    "volume.summary": 2000,
    "volume.premise": 1000,
    "volume.major_conflict": 2000,
    "arc.title": 120,
    "arc.goal": 2000,
    "chapter.title": 120,
    "chapter.summary": 2000,
    "chapter.beat": 2000,
}


class PlanError(ValueError):
    """计划数据不符合后端契约时抛出。"""


def now_ms() -> datetime:
    """返回截断到毫秒的 UTC 时间（与 MongoDB 解码精度一致）。

    Returns:
        naive UTC datetime。
    """
    current = datetime.now(timezone.utc)
    return current.replace(tzinfo=None, microsecond=(current.microsecond // 1000) * 1000)


def check_length(label: str, value: Any, limit_key: str) -> None:
    """校验字符串长度上限。

    Args:
        label: 出错位置。
        value: 待校验值。
        limit_key: LIMITS 中的键。
    Returns:
        无。
    Raises:
        PlanError: 超长或类型错误。
    """
    if not isinstance(value, str):
        raise PlanError(f"{label} 必须是字符串")
    limit = LIMITS[limit_key]
    if len(value) > limit:
        raise PlanError(f"{label} 长度 {len(value)} 超过上限 {limit}")


def validate(plan: dict) -> dict:
    """按后端契约校验计划文件，并返回统计信息。

    Args:
        plan: book-plan.json 的内容。
    Returns:
        章、篇章、场景数量的统计。
    Raises:
        PlanError: 缺少字段或超出上限。
    """
    if plan.get("format") != "novel-plan/v1":
        raise PlanError("format 必须是 novel-plan/v1")
    novel = plan["novel"]
    for field in ("title", "genre"):
        if not str(novel.get(field) or "").strip():
            raise PlanError(f"novel.{field} 不能为空")
    for field in ("title", "subtitle", "genre", "introduction", "summary", "core_seed",
                  "worldview", "writing_style", "era_background", "plot", "tone",
                  "target_audience", "narrative_pov"):
        if novel.get(field):
            check_length(f"novel.{field}", novel[field], f"novel.{field}")

    volumes = plan.get("volumes") or []
    if not volumes:
        raise PlanError("至少需要一卷")
    chapters_total = arcs_total = scenes_total = 0
    for volume_index, volume in enumerate(volumes, start=1):
        if volume.get("order_index") != volume_index:
            raise PlanError(f"第 {volume_index} 卷的 order_index 必须是 {volume_index}")
        for field in ("title", "goal", "summary"):
            check_length(f"卷{volume_index}.{field}", volume.get(field, ""), f"volume.{field}")
        planning = volume.get("planning") or {}
        required = ("premise", "major_conflict", "start_state", "end_state",
                    "key_turning_points", "target_chapter_count", "target_word_count")
        missing = [name for name in required if planning.get(name) in (None, "", [])]
        if missing:
            raise PlanError(f"卷{volume_index} 缺少卷规划字段：{', '.join(missing)}")
        check_length(f"卷{volume_index}.planning.premise", planning["premise"], "volume.premise")
        check_length(f"卷{volume_index}.planning.major_conflict", planning["major_conflict"],
                     "volume.major_conflict")
        if len(planning["key_turning_points"]) > 20:
            raise PlanError(f"卷{volume_index} 的关键转折不能超过 20 条")

        for arc_index, arc in enumerate(volume.get("arcs") or [], start=1):
            arcs_total += 1
            if arc.get("order_index") != arc_index:
                raise PlanError(f"卷{volume_index} 第 {arc_index} 篇章的 order_index 不正确")
            check_length(f"卷{volume_index}篇章{arc_index}.title", arc.get("title", ""), "arc.title")
            check_length(f"卷{volume_index}篇章{arc_index}.planning.goal",
                         (arc.get("planning") or {}).get("goal", ""), "arc.goal")
            for scene_index, scene in enumerate(arc.get("scenes") or [], start=1):
                scenes_total += 1
                chapters = scene.get("chapters") or []
                if not chapters:
                    raise PlanError(f"卷{volume_index}篇章{arc_index}场景{scene_index} 没有章节")
                if len(chapters) > 5:
                    raise PlanError(f"场景内章节超过 5 个：卷{volume_index}篇章{arc_index}场景{scene_index}")
                for chapter in chapters:
                    chapters_total += 1
                    check_length(f"第{chapter.get('chapter_number')}章.title",
                                 chapter.get("title", ""), "chapter.title")
                    check_length(f"第{chapter.get('chapter_number')}章.summary",
                                 chapter.get("summary", ""), "chapter.summary")
                    chapter_planning = chapter.get("planning") or {}
                    for field in ("goal", "start_state", "end_state"):
                        if not chapter_planning.get(field):
                            raise PlanError(f"第{chapter.get('chapter_number')}章 planning.{field} 为空")
                        check_length(f"第{chapter.get('chapter_number')}章 planning.{field}",
                                     chapter_planning[field], "chapter.summary")
                    beats = chapter_planning.get("beats") or []
                    if len(beats) > 30:
                        raise PlanError(f"第{chapter.get('chapter_number')}章 beats 不能超过 30 条")
                    for beat in beats:
                        check_length(f"第{chapter.get('chapter_number')}章 beat", beat, "chapter.beat")

    numbers = [chapter["chapter_number"] for volume in volumes for arc in volume["arcs"]
               for scene in arc["scenes"] for chapter in scene["chapters"]]
    if numbers != list(range(1, len(numbers) + 1)):
        raise PlanError("章号必须从 1 开始连续")
    return {"volumes": len(volumes), "arcs": arcs_total, "scenes": scenes_total, "chapters": chapters_total}


def build_documents(plan: dict) -> dict[str, list[dict]]:
    """把计划编译成五个集合的待插入文档（不含 _id 关联）。

    Args:
        plan: 已通过校验的计划。
    Returns:
        {集合名: 文档列表}；层级关系用占位路径表示。
    """
    novel = plan["novel"]
    stamp = now_ms()
    volumes_docs: list[dict] = []
    arcs_docs: list[dict] = []
    scenes_docs: list[dict] = []
    chapters_docs: list[dict] = []

    for volume in plan["volumes"]:
        volume_arcs = volume["arcs"]
        chapter_count = sum(len(scene["chapters"]) for arc in volume_arcs for scene in arc["scenes"])
        arcs_count = len(volume_arcs)
        volumes_docs.append({
            "path": f"volume:{volume['order_index']}",
            "order_index": volume["order_index"],
            "title": volume["title"],
            "subtitle": volume["subtitle"],
            "summary": volume["summary"],
            "goal": volume["goal"],
            "theme": volume["theme"],
            "planning": volume["planning"],
            "plot": "",
            "plot_source_fingerprint": None,
            "location_ids": [],
            "preparation": {},
            "status": volume.get("status") or "draft",
            "arcs_count": arcs_count,
            "chapter_count": chapter_count,
            "word_count": 0,
            "version": 1,
            "is_deleted": False,
            "deleted_at": None,
            "created_at": stamp,
            "updated_at": stamp,
        })
        for arc in volume_arcs:
            arc_scenes = arc["scenes"]
            arc_chapters = sum(len(scene["chapters"]) for scene in arc_scenes)
            arcs_docs.append({
                "path": f"volume:{volume['order_index']}/arc:{arc['order_index']}",
                "volume_path": f"volume:{volume['order_index']}",
                "order_index": arc["order_index"],
                "title": arc["title"],
                "summary": arc["summary"],
                "planning": arc["planning"],
                "scenes_count": len(arc_scenes),
                "chapter_count": arc_chapters,
                "word_count": 0,
                "version": 1,
                "is_deleted": False,
                "deleted_at": None,
                "created_at": stamp,
                "updated_at": stamp,
            })
            for scene in arc_scenes:
                scene_chapters = scene["chapters"]
                scenes_docs.append({
                    "path": f"volume:{volume['order_index']}/arc:{arc['order_index']}/scene:{scene['order_index']}",
                    "arc_path": f"volume:{volume['order_index']}/arc:{arc['order_index']}",
                    "order_index": scene["order_index"],
                    "title": scene["title"],
                    "summary": scene["summary"],
                    "planning": scene["planning"],
                    "chapter_count": len(scene_chapters),
                    "word_count": 0,
                    "version": 1,
                    "is_deleted": False,
                    "deleted_at": None,
                    "created_at": stamp,
                    "updated_at": stamp,
                })
                for offset, chapter in enumerate(scene_chapters, start=1):
                    chapters_docs.append({
                        "scene_path": (f"volume:{volume['order_index']}/arc:{arc['order_index']}"
                                       f"/scene:{scene['order_index']}"),
                        "order_index": offset,
                        "chapter_number": chapter["chapter_number"],
                        "title": chapter["title"],
                        "summary": chapter["summary"],
                        "planning": chapter["planning"],
                        "content": chapter.get("content") or "",
                        "word_count": 0,
                        "version": 1,
                        "is_deleted": False,
                        "deleted_at": None,
                        "created_at": stamp,
                        "updated_at": stamp,
                    })

    novel_doc = {
        "title": novel["title"],
        "subtitle": novel["subtitle"],
        "genre": novel["genre"],
        "tags": list(novel.get("tags") or []),
        "introduction": novel["introduction"],
        "summary": novel["summary"],
        "core_seed": novel["core_seed"],
        "worldview": novel["worldview"],
        "writing_style": novel["writing_style"],
        "narrative_pov": novel["narrative_pov"],
        "era_background": novel["era_background"],
        "plot": novel["plot"],
        "tone": novel["tone"],
        "target_audience": novel["target_audience"],
        "core_idea": novel["core_idea"],
        "number_of_chapters": novel["number_of_chapters"],
        "words_per_chapter": novel["words_per_chapter"],
        "status": "draft",
        "current_volume_count": len(volumes_docs),
        "current_chapter_count": len(chapters_docs),
        "current_word_count": 0,
        "version": 1,
        "is_deleted": False,
        "deleted_at": None,
        "created_at": stamp,
        "updated_at": stamp,
    }
    return {
        "novels": [novel_doc],
        "volumes": volumes_docs,
        "arcs": arcs_docs,
        "scenes": scenes_docs,
        "chapters": chapters_docs,
    }


def resolve_uri(cli_uri: str | None) -> str:
    """按 命令行 → 环境变量 → 项目配置 的顺序解析数据库地址。

    Args:
        cli_uri: 命令行传入的地址。
    Returns:
        MongoDB 连接串。
    """
    if cli_uri:
        return cli_uri
    env_uri = __import__("os").environ.get("MONGO_URI") or __import__("os").environ.get("MONGODB_URI")
    if env_uri:
        return env_uri
    if CONFIG.exists():
        match = re.search(r"(?m)^\s*mongodb_url\s*:\s*[\"']?([^\"'\n]+)", CONFIG.read_text(encoding="utf-8"))
        if match:
            return match.group(1).strip()
    return DEFAULT_URI


def import_plan(plan: dict, uri: str, database: str, replace: bool) -> dict:
    """把计划写入 MongoDB，并回填父级统计。

    Args:
        plan: 已通过校验的计划。
        uri: 连接串。
        database: 目标库名。
        replace: 是否先删除同名小说。
    Returns:
        写入结果统计。
    Raises:
        RuntimeError: 同名小说已存在且未指定 replace。
    """
    try:
        from pymongo import MongoClient
        from bson import ObjectId
    except ImportError as exc:  # pragma: no cover - 依赖缺失时给出可执行提示
        raise RuntimeError("缺少 pymongo，请在项目根目录执行：python scripts/quickstart.py --check") from exc

    documents = build_documents(plan)
    client = MongoClient(uri, serverSelectionTimeoutMS=8000, directConnection=True)
    try:
        client.admin.command("hello")
    except Exception as exc:
        raise RuntimeError(f"连不上 MongoDB（{exc.__class__.__name__}），请先用 开始创作.bat 启动数据库") from exc

    db = client[database]
    title = documents["novels"][0]["title"]
    existing = list(db["novels"].find({"title": title, "is_deleted": {"$ne": True}}, {"_id": 1}))
    if existing and not replace:
        raise RuntimeError(f"数据库里已有同名小说《{title}》；如需覆盖请加 --replace")
    if existing:
        for row in existing:
            novel_id = row["_id"]
            for name in ("chapters", "scenes", "arcs", "volumes"):
                db[name].delete_many({"novel_id": novel_id})
            db["novels"].delete_one({"_id": novel_id})

    novel_doc = documents["novels"][0]
    novel_id = db["novels"].insert_one(novel_doc).inserted_id

    volume_ids: dict[str, ObjectId] = {}
    arc_ids: dict[str, ObjectId] = {}
    scene_ids: dict[str, ObjectId] = {}

    for volume in documents["volumes"]:
        payload = {key: value for key, value in volume.items() if key != "path"}
        payload["novel_id"] = novel_id
        volume_ids[volume["path"]] = db["volumes"].insert_one(payload).inserted_id

    for arc in documents["arcs"]:
        payload = {key: value for key, value in arc.items() if key not in ("path", "volume_path")}
        payload["novel_id"] = novel_id
        payload["volume_id"] = volume_ids[arc["volume_path"]]
        arc_ids[arc["path"]] = db["arcs"].insert_one(payload).inserted_id

    for scene in documents["scenes"]:
        payload = {key: value for key, value in scene.items() if key not in ("path", "arc_path")}
        payload["novel_id"] = novel_id
        payload["volume_id"] = volume_ids[scene["arc_path"].split("/arc:")[0]]
        payload["arc_id"] = arc_ids[scene["arc_path"]]
        scene_ids[scene["path"]] = db["scenes"].insert_one(payload).inserted_id

    for chapter in documents["chapters"]:
        payload = {key: value for key, value in chapter.items() if key != "scene_path"}
        parent_path = chapter["scene_path"]
        payload["novel_id"] = novel_id
        payload["volume_id"] = volume_ids[parent_path.split("/arc:")[0]]
        payload["arc_id"] = arc_ids[parent_path.rsplit("/scene:", 1)[0]]
        payload["scene_id"] = scene_ids[parent_path]
        db["chapters"].insert_one(payload)

    return {
        "novel_id": str(novel_id),
        "volumes": len(documents["volumes"]),
        "arcs": len(documents["arcs"]),
        "scenes": len(documents["scenes"]),
        "chapters": len(documents["chapters"]),
        "url": f"/zh/writing/{novel_id}",
    }


def main() -> None:
    """解析参数，校验并（可选）导入。"""
    parser = argparse.ArgumentParser(description="把《刻天》创作包导入 AI_NovelGenerator")
    parser.add_argument("--plan", default=str(DEFAULT_PLAN), help="book-plan.json 路径")
    parser.add_argument("--mongo-uri", default=None, help="MongoDB 连接串")
    parser.add_argument("--database", default=DEFAULT_DB, help="目标库名")
    parser.add_argument("--replace", action="store_true", help="已存在同名小说时先删除再导入")
    parser.add_argument("--dry-run", action="store_true", help="只校验数据，不连接数据库")
    args = parser.parse_args()

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"[错误] 找不到计划文件：{plan_path}")
        print("       先运行：python scripts/build_book.py")
        sys.exit(1)

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    try:
        stats = validate(plan)
    except PlanError as exc:
        print(f"[错误] 计划不符合后端契约：{exc}")
        sys.exit(1)

    print(f"✓ 校验通过：《{plan['novel']['title']}》 "
          f"{stats['volumes']} 卷 / {stats['arcs']} 篇章 / {stats['scenes']} 场景 / {stats['chapters']} 章")
    documents = build_documents(plan)
    print(f"  待写入文档：novels {len(documents['novels'])}、volumes {len(documents['volumes'])}、"
          f"arcs {len(documents['arcs'])}、scenes {len(documents['scenes'])}、"
          f"chapters {len(documents['chapters'])}")

    if args.dry_run:
        print("  --dry-run：未连接数据库，未写入任何内容。")
        return

    uri = resolve_uri(args.mongo_uri)
    masked = re.sub(r"//[^@/]+@", "//***@", uri)
    print(f"  连接 {masked} ，目标库 {args.database} ...")
    try:
        result = import_plan(plan, uri, args.database, args.replace)
    except RuntimeError as exc:
        print(f"[错误] {exc}")
        sys.exit(1)

    print("✓ 导入完成")
    print(f"  小说 ID：{result['novel_id']}")
    print(f"  已写入：{result['volumes']} 卷 / {result['arcs']} 篇章 / "
          f"{result['scenes']} 场景 / {result['chapters']} 章（正文为空，等待续写）")
    print(f"  打开界面：http://127.0.0.1:3300{result['url']}")


if __name__ == "__main__":
    main()
