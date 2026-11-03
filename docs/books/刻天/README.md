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
| `scripts/build_book.py` | 编译：源数据 → `book-plan.json` + 计划文档 |
| `scripts/import_book_plan.py` | 导入：`book-plan.json` → 你的 MongoDB |

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
- 沙箱里没有 MongoDB，导入路径已用 `mongomock` 跑通关联与统计逻辑，但**没有在你的真实副本集上验证过**；
  第一次导入建议先 `--dry-run`，再导入，然后看界面里的卷/篇章/章数与本文开头的数字是否一致（4 / 16 / 42 / 165）。
