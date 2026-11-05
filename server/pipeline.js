/**
 * 墨脉 InkFlow —— 长篇小说创作工作流引擎
 *
 * 设计原则
 * 1) 每个环节都有明确的输入 / 输出契约，产物落在 project 上，下一环节只读契约字段。
 * 2) 审核不是「让模型自己说好不好」，而是「脚本实测 + 三个视角的模型判断」双轨；
 *    字数、AI 味、钩子强度、伏笔执行这些硬指标以脚本实测为准，模型无权覆盖。
 * 3) 任一环节失败可重跑；每章多版本，可回滚。
 */

import { complete, parseJSON } from './llm.js';
import { renderPrompt, systemFor } from './prompts.js';
import * as M from './mock.js';
import * as T from './text.js';
import { getSettings, loadCorpus, newId } from './store.js';

/* =============================== 环节元数据 =============================== */

export const STAGES = [
  {
    id: 'brief', no: 1, title: '立项设定', group: '准备', blocking: true,
    input: '题材 / 细分 / 受众 / 目标章数与单章字数 / 文风标签 / 禁忌',
    output: 'project.brief —— 后续所有环节的约束源（缺项会给默认值，但会记录风险）',
    handoff: 'brief.genre → 市场热度检索范围；brief.wordsPerChapter → 每章字数闸门',
  },
  {
    id: 'market', no: 2, title: '市场热度雷达', group: '选题', blocking: false,
    input: 'brief（题材/受众）+ 可选的外部抓取素材（榜单、评论、标签观察）',
    output: 'project.market —— 细分热度、趋势、饱和度、读者诉求、避坑清单',
    handoff: 'market.items[].heat/saturation → 选题打分；market.avoid → 选题硬性规避项',
  },
  {
    id: 'topic', no: 3, title: '方向选题', group: '选题', blocking: true,
    input: 'brief + market + 创新性约束（五种不同情绪引擎）',
    output: 'project.topics[] —— 5 个候选（logline、核心冲突、差异化、heat/novelty/risk/total）',
    handoff: 'selectedTopicId → 查重对象；topic 的 promise/differentiation → 世界观约束',
  },
  {
    id: 'dedup', no: 4, title: '查重（原创性）', group: '选题', blocking: true,
    input: 'selected topic + 本地参考语料（data/corpus）+ 字符 n-gram 预计算相似度',
    output: 'project.dedup —— verdict(safe/risky/duplicate)、逐条重合维度、必须修改项',
    handoff: 'dedup.mustChange → 世界观构建的禁止区；verdict=duplicate 时不得进入下一步',
  },
  {
    id: 'world', no: 5, title: '世界观构建', group: '设定', blocking: true,
    input: 'brief + topic + dedup.mustChange',
    output: 'project.world —— 力量体系（规则/代价/上限/例外）、硬规则、阵营、术语表、留白问题',
    handoff: 'world.hardRules + glossary → 逻辑审的事实基准；glossary → 正文术语约束',
  },
  {
    id: 'characters', no: 6, title: '人物关系网络', group: '设定', blocking: true,
    input: 'world + topic',
    output: 'project.characters[] —— 档案（欲望/障碍/错误信念/秘密/转折/弧光）、位阶、关系边',
    handoff: 'characters[].rank/motivation → 逻辑审的人物事实；关系边 → 场景分配与冲突矩阵',
  },
  {
    id: 'outline', no: 7, title: '分层大纲（L1/L2/L3）', group: '结构', blocking: true,
    input: 'brief + world + characters + 伏笔预留位',
    output: 'project.outline —— 卷(L1) → 弧(L2) → 章(L3)；每章含 goal/obstacle/turn/result/density/hook',
    handoff: 'L3 卡片 → 写作的输入；density → 节奏曲线；每章 hook → 钩子台账',
  },
  {
    id: 'pacing', no: 8, title: '节奏曲线检查', group: '结构', blocking: false,
    input: 'outline 全部 L3 的 conflict density',
    output: 'project.pacing —— 曲线点、移动平均、报警（连续低密度/高峰间隔/开局过载/结尾失速）',
    handoff: 'high 级报警 → 大纲调律建议（可一键执行）；曲线 → UI 可视化',
  },
  {
    id: 'foreshadow', no: 9, title: '伏笔与钩子设计', group: '结构', blocking: false,
    input: 'outline + glossary',
    output: 'project.foreshadow —— 台账（布置章/回收章/类型/风险/中途提示）+ 每章钩子类型',
    handoff: '台账 → 写作的「本章必须布置/回收」清单 → 审稿的伏笔闸门',
  },
  {
    id: 'draft', no: 10, title: '正文写作（分章）', group: '章循环', blocking: true, perChapter: true,
    input: 'L3 卡片 + 硬规则 + 出场人物 + 滚动摘要 + 上一章结尾 + 本章伏笔任务 + 文风基准',
    output: 'chapter.current（正文）+ 版本记录',
    handoff: '正文 → 三审；卡片 hook → 章末钩子检查',
  },
  {
    id: 'review', no: 11, title: '三视角审稿团', group: '章循环', blocking: true, perChapter: true,
    input: '正文 + 硬规则/术语/人物事实（逻辑审）+ 大纲承诺（读者审）+ 文风基准与实测指标（编辑审）',
    output: 'chapter.review —— 三个 pass 的问题清单 + 闸门结果（字数/AI味/钩子/伏笔/文风）',
    handoff: 'high 级问题与非 AI 类闸门失败 → 修正；AI 类失败 → 去AI味',
  },
  {
    id: 'revise', no: 12, title: '修正', group: '章循环', blocking: true, perChapter: true,
    input: '审稿意见（按严重度排序）+ 必须满足的指标',
    output: 'chapter 新版本 + 修订说明；轮次 +1',
    handoff: '修订后必须重跑三审，直到非 AI 类闸门全绿（最多 reviewRounds 轮）',
  },
  {
    id: 'deai', no: 13, title: '去 AI 味', group: '章循环', blocking: true, perChapter: true,
    input: '正文 + 脚本统计的 AI 腔命中表 + 文风基准',
    output: '改写后的正文 + 前/后指标对比 + 替换记录',
    handoff: '改写后重跑三审做最终校验；AI 味闸门仍不过则本地规则兜底',
  },
  {
    id: 'summary', no: 14, title: '章节摘要 / 状态增量', group: '章循环', blocking: true, perChapter: true,
    input: '定稿正文',
    output: 'chapter.summary、events、facts、伏笔状态、未解悬念、下一章交接说明',
    handoff: '摘要 → 下一章上下文；facts → 人物事实库；foreshadow 状态 → 台账',
  },
  {
    id: 'compress', no: 15, title: '前情摘要滚动压缩', group: '维护', blocking: false, perChapter: true,
    input: '已滚动摘要 + 新一批章节摘要（每 compressEvery 章触发）',
    output: 'project.summaries.rolling（硬上限字数）+ coveredUpTo',
    handoff: 'rolling → 写作上下文（防止 30 章之后爆上下文）；最近 3 章仍用逐章摘要',
  },
  {
    id: 'export', no: 16, title: '导出', group: '交付', blocking: false,
    input: '定稿章节 + 大纲 + 设定集',
    output: 'Markdown / TXT / JSON 全书（含设定集与审稿记录）',
    handoff: '交付给人工精修或投稿',
  },
];

export const CHAPTER_STEPS = ['draft', 'review', 'revise', 'deai', 'summary'];

/* =============================== 项目工厂 =============================== */

export function createProject(input = {}) {
  const now = new Date().toISOString();
  const id = input.id || newId('nov');
  const brief = {
    genre: input.genre || '东方玄幻',
    subgenre: input.subgenre || '官署怪谈 / 规则流',
    audience: input.audience || '男频 25-35，喜欢规则流与道德困境',
    targetChapters: Number(input.targetChapters || 12),
    wordsPerChapter: Number(input.wordsPerChapter || 2400),
    pov: input.pov || '第三人称限知',
    styleTags: input.styleTags || ['冷峻', '市井质感', '少形容词'],
    tone: input.tone || '压抑中带一点暖',
    taboos: input.taboos || ['不写无代价的金手指', '不写降智反派'],
    mustHaves: input.mustHaves || ['每章一个可验证的规则细节'],
    seedIdea: input.seedIdea || '长明灯与影子：照见谁的死期',
  };
  return {
    id,
    name: input.name || `《${brief.seedIdea.slice(0, 6)}》创作项目`,
    createdAt: now,
    updatedAt: now,
    brief,
    market: null,
    marketInput: [],
    topics: [],
    selectedTopicId: null,
    dedup: null,
    world: null,
    characters: [],
    relationEdges: [],
    outline: null,
    pacing: null,
    foreshadow: null,
    chapters: [],
    summaries: { rolling: '', coveredUpTo: 0, perChapter: {}, compressedAt: null },
    timeline: [],
    facts: [],
    logs: [],
    runs: [],
    export: null,
    stageFlags: {},
  };
}

/* =============================== 通用小工具 =============================== */

const isMock = () => getSettings().provider === 'mock';

function log(project, emit, message, meta = {}) {
  const entry = { at: new Date().toISOString(), message, ...meta };
  project.logs.push(entry);
  if (project.logs.length > 400) project.logs.splice(0, project.logs.length - 400);
  emit?.({ type: 'log', ...entry });
}

function clip(text = '', n = 400) {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

export function flatChapters(outline) {
  return M.flatChapters(outline);
}

export function chapterCard(project, no) {
  return flatChapters(project.outline).find((c) => c.no === no) || null;
}

export function selectedTopic(project) {
  return (project.topics || []).find((t) => t.id === project.selectedTopicId) || (project.topics || [])[0] || null;
}

function styleGuide(project) {
  const b = project.brief || {};
  const done = (project.chapters || []).filter((c) => c.status === 'done');
  const avg = done.length
    ? done.reduce((s, c) => s + (c.metrics?.avgSentenceLen || 0), 0) / done.length
    : 0;
  const dialogue = done.length
    ? done.reduce((s, c) => s + (c.metrics?.dialogueRatio || 0), 0) / done.length
    : 0;
  return [
    `整体语调：${b.tone || '克制'}；文风标签：${(b.styleTags || []).join('、') || '冷峻、具体'}`,
    `视角：${b.pov || '第三人称限知'}；单章 ${b.wordsPerChapter || 2400} 字左右`,
    `禁忌：${(b.taboos || []).join('；') || '无'}`,
    done.length
      ? `前文实测：平均句长 ${avg.toFixed(1)} 字，对话占比 ${(dialogue * 100).toFixed(0)}%，请贴近这一基准（±15%）。`
      : '尚无前文实测，首章请主动建立节奏：长短句交替，对话占比 15%-40%。',
    '具体优先于抽象：情绪写成动作，设定写成场景中的物件。',
  ].join('\n');
}

/* =============================== 各环节实现 =============================== */

async function runBrief(project, emit) {
  const b = project.brief;
  const missing = [];
  if (!b.genre) missing.push('题材');
  if (!b.audience) missing.push('受众');
  if (!b.targetChapters) missing.push('目标章数');
  b.wordsPerChapter = Math.max(Number(b.wordsPerChapter) || 2400, getSettings().minWords);
  project.stageFlags.brief = { ok: missing.length === 0, missing };
  log(project, emit, `立项完成：${b.genre} · ${b.subgenre} · ${b.targetChapters} 章 × ${b.wordsPerChapter} 字${missing.length ? `（缺项：${missing.join('、')}，已用默认值）` : ''}`);
  return { summary: `${b.targetChapters} 章 × ${b.wordsPerChapter} 字` };
}

function marketSourcesText(project) {
  const items = project.marketInput || [];
  if (!items.length) return '';
  return items.map((i, idx) => `${idx + 1}. ${i.title}${i.url ? `（${i.url}）` : ''}\n   ${clip(i.note || '', 300)}`).join('\n');
}

async function runMarket(project, emit, force = false) {
  const cfg = getSettings();
  if (isMock()) {
    project.market = M.mockMarket(project);
  } else {
    const { prompt, meta } = renderPrompt('00-market', {
      GENRE: project.brief.genre,
      SUBGENRE: project.brief.subgenre,
      AUDIENCE: project.brief.audience,
      CONSTRAINTS: (project.brief.taboos || []).join('；'),
      MARKET_SOURCES: marketSourcesText(project) || '（无外部素材：用你已掌握的行业认知估计，mode 写 estimated）',
    });
    const res = await complete({ system: systemFor('市场热度'), prompt, json: true, temperature: 0.3 });
    const data = parseJSON(res.text);
    project.market = {
      mode: data.mode || 'estimated',
      insight: data.insight || '',
      items: (data.items || []).map((i) => ({
        genre: i.genre, heat: Number(i.heat) || 50, trend: i.trend || 'stable',
        saturation: i.saturation || 'medium', readerWant: i.readerWant || '', note: i.note || '',
        sources: i.sources || [],
      })),
      avoid: data.avoid || [],
      updatedAt: new Date().toISOString(),
      tokens: res.tokens,
    };
  }
  project.market.refreshedAt = new Date().toISOString();
  log(project, emit, `市场雷达更新：${project.market.items.length} 个细分，建议避开 ${project.market.avoid.length} 类套路（模式：${project.market.mode}）`);
  return { summary: `${project.market.items.length} 个细分 · ${project.market.mode}` };
}

function normalizeTopic(t) {
  const heat = Number(t.heat) || 60;
  const novelty = Number(t.novelty) || 60;
  const risk = Number(t.risk) || 40;
  return {
    id: t.id || `t_${newId('x').slice(-6)}`,
    title: t.title || '未命名',
    logline: t.logline || '',
    coreConflict: t.coreConflict || '',
    promise: t.promise || '',
    differentiation: t.differentiation || '',
    audience: t.audience || '',
    heat, novelty, risk,
    riskNote: t.riskNote || '',
    total: Number(t.total) || Number((heat * 0.3 + novelty * 0.4 + (100 - risk) * 0.3).toFixed(1)),
  };
}

async function runTopic(project, emit) {
  let data;
  if (isMock()) data = M.mockTopics(project);
  else {
    const { prompt } = renderPrompt('01-topic', {
      BRIEF: project.brief,
      MARKET: project.market,
    });
    const res = await complete({ system: systemFor('方向选题'), prompt, json: true, temperature: 1 });
    data = parseJSON(res.text);
  }
  project.topics = (data.topics || []).map(normalizeTopic);
  if (!project.topics.length) throw new Error('选题环节未产出候选，请重试');
  project.topics.sort((a, b) => b.total - a.total);
  project.selectedTopicId = project.topics[0].id;
  project.topicRecommendation = data.recommendation || '';
  log(project, emit, `生成了 ${project.topics.length} 个候选选题，当前选中《${project.topics[0].title}》（总分 ${project.topics[0].total}）`);
  return { summary: `${project.topics.length} 个候选 · 选中《${project.topics[0].title}》` };
}

export async function selectTopic(project, topicId) {
  if (!(project.topics || []).some((t) => t.id === topicId)) throw new Error('选题不存在');
  project.selectedTopicId = topicId;
  project.dedup = null;
  project.world = null;
  project.characters = [];
  project.outline = null;
  project.pacing = null;
  project.foreshadow = null;
  project.chapters = [];
  project.summaries = { rolling: '', coveredUpTo: 0, perChapter: {}, compressedAt: null };
  project.stageFlags = {};
  return project;
}

function corpusPreScores(project) {
  const corpus = loadCorpus();
  const topic = selectedTopic(project);
  if (!topic) return [];
  const text = [topic.title, topic.logline, topic.coreConflict, topic.differentiation, project.brief.seedIdea].join(' ');
  return corpus.map((c) => ({
    ...c,
    localSim: T.similarity(text, `${c.title} ${c.text}`),
  })).sort((a, b) => b.localSim - a.localSim);
}

async function runDedup(project, emit) {
  const topic = selectedTopic(project);
  if (!topic) throw new Error('请先选题');
  const corpus = corpusPreScores(project);
  let data;
  if (isMock()) data = M.mockDedup(project, corpus);
  else {
    const { prompt } = renderPrompt('02-dedup', {
      TOPIC: topic,
      MATCHES: corpus.slice(0, 8).map((c) => ({
        title: c.title, author: c.author, localSimilarity: c.localSim, excerpt: clip(c.text, 400),
      })),
    });
    const res = await complete({ system: systemFor('查重'), prompt, json: true, temperature: 0.2 });
    data = parseJSON(res.text);
  }
  project.dedup = {
    verdict: data.verdict || 'risky',
    score: Number(data.score) || 60,
    matches: (data.matches || []).map((m) => ({
      title: m.title, author: m.author,
      similarity: Number(m.similarity) || 0,
      localSimilarity: corpus.find((c) => c.title === m.title)?.localSim ?? null,
      overlapFacets: m.overlapFacets || [],
      detail: m.detail || '',
      suggestion: m.suggestion || '',
    })),
    mustChange: data.mustChange || [],
    advice: data.advice || '',
    at: new Date().toISOString(),
  };
  if (project.dedup.verdict === 'duplicate') {
    log(project, emit, `⚠ 查重判定为 duplicate：${project.dedup.mustChange.join('；') || '请调整核心设定后再推进'}`, { level: 'warn' });
  } else {
    log(project, emit, `查重通过（${project.dedup.verdict}，安全分 ${project.dedup.score}），必须修改项：${project.dedup.mustChange.length} 条`);
  }
  return { summary: `${project.dedup.verdict} · 相似度最高 ${(Math.max(0, ...project.dedup.matches.map((m) => m.similarity)) * 100).toFixed(0)}%` };
}

export function normalizeWorld(w = {}, project) {
  const ps = (w.powerSystem || []).map((p) => ({
    name: p.name || '未命名体系',
    unit: p.unit || '',
    tiers: p.tiers || [],
    rules: p.rules || [],
    cost: p.cost || '',
    bounds: p.bounds || '',
    exception: p.exception || '',
  }));
  return {
    premise: w.premise || project.brief.seedIdea || '',
    era: w.era || '',
    powerSystem: ps,
    hardRules: w.hardRules || [],
    factions: w.factions || [],
    geography: w.geography || [],
    society: w.society || '',
    glossary: (w.glossary || []).map((g) => ({ term: g.term || '', def: g.def || '', type: g.type || '其他' })),
    taboo: w.taboo || [],
    openQuestions: w.openQuestions || [],
  };
}

async function runWorld(project, emit) {
  const topic = selectedTopic(project);
  let data;
  if (isMock()) data = M.mockWorld(project);
  else {
    const { prompt } = renderPrompt('03-world', {
      BRIEF: project.brief,
      TOPIC: topic,
      DEDUP: project.dedup,
    });
    const res = await complete({ system: systemFor('世界观构建'), prompt, json: true, temperature: 0.85 });
    data = parseJSON(res.text);
  }
  project.world = normalizeWorld(data, project);
  const issues = [];
  for (const p of project.world.powerSystem) {
    if (!p.bounds) issues.push(`${p.name} 缺少「做不到什么」的上限说明`);
    if (!p.cost) issues.push(`${p.name} 缺少使用代价`);
  }
  if (project.world.hardRules.length < 3) issues.push('可审核的硬规则少于 3 条，逻辑审将缺少对照基准');
  project.stageFlags.world = { ok: issues.length === 0, notes: issues };
  log(project, emit, `世界观建立：${project.world.powerSystem.length} 套体系、${project.world.hardRules.length} 条硬规则、${project.world.glossary.length} 个术语${issues.length ? `（自检 ${issues.length} 项待补）` : ''}`);
  return { summary: `${project.world.hardRules.length} 条硬规则 · ${project.world.glossary.length} 术语`, notes: issues };
}

export function normalizeCharacters(data = {}) {
  const raw = Array.isArray(data) ? data : Array.isArray(data.characters) ? data.characters : [];
  if (!raw.length) throw new Error('人物环节没有返回 characters 数组，请重试（模型可能返回了错误的结构）');
  const chars = raw.map((c) => ({
    name: c.name || '未命名',
    role: c.role || '配角',
    oneLine: c.oneLine || '',
    age: c.age || '',
    look: c.look || '',
    personality: c.personality || [],
    rank: c.rank || '',
    motivation: c.motivation || '',
    obstacle: c.obstacle || '',
    misbelief: c.misbelief || '',
    secret: c.secret || '',
    turn: c.turn || '',
    arcStart: c.arcStart || '',
    arcEnd: c.arcEnd || '',
    voice: c.voice || '',
    relations: (c.relations || []).map((r) => ({ target: r.target, type: r.type || '关系', tension: r.tension || '' })),
  }));
  return {
    characters: chars,
    network: data.network || '',
    conflictMatrix: data.conflictMatrix || [],
    pov: data.pov || '',
  };
}

async function runCharacters(project, emit) {
  let data;
  if (isMock()) data = M.mockCharacters(project);
  else {
    const { prompt } = renderPrompt('04-characters', {
      WORLD: project.world, TOPIC: selectedTopic(project),
    });
    const res = await complete({ system: systemFor('人物设计'), prompt, json: true, temperature: 0.95 });
    data = parseJSON(res.text);
  }
  const norm = normalizeCharacters(data);
  project.characters = norm.characters;
  project.characterNotes = { network: norm.network, conflictMatrix: norm.conflictMatrix, pov: norm.pov };
  // 关系边（去重）
  const edges = [];
  const seen = new Set();
  for (const c of project.characters) {
    for (const r of c.relations) {
      const key = [c.name, r.target].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: c.name, target: r.target, type: r.type, tension: r.tension, directed: false });
    }
  }
  project.relationEdges = edges;
  project.facts = project.characters
    .filter((c) => c.rank)
    .map((c) => ({ who: c.name, fact: `位阶/身份：${c.rank}`, motivation: c.motivation }));
  const isolated = project.characters.filter((c) => !edges.some((e) => e.source === c.name || e.target === c.name));
  project.stageFlags.characters = { ok: isolated.length === 0, isolated: isolated.map((c) => c.name) };
  log(project, emit, `人物档案完成：${project.characters.length} 人、${edges.length} 条关系边${isolated.length ? `；孤立节点：${isolated.map((c) => c.name).join('、')}` : ''}`);
  return { summary: `${project.characters.length} 人 · ${edges.length} 关系` };
}

export function normalizeOutline(data = {}, project) {
  let no = 0;
  const volumes = (data.volumes || []).map((v, vi) => ({
    no: v.no ?? vi + 1,
    title: v.title || `第${vi + 1}卷`,
    goal: v.goal || '',
    endState: v.endState || '',
    arcs: (v.arcs || []).map((a, ai) => ({
      no: a.no ?? ai + 1,
      title: a.title || `第${ai + 1}弧`,
      summary: a.summary || '',
      chapters: (a.chapters || []).map((c) => {
        no += 1;
        return {
          no: Number(c.no) || no,
          title: c.title || `第${no}章`,
          goal: c.goal || '',
          obstacle: c.obstacle || '',
          turn: c.turn || '',
          result: c.result || '',
          density: Math.min(5, Math.max(1, Number(c.density) || 3)),
          hook: c.hook || '',
          hookType: c.hookType || '悬念',
          scenes: c.scenes || [],
          words: Number(c.words) || project.brief.wordsPerChapter,
          foreshadow: { setup: c.foreshadow?.setup || [], payoff: c.foreshadow?.payoff || [] },
        };
      }),
    })),
  }));
  return {
    logline: data.logline || '',
    theme: data.theme || '',
    volumes,
    causalityCheck: data.causalityCheck || [],
  };
}

async function runOutline(project, emit) {
  const target = Number(project.brief.targetChapters) || 12;
  let data;
  if (isMock()) data = M.buildOutline(project);
  else {
    const { prompt } = renderPrompt('05-outline', {
      BRIEF: project.brief,
      WORLD: project.world,
      CHARACTERS: project.characters.map((c) => ({
        name: c.name, role: c.role, motivation: c.motivation, obstacle: c.obstacle, rank: c.rank,
      })),
      FORESHADOW: project.foreshadow || '（尚未设计，可在大纲中预留 6-9 条伏笔位）',
      TARGET_CHAPTERS: target,
      VOLUMES: 3,
    }, { budget: 30000 });
    const res = await complete({ system: systemFor('分层大纲'), prompt, json: true, temperature: 0.8 });
    data = parseJSON(res.text);
  }
  project.outline = normalizeOutline(data, project);
  const chapters = flatChapters(project.outline);
  if (!chapters.length) throw new Error('大纲没有解析出任何章节：模型返回的结构不符合 05-outline 约定（需要 volumes[].arcs[].chapters[]），请重试或降低温度');
  const problems = [];
  if (chapters.length !== target) problems.push(`章数 ${chapters.length} ≠ 目标 ${target}`);
  for (const c of chapters) {
    if (!c.goal || !c.obstacle || !c.turn || !c.result) problems.push(`第 ${c.no} 章缺少目标/阻碍/转折/结果`);
  }
  project.stageFlags.outline = { ok: problems.length === 0, problems };
  log(project, emit, `分层大纲完成：${project.outline.volumes.length} 卷、${chapters.length} 章${problems.length ? `；结构自检 ${problems.length} 项：${problems.slice(0, 3).join('；')}` : '；结构自检通过'}`);
  return { summary: `${project.outline.volumes.length} 卷 · ${chapters.length} 章`, notes: problems };
}

/** 节奏曲线：本地算法（两种 provider 都执行），LLM 只负责解释与给方案 */
export function computePacing(project) {
  const chapters = flatChapters(project.outline);
  const points = chapters.map((c) => ({ no: c.no, density: c.density, title: c.title, hookType: c.hookType }));
  const d = points.map((p) => p.density);
  const alarms = [];
  const push = (type, chaptersIdx, severity, why, fix) => alarms.push({
    type, chapters: chaptersIdx, severity, why, fix,
    id: `${type}-${chaptersIdx.join('-')}`,
  });

  // 1) 连续低密度平台
  for (let i = 0; i + 2 < d.length; i++) {
    if (d[i] <= 2 && d[i + 1] <= 2 && d[i + 2] <= 2) {
      push('low-plateau', [i + 1, i + 2, i + 3], 'high',
        '连续三章冲突密度 ≤2，读者会在这一段弃书。',
        `在 ${i + 1} 章加入一个具体的威胁（不是铺垫），或把 ${i + 3} 章的转折提前到 ${i + 2} 章。`);
    }
  }
  // 2) 双高峰间隔过长
  const peaks = points.filter((p) => p.density === 5).map((p) => p.no);
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i] - peaks[i - 1] >= 7) {
      push('gap-between-peaks', [peaks[i - 1], peaks[i]], 'medium',
        '两个 5 分高潮之间隔了 ≥7 章，中段会失速。',
        `在 ${Math.round((peaks[i - 1] + peaks[i]) / 2)} 章附近插入一次小规模正面冲突。`);
    }
  }
  // 3) 开局过载
  const head = d.slice(0, 5);
  if (head.length >= 5 && head.reduce((a, b) => a + b, 0) / head.length >= 4.2) {
    push('front-loaded', [1, 2, 3, 4, 5], 'medium',
      '前 5 章平均密度过高，后劲容易不足。', '把第 4 或 5 章降为喘息章，留出人物关系戏。');
  }
  // 4) 结尾失速
  const tail = d.slice(-3);
  if (tail.length >= 3 && tail.reduce((a, b) => a + b, 0) / tail.length <= 2.5) {
    push('flat-ending', [d.length - 2, d.length - 1, d.length], 'high',
      '最后三章密度过低，结局没有压力。', '把最大的一次代价放到倒数第二章，最后一章只写选择的结果。');
  }
  // 5) 卷内中段塌陷
  for (const v of project.outline?.volumes || []) {
    for (const a of v.arcs || []) {
      const arr = a.chapters.map((c) => c.density);
      const mid = Math.floor(arr.length / 2);
      if (arr.length >= 4 && arr[mid - 1] <= 2 && arr[mid] <= 2) {
        push('arc-sag', [a.chapters[mid - 1].no, a.chapters[mid].no], 'medium',
          `${a.title} 中段连续两章低密度，弧线塌陷。`, `把该弧的关键信息提前，或在这两章加入关系冲突。`);
      }
    }
  }
  const avg = d.length ? Number((d.reduce((a, b) => a + b, 0) / d.length).toFixed(2)) : 0;
  return {
    points,
    alarms,
    avg,
    peaks,
    advice: alarms.length
      ? `平均密度 ${avg}，发现 ${alarms.length} 个节奏报警（${alarms.filter((a) => a.severity === 'high').length} 个高危）。优先处理 high 级：它们直接对应读者流失点。`
      : `平均密度 ${avg}，曲线有呼吸感，未发现节奏报警。`,
    computedAt: new Date().toISOString(),
  };
}

async function runPacing(project, emit) {
  const local = computePacing(project);
  let advice = local.advice;
  let modelAlarms = [];
  if (!isMock()) {
    try {
      const { prompt } = renderPrompt('06-pacing', {
        PACING_POINTS: local.points,
        CHAPTER_SUMMARIES: flatChapters(project.outline).map((c) => ({ no: c.no, title: c.title, goal: c.goal, turn: c.turn, density: c.density })),
      });
      const res = await complete({ system: systemFor('节奏诊断'), prompt, json: true, temperature: 0.3 });
      const data = parseJSON(res.text);
      advice = data.advice || advice;
      modelAlarms = (data.alarms || []).map((a) => ({ ...a, source: 'model', id: `${a.type}-${(a.chapters || []).join('-')}` }));
    } catch (err) {
      log(project, emit, `模型节奏诊断失败，仅使用本地算法：${err.message}`, { level: 'warn' });
    }
  }
  const seen = new Set(local.alarms.map((a) => a.id));
  const merged = [...local.alarms, ...modelAlarms.filter((a) => !seen.has(a.id))];
  project.pacing = { ...local, alarms: merged, advice };
  project.stageFlags.pacing = { ok: !merged.some((a) => a.severity === 'high'), high: merged.filter((a) => a.severity === 'high').length };
  log(project, emit, `节奏曲线：平均密度 ${local.avg}，${merged.length} 个报警${merged.length ? `（${merged.map((a) => a.type).join('、')}）` : ''}`, { level: merged.length ? 'warn' : 'info' });
  return { summary: `平均密度 ${local.avg} · ${merged.length} 个报警` };
}

/** 一键调律：把 high 级报警涉及的章节密度 +1（保守干预），然后重算曲线 */
export async function autoFixPacing(project, emit) {
  const chapters = flatChapters(project.outline);
  const byNo = new Map(chapters.map((c) => [c.no, c]));
  const high = (project.pacing?.alarms || []).filter((a) => a.severity === 'high');
  const touched = [];
  for (const a of high) {
    for (const no of a.chapters || []) {
      const c = byNo.get(Number(no));
      if (c && c.density < 5) { c.density += 1; touched.push(no); }
    }
  }
  project.pacing = computePacing(project);
  const notes = [...new Set(touched)].sort((a, b) => a - b);
  log(project, emit, `执行节奏调律：提升第 ${notes.join('、')} 章的冲突密度，重算后仍有 ${project.pacing.alarms.length} 个报警`, { level: 'warn' });
  return { touched: notes, pacing: project.pacing };
}

async function runForeshadow(project, emit) {
  let data;
  if (isMock()) data = M.mockForeshadow(project);
  else {
    const { prompt } = renderPrompt('07-foreshadow', {
      OUTLINE: project.outline,
      GLOSSARY: project.world?.glossary || [],
    }, { budget: 32000 });
    const res = await complete({ system: systemFor('伏笔设计'), prompt, json: true, temperature: 0.85 });
    data = parseJSON(res.text);
  }
  const total = flatChapters(project.outline).length;
  const ledger = (data.ledger || []).map((f, i) => ({
    id: f.id || `f${i + 1}`,
    name: f.name || `伏笔${i + 1}`,
    type: f.type || '物件',
    setupChapter: Math.max(1, Number(f.setupChapter) || 1),
    payoffChapter: Math.min(total, Math.max(2, Number(f.payoffChapter) || total)),
    content: f.content || '',
    payoff: f.payoff || '',
    midHint: Number(f.midHint) || null,
    risk: f.risk || 'medium',
    status: 'planned',
    planted: false,
    paid: false,
  })).filter((f) => f.payoffChapter > f.setupChapter);
  project.foreshadow = {
    ledger,
    hooks: data.hooks || [],
    balance: data.balance || '',
    at: new Date().toISOString(),
  };
  const invalid = ledger.filter((f) => f.setupChapter >= f.payoffChapter);
  project.stageFlags.foreshadow = { ok: invalid.length === 0 && ledger.length > 0, invalid: invalid.length };
  log(project, emit, `伏笔台账：${ledger.length} 条，覆盖 ${new Set(ledger.map((f) => f.setupChapter)).size} 个布置章；钩子方案 ${(data.hooks || []).length} 条`);
  return { summary: `${ledger.length} 条伏笔 · ${(data.hooks || []).length} 个钩子` };
}

/* =============================== 每章上下文 =============================== */

export function chapterDuties(project, no) {
  const card = chapterCard(project, no);
  const ledger = project.foreshadow?.ledger || [];
  const setup = ledger.filter((f) => f.setupChapter === no);
  const payoff = ledger.filter((f) => f.payoffChapter === no);
  const hint = ledger.filter((f) => f.midHint === no);
  return { card, setup, payoff, hint };
}

function rollingSummary(project) {
  const s = project.summaries || {};
  const recent = [];
  for (let n = Math.max(1, (project.chaptersDone || 0) - 2); n <= (project.chaptersDone || 0); n++) {
    const text = s.perChapter?.[n];
    if (text) recent.push(`第${n}章：${text}`);
  }
  return {
    rolling: s.rolling || '（尚无滚动摘要，这是前几章，按 L3 卡片与前文摘要写作）',
    recent: recent.join('\n') || '（暂无）',
    coveredUpTo: s.coveredUpTo || 0,
  };
}

/** 估算下一次写作时真正塞进提示词的字符量（滚动摘要 + 最近 3 章 + 设定与卡片） */
function contextEstimate(project) {
  const s = project.summaries || {};
  const done = Number(project.chaptersDone || 0);
  let recent = '';
  for (let n = Math.max(1, done - 2); n <= done; n++) recent += s.perChapter?.[n] || '';
  const base = countChars(s.rolling || '') + recent.length + 4000;
  return { chars: base, tokens: Math.round(base / 1.6) };
}
const countChars = (t = '') => t.length;

function castForChapter(project, card) {
  const all = project.characters || [];
  const sceneText = (card?.scenes || []).join(' ') + ' ' + (card?.goal || '') + (card?.obstacle || '');
  const inScene = all.filter((c) => sceneText.includes(c.name));
  const picked = (inScene.length >= 2 ? inScene : all.slice(0, 4));
  return picked.map((c) => ({
    name: c.name, role: c.role, rank: c.rank,
    motivation: clip(c.motivation, 60), voice: c.voice,
    secret: clip(c.secret, 50), misbelief: clip(c.misbelief, 50),
  }));
}

function draftVars(project, no) {
  const { card, setup, payoff, hint } = chapterDuties(project, no);
  const b = project.brief;
  const prev = project.chapters?.find((c) => c.no === no - 1);
  const prevTail = prev ? prev.current.slice(-800) : '（本章是开篇，没有上一章）';
  const rs = rollingSummary(project);
  return {
    CHAPTER_NO: no,
    CHAPTER_CARD: card,
    HARD_RULES: project.world?.hardRules || [],
    CAST: castForChapter(project, card),
    ROLLING_SUMMARY: rs.rolling,
    RECENT_SUMMARIES: rs.recent,
    PREV_TAIL: prevTail,
    FORESHADOW_TASKS: {
      mustSetup: setup.map((f) => ({ name: f.name, how: f.content })),
      mustPayoff: payoff.map((f) => ({ name: f.name, reveal: f.payoff })),
      mayHint: hint.map((f) => ({ name: f.name, how: '轻轻带过，不要解释' })),
    },
    STYLE_GUIDE: styleGuide(project),
    MIN_WORDS: Math.max(getSettings().minWords, Math.round((b.wordsPerChapter || 2400) * 0.9)),
    MAX_WORDS: Math.round((b.wordsPerChapter || 2400) * 1.3),
    POV: b.pov,
  };
}

/* =============================== 写作 =============================== */

export function ensureChapter(project, no) {
  let ch = project.chapters.find((c) => c.no === no);
  const card = chapterCard(project, no);
  if (!ch) {
    ch = {
      no,
      title: card?.title || `第${no}章`,
      status: 'empty',
      current: '',
      versions: [],
      rounds: 0,
      deaiApplied: false,
      review: null,
      summary: '',
      metrics: null,
      createdAt: new Date().toISOString(),
    };
    project.chapters.push(ch);
    project.chapters.sort((a, b) => a.no - b.no);
  }
  return ch;
}

function commitVersion(ch, text, source) {
  ch.versions.push({
    v: ch.versions.length + 1,
    source,
    at: new Date().toISOString(),
    text,
    words: T.countWords(text),
  });
  ch.current = text;
  ch.metrics = T.styleMetrics(text);
}

function expansion(project, no) {
  // 离线兜底扩写：用大纲场景补具体动作与对话（不新增设定）
  const card = chapterCard(project, no);
  const lead = (project.characters || []).find((c) => c.role === '主角')?.name || '他';
  const scene = card?.scenes?.[1] || '灯市';
  return [
    `${lead}在${scene}外站了一会儿，把灯捻重新理直。风从巷口灌进来，火苗压低，他用手背护住，指节上立刻起了一层细汗。`,
    `「你这是第几趟了？」守巷的人问。`,
    `${lead}没有答，只把灯往前递了递。对方看清他腰上的牌子，让开了半步。`,
    `他走过去，听见背后那人很小声地说了一句什么，像是算账，又像是叹气。`,
  ].join('\n\n');
}

async function runDraft(project, emit) {
  const no = Number(project.chapterCursor || 1);
  const ch = ensureChapter(project, no);
  const card = chapterCard(project, no);
  if (!card) throw new Error(`大纲里没有第 ${no} 章`);
  const vars = draftVars(project, no);
  let text = '';
  let tokens = 0;

  if (isMock()) {
    text = M.mockChapterText(project, no);
  } else {
    const { prompt } = renderPrompt('08-chapter-draft', vars, { budget: 30000 });
    const res = await complete({ system: systemFor('执笔'), prompt, temperature: 0.95, maxTokens: 6000 });
    text = res.text.trim();
    tokens += res.tokens;
    // 字数不足 → 一次扩写
    let guard = 0;
    while (T.countWords(text) < vars.MIN_WORDS && guard++ < 2) {
      const need = vars.MIN_WORDS - T.countWords(text);
      const cont = await complete({
        system: systemFor('执笔'),
        prompt: `这是《${project.name}》第 ${no} 章的正文，目前只有 ${T.countWords(text)} 字，还差约 ${need} 字。\n请**接着往下写**，补足篇幅，保持同一场景、同一视角、同一文风，不要重复已有内容，最后落在钩子「${card.hook}」上。\n\n已有正文结尾：\n${text.slice(-1200)}\n\n只输出续写的正文，不要任何说明。`,
        temperature: 0.95,
        maxTokens: 4000,
      });
      tokens += cont.tokens;
      text = `${text}\n\n${cont.text.trim()}`;
    }
  }

  commitVersion(ch, text, 'draft');
  ch.status = 'drafted';
  ch.review = null;
  ch.deaiApplied = false;
  project.foreshadow?.ledger?.forEach((f) => {
    if (f.setupChapter === no) f.planted = true;
  });
  log(project, emit, `第 ${no} 章《${ch.title}》初稿完成：${T.countWords(text)} 字（闸门 ≥${vars.MIN_WORDS}）`, { chapter: no, tokens });
  return { summary: `${T.countWords(text)} 字`, chapter: no, tokens, text };
}

/* =============================== 审稿 =============================== */

export function measureChapter(project, text, no, cfg = getSettings()) {
  const metrics = T.styleMetrics(text);
  const hook = T.hookScore(text, (project.characters || []).map((c) => c.name));
  const factIssues = T.factCheck(text, project);
  const { setup, payoff } = chapterDuties(project, no);
  const expected = [
    ...setup.map((f) => ({ name: f.name, kind: 'setup', hint: f.content })),
    ...payoff.map((f) => ({ name: f.name, kind: 'payoff', hint: f.payoff })),
  ];
  const STOP = new Set('的了在是为着过要会可以被把而且或与和也都就才即'.split(''));
  const missed = expected.filter((e) => {
    if (text.includes(e.name)) return false;
    // 宽松判定：把伏笔说明去掉虚词后切成 2 字窗口，正文命中 ≥2 个窗口就算「写了这一笔」。
    // 之前按标点切段、要求命中 ≥2 段，遇到「苏雯的腕表永远快三分钟。」这种单句说明会永远判失败。
    const clean = String(e.hint || '').replace(/[^\u4e00-\u9fff]/g, '').split('').filter((ch) => !STOP.has(ch)).join('');
    const windows = [];
    for (let i = 0; i < clean.length - 1; i++) windows.push(clean.slice(i, i + 2));
    const hits = windows.filter((w) => text.includes(w));
    return hits.length < 2;
  }).map((e) => e.name);
  const minWords = Math.max(cfg.minWords, Math.round((project.brief?.wordsPerChapter || 2400) * 0.85));

  return {
    metrics,
    prose: T.proseProfile(text),
    words: metrics.words,
    minWords,
    dialogueRatio: metrics.dialogueRatio,
    sentenceLenStd: metrics.sentenceLenStd,
    aiScore: metrics.ai.score,
    maxAi: cfg.maxAiScore,
    topCliches: metrics.ai.top,
    hookScoreValue: hook.score,
    hookReasons: hook.reasons,
    issues: factIssues,
    foreshadow: {
      ok: missed.length === 0,
      value: `布置 ${setup.filter((f) => !missed.includes(f.name)).length}/${setup.length}，回收 ${payoff.filter((f) => !missed.includes(f.name)).length}/${payoff.length}`,
      missed,
      expected,
    },
    shortest: metrics.avgSentenceLen < 20 ? '（句子普遍偏短）' : '',
  };
}

export function mergeReviews(passes, measured, cfg) {
  const gateSource = passes.editor?.gates || {};
  const gates = {
    wordCount: { ok: measured.words >= measured.minWords, value: measured.words, require: `≥${measured.minWords}` },
    aiFlavor: { ok: measured.aiScore <= measured.maxAi, value: measured.aiScore, require: `≤${measured.maxAi}` },
    hook: { ok: measured.hookScoreValue >= 6, value: measured.hookScoreValue, require: '≥6' },
    foreshadow: { ok: measured.foreshadow.ok, value: measured.foreshadow.value, missed: measured.foreshadow.missed, require: '本章应布置/回收的伏笔全部执行' },
    styleConsistency: gateSource.styleConsistency || {
      ok: measured.sentenceLenStd >= 6,
      value: Number((10 - Math.max(0, 7 - measured.sentenceLenStd)).toFixed(1)),
      note: measured.sentenceLenStd < 6 ? '句长过于均匀' : '句长有起伏',
    },
  };
  const issues = [];
  for (const [name, pass] of Object.entries(passes)) {
    for (const it of pass.issues || []) {
      issues.push({
        severity: it.severity || 'medium',
        type: it.type || name,
        quote: it.quote || '',
        why: it.why || '',
        fix: it.fix || '',
        rule: it.rule || '',
        where: it.where || '',
        source: pass.name || name,
      });
    }
  }
  // 补充脚本层面的问题，保证非 AI 类问题一定能进入修正
  if (!gates.wordCount.ok) issues.push({ severity: 'high', type: '字数不足', quote: '', why: `实测 ${measured.words} 字，低于 ${measured.minWords}。`, fix: '补一场具体场景与对话，不要补解释。', source: '实测' });
  if (!gates.foreshadow.ok) issues.push({ severity: 'medium', type: '伏笔缺失', quote: '', why: `未执行：${measured.foreshadow.missed.join('、')}`, fix: '在中段用一个具体细节补上，不要直接解释。', source: '实测' });
  if (!gates.hook.ok) issues.push({ severity: 'medium', type: '钩子弱', quote: '', why: `章末钩子强度 ${measured.hookScoreValue}（${measured.hookReasons.join('；')}）。`, fix: '把最后一句改成具体的信息缺口或威胁。', source: '实测' });
  // 文笔层（对标 2026-11 头部开篇，见 docs/网文头部文笔拆解.md）：只拦「整章没有身体感」这类退化
  const prof = measured.prose;
  if (prof) {
    if (prof.sensoryDensity < 18) {
      issues.push({ severity: 'medium', type: '质感不足', quote: '', why: `五感密度 ${prof.sensoryDensity}/千字（闸门 18），整章缺身体感。`, fix: '补气味、温度、触感；抽象情绪改成生理反应。', source: '实测' });
    }
    if (prof.shortParaRatio < 0.5) {
      issues.push({ severity: 'low', type: '段落过长', quote: '', why: `短段占比 ${(prof.shortParaRatio * 100).toFixed(0)}%（闸门 50%）。`, fix: '把长段拆成单句成段，留白也是节奏。', source: '实测' });
    }
    if (prof.explanationRatio > 0.04) {
      issues.push({ severity: 'medium', type: '解释替代', quote: '', why: `解释句占比 ${(prof.explanationRatio * 100).toFixed(1)}%（闸门 4%），旁白在替读者总结。`, fix: '把「因为/也就是说/这说明」改成一次动作或一句对话。', source: '实测' });
    }
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const verdict = Object.values(gates).some((g) => !g.ok) || issues.some((i) => i.severity === 'high')
    ? 'revise' : 'pass';
  const logicScore = passes.logic?.score ?? 70;
  const readerScore = passes.reader?.score ?? 70;
  const editorScore = passes.editor?.score ?? 70;

  return {
    passes: [passes.logic, passes.reader, passes.editor].filter(Boolean),
    gates,
    issues,
    verdict,
    score: Math.round(logicScore * 0.4 + editorScore * 0.35 + readerScore * 0.25),
    logicScore, readerScore, editorScore,
    measured: {
      words: measured.words, aiScore: measured.aiScore, hook: measured.hookScoreValue,
      dialogueRatio: measured.dialogueRatio, sentenceLenStd: measured.sentenceLenStd,
      avgSentenceLen: measured.metrics.avgSentenceLen,
      foreshadow: measured.foreshadow.value,
    },
    at: new Date().toISOString(),
  };
}

/** 非 AI 类问题是否还需要修正（AI 类问题交给去 AI 味环节处理） */
export function needsRevision(review) {
  if (!review) return false;
  if (review.issues.some((i) => i.severity === 'high' && i.type !== 'AI味')) return true;
  const g = review.gates || {};
  return !g.wordCount?.ok || !g.hook?.ok || !g.foreshadow?.ok || !g.styleConsistency?.ok;
}

async function runReview(project, emit) {
  const no = Number(project.chapterCursor || 1);
  const ch = ensureChapter(project, no);
  const cfg = getSettings();
  const text = ch.current;
  const measured = measureChapter(project, text, no, cfg);
  const { card } = chapterDuties(project, no);

  let passes;
  let tokens = 0;
  if (isMock()) {
    passes = M.mockReviewPasses(project, ch, measured);
  } else {
    const baseVars = {
      CHAPTER_NO: no,
      TEXT: text,
      WORDS: measured.words,
      METRICS: {
        words: measured.words, minWords: measured.minWords,
        aiScore: measured.aiScore, maxAi: measured.maxAi,
        aiHits: measured.metrics.ai.hits,
        hookScore: measured.hookScoreValue, hookReasons: measured.hookReasons,
        dialogueRatio: measured.dialogueRatio, sentenceLenStd: measured.sentenceLenStd,
        avgSentenceLen: measured.metrics.avgSentenceLen,
      },
      HARD_RULES: project.world?.hardRules || [],
      GLOSSARY: project.world?.glossary || [],
      FACTS: [...(project.facts || []), ...(ch.summary ? [{ who: '前情', fact: ch.summary }] : [])],
      TIMELINE: (project.timeline || []).slice(-12),
      CHAPTER_CARD: card,
      STYLE_GUIDE: styleGuide(project),
      FORESHADOW_TASKS: chapterDuties(project, no),
      MIN_WORDS: measured.minWords,
      MAX_AI: measured.maxAi,
    };
    const [logic, reader, editor] = await Promise.all([
      renderPrompt('09-review-logic', baseVars).prompt,
      renderPrompt('10-review-reader', baseVars).prompt,
      renderPrompt('11-review-editor', baseVars).prompt,
    ].map((prompt, i) => complete({
      system: systemFor(['逻辑审', '读者审', '编辑审'][i]),
      prompt,
      json: true,
      temperature: 0.2,
    })));
    tokens = logic.tokens + reader.tokens + editor.tokens;
    passes = {
      logic: { name: '逻辑审', ...parseJSON(logic.text) },
      reader: { name: '读者审', ...parseJSON(reader.text) },
      editor: { name: '编辑审', ...parseJSON(editor.text) },
    };
  }

  // 与「上一轮审稿」对比：修正是否真的解决了问题
  const prevIssues = (ch.lastReview?.issues || []).map((i) => i.quote).filter(Boolean);
  const merged = mergeReviews(passes, measured, cfg);
  merged.fixed = prevIssues.filter((q) => !merged.issues.some((i) => i.quote && i.quote.includes(q.slice(0, 12)))).length;
  merged.remaining = merged.issues.length;

  ch.review = merged;
  ch.lastReview = merged;
  ch.status = ch.deaiApplied ? 'verified' : 'reviewed';
  ch.metrics = measured.metrics;
  log(project, emit, `第 ${no} 章三审完成：逻辑 ${merged.logicScore} / 读者 ${merged.readerScore} / 编辑 ${merged.editorScore}，闸门 ${Object.entries(merged.gates).filter(([, g]) => g.ok).length}/5 通过，结论 ${merged.verdict}`, { chapter: no, tokens, level: merged.verdict === 'pass' ? 'info' : 'warn' });
  return { summary: `三审 ${merged.score} 分 · ${merged.verdict}`, chapter: no, tokens, review: merged };
}

function fixList(review) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...(review.issues || [])]
    .filter((i) => i.type !== 'AI味' && i.type !== '弃书点' || i.severity === 'high')
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 12)
    .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.type}：${i.why || ''}${i.quote ? `\n   原句：${i.quote}` : ''}${i.fix ? `\n   修法：${i.fix}` : ''}`)
    .join('\n');
}

async function runRevise(project, emit) {
  const no = Number(project.chapterCursor || 1);
  const ch = ensureChapter(project, no);
  const cfg = getSettings();
  const review = ch.review;
  if (!review) throw new Error('没有审稿结果，无法修正');
  const before = ch.current;
  let text = before;
  let applied = [];
  let tokens = 0;

  if (isMock()) {
    const res = M.mockRevise(project, before, review.issues, no);
    text = res.text;
    applied = res.applied;
  } else {
    const measured = measureChapter(project, before, no, cfg);
    const { prompt } = renderPrompt('12-revise', {
      FIXES: fixList(review),
      MIN_WORDS: measured.minWords,
      WORDS: measured.words,
      MAX_AI: measured.maxAi,
      AI_SCORE: measured.aiScore,
      HOOK: measured.hookScoreValue,
      STYLE_GUIDE: styleGuide(project),
      TEXT: before,
    }, { budget: 30000 });
    const res = await complete({ system: systemFor('修正'), prompt, temperature: 0.55, maxTokens: 6000 });
    tokens = res.tokens;
    text = res.text.trim();
    applied = review.issues.slice(0, 8).map((i) => `${i.type}：${i.fix || i.why}`);
    if (T.countWords(text) < measured.minWords * 0.9) {
      text += '\n\n' + expansion(project, no);
      applied.push('字数不足，补充场景兜底');
    }
  }

  commitVersion(ch, text, 'revise');
  ch.rounds += 1;
  ch.review = null;
  ch.status = 'revised';
  ch.revisions = [...(ch.revisions || []), { round: ch.rounds, applied, at: new Date().toISOString() }];
  log(project, emit, `第 ${no} 章修正（第 ${ch.rounds} 轮）：${applied.length} 项改动 → ${T.countWords(text)} 字`, { chapter: no, tokens });
  return { summary: `第 ${ch.rounds} 轮 · ${applied.length} 项`, chapter: no, tokens };
}

async function runDeai(project, emit) {
  const no = Number(project.chapterCursor || 1);
  const ch = ensureChapter(project, no);
  const cfg = getSettings();
  const before = ch.current;
  const beforeMetrics = T.styleMetrics(before);
  let after = before;
  let replacements = [];
  let tokens = 0;

  if (isMock()) {
    let res = T.humanize(before);
    after = res.text;
    replacements = res.replacements;
    if (T.aiFlavor(after).score > cfg.maxAiScore) {
      const second = T.humanize(after);
      after = second.text;
      replacements = replacements.concat(second.replacements);
    }
    // 改写后字数不足则补场景，再压一次套话
    if (T.countWords(after) < cfg.minWords) {
      const fixed = M.mockRevise(project, after, [], no);
      after = T.humanize(fixed.text).text;
      replacements.push({ from: '字数不足', to: '补充场景后二次去AI味', count: 1 });
    }
  } else {
    const { prompt } = renderPrompt('13-deai', {
      AI_HITS: beforeMetrics.ai.hits.map((h) => `${h.term}（${h.count} 次）`).join('、') || '（脚本未命中高频套话，请按语感改写）',
      MIN_WORDS: cfg.minWords,
      TARGET_WORDS: project.brief.wordsPerChapter,
      STYLE_GUIDE: styleGuide(project),
      TEXT: before,
    }, { budget: 30000 });
    const res = await complete({ system: systemFor('去AI味'), prompt, temperature: 0.7, maxTokens: 6000 });
    tokens = res.tokens;
    after = res.text.trim();
    // 本地兜底：模型改写后 AI 味仍超标，再用规则层压一遍
    if (T.aiFlavor(after).score > cfg.maxAiScore) {
      const rule = T.humanize(after);
      after = rule.text;
      replacements = rule.replacements;
    }
  }

  const afterMetrics = T.styleMetrics(after);
  commitVersion(ch, after, 'deai');
  ch.deaiApplied = true;
  ch.review = null;
  ch.deai = {
    before: { aiScore: beforeMetrics.ai.score, hits: beforeMetrics.ai.hits.slice(0, 8), avgSentenceLen: beforeMetrics.avgSentenceLen, sentenceLenStd: beforeMetrics.sentenceLenStd, words: beforeMetrics.words },
    after: { aiScore: afterMetrics.ai.score, avgSentenceLen: afterMetrics.avgSentenceLen, sentenceLenStd: afterMetrics.sentenceLenStd, words: afterMetrics.words },
    replacements: replacements.slice(0, 20),
    at: new Date().toISOString(),
  };
  ch.status = 'deai';
  log(project, emit, `第 ${no} 章去AI味：AI 味 ${beforeMetrics.ai.score} → ${afterMetrics.ai.score}，句长标准差 ${beforeMetrics.sentenceLenStd} → ${afterMetrics.sentenceLenStd}，字数 ${beforeMetrics.words} → ${afterMetrics.words}`, { chapter: no, tokens });
  return { summary: `AI味 ${beforeMetrics.ai.score}→${afterMetrics.ai.score}`, chapter: no, tokens };
}

function updateForeshadowFromText(project, no, text) {
  for (const f of project.foreshadow?.ledger || []) {
    if (f.setupChapter === no && text.includes(f.name)) f.status = 'planted';
    if (f.payoffChapter === no && text.includes(f.name)) { f.status = 'paid'; f.paid = true; }
  }
}

async function runSummary(project, emit) {
  const no = Number(project.chapterCursor || 1);
  const ch = ensureChapter(project, no);
  let data;
  let tokens = 0;
  if (isMock()) data = M.mockSummarize(project, no, ch.current);
  else {
    const { prompt } = renderPrompt('14-chapter-summary', { CHAPTER_NO: no, TEXT: ch.current });
    const res = await complete({ system: systemFor('资料员'), prompt, json: true, temperature: 0.2 });
    tokens = res.tokens;
    data = parseJSON(res.text);
  }
  ch.summary = data.summary || '';
  ch.summaryData = data;
  ch.status = 'done';
  const lastGates = ch.review?.gates || {};
  const failedGates = Object.entries(lastGates).filter(([, g]) => !g.ok).map(([k]) => k);
  ch.needsAttention = failedGates.length > 0 || ch.review?.verdict === 'revise';
  ch.failedGates = failedGates;
  ch.finalizedAt = new Date().toISOString();
  project.summaries.perChapter[no] = `${ch.title}｜${clip(data.summary || '', 220)}`;
  for (const f of data.facts || []) project.facts.push({ ...f, chapter: no, at: new Date().toISOString() });
  for (const e of data.events || []) project.timeline.push({ chapter: no, event: e });
  for (const t of data.newTerms || []) {
    if (t.term && !(project.world?.glossary || []).some((g) => g.term === t.term)) {
      project.world.glossary.push({ term: t.term, def: t.def || '', type: '正文新增' });
    }
  }
  updateForeshadowFromText(project, no, ch.current);
  project.chaptersDone = no;
  project.chapterCursor = no + 1;

  // 断点续写：每 N 章滚动压缩一次（压缩写回 project.summaries.rolling）
  const cfg = getSettings();
  const needCompress = no % cfg.compressEvery === 0;
  if (needCompress) {
    try {
      const c = await runCompress(project, emit);
      ch.compressed = c?.summary || '';
    } catch (err) {
      log(project, emit, `前情摘要压缩失败（不影响本章定稿）：${err.message}`, { level: 'warn' });
    }
  }
  log(project, emit,
    `第 ${no} 章定稿：${T.countWords(ch.current)} 字，审稿 ${ch.review?.score ?? ch.lastReview?.score ?? '-'} 分`
    + (ch.needsAttention ? `｜⚠ 仍有未过闸门（${failedGates.join('、')}），已标记待人工` : '')
    + (needCompress ? '；触发前情摘要压缩' : ''),
    { chapter: no, tokens, level: ch.needsAttention ? 'warn' : 'info' });
  return { summary: `定稿 ${T.countWords(ch.current)} 字`, chapter: no, tokens, needCompress };
}

async function runCompress(project, emit) {
  const cfg = getSettings();
  const upTo = Number(project.chaptersDone || 0);
  const from = Number(project.summaries.coveredUpTo || 0) + 1;
  const newOnes = [];
  for (let n = from; n <= upTo; n++) if (project.summaries.perChapter[n]) newOnes.push(`第${n}章：${project.summaries.perChapter[n]}`);
  const previous = project.summaries.rolling || '';
  const limit = 1400;
  let rolling;
  let tokens = 0;
  if (isMock()) {
    rolling = M.mockCompress(project, previous, newOnes, limit);
  } else {
    const { prompt } = renderPrompt('15-compress', {
      LIMIT: limit, PREVIOUS: previous || '（空）', NEW: newOnes.join('\n') || '（无新增）', FROM: from, TO: upTo,
    });
    const res = await complete({ system: systemFor('摘要压缩'), prompt, temperature: 0.2, maxTokens: 2000 });
    tokens = res.tokens;
    rolling = res.text.trim();
  }
  project.summaries.rolling = rolling;
  project.summaries.coveredUpTo = upTo;
  project.summaries.compressedAt = new Date().toISOString();
  log(project, emit, `前情摘要已滚动压缩：覆盖第 1-${upTo} 章，压缩后 ${rolling.length} 字（上限 ${limit}），上下文估算 ${contextEstimate(project).tokens} tokens`, { tokens });
  return { summary: `压缩至 ${rolling.length} 字`, tokens };
}

/* =============================== 导出 =============================== */

export function buildMarkdown(project) {
  const lines = [];
  lines.push(`# ${project.name}`, '');
  lines.push(`> ${project.outline?.logline || ''}`, '');
  lines.push(`- 题材：${project.brief.genre} / ${project.brief.subgenre}`);
  lines.push(`- 受众：${project.brief.audience}`);
  lines.push(`- 体量：${project.brief.targetChapters} 章 × ${project.brief.wordsPerChapter} 字`);
  lines.push(`- 视角：${project.brief.pov}`);
  lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`, '');
  lines.push('## 设定集', '');
  lines.push(`**一句话世界**：${project.world?.premise || ''}`, '');
  for (const p of project.world?.powerSystem || []) {
    lines.push(`### 力量体系：${p.name}（单位：${p.unit}）`, '');
    lines.push(`- 阶位：${(p.tiers || []).join(' → ')}`);
    lines.push(`- 代价：${p.cost}`);
    lines.push(`- 上限：${p.bounds}`);
    lines.push(`- 例外：${p.exception}`, '');
    for (const r of p.rules || []) lines.push(`- 规则：${r}`);
    lines.push('');
  }
  lines.push('### 硬规则（审稿基准）', '');
  for (const r of project.world?.hardRules || []) lines.push(`- ${r}`);
  lines.push('', '### 术语表', '');
  for (const g of project.world?.glossary || []) lines.push(`- **${g.term}**：${g.def}`);
  lines.push('', '### 人物', '');
  for (const c of project.characters || []) {
    lines.push(`- **${c.name}**（${c.role}，${c.rank}）：${c.oneLine}｜欲望：${c.motivation}｜错误信念：${c.misbelief}`);
  }
  lines.push('', '## 分层大纲', '');
  for (const v of project.outline?.volumes || []) {
    lines.push(`### 第${v.no}卷 ${v.title}`, '', `目标：${v.goal}`, '');
    for (const a of v.arcs || []) {
      lines.push(`#### 弧 ${a.no}：${a.title}`, '');
      for (const c of a.chapters || []) {
        lines.push(`- **第${c.no}章 ${c.title}**（密度 ${c.density}，钩子 ${c.hookType}）`);
        lines.push(`  - 目标：${c.goal}`);
        lines.push(`  - 阻碍：${c.obstacle}`);
        lines.push(`  - 转折：${c.turn}`);
        lines.push(`  - 结果：${c.result}`);
        lines.push(`  - 章末钩子：${c.hook}`);
      }
    }
  }
  lines.push('', '## 伏笔台账', '');
  for (const f of project.foreshadow?.ledger || []) {
    lines.push(`- ${f.name}（${f.type}）：布置 ${f.setupChapter} → 回收 ${f.payoffChapter}｜状态：${f.status}`);
  }
  lines.push('', '---', '', '## 正文', '');
  for (const ch of [...project.chapters].filter((c) => c.current).sort((a, b) => a.no - b.no)) {
    lines.push(`### 第${ch.no}章 ${ch.title}`, '');
    lines.push(ch.current, '');
  }
  lines.push('', '---', '', '## 附：质量记录', '');
  for (const ch of [...project.chapters].filter((c) => c.current).sort((a, b) => a.no - b.no)) {
    const r = ch.review || ch.lastReview;
    lines.push(`- 第${ch.no}章：${T.countWords(ch.current)} 字｜三审 ${r?.score ?? '-'}｜AI味 ${ch.metrics?.ai?.score ?? '-'}｜钩子 ${r?.gates?.hook?.value ?? '-'}｜修订 ${ch.rounds} 轮`);
  }
  return lines.join('\n');
}

export function buildTxt(project) {
  const lines = [`${project.name}`, ''];
  for (const ch of [...project.chapters].filter((c) => c.current).sort((a, b) => a.no - b.no)) {
    lines.push(`第${ch.no}章 ${ch.title}`, '', ch.current, '', '');
  }
  return lines.join('\n');
}

async function runExport(project, emit) {
  project.export = {
    at: new Date().toISOString(),
    chars: (project.chapters || []).filter((c) => c.current).reduce((s, c) => s + T.countWords(c.current), 0),
    chapters: (project.chapters || []).filter((c) => c.current).length,
    markdown: buildMarkdown(project),
  };
  log(project, emit, `导出完成：${project.export.chapters} 章 / ${project.export.chars} 字`);
  return { summary: `${project.export.chapters} 章 · ${project.export.chars} 字` };
}

/* =============================== 状态机 =============================== */

export function nextAction(project) {
  const cfg = getSettings();
  const p = project;
  if (!p.stageFlags?.brief?.ok && !p.stageFlags?.briefFailed) return { action: 'brief', stage: 'brief' };
  if (!p.market) return { action: 'market', stage: 'market' };
  if (!p.topics?.length) return { action: 'topic', stage: 'topic' };
  if (!p.dedup) return { action: 'dedup', stage: 'dedup' };
  if (!p.world) return { action: 'world', stage: 'world' };
  if (!p.characters?.length) return { action: 'characters', stage: 'characters' };
  if (!p.outline) return { action: 'outline', stage: 'outline' };
  if (!p.pacing) return { action: 'pacing', stage: 'pacing' };
  if (!p.foreshadow) return { action: 'foreshadow', stage: 'foreshadow' };

  const target = Number(p.brief.targetChapters) || 12;
  const done = (p.chapters || []).filter((c) => c.status === 'done').length;
  if (done >= target) return { action: 'export', stage: 'export' };

  const no = Number(p.chapterCursor || 1);
  if (no > target) return { action: 'export', stage: 'export' };
  const ch = p.chapters.find((c) => c.no === no) || ensureChapter(p, no);

  if (ch.status === 'empty') return { action: 'draft', stage: 'draft', chapter: no };
  if (ch.status === 'flagged') return { action: 'summary', stage: 'summary', chapter: no, forced: true };

  if (ch.status === 'drafted' || ch.status === 'revised' || ch.status === 'deai' || ch.status === 'reviewed') {
    if (!ch.review) return { action: 'review', stage: 'review', chapter: no };
    if (ch.review.verdict === 'revise') {
      if (needsRevision(ch.review) && ch.rounds < cfg.reviewRounds) return { action: 'revise', stage: 'revise', chapter: no };
      if (!ch.deaiApplied) return { action: 'deai', stage: 'deai', chapter: no };
      if (ch.rounds >= cfg.reviewRounds) return { action: 'summary', stage: 'summary', chapter: no, forced: true };
      return { action: 'revise', stage: 'revise', chapter: no };
    }
    // verdict = pass
    if (!ch.deaiApplied) return { action: 'deai', stage: 'deai', chapter: no };
    return { action: 'summary', stage: 'summary', chapter: no };
  }
  if (ch.status === 'verified' || ch.status === 'done') {
    if (ch.status === 'verified') return { action: 'summary', stage: 'summary', chapter: no };
    return { action: 'export', stage: 'export' };
  }
  return { action: 'draft', stage: 'draft', chapter: no };
}

const ACTIONS = {
  brief: runBrief, market: runMarket, topic: runTopic, dedup: runDedup,
  world: runWorld, characters: runCharacters, outline: runOutline,
  pacing: runPacing, foreshadow: runForeshadow,
  draft: runDraft, review: runReview, revise: runRevise, deai: runDeai,
  summary: runSummary, compress: runCompress, export: runExport,
};

/** 执行一步。返回 {action, stage, chapter, summary, tokens} */
export async function runStep(project, { emit } = {}) {
  const plan = nextAction(project);
  const started = Date.now();
  emit?.({ type: 'step', action: plan.action, stage: plan.stage, chapter: plan.chapter ?? null });
  const fn = ACTIONS[plan.action];
  if (!fn) throw new Error(`未知环节：${plan.action}`);

  // 查重为 duplicate 时阻止进入世界观（人工确认后可 force）
  if (plan.action === 'world' && project.dedup?.verdict === 'duplicate' && !project.forceDedup) {
    throw new Error('查重判定为 duplicate，已阻止进入世界观环节。请调整选题，或在界面上确认「接受风险继续」。');
  }

  let result;
  try {
    result = await fn(project, emit, false);
  } catch (err) {
    project.runs.push({ action: plan.action, stage: plan.stage, chapter: plan.chapter ?? null, at: new Date().toISOString(), status: 'error', error: err.message, durationMs: Date.now() - started });
    throw err;
  }

  project.runs.push({
    action: plan.action, stage: plan.stage, chapter: plan.chapter ?? null,
    at: new Date().toISOString(), status: 'ok', durationMs: Date.now() - started,
    tokens: result?.tokens || 0, summary: result?.summary || '',
  });
  if (project.runs.length > 300) project.runs.splice(0, project.runs.length - 300);

  // summary 之后可能触发压缩
  if (plan.action === 'summary' && result?.needCompress) {
    emit?.({ type: 'compress-due' });
  }

  project.stageCursor = { stage: plan.stage, chapter: plan.chapter ?? null, at: new Date().toISOString() };
  project.stats = computeStats(project);
  emit?.({ type: 'step-done', action: plan.action, stage: plan.stage, chapter: plan.chapter ?? null, summary: result?.summary || '' });
  return { action: plan.action, stage: plan.stage, chapter: plan.chapter ?? null, ...result, durationMs: Date.now() - started };
}

export async function runCompressNow(project, { emit } = {}) {
  return runCompress(project, emit);
}

export function computeStats(project) {
  const withText = (project.chapters || []).filter((c) => c.current);
  const done = (project.chapters || []).filter((c) => c.status === 'done');
  const words = withText.reduce((s, c) => s + T.countWords(c.current), 0);
  const scored = done.map((c) => c.review?.score ?? c.lastReview?.score).filter(Boolean);
  const ai = done.map((c) => c.metrics?.ai?.score).filter((n) => n !== undefined);
  return {
    chapters: withText.length,
    done: done.length,
    words,
    avgScore: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    avgAi: ai.length ? Number((ai.reduce((a, b) => a + b, 0) / ai.length).toFixed(2)) : null,
    avgWordsPerChapter: withText.length ? Math.round(words / withText.length) : 0,
    contextTokens: contextEstimate(project).tokens,
  };
}

export function stageOverview(project) {
  const p = project;
  const done = (id) => {
    switch (id) {
      case 'brief': return Boolean(p.brief);
      case 'market': return Boolean(p.market);
      case 'topic': return Boolean(p.topics?.length);
      case 'dedup': return Boolean(p.dedup);
      case 'world': return Boolean(p.world);
      case 'characters': return Boolean(p.characters?.length);
      case 'outline': return Boolean(p.outline);
      case 'pacing': return Boolean(p.pacing);
      case 'foreshadow': return Boolean(p.foreshadow);
      case 'draft':
      case 'review':
      case 'revise':
      case 'deai':
      case 'summary':
      case 'compress':
        return Number(p.summaries?.coveredUpTo || 0) > 0;
      case 'export': return Boolean(p.export);
      default: return false;
    }
  };
  const next = nextAction(p);
  return STAGES.map((s) => {
    let status = done(s.id) ? 'done' : 'pending';
    if (next.stage === s.id) status = 'active';
    if (s.id === 'pacing' && p.pacing?.alarms?.length) status = status === 'done' ? 'warn' : status;
    if (s.id === 'dedup' && p.dedup?.verdict === 'duplicate') status = 'warn';
    return { ...s, status };
  });
}

/* =============================== 对外动作（给 HTTP 层用） =============================== */

export async function refreshMarketNow(project, { emit } = {}) {
  return runMarket(project, emit, true);
}

export async function rerunPacing(project, { emit } = {}) {
  return runPacing(project, emit);
}

export async function addMarketInput(project, item) {
  project.marketInput = [...(project.marketInput || []), { ...item, addedAt: new Date().toISOString() }];
  project.market = null;
  return project.marketInput;
}
