/**
 * 文本度量 / 去AI味 / 相似度 —— 全部本地计算，不依赖任何外部服务。
 * 这些函数是「审核闸门」的硬指标来源：即使不用大模型，也能判断
 * 字数是否达标、句式是否单调、AI 味是否过重、章末有没有钩子。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD = /[A-Za-z0-9]+/g;

/** 中文习惯字数：汉字数 + 英文单词/数字串数（不计标点） */
export function countWords(text = '') {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.match(LATIN_WORD) || []).length;
  return cjk + latin;
}

export function splitSentences(text = '') {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?…])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitParagraphs(text = '') {
  // 空行才是段落边界；对话的每一行之间只有单个换行，不能拆散
  return text.replace(/\r/g, '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}

export function excerpt(text = '', n = 120) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 高频 AI 腔词汇表（可扩展，也用于去AI味的替换表） */
export const AI_CLICHES = [
  '仿佛', '似乎', '不禁', '顿时', '缓缓', '微微', '深深地', '莫名的', '莫名的恐惧',
  '一丝', '一抹', '不易察觉', '心中一凛', '心中暗道', '嘴角勾起', '瞳孔骤缩',
  '空气仿佛凝固', '空气瞬间凝固', '时间的流逝', '在这个世界上', '命运的齿轮',
  '不置可否', '若有所思', '意味深长', '淡淡地', '轻轻地叹了口气',
  '总而言之', '与此同时', '此外', '然而', '值得一提的是', '毫无疑问',
  '这一夜注定无眠', '一切才刚刚开始', '而他不知道的是', '从这一刻起',
];

/** AI 味的「结构性」特征 */
const STRUCTURAL_PATTERNS = [
  { id: 'summary-ending', label: '段末总结句/命定感旁白', re: /(从这一刻起|从那天起|而他不知道的是|一切才刚刚开始|命运的齿轮|这一夜注定)/g, weight: 2.2 },
  // 真正的排比：顿号三项，或三句同头（同一字起句）
  { id: 'enumeration-triplet', label: '顿号三项排比', re: /[^，。！？\n]{1,8}、[^，。！？\n]{1,8}、[^，。！？\n]{1,8}[。！？]/g, weight: 0.9 },
  { id: 'same-start-triplet', label: '三句同头排比', re: /(?:^|[。！？\n])\s*(.)[^，。！？\n]{1,10}，\1[^，。！？\n]{1,10}，\1[^，。！？\n]{1,10}[。！？]/g, weight: 0.8 },
  { id: 'dash-abuse', label: '破折号滥用', re: /——/g, weight: 0.8 },
  { id: 'simile-pile', label: '比喻堆叠（像…仿佛…）', re: /(像|如同|仿佛|宛如)[^，。]{2,20}[，。][^。]{0,6}(像|仿佛|宛如)/g, weight: 1.4 },
  { id: 'abstract-emotion', label: '抽象情绪直述（感到一阵X）', re: /感到(一阵|一股|一丝|些许|无比)?[^，。]{0,6}(愤怒|悲伤|恐惧|孤独|温暖|寒意|无力)/g, weight: 1.6 },
];

export function aiFlavor(text = '') {
  const words = Math.max(countWords(text), 1);
  const per1k = 1000 / words;
  const hits = [];
  let weighted = 0;

  for (const term of AI_CLICHES) {
    let count = 0;
    let idx = text.indexOf(term);
    while (idx !== -1) { count++; idx = text.indexOf(term, idx + term.length); }
    if (count > 0) {
      const w = term.length >= 4 ? 1.4 : 1;
      weighted += count * w;
      hits.push({ term, count, kind: 'word', weight: w });
    }
  }
  for (const p of STRUCTURAL_PATTERNS) {
    const m = text.match(p.re);
    if (m && m.length) {
      weighted += m.length * p.weight;
      hits.push({ term: p.label, count: m.length, kind: 'pattern', weight: p.weight });
    }
  }
  hits.sort((a, b) => b.count * b.weight - a.count * a.weight);
  // 归一化：每千字 3 个加权命中 ≈ 5 分
  const density = weighted * per1k;
  const score = Math.min(10, Number((density * 1.65).toFixed(2)));
  return {
    score,
    density: Number(density.toFixed(2)),
    hits: hits.slice(0, 12),
    top: hits.slice(0, 5).map((h) => h.term),
  };
}

const CN_NUM = '零一二三四五六七八九十百千万两';

function stddev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

/** 文风/节奏指标 */
export function styleMetrics(text = '') {
  const words = countWords(text);
  const paras = splitParagraphs(text);
  const sentences = splitSentences(text);
  const lens = sentences.map((s) => countWords(s)).filter((n) => n > 0);
  const dialogue = (text.match(/[“"][^”"]{2,}[”"]/g) || []).join('');
  const dialogueWords = countWords(dialogue);
  const allChars = text.replace(/[^\u4e00-\u9fff]/g, '');
  const bigrams = new Set();
  for (let i = 0; i < allChars.length - 1; i++) bigrams.add(allChars.slice(i, i + 2));
  const ttr = allChars.length ? bigrams.size / Math.max(allChars.length - 1, 1) : 0;
  const avgSentence = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const avgParagraph = paras.length ? words / paras.length : 0;
  const longRatio = lens.filter((n) => n > 45).length / Math.max(lens.length, 1);

  return {
    words,
    paragraphs: paras.length,
    sentences: lens.length,
    avgSentenceLen: Number(avgSentence.toFixed(1)),
    sentenceLenStd: Number(stddev(lens).toFixed(1)),
    longSentenceRatio: Number(longRatio.toFixed(3)),
    avgParagraphLen: Number(avgParagraph.toFixed(0)),
    dialogueRatio: Number((dialogueWords / Math.max(words, 1)).toFixed(3)),
    lexicalRichness: Number(ttr.toFixed(3)),
    ai: aiFlavor(text),
  };
}

/** 章末钩子强度（0-10）：靠可观测特征估算，大模型审稿会在此基础上做语义判断 */
export function hookScore(text = '', names = []) {
  const sentences = splitSentences(text);
  const tail = sentences.slice(-3).join('');
  if (!tail) return { score: 0, reasons: ['章节为空'] };
  const reasons = [];
  const lastSentence = (sentences[sentences.length - 1] || '').trim();
  let s = 3;
  if (/[？?]/.test(tail)) { s += 3; reasons.push('结尾以疑问收束'); }
  if (/[！!]/.test(tail)) { s += 1; reasons.push('结尾有爆发式标点'); }
  if (/(却|竟|忽然|突然|可是|没想到|不对劲|偏偏|居然|反倒|反而)/.test(tail)) { s += 2; reasons.push('结尾出现意外转折词'); }
  // 具体威胁 / 反常细节 —— 中文短篇最有效的钩子特征
  if (/(门外|外面|背后|身后|脚步声|敲门|电话|短信|血|尸体|尸首|倒计时|[一二三四五六七八九十]声|最后一[个次盏句]|只剩下|来不及|多了一个|少了一个|不见了|没有影|没了影|名字|转过了头|回过头|停下了|不该|死期|日期|熄灭|灭下去|影子里|影子背|影子转|影子不见)/.test(tail)) {
    s += 2.6;
    reasons.push('结尾出现具体威胁或反常细节');
  }
  if (countWords(lastSentence) >= 6 && countWords(lastSentence) <= 30 && !/(从这一刻|一切才|他知道)/.test(lastSentence)) {
    s += 0.9;
    reasons.push('结尾短句、画面具体');
  }
  if (/(没有|不见|不再是|不该|不是他|认不出|数不清|不见了|没了)/.test(tail.slice(-40))) { s += 1.2; reasons.push('结尾使用否定式异常'); }
  if (/(看见|发现|认出|想起|听见|说出|转过头|回头)/.test(tail)) {
    s += 1.4;
    reasons.push('结尾出现揭示动作');
    if (/(自己|你|他|她|死人|尸体)/.test(tail)) { s += 1.1; reasons.push('揭示对象反常'); }
  }
  if (/[：:]\s*[“「]?[^。！？]{4,}/.test(tail) || /[“「][^”」]{4,}[”」]/.test(tail)) { s += 1.2; reasons.push('结尾以台词揭示收束'); }
  if (names.some((n) => n && n.length >= 2 && tail.includes(n))) { s += 1.2; reasons.push('结尾出现具体人物'); }
  if (/^(就这样|于是|后来|最终|然后)/.test(tail.trim())) { s -= 1.5; reasons.push('结尾落入日常收束'); }
  if (/(从这一刻起|一切才刚刚开始|而这一切|他知道自己回不去了)/.test(lastSentence)) { s -= 1.2; reasons.push('结尾使用命定感旁白'); }
  if (countWords(tail) < 8) { s -= 1; reasons.push('结尾句过短，信息量不足'); }
  return { score: Math.max(0, Math.min(10, Number(s.toFixed(1)))), reasons };
}

/** 设定事实核对：从世界观/人物档案里抽出可核对的约束，扫描正文是否违反 */
export function factCheck(text = '', project = {}) {
  const issues = [];
  const world = project.world || {};
  const chars = project.characters || [];
  const rankOf = new Map();
  for (const c of chars) if (c && c.name && c.rank) rankOf.set(c.name, c.rank);

  // 1) 角色位阶硬事实：正文里把某人的位阶写错
  //    只看「位阶之前、距离最近的」角色名，避免把「沈砚是九品」误判成「顾十是九品」
  const rankRe = new RegExp(`([${CN_NUM}\\d]{1,3})[品级阶]`, 'g');
  let m;
  while ((m = rankRe.exec(text)) !== null) {
    const near = text.slice(Math.max(0, m.index - 24), m.index + 24);
    // 「九品以上」「只有七品」「前四品」这类在描述规则/旧职，不是把某人写成该位阶
    if (/(以上|以下|不止|只有|至少|最多|规定|不得高于|不得低于|前[一二三四五六七八九十\d]|[一二三四五六七八九十\d]品以)/.test(near)) continue;
    // 引号里的「九品」多半是台词在称呼别人，不能绑定到最近的人名
    const before = text.slice(0, m.index);
    const inQuote = (open, close) => before.lastIndexOf(open) > before.lastIndexOf(close);
    if (inQuote('「', '」') || inQuote('“', '”')) continue;
    let nearest = null;
    let bestPos = -1;
    for (const name of rankOf.keys()) {
      const pos = text.lastIndexOf(name, m.index);
      if (pos > bestPos && m.index - pos <= 30) { bestPos = pos; nearest = name; }
    }
    if (!nearest) continue;
    // 人名与位阶必须同句，跨句的不算「把他写成某品」
    if (/[。！？\n]/.test(text.slice(bestPos + nearest.length, m.index))) continue;
    const rank = rankOf.get(nearest);
    const expect = String(rank).replace(/[^0-9一二三四五六七八九十两百]/g, '');
    if (!expect || expect === m[1]) continue;
    issues.push({
      severity: 'high',
      type: '设定冲突',
      where: `正文第 ${Math.round((m.index / Math.max(text.length, 1)) * 100)}% 处`,
      quote: near.replace(/\n/g, ' '),
      rule: `${nearest}的位阶是「${rank}」`,
      fix: `把「${m[1]}品」改回「${rank}」，或明确写成伪装 / 误传。`,
    });
  }

  // 2) 世界观硬规则：抽取禁止性条款的关键词，检查「关键词共现 + 正向动作」
  const STOP = ['在', '的', '了', '即', '为', '是', '着', '过', '要', '会', '可', '以', '被', '把', '而', '且', '或', '与', '和', '也', '都', '就', '才'];
  const rules = [...(world.hardRules || [])];
  for (const ps of world.powerSystem || []) {
    if (ps?.bounds) rules.push(`${ps.name}做不到：${ps.bounds}`);
  }
  const seen = new Set();
  for (const rule of rules) {
    const clauseMatch = String(rule).match(/(?:禁止|不能|不可|无法|不得|做不到)([^，。；：]{2,24})/);
    if (!clauseMatch) continue;
    const clause = clauseMatch[1];
    const tokens = clause
      .replace(/[”"'「」（）()]/g, '')
      .split(/[^\u4e00-\u9fffA-Za-z0-9]+/)
      .filter(Boolean)
      .flatMap((seg) => {
        const push = [];
        const clean = seg.split('').filter((ch) => !STOP.includes(ch)).join('');
        if (clean.length >= 4) push.push(clean.slice(0, 2), clean.slice(2));
        else if (clean.length >= 2) push.push(clean);
        return push;
      })
      .filter((t) => t.length >= 2);
    const uniq = [...new Set(tokens)];
    if (uniq.length < 2) continue;
    // 找出所有 token 同时出现的段落（先做方位/近义归一，避免「雨里 vs 雨中」漏判）
    const norm = (str) => str.replace(/[里内]/g, '中').replace(/之下/g, '中').replace(/之中/g, '中');
    const paras = text.split(/\n+/);
    for (const p of paras) {
      const np = norm(p);
      if (!uniq.every((t) => np.includes(norm(t)))) continue;
      if (!/(点燃|使用|施展|催动|打开|进入|召唤|吞下|拔出|照|烧|点)/.test(p)) continue;
      const key = rule.slice(0, 12);
      if (seen.has(key)) continue;
      seen.add(key);
      // 如果同段已经写明代价，则不算硬伤，只提示「强化代价的可见度」
      const paid = /(代价|水泡|烫|烧伤|折寿|失忆|记忆|吐血|伤口|死|烧掉|弯不过来|疼)/.test(p);
      issues.push({
        severity: paid ? 'medium' : 'high',
        type: paid ? '规则代价（已支付）' : '规则越界',
        where: `正文段落「${p.slice(0, 12)}…」`,
        quote: p.slice(0, 80).replace(/\n/g, ' '),
        rule: String(rule),
        fix: paid
          ? '代价已写出，建议让代价在后续章节继续生效（不要一笔带过）。'
          : '按世界观规则改写：补上代价、改为失败的尝试，或明确这是规则例外并埋下解释。',
      });
      break;
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* 去 AI 味：规则层（真实生效，不是占位符）                              */
/* ------------------------------------------------------------------ */

const REPLACE_TABLE = [
  ['仿佛', ['像是', '好像是', '看上去像']],
  ['似乎', ['好像', '看上去', '像是']],
  ['不禁', ['忍不住', '没忍住', '一时']],
  ['顿时', ['一下子', '当场', '立马']],
  ['缓缓', ['慢慢', '一点一点', '不紧不慢']],
  ['微微', ['稍稍', '轻轻']],
  ['深深地', ['长长地', '重重地']],
  ['莫名的', ['说不清的', '没来由的']],
  ['一丝不易察觉的', ['一点', '极淡的']],
  ['一丝', ['一点', '些微']],
  ['一抹', ['一点', '一道']],
  ['心中一凛', ['心里一紧', '后背发凉']],
  ['心中暗道', ['心里嘀咕', '在心里骂了一句']],
  ['嘴角勾起', ['扯了下嘴角', '嘴角撇了撇']],
  ['瞳孔骤缩', ['瞳孔缩成一点', '眼睛猛地睁大']],
  ['空气仿佛凝固', ['屋里没人再出声', '连呼吸都轻了']],
  ['时间的流逝', ['时辰过去', '时间过去']],
  ['在这个世界上', ['这世上', '眼下这光景里']],
  ['命运的齿轮', ['事情开始转动', '事态往前走']],
  ['不置可否', ['没正面答', '含混地应了一声']],
  ['若有所思', ['像是琢磨什么', '半响没说话']],
  ['意味深长', ['话里有话', '把话说了一半']],
  ['淡淡地', ['平静地', '没什么起伏地']],
  ['总而言之', ['说到底', '反正']],
  ['与此同时', ['另一边', '这时候']],
  ['此外', ['还有', '另外']],
  ['然而', ['可', '但']],
  ['值得一提的是', ['还有一件事', '顺带说一句']],
  ['毫无疑问', ['明摆着', '不用问']],
  ['这一夜注定无眠', ['这一夜谁都没睡好', '这一夜灯没灭']],
  ['一切才刚刚开始', ['后面还有得折腾', '麻烦才刚露头']],
  ['而他不知道的是', ['他不知道的是', '他没料到的是']],
  ['从这一刻起', ['打这以后', '从那以后']],
];

const SUMMARY_END = /(\n*)[ \t]*(从这一刻起|从那天起|一切才刚刚开始|而这一切|他知道自己回不去了|他知道，?自己回不去了)[^。\n]*。/g;

/** 规则化改写：去口头禅、拆长句、砍总结句、压破折号 */
export function humanize(text = '', opts = {}) {
  let out = text.replace(/\r/g, '');
  const replacements = [];
  const bump = (from, to, count) => {
    const hit = replacements.find((r) => r.from === from && r.to === to);
    if (hit) hit.count += count;
    else if (count > 0) replacements.push({ from, to, count });
  };

  // 1) 先砍掉段末命定感旁白（先做，否则会被同义词替换掉而漏网）
  out = out.replace(SUMMARY_END, (m, lead) => { bump('段末命定感旁白', '（删除）', 1); return lead; });

  // 2) 高频词替换（轮换同义词，避免二次套路）
  for (const [from, alts] of REPLACE_TABLE) {
    let i = 0;
    out = out.split(from).map((seg, idx, arr) => {
      if (idx === arr.length - 1) return seg;
      const to = alts[i % alts.length];
      i++;
      bump(from, to, 1);
      return seg + to;
    }).join('');
  }

  // 3) 拆长句：>52 字的句子在中间逗号处断开
  const sentences = out.split(/(?<=[。！？…])/);
  const rebuilt = sentences.map((s) => {
    const plain = s.trim();
    if (countWords(plain) < 52) return s;
    const idxs = [];
    for (let i = 0; i < plain.length; i++) if ('，；'.includes(plain[i])) idxs.push(i);
    if (!idxs.length) return s;
    const mid = idxs[Math.floor(idxs.length / 2)];
    bump('长句（>52字）', '断句', 1);
    return plain.slice(0, mid) + '。' + plain.slice(mid + 1);
  }).join('');
  out = rebuilt;

  // 4) 破折号限流
  let dash = 0;
  out = out.replace(/——/g, () => (++dash > 2 ? '，' : '——'));
  if (dash > 2) bump('破折号', '逗号', dash - 2);

  // 5) 规整空行
  out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();

  replacements.sort((a, b) => b.count - a.count);
  return { text: out, replacements: replacements.slice(0, 24) };
}

/* ------------------------------------------------------------------ */
/* 查重：字符 n-gram 余弦相似度（本地、确定性）                         */
/* ------------------------------------------------------------------ */

function grams(text = '', n = 2) {
  const clean = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
  const m = new Map();
  for (let i = 0; i < clean.length - n + 1; i++) {
    const g = clean.slice(i, i + n);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

export function similarity(a = '', b = '') {
  const ga = grams(a), gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let dot = 0;
  for (const [g, v] of ga) {
    const w = gb.get(g);
    if (w) dot += v * w;
  }
  const na = Math.sqrt([...ga.values()].reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt([...gb.values()].reduce((s, v) => s + v * v, 0));
  return Number((dot / (na * nb)).toFixed(3));
}

/** 把中文大数字（品阶等）转成阿拉伯数字，便于核对 */
export function cnNumToInt(s = '') {
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return map[s] ?? null;
  if (s === '十') return 10;
  if (s[0] === '十') return 10 + (map[s[1]] || 0);
  if (s[1] === '十') return (map[s[0]] || 0) * 10 + (map[s[2]] || 0);
  return null;
}
