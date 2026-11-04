/**
 * 引擎自检：不依赖网络与 API Key，验证度量、闸门、查重、压缩的核心行为。
 *   node scripts/selftest.mjs
 */
import * as T from '../server/text.js';
import * as M from '../server/mock.js';
import { createProject, normalizeOutline, computePacing, measureChapter } from '../server/pipeline.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('\n[1] 中文计字');
ok('汉字计数不计标点', T.countWords('雨下得很大，灯还亮着。') === 9, `实际 ${T.countWords('雨下得很大，灯还亮着。')}`);
ok('中英混排（英文按词计）', T.countWords('灯的英文是 lamp') === 6, `实际 ${T.countWords('灯的英文是 lamp')}`);

console.log('\n[2] AI 味识别与去 AI 味');
const aiText = '他缓缓抬起头，眼中闪过一丝不易察觉的光。空气仿佛凝固了，他顿时觉得自己被什么东西盯上了。从这一刻起，他知道自己回不去了。';
const ai = T.aiFlavor(aiText);
const human = T.humanize(aiText);
ok('套话能被识别', ai.score >= 5, `score=${ai.score}`);
ok('改写后 AI 味下降', T.aiFlavor(human.text).score < ai.score, `${ai.score} → ${T.aiFlavor(human.text).score}`);
ok('命定旁白被删除', !human.text.includes('从这一刻起'));
ok('改写不过度删减（≤40%）', T.countWords(human.text) >= T.countWords(aiText) * 0.6, `${T.countWords(aiText)} → ${T.countWords(human.text)}`);

console.log('\n[3] 章节钩子');
const weak = '他把灯放回架子上，然后回去睡了。';
const strong = '灯芯里，妹妹的影子背对着他，慢慢转过了头。';
ok('日常收束判低分', T.hookScore(weak).score < 6, `score=${T.hookScore(weak).score}`);
ok('反常细节判高分', T.hookScore(strong).score >= 6, `score=${T.hookScore(strong).score} ${JSON.stringify(T.hookScore(strong).reasons)}`);

console.log('\n[4] 设定事实核对');
const project = createProject({ targetChapters: 12, wordsPerChapter: 2400, seedIdea: '长明灯与影子' });
project.world = M.mockWorld(project);
project.characters = M.mockCharacters().characters;
const badText = '在这条巷子里，沈砚是三品灯官，一句话能调走半条街的灯。\n\n雨还没停，他把灯举起，在雨里点燃了灯芯，火苗窜起来。';
const issues = T.factCheck(badText, project);
ok('位阶写错被抓出', issues.some((i) => i.type === '设定冲突'));
ok('雨中点火（无代价）被抓出', issues.some((i) => i.type === '规则越界'));
const paidText = '差役看了看沈砚，叫他「九品灯官」。\n\n他在雨里点燃了灯。代价是右手起了七个水泡，指头弯不过来。';
const issues2 = T.factCheck(paidText, project);
ok('代价已写出则降级为非硬伤', !issues2.some((i) => i.type === '规则越界' && i.severity === 'high'));
ok('位阶正确不误报', !issues2.some((i) => i.type === '设定冲突'));
const dialogueText = '「九品，」顾十扫了一眼，「九品不该来这儿。」\n\n沈砚没有反驳。';
ok('台词里提到的位阶不误报', !T.factCheck(dialogueText, project).some((i) => i.type === '设定冲突'));

console.log('\n[5] 查重');
const simHigh = T.similarity('灯官用影子替人挡死，代价是失去记忆', '灯官用影子替人挡死，代价是失去记忆');
const simLow = T.similarity('灯官用影子替人挡死，代价是失去记忆', '都市里两个程序员创业做外卖平台');
ok('相同文本相似度接近 1', simHigh > 0.95, String(simHigh));
ok('无关文本相似度低', simLow < 0.15, String(simLow));

console.log('\n[6] 节奏曲线报警');
const outline = M.buildOutline({ ...project, brief: { ...project.brief, targetChapters: 12 } });
project.outline = normalizeOutline(outline, project);
const pacing = computePacing(project);
ok('能算出平均密度', pacing.avg > 0);
ok('连续低密度会报警', pacing.alarms.some((a) => a.type === 'low-plateau'), pacing.alarms.map((a) => a.type).join(','));
const flat = normalizeOutline({ volumes: [{ no: 1, title: 'v', arcs: [{ no: 1, title: 'a', chapters: Array.from({ length: 8 }, (_, i) => ({ no: i + 1, title: `c${i}`, goal: 'g', obstacle: 'o', turn: 't', result: 'r', density: 1 })) }] }] }, project);
const p2 = computePacing({ ...project, outline: flat });
ok('全平台低密度会连续报警', p2.alarms.filter((a) => a.type === 'low-plateau').length >= 2);

console.log('\n[7] 正文生成与五道闸门');
const chText = M.mockChapterText(project, 1);
const m = measureChapter(project, chText, 1, { minWords: 2000, maxAiScore: 4.5, reviewRounds: 2 });
ok('初稿字数达标（≥2000）', m.words >= 2000, `${m.words}`);
ok('初稿 AI 味超标（需要去AI味）', m.aiScore > 4.5, `${m.aiScore}`);
ok('章节包含伏笔任务', m.foreshadow.ok || m.foreshadow.missed.length === 0, JSON.stringify(m.foreshadow.missed));
const humanized = T.humanize(T.humanize(chText).text).text;
ok('两轮规则改写后 AI 味达标', T.aiFlavor(humanized).score <= 4.5, `${T.aiFlavor(humanized).score}`);
ok('改写后字数仍达标', T.countWords(humanized) >= 2000, `${T.countWords(humanized)}`);

console.log('\n[8] 摘要压缩上限');
const summaries = Array.from({ length: 30 }, (_, i) => `第${i + 1}章：主角在影巷处理了一起灯灭事件，并留下了关于父亲灯芯的疑问。`);
const compressed = M.mockCompress(project, '', summaries, 1400);
ok('压缩结果不超过上限', compressed.length <= 1400, String(compressed.length));
ok('压缩保留了章节信息', compressed.includes('第30章'));

console.log(`\n结论：${pass} 项通过，${fail} 项失败\n`);
process.exit(fail ? 1 : 0);
