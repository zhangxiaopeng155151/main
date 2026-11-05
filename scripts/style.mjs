/**
 * 文笔画像：只看「文笔层」指标，不跑结构/逻辑检查。
 *
 * 用法：
 *   node scripts/style.mjs                 # 默认 小说资料/十七秒
 *   node scripts/style.mjs 小说资料/某本书
 *   node scripts/style.mjs 小说资料/十七秒 --json
 *
 * 指标口径见 docs/网文头部文笔拆解.md 第五节；阈值与 scripts/audit.mjs 保持一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { proseProfile, countWords } from '../server/text.js';
import { ROOT } from '../server/store.js';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--')) || '小说资料/十七秒';
const asJson = args.includes('--json');
const file = path.resolve(ROOT, dirArg, '正文.txt');

const txt = fs.readFileSync(file, 'utf8');
const chapters = [];
let cur = null;
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*第\s*(\d+)\s*章[　\s:：]*(.*)$/);
  if (m) {
    if (cur) chapters.push(cur);
    cur = { no: Number(m[1]), title: (m[2] || '').trim(), lines: [] };
  } else if (cur) cur.lines.push(line);
}
if (cur) chapters.push(cur);

const SENSORY_MIN = 18;
const SHORT_PARA_MIN = 0.5;
const EXPLAIN_MAX = 0.04;

const rows = chapters.map((c) => {
  const text = c.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const p = proseProfile(text);
  return {
    no: c.no,
    title: c.title,
    words: countWords(text),
    sensory: p.sensoryDensity,
    shortPara: Math.round(p.shortParaRatio * 100),
    turns: p.dialogueTurns,
    explain: Number((p.explanationRatio * 100).toFixed(1)),
    numbers: p.numberDensity,
    opener: p.开篇三件套,
    sensoryBreakdown: p.sensory,
    flags: [
      p.sensoryDensity < SENSORY_MIN ? `五感密度 ${p.sensoryDensity} < ${SENSORY_MIN}` : '',
      p.shortParaRatio < SHORT_PARA_MIN ? `短段 ${Math.round(p.shortParaRatio * 100)}% < ${SHORT_PARA_MIN * 100}%` : '',
      p.explanationRatio > EXPLAIN_MAX ? `解释句 ${(p.explanationRatio * 100).toFixed(1)}% > ${EXPLAIN_MAX * 100}%` : '',
    ].filter(Boolean),
  };
});

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const pad = (v, n) => String(v).padEnd(n, ' ');
const padS = (v, n) => String(v).padStart(n, ' ');
console.log(`\n[style] ${dirArg}：${rows.length} 章 / ${rows.reduce((a, r) => a + r.words, 0)} 字\n`);
console.log('  章  五感/千字  短段%  对话轮  解释句%  数字/千字  开篇三件套  警示');
for (const r of rows) {
  console.log(
    ` ${padS(r.no, 3)}  ${padS(r.sensory, 9)}  ${padS(r.shortPara, 5)}  ${padS(r.turns, 6)}  ${padS(r.explain, 7)}  ${padS(r.numbers, 9)}  ${padS(r.opener ? '✅' : '—', 10)}  ${r.flags.join('；')}`
  );
}
const avg = (k) => (rows.reduce((a, r) => a + Number(r[k]), 0) / Math.max(rows.length, 1)).toFixed(1);
const minOf = (k) => Math.min(...rows.map((r) => Number(r[k])));
console.log(
  `\n 均值：五感 ${avg('sensory')}／短段 ${avg('shortPara')}%／对话轮 ${avg('turns')}／解释句 ${avg('explain')}%／数字 ${avg('numbers')}`
);
console.log(
  ` 最低：五感 ${minOf('sensory')}（闸门 ${SENSORY_MIN}）／短段 ${minOf('shortPara')}%（闸门 ${SHORT_PARA_MIN * 100}%）／解释句最高 ${Math.max(...rows.map((r) => r.explain))}%（闸门 ${EXPLAIN_MAX * 100}%）`
);
console.log(` 开篇三件套：${rows.filter((r) => r.opener).length}/${rows.length} 章同时有台词、动作、异常\n`);
