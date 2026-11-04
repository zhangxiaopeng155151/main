/**
 * 生成演示项目（离线可跑）：立项 → 市场 → 选题 → 查重 → 世界观 → 人物 → 大纲 → 节奏 → 伏笔 → 前两章全流程。
 * 用法：node scripts/seed.mjs [--chapters N] [--reset]（默认跑满全书，停在导出前）
 */
import { loadProject, saveProject, listProjects, getSettings, projectFile, withProjectLock } from '../server/store.js';
import { createProject, runStep, flatChapters } from '../server/pipeline.js';
import { countWords } from '../server/text.js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const chaptersArg = args.includes('--chapters') ? Number(args[args.indexOf('--chapters') + 1]) : null;
const reset = args.includes('--reset');

if (reset) {
  for (const p of listProjects()) fs.rmSync(projectFile(p.id), { force: true });
  console.log('[seed] 已清空旧项目');
}

const existing = listProjects().find((p) => p.name?.includes('照影') || p.name?.includes('长明灯'));
let project;

if (existing) {
  project = loadProject(existing.id);
  console.log(`[seed] 复用项目：${project.name}（${project.id}）`);
} else {
  project = createProject({
    name: '《照影》· 长明灯与影子',
    genre: '东方玄幻',
    subgenre: '官署怪谈 / 规则流',
    audience: '男频 25-35，喜欢规则流、市井细节与道德困境',
    targetChapters: 12,
    wordsPerChapter: 2400,
    pov: '第三人称限知',
    styleTags: ['冷峻', '市井质感', '少形容词', '对话带潜台词'],
    tone: '压抑中带一点暖',
    taboos: ['不写无代价的金手指', '不写降智反派', '不写“他不知道的是”式旁白'],
    mustHaves: ['每章一个可验证的规则细节', '每章末留一个具体的信息缺口'],
    seedIdea: '长明灯与影子：灯照见的影子里藏着一个人的死期',
  });
  saveProject(project);
  console.log(`[seed] 创建项目：${project.name}`);
}

const emit = (ev) => {
  if (ev.type === 'log') console.log('   ·', ev.message);
};

const targetChapters = chaptersArg || Number(loadProject(project.id).brief?.targetChapters || 12);
let steps = 0;
const maxSteps = 200;
while (steps < maxSteps) {
  const fresh = loadProject(project.id);
  const done = (fresh.chapters || []).filter((c) => c.status === 'done').length;
  if (done >= targetChapters) break;
  if (fresh.export) break;
  if (steps > 180) break;
  try {
    await withProjectLock(project.id, async () => {
      const p = loadProject(project.id);
      await runStep(p, { emit });
      saveProject(p);
    });
  } catch (err) {
    console.error('[seed] 中断：', err.message);
    break;
  }
  steps += 1;
}

const p = loadProject(project.id);
const outline = flatChapters(p.outline);
console.log('');
console.log(`[seed] 完成：${p.name}`);
console.log(`  · 大纲 ${outline.length} 章；已定稿 ${(p.chapters || []).filter((c) => c.status === 'done').length} 章`);
console.log(`  · 已写字数 ${(p.chapters || []).reduce((s, c) => s + countWords(c.current || ''), 0)} 字`);
console.log(`  · 项目 ID：${p.id}（打开 http://localhost:5173 查看）`);
console.log(`  · 模型模式：${getSettings().provider}${getSettings().provider === 'mock' ? '（离线演示引擎，可在界面切换到真实模型）' : ''}`);
