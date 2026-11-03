# 《刻天》创作包

东方玄幻长篇，**165 章 / 4 卷 / 16 篇章 / 42 场景 / 约 49.5 万字**（按每章 3000 字计）。
本包只含**全书结构与分章计划**，不含正文——正文交给 AI_NovelGenerator 在你的界面里逐章生成，或你自己写。

## 文件在哪

| 文件 | 用途 |
| --- | --- |
| `docs/books/刻天/00-设定集.md` | 世界观、力量体系、七方势力、人物、地理、器物、**设定一致性条款** |
| `books/刻天/全书结构与分章计划.md` | 四卷概览 + 每卷规划 + 每篇章场景划分 + **165 章逐章表**（梗概 + 关键节点）+ 伏笔回收表 |
| `books/刻天/book-plan.json` | 同源的机器可读版，导入用 |
| `books/刻天/plan/` | 分卷源数据（`meta.py`、`vol1..4.py`），改这里再重新编译 |
| `books/刻天/prose/` | 已写正文，文件名 `ch001-标题.md`；编译时按章号自动挂进 `book-plan.json` |
| `scripts/build_book.py` | 编译：源数据 → `book-plan.json` + 计划文档 |
| `scripts/import_book_plan.py` | 导入：`book-plan.json` → 你的 MongoDB（含正文与字数） |
| `scripts/app_generate.py` | 用 app 自己的接口逐章生成正文，替代手点 165 次「AI 写正文」 |

## 三种用法

### 1. 只想读 / 打印

直接看 `book-plan.json` 同源的 Markdown：
`books/刻天/全书结构与分章计划.md`（含全部 165 章的梗概与关键节点）。

### 2. 导入 app，在界面里继续写（推荐）

1. 先双击 `开始创作.bat` 把数据库、后端、前端都跑起来（**导入前必须先启动一次**，MongoDB 副本集要就绪）；
2. 回到项目根目录，执行：

```bash
python scripts/import_book_plan.py --dry-run     # 先校验，不写库
python scripts/import_book_plan.py               # 真正导入
```

3. 打开终端里打印的链接（`http://127.0.0.1:3300/zh/writing/<小说ID>`）。

导入后你会看到：4 卷、16 篇章、42 场景、165 章的计划全部就位，**正文为空、字数 0**，
所以工作台的流程会停在第 6 阶段「检查或继续规划」，从第 1 章开始就能用 AI 逐章生成。

常用参数：

```bash
python scripts/import_book_plan.py --replace       # 已导入过，想覆盖重来
python scripts/import_book_plan.py --mongo-uri "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"
python scripts/import_book_plan.py --plan 别的书/book-plan.json
```

> 导入器只写 `novels / volumes / arcs / scenes / chapters` 五个集合，字段与项目自身的创建逻辑一致；
> 人物、势力等"事实"集合没有写，因为这些用界面里的 AI 任务生成质量更高，设定集里已经准备好了原料。

### 3. 当作 AI 提示词

把 `00-设定集.md` 整篇贴进 app 的「世界观 / 文风 / 时代背景」字段，或在生成某一章时把该章的
梗概 + 关键节点作为"本章要求"喂给 AI。设定集第九节「设定一致性条款」建议每次生成都带上。

### 4. 让 app 一章一章往下写（自动化）

导入后，除了在界面上点「AI 写正文」，也可以在项目根目录直接跑：

```bash
python scripts/app_generate.py --dry-run     # 先看要写哪些章
python scripts/app_generate.py --limit 3     # 先写 3 章看质量
python scripts/app_generate.py               # 一直写下去
python scripts/app_generate.py --from-chapter 12 --limit 5   # 断点续写
```

它做的事和你在界面上点的完全一样：调 `POST /api/llm/novels/{id}/chapters/{cid}/writing`
拿候选 → 调 `POST /api/chapters/{cid}/content/confirm` 保存，带 `Idempotency-Key`，
已写好的章会自动跳过，模型报错会退避重试。

前提：MongoDB 副本集已启动（`开始创作.bat`），且「设置」里 LLM 供应商与 Key 已测试通过。

### 5. 当前进度

- 全书结构：165 章计划全部就绪；
- 正文：**第 1 章《拓碑夜》、第 2 章《七个字》已成稿**（约 4800 字），作为文风样张；
- 其余 163 章正文留空，导入后由 `app_generate.py` 或界面逐章生成。

## 改这本书

```bash
# 1. 改源数据
vim books/刻天/plan/vol2.py
# 2. 重新编译（自动重算章号、统计、目标字数，并重排超长场景）
python scripts/build_book.py
# 3. 已导入过的话覆盖重导
python scripts/import_book_plan.py --replace
```

编译时会自动做三件事：

- 章号从 1 开始**连续重排**；
- 每卷/每篇章/每场景的 `target_chapter_count`、`target_word_count` 按实际内容重算；
- 单个场景超过 5 章会**自动对半拆开**（`·上` / `·下`），因为场景是 app 里章的容器。

## 已知边界

- 导入是**直接写数据库**，不经过 app 的命令回执；万一写入失败，可用 `--replace` 重来，或直接在界面里删掉这本书。
- 沙箱里没有 MongoDB，导入路径已用 `mongomock` 跑通关联与统计逻辑（含正文、字数、父级统计回填），
  但**没有在你的真实副本集上验证过**；第一次导入建议先 `--dry-run`，再导入，
  然后核对界面里的卷/篇章/章数是否为 4 / 16 / 42 / 165、第一章是否有正文。
- `app_generate.py` 的循环逻辑用本地假后端验证过（生成→采纳→跳过已写→幂等键），
  但**没有对真实后端+真实模型跑过**；第一次请用 `--limit 3` 试，确认质量再放开。
