/**
 * 市场热度定时刷新（可挂 cron / systemd timer / 计划任务）
 *
 *   node scripts/market-refresh.mjs                 # 刷新所有「超过自动刷新间隔」的项目
 *   node scripts/market-refresh.mjs --force         # 强制刷新全部
 ∗   node scripts/market-refresh.mjs --id nov_xxx    # 只刷一个项目
 *   node scripts/market-refresh.mjs --sources feed.json  # 追加外部素材（JSON 数组）
 *
 * 外部素材格式：[{"title":"平台榜单观察","url":"https://...","note":"…原文摘录或摘要…"}]
 * 在 Arena 里可以让 agent 用 WebSearch 抓取后 POST 到 /api/projects/:id/market/input，
 * 也可以写进 json 文件后由本脚本导入。
 */
import fs from 'node:fs';
import { loadProject, saveProject, listProjects, getSettings, withProjectLock } from '../server/store.js';
import { refreshMarketNow, addMarketInput } from '../server/pipeline.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const sourcesArg = args.includes('--sources') ? args[args.indexOf('--sources') + 1] : null;
const cfg = getSettings();
const hours = Number(cfg.autoMarketRefreshHours) || 24;

const targets = idArg ? [loadProject(idArg)].filter(Boolean) : listProjects().map((p) => loadProject(p.id)).filter(Boolean);

if (!targets.length) {
  console.log('[market] 没有可刷新的项目');
  process.exit(0);
}

let imported = 0;
const sources = sourcesArg && fs.existsSync(sourcesArg) ? JSON.parse(fs.readFileSync(sourcesArg, 'utf8')) : [];

for (const target of targets) {
  const id = target.id;
  const age = target.market?.updatedAt ? (Date.now() - new Date(target.market.updatedAt).getTime()) / 3.6e6 : Infinity;
  if (!force && age < hours) {
    console.log(`[market] 跳过 ${target.name}（${age.toFixed(1)}h < ${hours}h）`);
    continue;
  }
  await withProjectLock(id, async () => {
    const p = loadProject(id);
    if (sources.length) {
      for (const s of sources) await addMarketInput(p, s);
      imported += sources.length;
    }
    await refreshMarketNow(p, { emit: (ev) => ev.type === 'log' && console.log('   ·', ev.message) });
    saveProject(p);
  });
  console.log(`[market] 已刷新 ${target.name}`);
}

console.log(`[market] 完成：${targets.length} 个项目，导入 ${imported} 条外部素材。`);
console.log('[market] 定时示例：0 */6 * * * cd /path/to/repo && node scripts/market-refresh.mjs');
