"""用 app 自己的接口逐章生成正文（"AI 写正文"的批处理版）。

做的事情和你在界面上点「AI 写正文 → 采纳」完全一样，只是不用点 165 次：
    1. 读取小说的章节列表，挑出正文为空（word_count == 0）的章；
    2. 逐章调用 POST /api/llm/novels/{novel_id}/chapters/{chapter_id}/writing 生成候选；
    3. 把候选连同生成依据回传给 POST /api/chapters/{chapter_id}/content/confirm 保存；
    4. 每章之间可暂停，失败可重试，中断后重新运行会自动跳过已写好的章。

前提（都在你自己电脑上，沙箱里跑不了）：
    · MongoDB 副本集已启动并导入过本书：python scripts/import_book_plan.py
    · 界面「设置」里已经填好并测试通过 LLM 供应商与 Key
    · app 正在运行：开始创作.bat（前端 3300 / 后端 8200）

用法：
    python scripts/app_generate.py --dry-run                 # 只列出要写的章
    python scripts/app_generate.py --limit 3                 # 先写 3 章看看效果
    python scripts/app_generate.py                           # 一直写下去
    python scripts/app_generate.py --from-chapter 12 --limit 5
    python scripts/app_generate.py --novel-id 6ae9d927a0f617bf77403b4d
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

ROOT_API = "http://127.0.0.1:8200"
TIMEOUT = 600


class ApiError(RuntimeError):
    """app 返回非 2xx 时抛出。"""

    def __init__(self, status: int, payload: Any) -> None:
        """保存状态码与响应体。

        Args:
            status: HTTP 状态码。
            payload: 解析后的响应体。
        """
        self.status = status
        self.payload = payload
        message = ""
        if isinstance(payload, dict):
            error = payload.get("error") or payload
            message = f"{error.get('code', '')} {error.get('message', '')}".strip()
        super().__init__(f"HTTP {status} {message or payload}")


def request(method: str, path: str, body: dict | None = None,
            idempotency_key: str | None = None, base: str = ROOT_API) -> Any:
    """发一个 JSON 请求并返回解析结果。

    Args:
        method: HTTP 方法。
        path: 以 / 开头的接口路径。
        body: 请求体。
        idempotency_key: 可选 Idempotency-Key 头。
        base: 后端地址。
    Returns:
        解析后的响应体。
    Raises:
        ApiError: 非 2xx。
    """
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            payload = raw.decode("utf-8", "replace")
        raise ApiError(exc.code, payload) from None
    except urllib.error.URLError as exc:
        raise ApiError(0, {"error": {"code": "BACKEND_UNREACHABLE",
                                     "message": f"连不上后端 {base}（{exc.reason}），先用 开始创作.bat 启动"}}) from None
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def pick_novel(title: str, novel_id: str | None, base: str) -> dict:
    """按 ID 或标题定位小说。

    Args:
        title: 小说标题（未给 ID 时使用）。
        novel_id: 小说 ID。
        base: 后端地址。
    Returns:
        novels 列表接口中的一行。
    Raises:
        SystemExit: 找不到或有多本同名。
    """
    if novel_id:
        return request("GET", f"/api/novels/{novel_id}", base=base)
    payload = request("POST", "/api/novels/list", {"page": 1, "page_size": 50}, base=base)
    rows = payload.get("items") or payload.get("novels") or []
    matched = [row for row in rows if row.get("title") == title]
    if not matched:
        raise SystemExit(f"没找到《{title}》。先运行：python scripts/import_book_plan.py")
    if len(matched) > 1:
        raise SystemExit(f"有 {len(matched)} 本同名小说，请用 --novel-id 指定")
    return matched[0]


def list_chapters(novel_id: str, base: str) -> list[dict]:
    """读取小说全部章节（含章号与字数）。

    Args:
        novel_id: 小说 ID。
        base: 后端地址。
    Returns:
        按章号排序的章节列表。
    """
    payload = request("GET", f"/api/chapters/novel/{novel_id}", base=base)
    rows = payload.get("chapters") or payload.get("items") or []
    rows = [row for row in rows if not row.get("is_deleted")]
    rows.sort(key=lambda row: (row.get("chapter_number") or 10**9, row.get("order_index") or 0))
    return rows


def generate_chapter(novel_id: str, chapter_id: str, base: str, retries: int = 2) -> dict:
    """生成一章正文候选，失败时按退避重试。

    Args:
        novel_id: 小说 ID。
        chapter_id: 章节 ID。
        base: 后端地址。
        retries: 失败重试次数。
    Returns:
        含 candidate 与 basis 的生成信封。
    Raises:
        ApiError: 重试后仍失败。
    """
    body = {"request_mode": "task_flow", "use_stream": False}
    last: ApiError | None = None
    for attempt in range(retries + 1):
        try:
            return request("POST", f"/api/llm/novels/{novel_id}/chapters/{chapter_id}/writing",
                           body, base=base)
        except ApiError as exc:
            last = exc
            if exc.status in (400, 401, 403, 404, 422):
                raise
            time.sleep(5 * (attempt + 1))
    raise last  # type: ignore[misc]


def confirm_chapter(chapter_id: str, envelope: dict, base: str) -> dict:
    """把候选正文保存到章节。

    Args:
        chapter_id: 章节 ID。
        envelope: generate_chapter 的返回。
        base: 后端地址。
    Returns:
        确认结果。
    """
    body = {"candidate": envelope["candidate"], "basis": envelope["basis"]}
    return request("POST", f"/api/chapters/{chapter_id}/content/confirm", body,
                   idempotency_key=f"auto-write-{uuid.uuid4().hex}", base=base)


def candidate_length(envelope: dict) -> int:
    """返回候选正文的非空白字数。

    Args:
        envelope: 生成信封。
    Returns:
        字数。
    """
    content = ""
    candidate = envelope.get("candidate") or {}
    if isinstance(candidate, dict):
        content = candidate.get("content") or candidate.get("text") or ""
    return sum(1 for char in str(content) if not char.isspace())


def main() -> None:
    """解析参数并逐章生成直到完成或触达上限。"""
    parser = argparse.ArgumentParser(description="用 app 的接口逐章生成正文")
    parser.add_argument("--title", default="刻天", help="小说标题（未给 --novel-id 时按它查）")
    parser.add_argument("--novel-id", default=None, help="直接指定小说 ObjectId")
    parser.add_argument("--backend", default=ROOT_API, help="后端地址")
    parser.add_argument("--from-chapter", type=int, default=1, help="从第几章开始")
    parser.add_argument("--limit", type=int, default=0, help="最多写几章（0 = 全部）")
    parser.add_argument("--sleep", type=float, default=2.0, help="每章之间的间隔秒数")
    parser.add_argument("--dry-run", action="store_true", help="只列出待写章节，不调用模型")
    args = parser.parse_args()

    try:
        novel = pick_novel(args.title, args.novel_id, args.backend)
        novel_id = str(novel.get("novel_id") or novel.get("id") or novel.get("_id"))
        chapters = list_chapters(novel_id, args.backend)
    except ApiError as exc:
        print(f"[错误] {exc}")
        if "DATABASE" in str(exc):
            print("       数据库没起来：先双击 开始创作.bat（它会拉起 MongoDB 副本集）")
        sys.exit(1)

    pending = [row for row in chapters
               if (row.get("chapter_number") or 0) >= args.from_chapter and not row.get("word_count")]
    if args.limit:
        pending = pending[:args.limit]
    print(f"《{novel.get('title')}》：共 {len(chapters)} 章，其中待写 {len(pending)} 章")
    if not pending:
        print("没有待写的章节。")
        return
    for row in pending[:10]:
        print(f"  第 {row.get('chapter_number')} 章 {row.get('title')}")
    if len(pending) > 10:
        print(f"  …… 以及另外 {len(pending) - 10} 章")
    if args.dry_run:
        print("--dry-run：未调用模型。")
        return

    written = failed = 0
    for index, row in enumerate(pending, start=1):
        number, title, chapter_id = row.get("chapter_number"), row.get("title"), str(row.get("chapter_id") or row.get("id"))
        print(f"[{index}/{len(pending)}] 第 {number} 章 {title} ...", end="", flush=True)
        try:
            envelope = generate_chapter(novel_id, chapter_id, args.backend)
            size = candidate_length(envelope)
            confirm_chapter(chapter_id, envelope, args.backend)
            print(f" 完成（{size} 字）")
            written += 1
        except ApiError as exc:
            print(f" 失败：{exc}")
            if exc.status in (401, 403) or "PROVIDER" in str(exc) or "API_KEY" in str(exc):
                print("       看起来是模型供应商没配好：打开 http://127.0.0.1:3300/zh/settings 填 Key 并点测试")
                failed += 1
                break
            failed += 1
        if index < len(pending):
            time.sleep(args.sleep)

    print(f"\n本次完成 {written} 章，失败 {failed} 章。")
    if written:
        print("打开界面查看：http://127.0.0.1:3300/zh/writing/" + novel_id)


if __name__ == "__main__":
    main()
