/**
 * 从项目 JSON 生成「小说资料」文件夹：正文（md + txt）、设定与人物、大纲、投稿包。
 *
 * 用法：node scripts/submission.mjs <projectId> [输出目录]
 * 默认输出到 小说资料/十七秒/：
 *   正文.md / 正文.txt     全书正文（md 用于阅读，txt 用于投递/配音）
 *   设定与人物.md          世界观硬规则、人物小传、伏笔台账
 *   大纲.md               4 卷 24 章分层大纲（含冲突密度与钩子）
 *   投稿包.md             简介 / 目录 / 样章 / 质量自检，可直接发给编辑
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, ROOT } from '../server/store.js';
import { flatChapters, buildTxt, buildMarkdown } from '../server/pipeline.js';
import { countWords } from '../server/text.js';

const id = process.argv[2];
if (!id) {
  console.error('用法：node scripts/submission.mjs <projectId> [输出路径]');
  process.exit(1);
}
const outDirArg = process.argv[3];
const outDir = outDirArg
  ? path.resolve(ROOT, outDirArg)
  : path.resolve(ROOT, '小说资料/十七秒');
const outPath = path.join(outDir, '投稿包.md');
const p = loadProject(id);
const cards = flatChapters(p.outline);
const topic = (p.topics || []).find((t) => t.id === p.selectedTopicId) || p.topics?.[0] || {};
const chs = (p.chapters || []).slice().sort((a, b) => a.no - b.no);
const totalWords = chs.reduce((s, c) => s + countWords(c.current || ''), 0);

const lines = [];
const push = (...xs) => lines.push(...xs);

push(`# 《${topic.title || '十七秒'}》投稿包`);
push('');
push('> 长篇小说 · 都市悬疑 / 声音怪谈 · 女主视角');
push(`> 全书规划 ${p.brief.targetChapters} 章（约 ${Math.round(p.brief.targetChapters * p.brief.wordsPerChapter / 10000)} 万字），已完稿 ${chs.length} 章（${totalWords} 字），附完整目录与分层大纲`);
push('');
push('---');
push('');
push('## 一、一句话简介');
push('');
push(topic.logline || p.brief.seedIdea);
push('');
push('## 二、200 字故事简介');
push('');
push(
  `雾津市广播电台的地下二层，有一间 1958 年建成的审听室。凡是「被判定该死」的人，都会在死前七天，被录成一段正好十七秒的回声。\n\n` +
  `沈听澜是市局声纹鉴定中心的修复师，她能还原被抹掉的录音。她接手一桩溺亡案，从一卷泡过水的报警带子里，听见十七秒的空白中有人在倒数，数到「一」之后，叫了她的名字。\n\n` +
  `七天之内，录音里出现过的人，会按照录音描述的方式死去。而每修复一段回声，她就会永久失去一段与声音有关的记忆——从最亲的人开始。\n\n` +
  `十二年前，她的母亲、《夜航》主播沈玉声，在同一间审听室里消失。这一次，她要听清那十七秒里到底是谁在说话。`,
);
push('');
push('## 三、核心设定（三条规则撑起全书）');
push('');
for (const r of (p.world.hardRules || []).slice(0, 6)) push(`- ${r}`);
push('');
push(`**代价机制**：${p.world.powerSystem?.[0]?.cost || ''}`);
push('');
push(`**上限**：${p.world.powerSystem?.[0]?.bounds || ''}`);
push('');
push('## 四、人物小传');
push('');
for (const c of (p.characters || []).slice(0, 6)) {
  push(`**${c.name}**（${c.role}｜${c.age} 岁｜${c.rank}）`);
  push('');
  push(`${c.oneLine}。动机：${c.motivation}。障碍：${c.obstacle}。致命误信：${c.misbelief}。`);
  push('');
}
push('## 五、分层大纲（4 卷 24 章）');
push('');
for (const v of p.outline.volumes) {
  push(`### 第 ${v.no} 卷 · ${v.title}`);
  push('');
  push(`- 本卷目标：${v.goal}`);
  push(`- 卷末状态：${v.endState}`);
  push('');
  for (const a of v.arcs) {
    push(`**第 ${a.no} 弧 · ${a.title}**（${a.summary}）`);
    push('');
    push('| 章 | 标题 | 本章目标 | 阻碍 | 转折 | 冲突密度 | 章末钩子 |');
    push('|---|---|---|---|---|---|---|');
    for (const c of a.chapters) {
      push(`| ${c.no} | ${c.title} | ${c.goal} | ${c.obstacle} | ${c.turn} | ${c.density} | ${c.hook} |`);
    }
    push('');
  }
}
push('## 六、目录（24 章）');
push('');
push(cards.map((c) => `第${c.no}章　${c.title}`).join('\n\n'));
push('');
push('## 七、正文样稿');
push('');
push(`已完稿 ${chs.length} 章，共 ${totalWords} 字。以下附第 1 章全文（完整正文见同目录 \`正文.txt\`）。`);
push('');
if (chs[0]) {
  push(`### 第 1 章　${chs[0].title}`);
  push('');
  push(chs[0].current);
  push('');
}
push('## 八、差异化说明');
push('');
for (const m of (p.dedup?.matches || [])) {
  push(`- 对照《${m.title}》：${m.detail} 本文的区别在于 ${m.suggestion}`);
}
push('');
push('## 九、节奏与质量自检');
push('');
push('| 章 | 字数 | 冲突密度 | AI 味 | 钩子 | 三审均分 | 闸门 |');
push('|---|---|---|---|---|---|---|');
for (const c of chs) {
  const g = c.review?.gates || {};
  const failed = Object.entries(g).filter(([, v]) => !v.ok).map(([k]) => k);
  push(`| ${c.no} | ${c.metrics?.words ?? ''} | ${cards.find((x) => x.no === c.no)?.density ?? ''} | ${c.metrics?.ai?.score ?? ''} | ${c.metrics?.hook ?? ''} | ${c.review?.score ?? ''} | ${failed.length ? failed.join('、') : '全通过'} |`);
}
push('');
push(`节奏曲线平均密度 ${p.pacing?.avg ?? ''}；${(p.pacing?.alarms || []).map((a) => `${a.type}（第 ${a.chapters.join('/')} 章）`).join('、') || '无报警'}。`);
push('');
push('## 十、投稿信息与声明');
push('');
push('- 作者：（待填）　联系方式：（待填）');
push('- 作品状态：原创首发，未发表、未签约；本书规划 24 章、约 5.8 万字，已完稿 10 章。');
push('- AI 使用声明：本书由「墨脉 InkFlow」工作流辅助创作（设定一致性校验、逐章三审与去 AI 味质检），选题判断、规则设计与终稿修订由作者完成。');
push('');
push('---');
push('');
push(`*本投稿包由 \`node scripts/submission.mjs ${id}\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成，数据取自项目 JSON，指标为本地确定性脚本实测。*`);
push('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

// 顺手导出一份纯文本正文，方便直接发给编辑或用手机看
const txtPath = path.join(outDir, '正文.txt');
fs.writeFileSync(txtPath, buildTxt(p), 'utf8');

// —— 正文.md（给人读，查看器/编辑器都能直接打开）
const chsSorted = chs.map((c) => `## 第 ${c.no} 章　${c.title}\n\n${c.current.trim()}`).join('\n\n---\n\n');
const novelMd = [
  `# 《${topic.title || '十七秒'}》`,
  '',
  `> ${topic.logline || p.brief.seedIdea}`,
  '',
  `> 都市悬疑 / 声音怪谈 · 女主视角 · 已完稿 ${chs.length} 章 / ${totalWords} 字（全书规划 ${p.brief.targetChapters} 章）`,
  '',
  '---',
  '',
  chsSorted,
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, '正文.md'), novelMd, 'utf8');

// —— 设定与人物.md
const w = p.world || {};
const setting = [];
setting.push(`# 《${topic.title || ''}》设定与人物`, '');
setting.push('## 一句话', '', topic.logline || p.brief.seedIdea, '');
setting.push('## 世界观', '', w.premise || '', '');
setting.push(`**时代**：${w.era || ''}`, '', `**社会**：${w.society || ''}`, '');
if (w.powerSystem?.length) {
  setting.push('## 力量 / 异常体系', '');
  for (const ps of w.powerSystem) {
    setting.push(`### ${ps.name}（单位：${ps.unit}）`, '');
    if (ps.tiers?.length) setting.push('**层级**：' + ps.tiers.join('；'), '');
    if (ps.rules?.length) setting.push('**规则**：', ...ps.rules.map((r) => `- ${r}`), '');
    if (ps.cost) setting.push(`**代价**：${ps.cost}`, '');
    if (ps.bounds) setting.push(`**上限**：${ps.bounds}`, '');
    if (ps.exception) setting.push(`**例外**：${ps.exception}`, '');
  }
}
if (w.hardRules?.length) setting.push('## 硬规则（写错即算设定冲突）', '', ...w.hardRules.map((r) => `- ${r}`), '');
if (w.glossary?.length) setting.push('## 词条', '', ...w.glossary.map((g) => `- **${g.term}**：${g.def}`), '');
if (w.factions?.length) setting.push('## 势力', '', ...w.factions.map((f) => `- **${f.name}**：目标 ${f.goal}；资源 ${f.resource}；软肋 ${f.weakness}`), '');
if (w.geography?.length) setting.push('## 地点', '', ...w.geography.map((g) => `- **${g.name}**：${g.feature}；危险：${g.danger}`), '');
setting.push('## 人物', '');
for (const c of p.characters || []) {
  setting.push(`### ${c.name}（${c.role}｜${c.age} 岁｜${c.rank}）`, '');
  setting.push(`${c.oneLine}。`, '');
  setting.push(`- 动机：${c.motivation}`);
  setting.push(`- 阻碍：${c.obstacle}`);
  setting.push(`- 误信：${c.misbelief}`);
  setting.push(`- 秘密：${c.secret}`);
  setting.push(`- 转折：${c.turn}`);
  setting.push(`- 弧光：${c.arcStart} → ${c.arcEnd}`);
  setting.push(`- 说话方式：${c.voice}`, '');
  for (const r of c.relations || []) setting.push(`- 关系：${r.target}｜${r.type}｜${r.tension}`);
  setting.push('');
}
if (p.foreshadow?.ledger?.length) {
  setting.push('## 伏笔台账', '');
  setting.push('| 伏笔 | 类型 | 布置章 | 回收章 | 内容 | 回收方式 |');
  setting.push('|---|---|---|---|---|---|');
  for (const f of p.foreshadow.ledger) {
    setting.push(`| ${f.name} | ${f.type} | ${f.setupChapter} | ${f.payoffChapter} | ${f.content} | ${f.payoff} |`);
  }
  setting.push('');
}
fs.writeFileSync(path.join(outDir, '设定与人物.md'), setting.join('\n'), 'utf8');

// —— 大纲.md
const ol = [`# 《${topic.title || ''}》分层大纲`, '', `> ${p.outline.logline || ''}`, '', `**主题**：${p.outline.theme || ''}`, ''];
for (const v of p.outline.volumes) {
  ol.push(`## 第 ${v.no} 卷 · ${v.title}`, '', `- 本卷目标：${v.goal}`, `- 卷末状态：${v.endState}`, '');
  for (const a of v.arcs) {
    ol.push(`### 第 ${a.no} 弧 · ${a.title}（${a.summary}）`, '');
    ol.push('| 章 | 标题 | 目标 | 阻碍 | 转折 | 结果 | 密度 | 钩子 |');
    ol.push('|---|---|---|---|---|---|---|---|');
    for (const c of a.chapters) {
      ol.push(`| ${c.no} | ${c.title} | ${c.goal} | ${c.obstacle} | ${c.turn} | ${c.result} | ${c.density} | ${c.hook} |`);
    }
    ol.push('');
  }
}
if (p.outline.causalityCheck?.length) {
  ol.push('## 因果链自检', '', ...p.outline.causalityCheck.map((x) => `- ${x}`), '');
}
fs.writeFileSync(path.join(outDir, '大纲.md'), ol.join('\n'), 'utf8');

console.log(`[submission] 已生成 ${path.relative(ROOT, outPath)}（${lines.join('\n').length} 字符）`);
console.log(`[submission] 已生成 正文.md / 设定与人物.md / 大纲.md`);
console.log(`[submission] 已生成 ${path.relative(ROOT, txtPath)}`);
console.log(`[submission] ${chs.length} 章 / ${totalWords} 字 / ${cards.length} 章大纲`);
