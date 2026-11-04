import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';

const DIR = path.join(ROOT, 'skill', 'prompts');
const cache = new Map();

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body };
}

export function loadPrompt(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(DIR, `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`提示词不存在：${name}`);
  const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  cache.set(name, parsed);
  return parsed;
}

export function listPrompts() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const name = f.replace(/\.md$/, '');
    const { meta } = loadPrompt(name);
    return { name, title: meta.title || name, stage: meta.stage || '', output: meta.output || 'text', temperature: meta.temperature };
  });
}

/** 渲染提示词：{{VAR}} 占位符；对象自动 JSON 化并按预算截断 */
export function renderPrompt(name, vars = {}, { budget = 24000 } = {}) {
  const { body, meta } = loadPrompt(name);
  let prompt = body.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 1); } catch { return String(v); }
  });
  if (prompt.length > budget) prompt = prompt.slice(0, budget) + '\n\n（输入过长，已截断）';
  return {
    prompt,
    meta: {
      ...meta,
      temperature: meta.temperature ? Number(meta.temperature) : undefined,
    },
  };
}

export function systemFor(stage = '') {
  return `你是「墨脉 InkFlow」长篇小说创作工作流中的专业角色（当前环节：${stage || '通用'}）。
你必须严格遵守三点：
1) 只输出任务要求的格式（JSON 或纯正文），不要寒暄、不要解释、不要 markdown 代码块之外的包装。
2) 所有设定必须与给定输入一致，不得自行发明与世界观冲突的能力、人物或名词。
3) 中文写作使用简体，避免网络用语与翻译腔。`;
}
