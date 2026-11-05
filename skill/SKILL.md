---
name: inkflow-novel-workflow
title: 墨脉 InkFlow · 长篇小说创作工作流
version: 1.0.0
description: 本地可运行的长篇小说自动创作流水线。从市场热度与选题开始，经查重、世界观（力量体系/规则边界）、人物关系、分层大纲、节奏曲线、伏笔钩子，进入「逐章写作 → 三视角审稿 → 修订 → 去 AI 味 → 定稿」的章循环，并用滚动摘要压缩支撑 30 章以上断点续写，最后导出全书与设定集。
entrypoints:
  ui: npm start → http://localhost:5173
  api: POST /api/projects/:id/run  {"mode":"step"|"auto"}
  cli: node scripts/seed.mjs / node scripts/market-refresh.mjs / node scripts/export.mjs
requires:
  runtime: Node.js >= 20（零第三方依赖）
  model: 可选。默认离线演示引擎；接真实模型需 OpenAI 兼容网关或 Anthropic Key
files:
  prompts: skill/prompts/*.md
  engine: server/pipeline.js
  gates: server/text.js
  ui: web/
---

# 墨脉 InkFlow · 长篇小说创作工作流（Skill）

> 这是一个「可以随时打开使用」的长篇小说创作工作流：**左侧工作流 / 右侧成书**，
> 16 个环节、每章 5 道硬闸门、三视角审稿、自动修订、去 AI 味、断点续写压缩。
> 默认离线可跑通全流程（无需 API Key），接上真实模型即可产出可投稿的正文。

---

## 0. 何时使用

- 要写 10 万字以上、需要**跨章保持设定一致**的长篇（玄幻 / 悬疑 / 都市 / 言情 / 科幻均可）。
- 已经被「上下文越写越乱、伏笔写着写着忘了、每章文风飘」折磨过的写作项目。
- 需要一套**可审核、可回滚、可断点续写**的流水线，而不是一次性让模型吐一本书。
- 需要在 Arena 里把「选题研究（WebSearch）→ 创作 → 审稿」串起来时，本 Skill 提供落地的产物契约。

不适用：短篇 / 单场景练笔（用普通对话更划算）；需要插画出图（本流程只产出文字与设定集）。

---

## 1. 三条设计原则（决定了它为什么不会写崩）

1. **环节之间有产物契约**
   每个环节只读上游的契约字段（如 `world.hardRules`、`characters[].rank`、`outline` 的 L3 卡片），
   不允许「凭感觉」。产物落在项目 JSON 上，可单独重跑某一环。

2. **审核是「脚本实测 + 模型判断」双轨**
   字数、AI 味、句长节奏、章末钩子、伏笔执行、位阶/术语一致性全部由 `server/text.js` **确定性地量出来**；
   大模型的三视角审稿只负责「讲清楚为什么这是问题、怎么改」。
   → 模型无法用一句「本章写得很好」绕过字数不足或 AI 味超标。

3. **上下文是滚动压缩的**
   每章定稿产出 150-220 字摘要 + 事实增量；每 `compressEvery`（默认 30）章把摘要滚动压缩成
   一段≤1400 字的〔主角与处境 / 关系变化 / 伏笔台账 / 未解悬念〕。
   写作时只喂「滚动摘要 + 最近 3 章摘要 + 上一章结尾 800 字 + 本章卡片」，30 章、100 章都不会爆上下文。

---

## 2. 完整流程：环节 / 输入 / 输出 / 衔接

> 表格里的 id 与 `GET /api/meta` 的 `stages[].id`、以及 `server/pipeline.js` 的状态机一一对应。

| # | 环节 | 输入 | 输出（产物字段） | 衔接方式 |
|---|------|------|------------------|----------|
| 1 | 立项设定 `brief` | 题材/细分/受众/章数/单章字数/视角/文风标签/禁忌/种子想法 | `project.brief` | 章数与单章字数 → 全流程的字数闸门；文风标签 → 写作与编辑审的基准 |
| 2 | 市场热度 `market` | brief + 外部素材（可选） | `project.market`：细分热度/趋势/饱和度/读者诉求/避坑 | 热度与饱和度 → 选题打分；避坑清单 → 选题硬约束 |
| 3 | 方向选题 `topic` | brief + market + 「五种不同情绪引擎」约束 | `project.topics[]`：logline、核心冲突、承诺、差异化、heat/novelty/risk/total | `selectedTopicId` → 查重对象；差异化 → 世界观禁止区 |
| 4 | 查重 `dedup` | 选中选题 + `corpus/` 参考库（字符 2-gram 余弦预计算） | `project.dedup`：verdict(safe/risky/duplicate)、逐条重合维度、必须修改项 | `duplicate` 默认**阻断**进入世界观（可在界面确认风险继续）；mustChange → 世界观禁止区 |
| 5 | 世界观 `world` | brief + topic + dedup | `project.world`：力量体系（阶位/规则/代价/上限/例外）、硬规则、阵营、地理、术语表、避讳、留白 | `hardRules` + `glossary` → 逻辑审的事实基准；`glossary` → 正文术语约束 |
| 6 | 人物 `characters` | world + topic | `project.characters[]`：欲望/障碍/错误信念/秘密/转折/弧光/语感/位阶/关系边；`conflictMatrix`；`pov` | 位阶与动机 → 逻辑审的人物事实；关系边 → 场景分配 & 关系网图 |
| 7 | 分层大纲 `outline` | brief + world + characters + 伏笔预留位 | `project.outline`：L1 卷 → L2 弧 → L3 章（goal/obstacle/turn/result/density/hook/scenes/伏笔位） | L3 卡片 → 写作唯一输入；density → 节奏曲线；hook → 钩子台账 |
| 8 | 节奏曲线 `pacing` | 全部 L3 的 conflict density | `project.pacing`：曲线点、平均密度、报警、建议 | high 级报警 → 一键调律；曲线 → 左栏可视化 |
| 9 | 伏笔与钩子 `foreshadow` | outline + glossary | `project.foreshadow`：台账（布置章/回收章/类型/风险/中途提示）+ 每章钩子类型 | 台账 → 本章「必须布置/回收」清单 → 审稿的伏笔闸门 |
| 10 | 正文写作 `draft` | L3 卡片 + 硬规则 + 出场人物 + 滚动摘要 + 上一章结尾 + 本章伏笔任务 + 文风基准 | `chapter.current` + 版本记录 | 正文 → 三审；卡片 hook → 章末钩子检查 |
| 11 | 三视角审稿 `review` | 正文 + 硬规则/术语/人物事实（逻辑审）、大纲承诺（读者审）、文风基准与实测指标（编辑审） | `chapter.review`：三个 pass 的问题清单 + 5 道闸门 | high 级 & 非 AI 类闸门失败 → 修正；AI 类失败 → 去 AI 味 |
| 12 | 修正 `revise` | 审稿意见（按严重度）+ 必须满足的指标 | 新版本正文 + 修订记录；轮次 +1 | 修订后必须重跑三审，最多 `reviewRounds` 轮；仍不过 → 定稿但标记「待人工」 |
| 13 | 去 AI 味 `deai` | 正文 + AI 腔命中表 + 文风基准 | 改写后正文 + 前/后指标 + 替换记录 | 改写后重跑三审做最终校验；模型改写仍超标 → 本地规则层兜底 |
| 14 | 章节摘要 `summary` | 定稿正文 | summary(150-220 字)/events/facts/新术语/伏笔状态/未解悬念/下一章交接 | 摘要 → 滚动摘要与下一章上下文；facts → 人物事实库；伏笔状态 → 台账 |
| 15 | 滚动压缩 `compress` | 旧滚动摘要 + 新一批章节摘要 | `summaries.rolling`（≤1400 字）+ `coveredUpTo` | 写作时用滚动摘要替代全量前情；每 `compressEvery` 章自动触发 |
| 16 | 导出 `export` | 定稿章节 + 大纲 + 设定集 | Markdown / TXT / JSON（`/api/projects/:id/export`） | 交付人工精修或投稿 |

### 环节之间的「硬衔接」示例

```
topic.differentiation ──► world 的禁止区 ──► hardRules ──► 逻辑审的判定依据
outline.L3.density ──► pacing.points ──► pacing.alarms ──► autoFixPacing() 改写 density
outline.L3.foreshadow.setup/payoff ──► foreshadow.ledger ──► 每章 duties ──► 写作任务 & 审稿闸门
chapter.summary ──► summaries.perChapter ──► 每 30 章 rolling ──► 下一章上下文
chapter.review.issues ──► revise 的 FIXES ──► 新版本 ──► 二次审稿（保留 fixed/remaining 统计）
```

---

## 3. 每章循环（这是本工作流的核心）

```
draft ──► review(逻辑审‖读者审‖编辑审) ──┬─ 非AI类不过 ──► revise ──► review …（≤reviewRounds）
                                          ├─ 仅AI味不过 ──► deai ──► review ──► summary
                                          └─ 全过 ──► deai（仍执行，保证文风）──► review ──► summary
```

### 五道硬闸门（每章必过，脚本实测，模型无权覆盖）

| 闸门 | 判定 | 默认阈值 | 失败后 |
|------|------|----------|--------|
| 字数 | 汉字数 + 英文词数，不计标点 | `≥ max(2000, 单章目标×0.85)` | 修订补场景（不补解释/回忆） |
| AI 味 | 套话命中密度 + 排比/命定旁白/破折号结构特征 归一化到 0-10 | `≤ 4.5` | 去 AI 味（规则层 + 模型） |
| 章末钩子 | 疑问/威胁/反常细节/揭示动作/否定异常/具体人物 加权 | `≥ 6` | 重写最后 3 句，落在信息缺口上 |
| 伏笔执行 | 本章应布置/回收的每条伏笔，名称或关键细节必须在正文出现 | 全部执行 | 中段补一个具体细节（不许直接解释） |
| 设定一致 | 位阶/身份/术语/硬规则逐条核对（本地事实核对 + 逻辑审） | 无 high 级问题 | 修订按最小改动修 |

**三视角审稿团**分工：

- **逻辑审**（temperature 0.15）：只抓硬伤 —— 设定冲突、规则越界、因果断裂、动机断裂、信息越界（角色知道了不该知道的事）、时间线矛盾。每个问题必须给「原句 / 为什么 / 最小改法」。
- **读者审**（temperature 0.4）：付费读者视角，标出「我在这里想退出」的具体段落、情绪曲线、兑现了什么、钩子强度。
- **编辑审**（temperature 0.25）：文风是否与基准一致、字数/句式/AI 味、对话质量、伏笔是否执行；输出 5 个 gate 的判定。

### 去 AI 味的双层实现

1. **模型改写**（`skill/prompts/13-deai.md`）：删套话、打散句式、抽象情绪改动作、对话加人味、保留伏笔与钩子。
2. **规则层兜底**（`server/text.js` `humanize()`）：30+ 组高频 AI 词轮换替换、删除段末命定旁白、拆 >52 字长句、破折号限流。
   → 两次「改写 → 实测」后 AI 味仍超标时，规则层保证闸门能被关上（离线演示即依赖此层）。

### 文笔层：从 2026-11 头部开篇反推的六条指令

拆解口径与证据见 **`docs/网文头部文笔拆解.md`**（番茄 / 起点各取前三，逐本标注句法、信息投放、感官锚点）。这里只留能被写成指令的部分，写作时（`08-chapter-draft`）与审稿时（`11-review-editor` 的质感审）都执行：

| # | 指令 | 反例（写成这样即返工） |
|---|------|------------------------|
| 1 | **定场不写气氛**：开场 ≤100 字内给到可指认的地点或物件（一个地名、一块招牌、一件器物），禁写「夜色深沉」「空气仿佛凝固」 | 用形容词开场；开场先讲世界观 |
| 2 | **先事实后情绪**：钱、天数、斤两、时刻、温度先落地；情绪只由动作和生理反应承担 | 「她感到无比恐惧」 |
| 3 | **账本写世界**：每章至少一处可以算的数（费用 / 工时 / 距离 / 药量），世界观靠开销清单投放 | 用一段说明介绍阶层与体系 |
| 4 | **规矩即设定**：每条设定都要能翻译成一句「不许 / 必须 / 否则」，让角色在规矩边缘试探 | 设定只当名词存在，从不约束人物 |
| 5 | **工序做质感**：写清一门手艺的步骤，并让它失败一次 | 主角一次就做到，全靠天赋 |
| 6 | **段末留缺口**：每 300–500 字收在一次小动作、一句反常的话或一个没有答案的疑问上；禁段末总结句 | 「这一切都说明……」 |

配套的量化层（`server/text.js` `proseProfile()`，`npm run style` 单独查看，`npm run audit` 报告里有「文笔画像」表）：

| 指标 | 闸门 | 说明 |
|---|---|---|
| 五感密度（视/听/体感/嗅/味，每千字） | ≥18 | 低于即「整章没有身体感」，进修订 |
| 短段占比（≤20 字段落） | ≥50% | 低于即段落块状 |
| 解释句占比（因为/也就是说/这说明…） | ≤4% | 超过即旁白在替读者总结 |
| 开篇三件套（前 300 字有台词/动作/异常） | 提示 | 刻意无台词开场可不满足，但要在日志里说明 |

**这一层的定位**：不是第六道硬闸门，而是「退化探测器」。它只拦明显退化的稿子；真正判断质感好坏的是编辑审里的质感审（`11-review-editor.md` 的 `craft` 字段），以及一次独立的改写 pass（`16-prose-pass.md`）。

---

## 4. 本地运行

```bash
# 1) 启动（零依赖，Node >= 20）
npm start                 # → http://localhost:5173

# 2) 首次启动会自动生成演示项目；也可以手动重建
node scripts/seed.mjs --reset

# 3) 接真实模型（三选一）
#    a. 界面右上角「设置」填 baseUrl / model / apiKey（OpenAI 兼容或 Anthropic）
#    b. 环境变量：
export LLM_PROVIDER=openai OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_MODEL=gpt-4o-mini
#    c. 本地模型：OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:14b

# 4) 其他命令
node scripts/market-refresh.mjs --force      # 市场热度定时刷新（可挂 cron）
node scripts/export.mjs <项目ID> md           # 命令行导出
node scripts/selftest.mjs                     # 引擎自检
```

**数据位置**：`data/projects/<id>.json`（含全部产物与版本历史）、`data/settings.json`（Key 只在本机）、
`data/corpus/`（用户导入的查重语料）。`corpus/` 是自带的题材原型库。整个 `data/` 已加入 `.gitignore`。

---

## 5. 界面（左侧工作流 / 右侧成书）

- **左栏**：项目进度 → 16 环节竖排流水线（点开看输入/输出/衔接与产物）→ 市场雷达 / 候选选题 / 查重报告；
  顶部标签可切到 **世界观（含力量体系与硬规则全文）/ 人物（档案 + 关系网络图）/ 大纲（L1-L2-L3 全文 + 每章目标阻碍转折结果与冲突密度）/ 质量（节奏曲线 + 逐章闸门 + 伏笔台账 + 去AI味前后对比）/ 说明**。
- **右栏**：完整小说。可按章跳转、单章阅读或全书通读，显示每章字数、三审均分、AI 味、钩子分与审核详情；**可收起**（右上角「收起」，或 `Alt+←`），收起后左栏自动占满。
- **底部抽屉**：实时日志（每一步的产物、闸门结果、报警、报错）。
- 关键操作：`下一步`、`自动连跑`、`暂停`、`一键调律节奏`、`重跑市场`、`接受查重风险`、`回滚版本`、`立即压缩摘要`、`导出 MD/TXT`。

---

## 6. Agent 调用契约（在 Arena 里怎么用它）

```bash
# 查看能力与提示词清单
GET /api/meta

# 新建项目（brief 字段即立项输入）
POST /api/projects  { "genre":"东方玄幻", "seedIdea":"长明灯与影子", "targetChapters":12 }

# 单步 / 连跑（SSE 流：log / step / step-done / project / error / finished）
POST /api/projects/:id/run  { "mode":"step" }        # 执行 nextAction 一步
POST /api/projects/:id/run  { "mode":"auto", "steps":400 }

# 取产物
GET  /api/projects/:id                     # 全量项目（含大纲/世界观/章节/审稿）
POST /api/projects/:id/select-topic        # 换主线（重置下游）
POST /api/projects/:id/pacing/fix          # 节奏调律
POST /api/projects/:id/market/input        # 写入 WebSearch 抓来的市场素材
POST /api/projects/:id/export?format=md    # 导出
```

在 Arena 中推荐的操作顺序：
1. 用 `WebSearch` 检索题材热度 / 榜单 / 读者评论 → `POST /market/input` → 再 `POST /run {"mode":"step"}` 跑 `market`。
2. 用 `WebSearch` 找 3-5 本同题材竞品简介 → `POST /api/corpus` 存入参考库 → 跑 `dedup`，得到真实查重结论。
3. 其余环节交给 `auto` 连跑；每隔几章抽查 `GET /api/projects/:id` 的 `chapter.review`。

---

## 7. 提示词资产（`skill/prompts/`）

| 文件 | 作用 | 温度 |
|------|------|------|
| `00-market.md` | 市场热度雷达 | 0.3 |
| `01-topic.md` | 5 个不同情绪引擎的候选选题 + 打分 | 1.0 |
| `02-dedup.md` | 设定/情节/专名三重查重 | 0.2 |
| `03-world.md` | 力量体系（代价/上限/例外）+ 可审核硬规则 | 0.8 |
| `04-characters.md` | 人物档案 + 关系网 + 冲突矩阵 | 0.9 |
| `05-outline.md` | L1/L2/L3 分层大纲 + 因果链自检 | 0.75 |
| `06-pacing.md` | 节奏诊断与改法 | 0.3 |
| `07-foreshadow.md` | 伏笔台账 + 章末钩子方案 | 0.8 |
| `08-chapter-draft.md` | 单章正文写作（含禁用词表） | 0.9 |
| `09-review-logic.md` | 逻辑审 | 0.15 |
| `10-review-reader.md` | 读者审 | 0.4 |
| `11-review-editor.md` | 编辑审（5 个 gate） | 0.25 |
| `12-revise.md` | 按意见精修 | 0.55 |
| `13-deai.md` | 去 AI 味 | 0.7 |
| `14-chapter-summary.md` | 章末摘要与状态增量 | 0.2 |
| `15-compress.md` | 滚动摘要压缩 | 0.2 |
| `16-prose-pass.md` | 文笔层改写（只改质感，不动情节与钩子） | 0.6 |

所有提示词都是可编辑的 Markdown（YAML frontmatter 记录温度与输出格式），改完重启即生效。

---

## 8. 人工介入点（不要全自动的地方）

- **选题 / 查重**：机器给候选与风险，人拍板。查重为 `duplicate` 时流程默认阻断。
- **节奏报警**：一键调律只做保守 +1 密度；结构级问题（如「第二卷整卷塌陷」）建议人工改大纲。
- **标记为「待人工」的章节**：脚本记录 `needsAttention`（有闸门未过或 high 级问题残留），
  界面用红色「待人工」标出。这些章可以回滚到任一版本重跑，或人工改完再运行审稿。
- **导出前**：建议人工通读一次，尤其是前 3 章（决定读者去留）。

---

## 9. 验收与自检

```bash
node scripts/selftest.mjs   # 字数/AI味/钩子/事实核对/查重/压缩 的单元自检
npm start                   # 首屏自动生成 12 章演示项目
```

自检覆盖：中文计字规则、AI 味评分对已知套话的敏感度、钩子识别、位阶与硬规则的事实核对、
n-gram 查重、去 AI 味改动有效性、滚动摘要上限。

---

## 10. 还可以补什么（按优先级）

已实现：`世界观`、`节奏曲线`、`三视角审稿`、`滚动摘要压缩`、`市场热度自动化`、`术语库/事实库/时间线`、
`版本回滚`、`一键调律`、`上下文预算估算`、`离线演示模式`、`导出`、`提示词资产化`。

建议下一步（按投入产出排序）：

1. **人工改稿的 diff 视图**：把 `revise` 的改动做成可逐条接受/拒绝的 diff（现在只能整版回滚）。
2. **多模型交叉审稿**：逻辑审用强模型，读者审用便宜模型，编辑审用本地模型，降低单点偏差。
3. **对话归属校验**：统计每角色台词与 `voice` 指纹的相似度，专治「所有人说话一个味」。
4. **敏感与合规检查**：按平台规则扫描暴力/迷信/现实影射，导出前给出风险清单。
5. **竞品评论挖掘**：市场环节接入真实评论语料，把「读者想要什么」变成引用而不是猜测。
6. **封面/简介/标签/章节目录生成**：投稿必需，目前只生成正文与设定集。
7. **成本与预算控制**：按 token 计价、按章预算、超预算自动降级到本地模型。
8. **有声书**：把定稿章节接 TTS（多角色音色），做试听样章。
9. **团队协作**：审稿批注、角色分工、章节锁。
10. **跨设备同步**：`data/` 目录放进私有仓库或对象存储，实现断点续写换机不断。
