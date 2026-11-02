# Windows 首次使用清单（从装软件到写出第一章）

> 适用：Windows 10 / 11（x64）。全部按顺序做，每步都有"应该看到什么"，对不上就停下看最后一节排错。
> 涉及的其他文档：[创作流程速查](创作流程速查.md) · [环境搭建与开发指南](环境搭建与开发指南.md)

---

## 第 0 步：选一个合适的项目路径（很重要，先做这步）

把项目放在**本机磁盘、路径不含中文和空格、且不在 OneDrive 同步目录里**的位置，例如：

```
D:\dev\AI_NovelGenerator
```

为什么：
- OneDrive / 坚果云等同步盘会锁文件，MongoDB 数据与 `user_data` 容易半写坏；
- 路径里有空格时个别命令要额外加引号，容易出错；
- 放在 `C:\Program Files` 下会因为没有写权限而失败。

复制/移动后，确认这个路径下能看到 `开始创作.bat`、`backend`、`frontend`、`compose.mongodb.yaml`。

---

## 第 0.5 步：把代码拿到本机

**情况 A：还没有代码** —— 装好 Git 后，在 CMD / PowerShell 里：

```bat
cd /d D:\dev
git clone -b arena/d5d2ac87-main https://github.com/zhangxiaopeng155151/main.git AI_NovelGenerator
cd AI_NovelGenerator
```

> 注意分支是 **`arena/d5d2ac87-main`**，这里面才有 `开始创作.bat`、`检查环境.bat` 和
> `scripts/quickstart.py`。默认的 `main` 分支是上游原始代码，没有这些启动脚本。

**情况 B：之前已经 clone 过上游仓库** —— 在你的仓库目录里加一个远端并切过去：

```bat
git remote add arena https://github.com/zhangxiaopeng155151/main.git
git fetch arena arena/d5d2ac87-main
git checkout -b arena-work arena/d5d2ac87-main
```

（用新分支名 `arena-work` 是为了不动你原有的 `main`。）

确认这两个文件在目录里：`开始创作.bat`、`scripts\quickstart.py`。

## 第 1 步：装 4 个软件（只做一次）

### 1.1 Python 3.13

- 下载：<https://www.python.org/downloads/windows/> → "Windows installer (64-bit)"
- 安装第一屏**务必勾选** `Add python.exe to PATH`，然后 `Install Now`
- 验证：按 `Win + R` → 输入 `cmd` → 回车，在窗口里输入：

```
python --version
```

应该看到 `Python 3.13.x`。如果提示"不是内部或外部命令"，说明没勾 PATH：重跑安装包 → `Modify` → 勾上 PATH，或直接用官网安装包修复。

> 不要用 Microsoft Store 里的 Python —— 它的 venv 与本机路径容易互相打架。

### 1.2 Node.js 24 LTS

- 下载：<https://nodejs.org/en/download> → "Windows Installer (.msi) 64-bit"
- 一路默认安装
- 验证（新开一个 cmd 窗口）：

```
node --version
npm --version
```

应该是 `v24.x` 与 `11.x`。**Node 最低 20.9**，低于这个版本前端起不来。

### 1.3 Git

- 下载：<https://git-scm.com/download/win>
- 安装时保持默认，其中 "Use Git from the Windows Command Prompt" 保持选中
- 验证：`git --version`

> 这一步只影响以后更新代码（`git pull`）。只想先用起来可以先跳过。

### 1.4 Docker Desktop（MongoDB 靠它跑）

- 下载：<https://docs.docker.com/desktop/setup/install/windows-install/>
- 安装时保持勾选 "Use WSL 2 instead of Hyper-V"（家庭版会自动装 WSL2 组件，可能需要重启一次）
- 安装完**启动 Docker Desktop**，等左下角出现 **Engine running**（鲸鱼图标不再转圈）
- 验证（新开 cmd）：

```
docker --version
docker compose version
docker info
```

`docker info` 能打印一大段信息 = 引擎已经在跑。如果报 `error during connect` / `cannot connect to the Docker daemon`：
先把 Docker Desktop 完全启动再等 1~2 分钟；仍然不行就重启电脑一次。

> 首次启动 Docker Desktop 会问是否登录账号，可以选 **Skip / Continue without signing in**。

---

## 第 2 步：自检（30 秒）

在项目目录里**双击 `检查环境.bat`**。它会打印版本、三个端口占用情况、MongoDB 容器状态和项目自检结果。

正常的话应该是：

```
--- Versions ---
Python 3.13.x
v24.x
Docker version 2x.x.x
Docker engine: RUNNING
--- Ports 8200 / 3300 / 27017 ---
(none of the three ports is in use)      ← 首次使用一般是这句
--- MongoDB container ---
（空或容器未创建，正常）
--- Project self check ---
[quickstart] Python 3.13.x（首次显示系统 Python 路径，创建后为 .venv\Scripts\python.exe）
[quickstart] Node 24.x
[quickstart] Docker 已运行
[quickstart] 自检完成（未启动任何服务）
```

有问题就先按最后一节排错，别急着往下走。

---

## 第 3 步：双击 `开始创作.bat`

**双击它**（不是右键编辑）。会弹出一个黑色命令行窗口，标题是 `AI Novel Generator`。

首次运行它会依次做（**总共约 3~8 分钟**，取决于网速）：

| 阶段 | 窗口里会看到 | 说明 |
| --- | --- | --- |
| 建虚拟环境 + 装后端依赖 | `安装后端依赖 requirements.txt（首次约 1~3 分钟）...` | 约 400 MB |
| 装前端依赖 | `安装前端依赖（npm ci，首次约 1~2 分钟）...` | 约 750 MB |
| 构建前端 | `构建前端（NEXT_PUBLIC_API_BASE=http://127.0.0.1:8200，约 1 分钟）...` | 大量 `Compiling...` 输出 |
| 起 MongoDB | `等待 MongoDB 容器进入 healthy ...` → `初始化副本集 rs0 ...` → `MongoDB 副本集就绪` | 首次会初始化副本集 |
| 写数据库配置 | `已写入 ...\user_data\config\config.yaml（数据库 novel_generator）` | 之后用 `start.bat` 也能直接跑 |
| 起服务 | `启动后端 ...` / `启动前端 ...` / `应用已启动：http://127.0.0.1:3300` | |
| 打开浏览器 | 默认浏览器自动弹出界面 | |

**看到 `按 Ctrl+C 停止前后端（MongoDB 由 Docker 单独管理）` 就是成功了，这个黑窗口不要关。**

- 之后每天开工：双击 `开始创作.bat`（十几秒就起来，不会重复安装）。
- 收工：直接关掉黑窗口 = 停前端和后端。**MongoDB 继续在 Docker 里跑，这是正常的**（下次启动更快）。
  要停 MongoDB：`docker compose -f compose.mongodb.yaml stop`。**千万不要加 `-v`**，那会删掉数据卷。

> 如果浏览器没自动打开：手动访问 <http://127.0.0.1:3300>。
> 如果 Windows 防火墙弹窗询问，允许"专用网络"即可（服务只监听 127.0.0.1，不会暴露到局域网）。

---

## 第 3.5 步（推荐）：做一个桌面图标

想让"双击图标 = 开始写小说"：

1. 在项目根目录**双击 `创建桌面图标.bat`**；
2. 桌面上会出现 **AI小说生成器** 图标（蓝色书本+羽毛笔+浪花）；
3. 以后直接双击桌面图标：自动启动全部服务，并**直接打开「新建小说」页面**。

细节与各平台差异见 [桌面图标与快捷启动](桌面图标与快捷启动.md)。想先不放桌面：
`python scripts/create_shortcuts.py --no-desktop`。

---

## 第 4 步：确认数据库已经是通的（通常不用改）

界面右上角 **设置 → 数据库配置**，应该看到：

- **MongoDB 连接地址**：显示为"连接已配置"（点"显示连接地址"可查看，内容应为
  `mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true`）
- **数据库名称**：`novel_generator`

如果显示"连接未配置"，手工补一次：点 **替换连接** → 粘贴上面的地址 → **确认** → 填数据库名 `novel_generator` → **保存**。
保存成功会提示"配置已保存，Mongo 连接已刷新"。

> 判断是否真的通：回到首页，**新建小说**按钮可点、不再提示"请先配置数据库"，就说明数据库正常。

---

## 第 5 步：配模型（唯一必须手工做的一步）

进 **设置 → LLM Provider 管理**：

1. 点 **新增 Provider**
2. 填这几个字段（其余保持默认）：

| 字段 | 填什么 |
| --- | --- |
| **Provider 别名** | 随便起，例如 `日常写作-GPT` |
| **客户端类别** | 你有哪家的 Key 就选哪家：`openai` / `deepseek` / `gemini` / `claude`；中转或自建网关一般选 `openai` |
| **API 基地址** | 官方地址留空或填官方域名（OpenAI `https://api.openai.com`、DeepSeek `https://api.deepseek.com`、Gemini `https://generativelanguage.googleapis.com`、Claude `https://api.anthropic.com`）；中转站填它给你的地址（一般以 `/v1` 结尾） |
| **API Key** | 粘贴你的 Key |
| **默认模型** | 例如 `gpt-4o-mini`、`deepseek-chat`、`gemini-2.5-flash`（写服务商文档里的模型名） |

3. 点 **测试接口**：会发 4 次极小请求，看"接口可用性 / 流式输出 / JSON Schema / JSON Output / Function Calling"几项。
   - 能通过就直接往下；某项失败不要紧，但 **JSON Schema 失败要在下方"能力开关"里手动关掉**（关掉后程序走 JSON 文本模式）。
   - 测试会消耗少量 token，也会计费。
4. 勾上 **启用**，点 **保存**。
5. 切到 **小说生成流程配置** → **全局默认 Provider** 选刚配的这个 → **保存**。

> 有多个 Key 想分开用：给便宜模型再建一个 Provider，然后在"小说生成流程配置"里给个别流程步骤单独指定。
> 网络需要代理时，把 Provider 里的 **使用系统代理** 打开。

---

## 第 6 步：创建第一本书，跑出第一章

1. 首页点 **创建小说** → 选 **AI 创作** 标签页
2. **你的创意**：一两句话即可，例如
   *"一个能听见潮汐记忆的档案管理员，在填海城市里追查失踪的姐姐"*
3. 填 **预计章节数** 和 **每章字数**（先小一点试水，比如 20 章 / 2500 字）
4. 点 **开始 AI 创作**，会依次走：**扩写完整剧情 → 提炼创意 → 生成故事核心 → 生成小说设定**
5. 出结果后看 **AI 生成结果预览**，可以直接改，满意就点 **保存并创建小说** → 提示"小说创建成功！"

进入写作页后，**跟着左侧「创作进度」走**（它会一直告诉你下一步该点什么）：

| 进度阶段 | 做什么 |
| --- | --- |
| 建立作品 | 小说资料（故事方向 / 世界观 / 风格 / 篇幅），可 AI 生成也可手写 |
| 开场资料 | 核心势力 → 势力关系 → 主角 → 核心角色 → 势力归属 → 角色关系；世界规则、开场物品可点 **暂不添加，继续** |
| 本卷剧情 | 准备第一卷 → 生成全书分卷 → 完善本卷剧情 |
| 本卷准备 | 篇章计划 → 场景计划 → 章计划（逐层细化，都能改） |
| 本卷章节 | 准备下一章剧情 → **写作·章节 1** → 生成正文 → 审阅候选 → 保存 |
| 继续 | 章后记录（核对人物/关系/物品/规则变化）、伏笔、下一章 |

**所有 AI 生成结果都是候选**，先审阅、可编辑，点保存才生效；正文也能纯手写。

---

## 第 7 步：备份（写了几章之后就开始做）

需要备份两样东西，**缺一不可**：

1. **数据库**（CMD 里执行，输出到当前目录）：

```
docker exec novel-generator-mongodb mongodump --archive --gzip --db novel_generator > novel_generator-%date:~0,4%%date:~5,2%%date:~8,2%.archive.gz
```

2. **用户数据目录**：直接复制 `D:\dev\AI_NovelGenerator\user_data` 整个文件夹（里面有配置、导出、上传的封面、自定义流程）。

恢复数据库：

```
docker exec -i novel-generator-mongodb mongorestore --archive --gzip --nsInclude "novel_generator.*" < 你备份的.archive.gz
```

> 只"导出单本书"不是完整备份；升级代码前先备份，且先关掉应用。

---

## Windows 上的坑（照这个排查）

| 现象 | 原因 / 处理 |
| --- | --- |
| 双击 `开始创作.bat` **一闪而过** | 说明脚本在早期就退出了。打开 cmd，`cd /d D:\dev\AI_NovelGenerator` 然后执行 `开始创作.bat`，这样报错会留在窗口里 |
| 提示 `[ERROR] Python 3.11+ was not found` | Python 没装或没进 PATH：重跑安装包勾上 `Add python.exe to PATH`，或改用 `py -3 scripts\quickstart.py --persist-config` |
| 提示 `需要 Docker 才能自动启动 MongoDB` | Docker Desktop 没启动。启动它，等 Engine running，再重试 |
| `docker info` 报 `cannot connect to the Docker daemon` | Docker Desktop 还在启动 / WSL2 未就绪：等 1~2 分钟，必要时重启电脑或 `wsl --update` |
| `docker compose up` 报端口占用 | 本机已装过独立 MongoDB 或别的程序占了 27017。**不要删数据卷**。要么停掉那个 MongoDB 服务（`services.msc` → MongoDB → 停止），要么用你已有的副本集：`开始创作.bat --no-mongo --mongo-uri "你的连接串"` |
| 提示 `后端端口 8200 已被占用` / `前端端口 3300 已被占用` | 之前开的实例没关干净，或别的程序占用。看 `检查环境.bat` 里的端口列表，找到 PID → 任务管理器结束；或换端口：`开始创作.bat --backend-port 8300 --frontend-port 3400` |
| 后端报 `这个数据目录正在使用，请关闭原实例后重试` | 你开了两个实例（比如上次的窗口没关）。关掉多余窗口；确实要并行就设不同的 `NOVEL_GENERATOR_USER_DATA_DIR` |
| 界面提示"请先配置数据库" | MongoDB 没起：`docker compose -f compose.mongodb.yaml ps` 看是否 healthy；不健康先看 `docker compose -f compose.mongodb.yaml logs mongodb` |
| 保存时报事务/副本集相关错误 | 连到了**单机 mongod**。必须用副本集：本项目自带的 compose 已带 `--replSet rs0`，若用自己装的库要确认已 `rs.initiate` |
| `npm ci` 报一大堆 `EBUSY` / `EPERM` | 路径在 OneDrive 或被杀软实时扫描锁文件：换到 `D:\dev\...`，并把该目录加入杀软排除项 |
| `npm ci` 报 `EACCES` / 权限错误 | 用普通用户目录，不要放在 `C:\Program Files`；也不要 `sudo`/管理员权限装依赖 |
| 生成时报"没有可用的 AI 服务" | Provider 没启用，或"小说生成流程配置"里没选**全局默认 Provider** |
| 生成很慢或报 429 | 服务商限流：把该 Provider 的**最大并发数**调低（如 2），或换模型 |
| 生成结果 JSON 解析失败 | 模型不支持原生 JSON Schema：在 Provider 的**能力开关**里关掉 `JSON Schema`，或把**结构化输出方式**改成"工具输出（旧模型）" |
| 关闭窗口后 MongoDB 还在跑 | 正常。它是 Docker 容器，用 `docker compose -f compose.mongodb.yaml stop` 单独停；**不要 `down -v`** |
| 中文路径下报奇怪的编码错误 | 换到纯英文路径（第 0 步） |
| 想更新到最新代码 | `git pull`（或重新下载并覆盖，保留 `user_data`）→ 再次双击 `开始创作.bat`，它会重新装依赖并按需重建前端 |

---

## 需要求助时，给我这三样

1. `检查环境.bat` 整个窗口的输出（右键"全选"→ 回车复制）；
2. `开始创作.bat` 窗口里**最后 30 行**（尤其是 `[错误]` 开头那几行）；
3. 浏览器 F12 → Console 里的红色报错（如果界面操作有问题）。

补充可选命令（排查数据库）：

```
docker compose -f compose.mongodb.yaml ps
docker compose -f compose.mongodb.yaml logs --tail 50 mongodb
docker exec novel-generator-mongodb mongosh --quiet --eval "rs.status().ok"
```

最后一条返回 `1` 表示副本集正常。
