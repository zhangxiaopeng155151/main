/**
 * 全文审核：对一本书做一遍「结构 / 语言 / 逻辑 / 阅读体验」四组检查，产出审核报告。
 *
 * 用法：
 *   node scripts/audit.mjs                 # 默认审 小说资料/十七秒
 *   node scripts/audit.mjs 小说资料/某本书
 *   node scripts/audit.mjs 小说资料/十七秒 --strict   # 有阻断项时退出码 1
 *
 * 与 scripts/import.mjs 的区别：import 是把稿子装进项目跑三审；audit 是不依赖项目，
 * 直接对「书稿.json + 正文.txt」做交叉检查（跨章重复、人名/编号一致、伏笔逾期、大纲覆盖）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { styleMetrics, hookScore, factCheck, splitParagraphs, splitSentences, countWords } from '../server/text.js';
import { ROOT } from '../server/store.js';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--')) || '小说资料/十七秒';
const strict = args.includes('--strict');
const dir = path.resolve(ROOT, dirArg);

const book = JSON.parse(fs.readFileSync(path.join(dir, '书稿.json'), 'utf8'));
const cards = [];
for (const v of book.outline.volumes) for (const a of v.arcs) for (const c of a.chapters) cards.push(c);

/* ------------------------------ 读正文 ------------------------------ */

function parseChapters(txt = '') {
  const out = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*第\s*(\d+)\s*章[　\s:：]*(.*)$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { no: Number(m[1]), title: (m[2] || '').trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out
    .map((c) => ({ no: c.no, title: c.title, text: c.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() }))
    .filter((c) => c.text)
    .sort((a, b) => a.no - b.no);
}

const chapters = parseChapters(fs.readFileSync(path.join(dir, '正文.txt'), 'utf8'));
const fullText = chapters.map((c) => c.text).join('\n\n');

/* ------------------------------ 规则参数 ------------------------------ */

const MIN_WORDS = 2040;
const MAX_AI = Number((args.includes('--max-ai') ? args[args.indexOf('--max-ai') + 1] : 1)); // 默认 1：比平台闸门更严
const MIN_STD = 6;
const HOOK_MIN = 6;
const CLICHE_SOFT = ['仿佛', '似乎', '顿时', '缓缓', '微微', '不禁', '一丝', '一抹', '莫名'];
const issues = []; // { level: 'block'|'warn'|'info', where, what, fix }

const add = (level, where, what, fix = '') => issues.push({ level, where, what, fix });

/* ------------------------------ 逐章检查 ------------------------------ */

const projectLike = { world: book.world || {}, characters: book.characters || [] };
const ledger = book.foreshadow?.ledger || [];
const rows = [];

for (const ch of chapters) {
  const m = styleMetrics(ch.text);
  const hook = hookScore(ch.text, (book.characters || []).map((c) => c.name));
  const fact = factCheck(ch.text, projectLike);
  const card = cards.find((c) => c.no === ch.no);

  // 结构
  if (m.words < MIN_WORDS) add('block', `第${ch.no}章`, `字数 ${m.words} < ${MIN_WORDS}`, '补一场具体场景（有人做事、有人说话），不要补解释');
  if (card && ch.title !== card.title) add('warn', `第${ch.no}章`, `标题「${ch.title}」≠ 大纲「${card.title}」`, '统一标题，或改大纲');

  // 语言
  if (m.ai.score > MAX_AI) add('block', `第${ch.no}章`, `AI 味 ${m.ai.score} > ${MAX_AI}（命中：${m.ai.top.join('、')}）`, '删套话、打散句式、删命定感旁白');
  if (m.sentenceLenStd < MIN_STD) add('warn', `第${ch.no}章`, `句长标准差 ${m.sentenceLenStd} < ${MIN_STD}`, '每 3–4 句插一个 3–8 字短句');
  if (m.dialogueRatio < 0.12) add('warn', `第${ch.no}章`, `对白占比 ${(m.dialogueRatio * 100).toFixed(0)}% 偏低`, '把一段叙述改成两个人的对话');
  if (m.dialogueRatio > 0.6) add('warn', `第${ch.no}章`, `对白占比 ${(m.dialogueRatio * 100).toFixed(0)}% 偏高`, '补动作与环境，避免变成剧本');
  const clicheHits = CLICHE_SOFT.filter((w) => ch.text.includes(w));
  if (clicheHits.length > 3) add('warn', `第${ch.no}章`, `套话命中 ${clicheHits.length} 种：${clicheHits.join('、')}`, '替换成具体动作');
  const dash = (ch.text.match(/——/g) || []).length;
  if (dash > 3) add('warn', `第${ch.no}章`, `破折号 ${dash} 处`, '改成句号或逗号');
  const open = (ch.text.match(/「/g) || []).length;
  const close = (ch.text.match(/」/g) || []).length;
  if (open !== close) add('block', `第${ch.no}章`, `直角引号不配对（「${open} / 」${close}）`, '补齐引号');
  if (/[，。！？；：]{2,}/.test(ch.text.replace(/……/g, ''))) add('warn', `第${ch.no}章`, '出现连续标点', '检查句读');

  // 标点（中文规范：只用全角，引号用「」/‘’）
  const asciiQuote = (ch.text.match(/["']/g) || []).length;
  if (asciiQuote) add('block', `第${ch.no}章`, `出现 ${asciiQuote} 个半角引号`, '改用「」或‘’，不要用 " 和 \'');
  const halfPunct = ch.text.match(/[\u4e00-\u9fff][,.!?;:]/g) || [];
  if (halfPunct.length) add('block', `第${ch.no}章`, `中文后面跟了半角标点 ${halfPunct.length} 处：${halfPunct.slice(0, 3).join(' ')}`, '改成全角，。！？；：');
  if (/^---$/m.test(ch.text) || /\*\*[^*\n]{1,30}\*\*/.test(ch.text) || /^#+\s/m.test(ch.text)) add('warn', `第${ch.no}章`, '正文里混进了 Markdown 记号', '正文.txt 只放纯文本（138****6047 这类打码不算）');
  if (dash > 0) add('warn', `第${ch.no}章`, `破折号 ${dash} 处（本书目标 0，破折号是最容易识别的 AI 痕迹）`, '改成句号、逗号或冒号');
  const ell = ch.text.match(/(?<!…)…(?!…)/g);
  if (ell && ell.length) add('warn', `第${ch.no}章`, `省略号只用了单个「…」${ell.length} 处`, '中文省略号是六个点：……');
  const so = (ch.text.match(/‘/g) || []).length;
  const sc = (ch.text.match(/’/g) || []).length;
  if (so !== sc) add('block', `第${ch.no}章`, `单引号不配对（‘${so} / ’${sc}）`, '补齐或删掉');

  // 逻辑
  for (const f of fact) add('block', `第${ch.no}章`, `设定冲突：${f.why || f.type}${f.quote ? `（${f.quote}）` : ''}`, f.fix || '');

  // 伏笔任务
  const duties = [
    ...ledger.filter((f) => f.setupChapter === ch.no).map((f) => ({ ...f, kind: '布置' })),
    ...ledger.filter((f) => f.payoffChapter === ch.no).map((f) => ({ ...f, kind: '回收' })),
  ];
  const missed = duties.filter((f) => {
    if (ch.text.includes(f.name)) return false;
    const clean = String(f.content || '').replace(/[^\u4e00-\u9fff]/g, '');
    const wins = [];
    for (let i = 0; i < clean.length - 1; i++) wins.push(clean.slice(i, i + 2));
    return wins.filter((w) => ch.text.includes(w)).length < 2;
  });
  for (const f of missed) add('block', `第${ch.no}章`, `伏笔「${f.name}」该${f.kind}未${f.kind}`, `用具体细节补上，不要直接解释（${f.content}）`);

  // 阅读体验
  if (hook.score < HOOK_MIN) add('block', `第${ch.no}章`, `章末钩子 ${hook.score} < ${HOOK_MIN}（${hook.reasons.join('；')}）`, '把最后一句改成具体威胁 / 信息缺口');
  if (card?.turn) {
    const clean = String(card.turn).replace(/[^\u4e00-\u9fff]/g, '');
    const wins = [];
    for (let i = 0; i < clean.length - 1; i++) wins.push(clean.slice(i, i + 2));
    const hit = wins.filter((w) => ch.text.includes(w)).length;
    const ratio = wins.length ? hit / wins.length : 1;
    if (ratio < 0.25) add('warn', `第${ch.no}章`, `与大纲「转折」重合度仅 ${(ratio * 100).toFixed(0)}%：${card.turn}`, '确认这一章的转折是否真的写了');
  }

  rows.push({
    no: ch.no, title: ch.title, words: m.words, ai: m.ai.score, std: m.sentenceLenStd,
    dlg: Math.round(m.dialogueRatio * 100), hook: hook.score, density: card?.density ?? '',
    score: Math.max(0, 100 - issues.filter((i) => i.where === `第${ch.no}章` && i.level !== 'info').length * 6),
  });
}

/* ------------------------------ 跨章检查 ------------------------------ */

// 1) 章号连续
const nos = chapters.map((c) => c.no);
for (let i = 1; i <= Math.max(...nos); i++) {
  if (!nos.includes(i)) add('block', `第${i}章`, '章号缺失', '补齐或改编号');
}

// 2) 跨章重复句（≥12 字）
const seen = new Map();
for (const ch of chapters) {
  for (const s of splitSentences(ch.text)) {
    const t = s.trim().replace(/\s/g, '');
    if (countWords(t) < 12) continue;
    if (!seen.has(t)) seen.set(t, []);
    seen.get(t).push(ch.no);
  }
}
for (const [t, chs] of seen) {
  if (chs.length > 1) add('warn', `第${[...new Set(chs)].join('/')}章`, `跨章重复句（${countWords(t)} 字）：${t.slice(0, 30)}…`, '换一种写法，重复句是 AI 稿最明显的痕迹');
}

// 3) 人名一致性：首字相同、长度相同、仅差一个字 → 疑似错字
const names = (book.characters || []).map((c) => c.name).filter((n) => n && n.length >= 2);
const nameSet = new Set(names);
// 「苏主任」「顾队长」这类是职务简称，不是人名错字
const TITLE_CHARS = new Set('主任警官法医队老总科长馆员家氏小大'.split(''));
for (const name of names) {
  const re = new RegExp(name[0] + '[\\u4e00-\\u9fff]' + (name.length > 2 ? '[\\u4e00-\\u9fff]' : ''), 'g');
  const found = new Map();
  for (const m of fullText.matchAll(re)) {
    const f = m[0];
    found.set(f, (found.get(f) || 0) + 1);
  }
  for (const [f, n] of found) {
    if (nameSet.has(f)) continue;
    if (names.some((x) => x.startsWith(f) || f.startsWith(x))) continue;
    if (f.length === 2 && TITLE_CHARS.has(f[1])) continue;   // 苏主任 / 顾队长
    const diff = f.split('').filter((c, i) => c !== name[i]).length;
    if (diff === 1 && n >= 2) add('block', '全文', `疑似人名错字：「${f}」出现 ${n} 次（应为「${name}」？）`, '全文替换并检查');
  }
}

// 4) 编号 / 日期格式一致性
const dateTokens = new Set(fullText.match(/\d{4}-\d{1,2}-\d{1,2}/g) || []);
const badDate = [...dateTokens].filter((d) => d.split('-')[2].length !== 2 || d.split('-')[1].length !== 2);
if (badDate.length) add('warn', '全文', `日期格式不统一：${badDate.join('、')}`, '统一成 YYYY-MM-DD');
const numTokens = {};
for (const n of fullText.match(/(?<![0-9-])\d{3,4}(?![0-9-])/g) || []) numTokens[n] = (numTokens[n] || 0) + 1;

// 5) 伏笔逾期未回收
for (const f of ledger) {
  if (f.payoffChapter <= Math.max(...nos) && !fullText.includes(f.name)) {
    const hit = (() => {
      const clean = String(f.payoff || '').replace(/[^\u4e00-\u9fff]/g, '');
      const wins = [];
      for (let i = 0; i < clean.length - 1; i++) wins.push(clean.slice(i, i + 2));
      return wins.filter((w) => fullText.includes(w)).length >= 2;
    })();
    if (!hit) add('block', '全书', `伏笔「${f.name}」应在第 ${f.payoffChapter} 章回收，至今未回收`, '补回收场景，或把回收章号后移');
  }
}

// 6) 节奏曲线
const densityOf = (no) => cards.find((c) => c.no === no)?.density ?? null;
const planDensities = cards.map((c) => c.density);
const avgPlan = planDensities.reduce((a, b) => a + b, 0) / planDensities.length;
for (let i = 0; i + 2 < cards.length; i++) {
  const trio = [cards[i], cards[i + 1], cards[i + 2]];
  if (trio.every((c) => c.density <= 2)) add('warn', '节奏', `第 ${trio.map((c) => c.no).join('/')} 章连续低密度`, '把后面的高潮提前，或给其中一章加具体威胁');
}
if (!cards.some((c) => c.density >= 5)) add('warn', '节奏', '全书没有密度 5 的高潮章', '至少要有一章把底牌翻出来');

// 7) 进度
const maxNo = Math.max(...nos);
const planned = cards.length;
if (maxNo < planned) add('info', '进度', `已写 ${maxNo} 章 / 规划 ${planned} 章，还差 ${planned - maxNo} 章`, '');

/* ------------------------------ 多音字（只出表，不进正文） ------------------------------ */

// 只收「读错就会出戏」的词。演播照着这张表念；正文.txt 里不写任何注音。
const POLY = [
  { w: '数数', py: 'shǔ shù', note: '第一个字读 shǔ（清点），第二个字读 shù' },
  { w: '数到', py: 'shǔ dào', note: '清点义，读 shǔ' },
  { w: '数着', py: 'shǔ zhe', note: '清点义，读 shǔ' },
  { w: '数字', py: 'shù zì', note: '名词义，读 shù' },
  { w: '十七行', py: 'shí qī háng', note: '表格/名单的量词，读 háng，不读 xíng' },
  { w: '一行', py: 'yī háng', note: '同上，名单的一行读 háng' },
  { w: '转盘', py: 'zhuàn pán', note: '旋转的盘，读 zhuàn' },
  { w: '转身', py: 'zhuǎn shēn', note: '改变方向，读 zhuǎn' },
  { w: '转过来', py: 'zhuǎn guò lái', note: '改变方向，读 zhuǎn' },
  { w: '重新', py: 'chóng xīn', note: '再一次，读 chóng' },
  { w: '长大', py: 'zhǎng dà', note: '生长，读 zhǎng' },
  { w: '睡着', py: 'shuì zháo', note: '入睡的结果，读 zháo' },
  { w: '还给', py: 'huán gěi', note: '归还，读 huán' },
  { w: '差不多', py: 'chà bù duō', note: '读 chà' },
  { w: '觉得', py: 'jué de', note: '读 jué' },
  { w: '一只', py: 'yī zhī', note: '量词，读 zhī' },
  { w: '只有', py: 'zhǐ yǒu', note: '读 zhǐ' },
  { w: '答应', py: 'dā ying', note: '读 dā，第二个字轻声' },
  { w: '露出', py: 'lù chū', note: '读 lù；口语「露馅」才读 lòu' },
  { w: '空转', py: 'kōng zhuàn', note: '空=没有负载读 kōng，转=旋转读 zhuàn' },
  { w: '空白', py: 'kòng bái', note: '读 kòng' },
  { w: '薄薄', py: 'báo báo', note: '口语单用读 báo' },
  { w: '划掉', py: 'huá diào', note: '用笔划，读 huá；「计划」读 huà' },
  { w: '为了', py: 'wèi le', note: '读 wèi' },
  { w: '落下', py: 'luò xià', note: '读 luò' },
  { w: '曾经', py: 'céng jīng', note: '读 céng' },
  { w: '看夜', py: 'kān yè', note: '看守义，读 kān，不读 kàn' },
];

const polyRows = [];
for (const e of POLY) {
  const cnt = fullText.split(e.w).length - 1;
  if (!cnt) continue;
  const idx = fullText.indexOf(e.w);
  const ctx = fullText.slice(Math.max(0, idx - 16), idx + e.w.length + 16).replace(/\n/g, ' ').replace(/\s+/g, ' ');
  polyRows.push({ ...e, cnt, ctx });
}

const PY = [];
PY.push('# 《十七秒》朗读注音表');
PY.push('');
PY.push('> **这张表不进正文。** `正文.txt` 保持纯文本，不带任何拼音或注音标记；演播、配音、TTS 校对时照着这份表念即可。');
PY.push('> 由 `scripts/audit.mjs` 从正文里扫出来，改稿后重跑一次就更新。');
PY.push('');
PY.push('| 词 | 读音 | 出现次数 | 例句（正文原句） |');
PY.push('|---|---|---|---|');
for (const r of polyRows) PY.push(`| ${r.w} | ${r.py} | ${r.cnt} | ${r.ctx} |`);
PY.push('');
PY.push('## 最容易读错的五处');
PY.push('');
PY.push('1. **数数**：`shǔ shù`——前面是动词（数），后面是名词（数目），两个字不同音。');
PY.push('2. **转盘 / 转身**：转盘是 `zhuàn`（旋转），转身是 `zhuǎn`（改变方向）。同一章里两种读法都有。');
PY.push('3. **十七行**：名单的一行读 `háng`，不是 `xíng`。');
PY.push('4. **答应**：`dā ying`，第二个字轻声——这是全书出现最频繁的词之一，读成 `dā yìng` 会立刻出戏。');
PY.push('5. **看夜**：`kān yè`（看守），不是 `kàn yè`。');
PY.push('');
fs.writeFileSync(path.join(dir, '朗读注音表.md'), PY.join('\n'), 'utf8');

/* ------------------------------ 报告 ------------------------------ */

const blocks = issues.filter((i) => i.level === 'block');
const warns = issues.filter((i) => i.level === 'warn');
const infos = issues.filter((i) => i.level === 'info');

const L = [];
L.push(`# 《${(book.topics || []).find((t) => t.id === book.selectedTopicId)?.title || book.name}》全文审核报告`);
L.push('');
L.push(`> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}　审核范围：${chapters.length} 章 / ${fullText.length} 字符`);
L.push('> 口径见 `docs/全文审核清单.md`；本报告由 `scripts/audit.mjs` 本地确定性生成。');
L.push('');
L.push(`## 结论：${blocks.length ? `❌ 阻断 ${blocks.length} 项` : '✅ 无阻断'}　·　⚠ 警告 ${warns.length} 项`);
L.push('');
L.push('| 章 | 标题 | 字数 | AI 味 | 句长σ | 对白% | 钩子 | 规划密度 |');
L.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  L.push(`| ${r.no} | ${r.title} | ${r.words}${r.words < MIN_WORDS ? ' ⚠' : ''} | ${r.ai}${r.ai > MAX_AI ? ' ⚠' : ''} | ${r.std}${r.std < MIN_STD ? ' ⚠' : ''} | ${r.dlg} | ${r.hook}${r.hook < HOOK_MIN ? ' ⚠' : ''} | ${r.density} |`);
}
L.push('');
if (blocks.length) {
  L.push('## 阻断项（必须改完再往下写）');
  L.push('');
  for (const i of blocks) L.push(`- **${i.where}**：${i.what}${i.fix ? `\n  - 改法：${i.fix}` : ''}`);
  L.push('');
}
if (warns.length) {
  L.push('## 警告项');
  L.push('');
  for (const i of warns) L.push(`- ${i.where}：${i.what}${i.fix ? `（${i.fix}）` : ''}`);
  L.push('');
}
if (infos.length) {
  L.push('## 进度');
  L.push('');
  for (const i of infos) L.push(`- ${i.what}`);
  L.push('');
}
L.push('## 多音字');
L.push('');
L.push(`扫到 ${polyRows.length} 个易读错的词，完整读音表见同目录 \`朗读注音表.md\`（**不进正文**）：`);
L.push('');
L.push(polyRows.slice(0, 8).map((r) => `${r.w}（${r.py}）×${r.cnt}`).join('　') || '无');
L.push('');
L.push('## 编号 / 数字出现频次（人工核对用）');
L.push('');
L.push(Object.entries(numTokens).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n}×${c}`).join('　'));
L.push('');
L.push('## 规划节奏（按大纲密度）');
L.push('');
L.push(`平均密度 ${avgPlan.toFixed(2)}：` + planDensities.map((d, i) => `${i + 1}:${d}`).join(' '));
L.push('');

fs.writeFileSync(path.join(dir, '审核报告.md'), L.join('\n'), 'utf8');

console.log(`[audit] ${dirArg}：${chapters.length} 章 / ${fullText.length} 字符`);
console.log(`[audit] 阻断 ${blocks.length} · 警告 ${warns.length}`);
for (const i of [...blocks, ...warns].slice(0, 20)) console.log(`  ${i.level === 'block' ? '✗' : '!'} ${i.where}：${i.what}`);
console.log(`[audit] 注音表已写入 ${path.relative(ROOT, path.join(dir, '朗读注音表.md'))}（${polyRows.length} 条）`);
console.log(`[audit] 报告已写入 ${path.relative(ROOT, path.join(dir, '审核报告.md'))}`);

if (strict && blocks.length) process.exit(1);
