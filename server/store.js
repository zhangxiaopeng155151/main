import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
export const PROJECTS = path.join(DATA, 'projects');
export const CORPUS = path.join(DATA, 'corpus');
export const BUILTIN_CORPUS = path.join(ROOT, 'corpus');
export const SETTINGS_FILE = path.join(DATA, 'settings.json');

for (const dir of [DATA, PROJECTS, CORPUS]) fs.mkdirSync(dir, { recursive: true });

const locks = new Map();

export function withProjectLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

export function newId(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

/* ----------------------------- settings ----------------------------- */

const DEFAULT_SETTINGS = {
  provider: 'mock',            // mock | openai | anthropic
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.85,
  maxTokens: 4096,
  reviewRounds: 2,             // 每章最多审稿-修订轮次
  minWords: 2000,              // 单章字数闸门
  maxAiScore: 4.5,             // 去AI味闸门
  compressEvery: 30,           // 每 N 章滚动压缩前情摘要
  autoMarketRefreshHours: 24,
  marketSources: [],
};

export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { /* 首次运行 */ }
  const env = {};
  if (process.env.LLM_PROVIDER) env.provider = process.env.LLM_PROVIDER;
  if (process.env.OPENAI_API_KEY) { env.apiKey = process.env.OPENAI_API_KEY; env.provider = env.provider || 'openai'; }
  if (process.env.OPENAI_BASE_URL) env.baseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_MODEL) env.model = process.env.OPENAI_MODEL;
  if (process.env.ANTHROPIC_API_KEY) { env.apiKey = process.env.ANTHROPIC_API_KEY; env.provider = env.provider || 'anthropic'; }
  if (process.env.ANTHROPIC_MODEL) env.model = process.env.ANTHROPIC_MODEL;
  return { ...DEFAULT_SETTINGS, ...saved, ...env };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function publicSettings() {
  const s = getSettings();
  return { ...s, apiKey: s.apiKey ? '已配置（' + s.apiKey.slice(0, 3) + '…）' : '' , hasKey: Boolean(s.apiKey) };
}

/* ----------------------------- projects ----------------------------- */

export function listProjects() {
  return fs.readdirSync(PROJECTS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(PROJECTS, f), 'utf8'));
        return {
          id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt,
          genre: p.brief?.genre, chapters: p.chapters?.length || 0,
          words: (p.chapters || []).reduce((s, c) => s + (c.metrics?.words || 0), 0),
          stage: p.stageCursor?.stage, done: p.stageCursor?.done,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function projectFile(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('非法项目 ID');
  return path.join(PROJECTS, `${id}.json`);
}

export function loadProject(id) {
  const file = projectFile(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  const file = projectFile(project.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, file);
  return project;
}

/* ------------------------------ corpus ------------------------------ */

export function loadCorpus() {
  const items = [];
  const read = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) { read(full); continue; }
      if (!/\.(json|md|txt)$/i.test(f)) continue;
      try {
        if (f.endsWith('.json')) {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          for (const it of Array.isArray(data) ? data : [data]) {
            items.push({ title: it.title || f, author: it.author || '参考库', tags: it.tags || [], text: it.text || it.premise || it.summary || '' });
          }
        } else {
          items.push({ title: f.replace(/\.(md|txt)$/i, ''), author: '参考库', tags: [], text: fs.readFileSync(full, 'utf8') });
        }
      } catch { /* 忽略坏文件 */ }
    }
  };
  read(BUILTIN_CORPUS);
  read(CORPUS);
  return items;
}

export function addCorpusItem(item) {
  const file = path.join(CORPUS, 'user-corpus.json');
  let list = [];
  if (fs.existsSync(file)) { try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { list = []; } }
  list.push({ ...item, addedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  return list.length;
}
