import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, DATA, getSettings, saveSettings, publicSettings, listProjects,
  loadProject, saveProject, saveProject as _save, withProjectLock, newId,
  loadCorpus, addCorpusItem,
} from './store.js';
import { providerInfo } from './llm.js';
import { listPrompts } from './prompts.js';
import {
  STAGES, createProject, runStep, buildMarkdown, buildTxt, computeStats,
  stageOverview, computePacing, autoFixPacing, selectTopic, refreshMarketNow,
  rerunPacing, addMarketInput, runCompressNow, needsRevision, measureChapter,
} from './pipeline.js';
import { countWords } from './text.js';

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const WEB = path.join(ROOT, 'web');

/* ------------------------------ 工具 ------------------------------ */

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

const TYPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(WEB, file);
  if (!full.startsWith(WEB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPE[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

/* --------------------------- 运行控制（暂停/停止） --------------------------- */

const stopFlags = new Set();
const running = new Map();

function view(project) {
  return {
    ...project,
    stats: computeStats(project),
    overview: stageOverview(project),
    settings: publicSettings(),
    provider: providerInfo(),
  };
}

/* ------------------------------ 运行 SSE ------------------------------ */

async function handleRun(req, res, id) {
  const body = await readBody(req);
  const mode = body.mode === 'auto' ? 'auto' : 'step';
  const maxSteps = Math.min(Number(body.steps) || (mode === 'auto' ? 400 : 1), 400);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* 客户端断开 */ } };
  send({ type: 'open', mode });

  if (running.has(id)) {
    send({ type: 'error', message: '该项目已有运行中的任务' });
    res.write('event: end\ndata: {}\n\n');
    return res.end();
  }
  running.set(id, true);
  stopFlags.delete(id);

  try {
    let project = loadProject(id);
    if (!project) throw new Error('项目不存在');
    let steps = 0;
    while (steps < maxSteps) {
      if (stopFlags.has(id)) { send({ type: 'stopped' }); break; }
      const fresh = loadProject(id);
      const plan = (await import('./pipeline.js')).nextAction(fresh);
      if (mode === 'auto' && plan.action === 'export' && fresh.export) break;
      let result;
      try {
        result = await withProjectLock(id, async () => {
          const p = loadProject(id);
          // 每步重新绑定 emit，保证日志实时推到前端
          const r = await runStep(p, { emit: send });
          saveProject(p);
          return r;
        });
      } catch (err) {
        send({ type: 'error', message: err.message });
        const p = loadProject(id);
        if (p) { saveProject(p); send({ type: 'project', project: view(p) }); }
        break;
      }
      steps += 1;
      const p = loadProject(id);
      send({ type: 'project', project: view(p), result });
      if (mode === 'step') break;
      if (result.action === 'export') break;
    }
    if (!stopFlags.has(id) && mode === 'auto') send({ type: 'finished', steps });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    running.delete(id);
    stopFlags.delete(id);
    send({ type: 'end' });
    res.end();
  }
}

/* ------------------------------ 路由 ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    /* ------------ meta ------------ */
    if (pathname === '/api/meta' && method === 'GET') {
      let skill = '';
      try { skill = fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md'), 'utf8'); } catch { /* 可选 */ }
      return json(res, 200, {
        stages: STAGES,
        prompts: listPrompts(),
        settings: publicSettings(),
        provider: providerInfo(),
        projects: listProjects(),
        corpusCount: loadCorpus().length,
        skill,
        dataDir: DATA,
      });
    }

    if (pathname === '/api/settings' && method === 'GET') return json(res, 200, publicSettings());
    if (pathname === '/api/settings' && method === 'POST') {
      const patch = await readBody(req);
      if (patch.apiKey === '') delete patch.apiKey;
      const next = saveSettings(patch);
      return json(res, 200, { ...publicSettings(), ok: true });
    }

    /* ------------ projects ------------ */
    if (pathname === '/api/projects' && method === 'GET') return json(res, 200, listProjects());
    if (pathname === '/api/projects' && method === 'POST') {
      const body = await readBody(req);
      const project = createProject(body);
      saveProject(project);
      return json(res, 200, { ok: true, project: view(project) });
    }

    const m = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (m) {
      const id = m[1];
      const sub = m[2] || '';
      const project = loadProject(id);
      if (!project) return json(res, 404, { error: '项目不存在' });

      if (sub === '' && method === 'GET') return json(res, 200, view(project));
      if (sub === '' && method === 'DELETE') {
        fs.rmSync(path.join(ROOT, 'data', 'projects', `${id}.json`), { force: true });
        return json(res, 200, { ok: true });
      }
      if (sub === '' && method === 'PATCH') {
        const patch = await readBody(req);
        Object.assign(project, patch);
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/run' && method === 'POST') return handleRun(req, res, id);
      if (sub === '/stop' && method === 'POST') { stopFlags.add(id); return json(res, 200, { ok: true }); }

      if (sub === '/select-topic' && method === 'POST') {
        const { topicId } = await readBody(req);
        await selectTopic(project, topicId);
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/pacing/fix' && method === 'POST') {
        const out = await autoFixPacing(project, () => {});
        saveProject(project);
        return json(res, 200, { ...out, project: view(project) });
      }
      if (sub === '/pacing/rerun' && method === 'POST') {
        await rerunPacing(project, {});
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/market/refresh' && method === 'POST') {
        await refreshMarketNow(project, {});
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/market/input' && method === 'POST') {
        const item = await readBody(req);
        await addMarketInput(project, item);
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/force-dedup' && method === 'POST') {
        project.forceDedup = Boolean((await readBody(req)).force !== false);
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/compress' && method === 'POST') {
        await runCompressNow(project, {});
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/rollback' && method === 'POST') {
        const { chapter, version } = await readBody(req);
        const ch = project.chapters.find((c) => c.no === Number(chapter));
        const v = ch?.versions?.[Number(version) - 1];
        if (!v) return json(res, 400, { error: '版本不存在' });
        ch.current = v.text;
        ch.status = 'drafted';
        ch.review = null;
        ch.deaiApplied = false;
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/retitle' && method === 'POST') {
        const { chapter, title } = await readBody(req);
        const ch = project.chapters.find((c) => c.no === Number(chapter));
        if (ch) ch.title = title;
        saveProject(project);
        return json(res, 200, view(project));
      }
      if (sub === '/measure' && method === 'POST') {
        const { chapter } = await readBody(req);
        const ch = project.chapters.find((c) => c.no === Number(chapter));
        if (!ch) return json(res, 404, { error: '章节不存在' });
        return json(res, 200, measureChapter(project, ch.current, ch.no));
      }
      if (sub.startsWith('/export')) {
        const format = url.searchParams.get('format') || 'md';
        const name = (project.name || 'novel').replace(/[\\/:*?"<>|]/g, '_');
        if (format === 'txt') {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.txt"` });
          return res.end(buildTxt(project));
        }
        if (format === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.json"` });
          return res.end(JSON.stringify(project, null, 2));
        }
        const md = buildMarkdown(project);
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        return res.end(md);
      }
    }

    /* ------------ corpus ------------ */
    if (pathname === '/api/corpus' && method === 'GET') return json(res, 200, loadCorpus());
    if (pathname === '/api/corpus' && method === 'POST') {
      const item = await readBody(req);
      const total = addCorpusItem(item);
      return json(res, 200, { ok: true, total });
    }

    /* ------------ 静态资源 ------------ */
    if (pathname.startsWith('/api/')) return json(res, 404, { error: '未知接口' });
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[api]', err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

/* ------------------------------ 启动 ------------------------------ */

async function ensureDemoProject() {
  const list = listProjects();
  if (list.length) return;
  console.log('[seed] 首次启动，正在生成演示项目（离线演示引擎）…');
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed.mjs')], { stdio: 'inherit', timeout: 120_000 });
  } catch (e) {
    console.error('[seed] 演示项目初始化失败（不影响使用，可在界面手动创建）：', e.message);
  }
}

await ensureDemoProject();

server.listen(PORT, HOST, () => {
  console.log(`墨脉 InkFlow 已启动： http://localhost:${PORT}`);
  console.log(`数据目录： ${DATA}`);
  console.log(`模型模式： ${providerInfo().mode}（${providerInfo().model}）`);
});
