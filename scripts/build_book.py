"""把《刻天》的分卷源数据编译成 book-plan.json 与 Markdown 计划文档。

用法：
    python scripts/build_book.py                 # 默认 books/刻天
    python scripts/build_book.py --dir books/刻天
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORDS_PER_CHAPTER = 3000


def load_module(path: Path, name: str):
    """按文件路径加载源数据模块。

    Args:
        path: Python 文件路径。
        name: 模块名。
    Returns:
        已执行的模块对象。
    """
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def word_count(text: str) -> int:
    """按汉字与字母计数（不计空白），与章节 word_count 口径一致。

    Args:
        text: 待计数文本。
    Returns:
        非空白字符数。
    """
    return sum(1 for char in text if not char.isspace())


def build_chapter(source: tuple[str, str, list[str]], number: int) -> dict:
    """把一条源章节编译成导入所需的章节结构。

    Args:
        source: (标题, 梗概, 关键节点列表) 三元组。
        number: 全书章号。
    Returns:
        含 planning 的章节字典。
    """
    title, summary, beats = source[0], source[1], list(source[2])
    return {
        "chapter_number": number,
        "title": title,
        "summary": summary,
        "content": "",
        "word_count": 0,
        "planning": {
            "goal": summary,
            "start_state": beats[0],
            "end_state": beats[-1],
            "beats": beats,
            "pov_character_id": None,
            "must_include": [],
            "must_avoid": [],
            "target_word_count": WORDS_PER_CHAPTER,
        },
    }


def plan_from_chapters(chapters: list[dict], goal: str, extra: str = "") -> dict:
    """由子章节推导篇章或场景的 planning 字段。

    Args:
        chapters: 已编译的章节列表。
        goal: 该层目标。
        extra: 附加连续性说明。
    Returns:
        符合 ArcPlanningV1 / ScenePlanningV1 的字典。
    """
    return {
        "goal": goal,
        "start_state": chapters[0]["planning"]["start_state"],
        "end_state": chapters[-1]["planning"]["end_state"],
        "continuity_notes": extra,
        "target_chapter_count": len(chapters),
        "target_word_count": len(chapters) * WORDS_PER_CHAPTER,
    }


def split_scene(title: str, summary: str, goal: str, chapters: list[dict]) -> list[dict]:
    """把超过 5 章的场景对半拆开，保证每个场景只承载 3—5 章。

    Args:
        title: 原场景标题。
        summary: 原场景简介。
        goal: 原场景目标。
        chapters: 该场景已编译的章节。
    Returns:
        一个或多个场景的列表。
    """
    if len(chapters) <= 5:
        return [{"title": title, "summary": summary, "goal": goal, "chapters": chapters}]
    half = (len(chapters) + 1) // 2
    parts = [("上", chapters[:half]), ("下", chapters[half:])]
    result = []
    for suffix, chunk in parts:
        first, last = chunk[0]["chapter_number"], chunk[-1]["chapter_number"]
        result.append({
            "title": f"{title}·{suffix}",
            "summary": f"覆盖第 {first}–{last} 章：{chunk[0]['summary']}",
            "goal": f"{goal}（本场上半/下半对应第 {first}–{last} 章）",
            "chapters": chunk,
        })
    return result


def build(plan_dir: Path) -> dict:
    """汇总四个分卷模块，产出完整计划字典。

    Args:
        plan_dir: 存放 meta.py 与 vol1..vol4.py 的目录。
    Returns:
        可直接序列化为 book-plan.json 的字典。
    """
    meta = load_module(plan_dir / "meta.py", "meta")
    novel = dict(meta.NOVEL)

    volumes = []
    number = 0
    for index in range(1, 5):
        module = load_module(plan_dir / f"vol{index}.py", f"vol{index}")
        source = module.VOLUME
        arcs = []
        for arc_index, arc_source in enumerate(source["arcs"], start=1):
            scenes = []
            for scene_source in arc_source["scenes"]:
                chapters = []
                for chapter_source in scene_source["chapters"]:
                    number += 1
                    chapters.append(build_chapter(chapter_source, number))
                for part in split_scene(scene_source["title"], scene_source["summary"],
                                        scene_source["goal"], chapters):
                    scenes.append({
                        "order_index": len(scenes) + 1,
                        "title": part["title"],
                        "summary": part["summary"],
                        "planning": plan_from_chapters(part["chapters"], part["goal"]),
                        "chapters": part["chapters"],
                    })
            arc_chapters = [chapter for scene in scenes for chapter in scene["chapters"]]
            arcs.append({
                "order_index": arc_index,
                "title": arc_source["title"],
                "summary": arc_source["summary"],
                "planning": plan_from_chapters(arc_chapters, arc_source["planning_goal"]),
                "scenes": scenes,
            })
        arc_chapters = [chapter for arc in arcs for scene in arc["scenes"] for chapter in scene["chapters"]]
        planning = dict(source["planning"])
        planning["target_chapter_count"] = len(arc_chapters)
        planning["target_word_count"] = len(arc_chapters) * WORDS_PER_CHAPTER
        volumes.append({
            "order_index": source["order_index"],
            "title": source["title"],
            "subtitle": source["subtitle"],
            "summary": source["summary"],
            "goal": source["goal"],
            "theme": source["theme"],
            "status": "draft",
            "planning": planning,
            "arcs": arcs,
        })

    novel["number_of_chapters"] = number
    novel["words_per_chapter"] = WORDS_PER_CHAPTER
    return {
        "format": "novel-plan/v1",
        "source": "《刻天》东方玄幻长篇（AI_NovelGenerator 创作包）",
        "novel": novel,
        "volumes": volumes,
        "factions": meta.FACTIONS,
        "characters": meta.CHARACTERS,
        "locations": meta.LOCATIONS,
        "items": meta.ITEMS,
        "power_system": meta.POWER_SYSTEM,
    }


def render_markdown(plan: dict) -> str:
    """把计划字典渲染成便于阅读与打印的 Markdown。

    Args:
        plan: build() 的结果。
    Returns:
        Markdown 文本。
    """
    novel = plan["novel"]
    volumes = plan["volumes"]
    total_chapters = sum(len([c for a in v["arcs"] for s in a["scenes"] for c in s["chapters"]]) for v in volumes)
    total_scenes = sum(len(v["arcs"][0]["scenes"]) * 0 + len([s for a in v["arcs"] for s in a["scenes"]]) for v in volumes)
    total_arcs = sum(len(v["arcs"]) for v in volumes)

    lines = [
        f"# 《{novel['title']}》全书结构与分章计划",
        "",
        f"> {novel['subtitle']}　|　{novel['genre']}　|　{total_chapters} 章　|　"
        f"{total_arcs} 篇章　|　{total_scenes} 场景　|　约 {total_chapters * WORDS_PER_CHAPTER / 10000:.1f} 万字",
        "",
        "本文件由 `scripts/build_book.py` 从 `books/刻天/plan/` 的源数据自动生成，"
        "与 `book-plan.json` 完全同源；改动请改源数据后重新生成。",
        "",
        "## 一、卷目一览",
        "",
        "| 卷 | 卷名 | 篇章 | 场景 | 章 | 目标字数 | 一句话 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for volume in volumes:
        chapter_count = sum(len(s["chapters"]) for a in volume["arcs"] for s in a["scenes"])
        scene_count = sum(len(a["scenes"]) for a in volume["arcs"])
        lines.append(
            f"| {volume['order_index']} | {volume['title']} | {len(volume['arcs'])} | {scene_count} | "
            f"{chapter_count} | {chapter_count * WORDS_PER_CHAPTER // 10000} 万 | {volume['subtitle']} |"
        )

    for volume in volumes:
        planning = volume["planning"]
        lines += [
            "",
            f"## {volume['title']}　{volume['subtitle']}",
            "",
            volume["summary"],
            "",
            "| 规划项 | 内容 |",
            "| --- | --- |",
            f"| 本卷目标 | {volume['goal']} |",
            f"| 主题 | {volume['theme']} |",
            f"| 故事前提 | {planning['premise']} |",
            f"| 主要冲突 | {planning['major_conflict']} |",
            f"| 起点 | {planning['start_state']} |",
            f"| 终点 | {planning['end_state']} |",
            f"| 目标 | {planning['target_chapter_count']} 章 / {planning['target_word_count']} 字 |",
            "",
            "关键转折：",
            "",
        ]
        for point in planning["key_turning_points"]:
            lines.append(f"- {point}")

        for arc in volume["arcs"]:
            lines += [
                "",
                f"### {arc['title']}",
                "",
                f"{arc['summary']}",
                "",
                f"**篇章目标**：{arc['planning']['goal']}",
                "",
                "| 场景 | 覆盖章节 | 场景内容 |",
                "| --- | --- | --- |",
            ]
            for scene in arc["scenes"]:
                first = scene["chapters"][0]["chapter_number"]
                last = scene["chapters"][-1]["chapter_number"]
                span = f"第 {first} 章" if first == last else f"第 {first}–{last} 章"
                lines.append(f"| {scene['title']} | {span} | {scene['summary']} |")
            lines += [
                "",
                "| 章 | 标题 | 梗概 | 关键节点（beats） |",
                "| --- | --- | --- | --- |",
            ]
            for scene in arc["scenes"]:
                for chapter in scene["chapters"]:
                    beats = "；".join(chapter["planning"]["beats"])
                    lines.append(
                        f"| {chapter['chapter_number']} | {chapter['title']} | {chapter['summary']} | {beats} |"
                    )

    lines += [
        "",
        "## 附：全书伏笔与回收表",
        "",
        "| 埋设 | 回收 | 说明 |",
        "| --- | --- | --- |",
        "| 第 1 章 那道不该存在的刻痕 | 第 156 章 | 刻痕=宋无极私刻的笔迹 |",
        "| 第 5 章 铜铃里的声音 | 第 158 章 | 姐姐始终听得见，铃内刻着主角名字 |",
        "| 第 18 章 忘了姐姐的笑容 | 第 149 章 | 沈黎当着他说出那句话，验证记忆可复原为'别人的转述' |",
        "| 第 25 章 墨七身上的浅拓纹 | 第 105 章 | 墨七也是被抹者之后，故能承接记忆 |",
        "| 第 44 章 刀上残留的字 | 第 136 章 | 裴玄衣的父亲=活碑 |",
        "| 第 47 章 清册七 | 第 111 章 | 清册七是被涂掉的第八碑残档 |",
        "| 第 60 章 伪刻笔迹 | 第 64 章 | 指向师父柳无咎 |",
        "| 第 98 章 墨七的留信 | 第 105 章 | 他去换妹妹的记忆，代价是忘了自己 |",
        "| 第 109 章 白十三被刻成律 | 第 156 章 | '风里有名字'在换刻之夜救场 |",
        "| 第 119 章 碑文'她还听得见' | 第 133 章 | 沈黎用裂纹回话 |",
        "",
        "## 附：写作执行建议",
        "",
        "1. **先写卷一**，再回填伏笔：卷一所有异常（刻痕、褪墨、白发）都要能在卷四找到同一个来源。",
        "2. **每章一个钩子**：章末留给读者一个未解的疑问或一个代价的结算，不做纯过渡章。",
        "3. **代价必须当场结算**：刻律后的失忆、白发、忘名，必须在同一章内显形，不允许延后。",
        "4. **反派台词不解释设定**：宋无极讲道理时只讲自己的账，不替作者交代世界观。",
        "5. **战斗写手感**：刀重、血温、字迹的顿笔；不写'轰然'与'滔天'。",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    """解析参数、编译并写入两个产物。"""
    parser = argparse.ArgumentParser(description="编译《刻天》计划文档与导入 JSON")
    parser.add_argument("--dir", default="books/刻天", help="创作包目录")
    args = parser.parse_args()

    target = (ROOT / args.dir).resolve() if not Path(args.dir).is_absolute() else Path(args.dir)
    plan = build(target / "plan")

    json_path = target / "book-plan.json"
    json_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    md_path = target / "全书结构与分章计划.md"
    md_path.write_text(render_markdown(plan), encoding="utf-8")

    total = plan["novel"]["number_of_chapters"]
    scenes = sum(len(a["scenes"]) for v in plan["volumes"] for a in v["arcs"])
    print(f"✓ {json_path.relative_to(ROOT)}  （{total} 章 / "
          f"{sum(len(v['arcs']) for v in plan['volumes'])} 篇章 / {scenes} 场景）")
    print(f"✓ {md_path.relative_to(ROOT)}  （{word_count(md_path.read_text(encoding='utf-8'))} 字）")


if __name__ == "__main__":
    main()
