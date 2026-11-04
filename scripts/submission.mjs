/**
 * 生成投稿包：把项目 JSON 里的设定、目录、人物与第一章样稿拼成一份可直接投递的 Markdown。
 *
 * 用法：node scripts/submission.mjs <projectId> [输出路径]
 * 默认输出：manuscripts/十七秒/投稿包.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, ROOT } from '../server/store.js';
import { flatChapters, buildMarkdown } from '../server/pipeline.js';
import { countWords } from '../server/text.js';

const id = process.argv[2];
if (!id) {
  console.error('用法：node scripts/submission.mjs <projectId> [输出路径]');
  process.exit(1);
}
const outPath = path.resolve(ROOT, process.argv[3] || 'manuscripts/十七秒/投稿包.md');
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
push(`已完稿 ${chs.length} 章，共 ${totalWords} 字。以下附第 1 章全文（其余章节见 \`manuscripts/十七秒/chapters/\`）。`);
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

// 顺手导出一份全本 markdown，方便直接发给编辑
const novelPath = path.join(path.dirname(outPath), '全本样章.md');
fs.writeFileSync(novelPath, buildMarkdown(p), 'utf8');

console.log(`[submission] 已生成 ${path.relative(ROOT, outPath)}（${lines.join('\n').length} 字符）`);
console.log(`[submission] 已生成 ${path.relative(ROOT, novelPath)}`);
console.log(`[submission] ${chs.length} 章 / ${totalWords} 字 / ${cards.length} 章大纲`);
