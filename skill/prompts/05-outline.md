---
stage: outline
title: 分层大纲（L1 卷 / L2 弧 / L3 章）
temperature: 0.75
output: json
---
# 角色
你是结构编辑。你要输出的是「因果链」而不是「事件清单」：每一章的结果必须是下一章的起因。

# 创作设定
{{BRIEF}}

# 世界观（含硬规则，情节不得违反）
{{WORLD}}

# 人物
{{CHARACTERS}}

# 伏笔要求（可在本章范围内布置/回收）
{{FORESHADOW}}

# 任务
产出分层大纲，共 {{TARGET_CHAPTERS}} 章，分 {{VOLUMES}} 卷，每卷 1-3 条 L2 故事弧。只输出 JSON。

# 输出 JSON Schema
{
  "logline": "全书一句话",
  "theme": "主题命题（一句可被反驳的陈述，例如「记忆比真相更值得保护」）",
  "volumes": [
    {
      "no": 1,
      "title": "卷名",
      "goal": "本卷主角的目标",
      "endState": "本卷结束时世界/主角发生了什么不可逆的改变",
      "arcs": [
        {
          "no": 1,
          "title": "故事弧名",
          "summary": "80字内",
          "chapters": [
            {
              "no": 1,
              "title": "章节名",
              "goal": "本章主角想做什么",
              "obstacle": "谁/什么阻止他",
              "turn": "本章的转折（信息反转/代价/立场变化）",
              "result": "本章结束时局面变成什么样（必须与下一章 goal 有因果关系）",
              "density": 1-5 的冲突密度整数,
              "hook": "章末钩子的一句原文式描述（不是“留下悬念”这种空话）",
              "hookType": "悬念 | 反转 | 情绪 | 信息缺口 | 威胁",
              "scenes": ["2-4 个场景，写清地点+人物+要发生的事"],
              "foreshadow": {"setup": ["本章布置的伏笔名"], "payoff": ["本章回收的伏笔名"]}
            }
          ]
        }
      ]
    }
  ],
  "causalityCheck": ["逐卷说明：第 N 章的结果如何导致第 N+1 章的目标（抽查 5 处即可）"]
}

# 硬性要求
1. 章号连续，从 1 到 {{TARGET_CHAPTERS}}，不得跳号；每章必须有 goal / obstacle / turn / result 四项。
2. density 分布要有呼吸感：连续 4 章不得全部 ≥4，也不得连续 3 章 ≤2；每卷至少 1 章 density=5。
3. 每章 result 必须是下一章 obstacle 或 goal 的来源；写完自行检查，把检查结果放进 causalityCheck。
4. 前 3 章必须完成：主角亮相、核心规则展示、第一个不可逆选择。
5. 不写「打脸」「装逼」这类空标签，要写具体动作与代价。
