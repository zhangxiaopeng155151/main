/**
 * 导入一本「人写的」稿子，让它进入墨脉的审核流水线。
 *
 * 为什么需要它：mock 引擎只能生成演示书，真实模型才能从零写新书。
 * 但很多时候你手里已经有设定、大纲和正文——这时你要的是「审稿流水线」，
 * 不是「再生成一遍」。本脚本把 manuscripts/<书名>/ 下的稿件装进项目，
 * 然后用同一套本地度量（字数 / AI 味 / 钩子 / 伏笔 / 设定冲突）跑逻辑审、
 * 读者审、编辑审，结果写回项目，界面里能直接看。
 *
 * 目录约定：
 *   manuscripts/<书名>/book.json      brief / market / topics / dedup / world / characters / foreshadow
 *   manuscripts/<书名>/outline.json   logline / theme / volumes[].arcs[].chapters[]
 *   manuscripts/<书名>/chapters/ch01.md ...
 *
 * 用法：
 *   node scripts/import.mjs manuscripts/十七秒
 *   node scripts/import.mjs manuscripts/十七秒 --id nov_xxx     # 覆盖已有项目
 *   node scripts/import.mjs manuscripts/十七秒 --reset           # 先删同名项目再建
 */
import fs from 'node:fs';
import path from 'node:path';
import { saveProject, loadProject, listProjects, projectFile, getSettings, newId } from '../server/store.js';
import {
  createProject, measureChapter, mergeReviews, normalizeWorld, normalizeOutline,
  computePacing, buildMarkdown, flatChapters,
} from '../server/pipeline.js';
import { mockReviewPasses, mockSummarize } from '../server/mock.js';
import { countWords } from '../server/text.js';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--')) || 'manuscripts/十七秒';
const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const reset = args.includes('--reset');

const dir = path.resolve(import.meta.dirname, '..', dirArg);
const book = JSON.parse(fs.readFileSync(path.join(dir, 'book.json'), 'utf8'));
const outlineSrc = JSON.parse(fs.readFileSync(path.join(dir, 'outline.json'), 'utf8'));
const chapterDir = path.join(dir, 'chapters');
const chapterFiles = fs.existsSync(chapterDir)
  ? fs.readdirSync(chapterDir).filter((f) => /^ch\d+\.md$/.test(f)).sort()
  : [];

if (reset) {
  for (const p of listProjects()) {
    if (p.name === book.name) {
      fs.rmSync(projectFile(p.id), { force: true });
      console.log(`[import] 已删除同名项目 ${p.id}`);
    }
  }
}

let project;
if (idArg) {
  project = loadProject(idArg);
  console.log(`[import] 覆盖项目 ${project.id}`);
} else {
  const existing = listProjects().find((p) => p.name === book.name);
  project = existing ? loadProject(existing.id) : createProject({ ...book.brief, name: book.name });
  console.log(`[import] ${existing ? '复用' : '新建'}项目 ${project.id}`);
}

/* ---------- 设定层 ---------- */
project.name = book.name || project.name;
project.brief = { ...project.brief, ...(book.brief || {}) };
project.market = book.market || null;
project.topics = book.topics || [];
project.selectedTopicId = book.selectedTopicId || project.topics[0]?.id || null;
project.dedup = book.dedup || null;
project.world = normalizeWorld(book.world || {}, project);

const chars = Array.isArray(book.characters) ? book.characters : [];
project.characters = chars.map((c) => ({
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
  relations: c.relations || [],
}));

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
project.characterNotes = {
  network: '以沈听澜为中心：母亲的线牵出电台，顾行舟的线牵出警方，苏雯的线牵出档案馆，谭宗铭在最末端签字。',
  conflictMatrix: [
    { a: '沈听澜', b: '谭宗铭', stake: '谁有资格决定谁被听见' },
    { a: '沈听澜', b: '苏雯', stake: '名单交不交' },
    { a: '沈听澜', b: '顾行舟', stake: '证据能不能写成报告' },
    { a: '魏承宗', b: '谭宗铭', stake: '门开不开' },
  ],
  pov: project.brief.pov || '第三人称限知',
};
project.facts = project.characters
  .filter((c) => c.rank)
  .map((c) => ({ who: c.name, fact: `身份：${c.rank}`, motivation: c.motivation }));

project.outline = normalizeOutline(outlineSrc, project);
project.foreshadow = book.foreshadow || { ledger: [], hooks: [], balance: '' };
for (const f of project.foreshadow.ledger) {
  f.status = f.status || 'planned';
  f.planted = false;
  f.paid = false;
}

const targetChapters = Number(project.brief.targetChapters || 0) || flatChapters(project.outline).length;

/* ---------- 正文层：逐章跑本地审稿 ---------- */
const cfg = getSettings();
const chapters = [];
let words = 0;
let aiSum = 0;
let scoreSum = 0;
let doneCount = 0;

for (const file of chapterFiles) {
  const no = Number(file.match(/^ch(\d+)\.md$/)[1]);
  const text = fs.readFileSync(path.join(chapterDir, file), 'utf8').trim();
  const card = flatChapters(project.outline).find((c) => c.no === no);
  const ch = {
    no,
    title: card?.title || `第${no}章`,
    status: 'done',
    current: text,
    versions: [{ at: new Date().toISOString(), label: '导入原稿', text }],
    rounds: 0,
    deaiApplied: false,
    review: null,
    summary: '',
    metrics: null,
    createdAt: new Date().toISOString(),
    lastReview: null,
    revisions: [],
    deai: null,
    summaryData: null,
    needsAttention: false,
    failedGates: [],
    finalizedAt: new Date().toISOString(),
  };

  const measured = measureChapter(project, text, no, cfg);
  const passes = mockReviewPasses(project, ch, measured);
  const review = mergeReviews(passes, measured, cfg);
  review.fixed = 0;
  review.remaining = review.issues.length;
  ch.review = review;
  ch.lastReview = review;
  // 与 pipeline 保持一致：metrics 直接存 styleMetrics 的结果，再补一个章末钩子分
  ch.metrics = { ...measured.metrics, hook: measured.hookScoreValue };

  const sum = mockSummarize(project, no, text);
  ch.summary = sum.summary;
  ch.summaryData = sum;

  const failed = Object.entries(review.gates).filter(([, g]) => !g.ok).map(([k]) => k);
  ch.failedGates = failed;
  ch.needsAttention = failed.length > 0 || review.verdict === 'revise';

  // 伏笔状态：本章出现的名字标为已布置 / 已回收
  for (const f of project.foreshadow.ledger) {
    if (f.setupChapter === no && text.includes(f.name)) { f.status = 'planted'; f.planted = true; }
    if (f.payoffChapter === no && text.includes(f.name)) { f.status = 'paid'; f.paid = true; }
  }

  chapters.push(ch);
  words += measured.words;
  aiSum += measured.aiScore;
  scoreSum += review.score;
  doneCount += 1;
  project.summaries.perChapter[no] = `${ch.title}｜${sum.summary}`;
}

project.chapters = chapters;
project.chaptersDone = doneCount;
project.chapterCursor = Math.min(doneCount + 1, targetChapters);
project.pacing = computePacing(project);

project.stats = {
  chapters: targetChapters,
  done: doneCount,
  words,
  avgScore: doneCount ? Math.round(scoreSum / doneCount) : 0,
  avgAi: doneCount ? Number((aiSum / doneCount).toFixed(2)) : 0,
  avgWordsPerChapter: doneCount ? Math.round(words / doneCount) : 0,
  contextTokens: Math.round(((project.summaries.rolling || '').length + 4000) / 1.6),
};

project.stageFlags = {
  brief: { ok: Boolean(project.brief.seedIdea && project.brief.genre), missing: [] },
  world: {
    ok: project.world.hardRules.length >= 3 && project.world.powerSystem.every((p) => p.cost && p.bounds),
    notes: project.world.hardRules.length >= 3 ? [] : ['硬规则少于 3 条，逻辑审将缺少对照基准'],
  },
  characters: { ok: true, isolated: [] },
  outline: {
    ok: flatChapters(project.outline).length === targetChapters,
    problems: flatChapters(project.outline).length === targetChapters ? [] : [`章数 ${flatChapters(project.outline).length} ≠ 目标 ${targetChapters}`],
  },
  pacing: { ok: !project.pacing.alarms.some((a) => a.severity === 'high'), high: project.pacing.alarms.filter((a) => a.severity === 'high').length },
  foreshadow: { ok: true, invalid: 0 },
};

project.stageCursor = {
  stage: doneCount >= targetChapters ? 'export' : 'draft',
  chapter: doneCount >= targetChapters ? null : doneCount + 1,
  at: new Date().toISOString(),
};

project.logs.push({
  at: new Date().toISOString(),
  message: `导入稿件：${doneCount} 章 / ${words} 字；本地三审完成，平均 ${project.stats.avgScore} 分，AI 味 ${project.stats.avgAi}`,
});

project.export = {
  at: new Date().toISOString(),
  chars: words,
  chapters: doneCount,
  markdown: buildMarkdown(project),
};

saveProject(project);

console.log('');
console.log(`[import] 完成：${project.name}（${project.id}）`);
console.log(`  · 大纲 ${flatChapters(project.outline).length} 章 / 目标 ${targetChapters} 章`);
console.log(`  · 正文 ${doneCount} 章 / ${words} 字（平均 ${project.stats.avgWordsPerChapter} 字/章）`);
console.log(`  · 三审平均 ${project.stats.avgScore} 分；AI 味 ${project.stats.avgAi}；钩子与伏笔见界面`);
console.log(`  · 待人工：${chapters.filter((c) => c.needsAttention).map((c) => `第${c.no}章`).join('、') || '无'}`);
for (const ch of chapters) {
  const g = ch.review.gates;
  console.log(`    第 ${String(ch.no).padStart(2)} 章 ${ch.title}｜${ch.metrics.words} 字｜AI ${ch.metrics.aiScore}｜钩子 ${ch.metrics.hook}｜审稿 ${ch.review.score}` +
    `｜${Object.entries(g).filter(([, v]) => !v.ok).map(([k]) => k).join(',') || '全闸门通过'}`);
}
for (const a of project.pacing.alarms.slice(0, 3)) {
  console.log(`  ! 节奏报警 ${a.type}：第 ${a.chapters.join('/')} 章 ${a.why}`);
}
console.log(`  · 打开 http://localhost:5173 查看（选中项目「${project.name}」）`);
