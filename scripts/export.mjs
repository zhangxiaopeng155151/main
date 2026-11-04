/**
 * 命令行导出：node scripts/export.mjs [项目ID] [md|txt|json]
 * 输出到 exports/ 目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listProjects, loadProject } from '../server/store.js';
import { buildMarkdown, buildTxt } from '../server/pipeline.js';

const args = process.argv.slice(2);
let id = args[0];
const format = (args[1] || 'md').toLowerCase();
if (!id || id.startsWith('-')) id = listProjects()[0]?.id;
const project = id ? loadProject(id) : null;
if (!project) {
  console.error('找不到项目。先运行 npm start 或 node scripts/seed.mjs');
  process.exit(1);
}

const dir = path.join(ROOT, 'exports');
fs.mkdirSync(dir, { recursive: true });
const safe = (project.name || 'novel').replace(/[\\/:*?"<>|]/g, '_');
const file = path.join(dir, `${safe}.${format === 'json' ? 'json' : format === 'txt' ? 'txt' : 'md'}`);

if (format === 'json') fs.writeFileSync(file, JSON.stringify(project, null, 2));
else if (format === 'txt') fs.writeFileSync(file, buildTxt(project));
else fs.writeFileSync(file, buildMarkdown(project));

const words = (project.chapters || []).reduce((s, c) => s + (c.metrics?.words || 0), 0);
console.log(`已导出：${file}`);
console.log(`  ${(project.chapters || []).filter((c) => c.status === 'done').length} 章定稿 / ${words} 字`);
