/* 墨脉 InkFlow —— 前端（零依赖，原生 ESM） */

const S = {
  meta: null,
  projects: [],
  project: null,
  tab: 'flow',
  stageId: null,
  running: false,
  logs: [],
  drawerOpen: false,
  rightCollapsed: false,
  leftCollapsed: false,
  focusChapter: null,
  modal: null,
  busy: false,
  renderQueued: false,
};

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const time = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const wordCount = (t = '') => (t.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length + (t.match(/[A-Za-z0-9]+/g) || []).length;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(4px)'; el.style.transition = '.2s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

function setStatus(msg) {
  const el = $('#run-status');
  if (el) el.textContent = msg;
}

/* =============================== 初始化 =============================== */

async function init() {
  try {
    const meta = await api('/api/meta');
    S.meta = meta;
    S.projects = meta.projects || [];
    let id = localStorage.getItem('inkflow.project');
    if (!id || !S.projects.some((p) => p.id === id)) id = S.projects[0]?.id || null;
    if (id) {
      S.project = await api(`/api/projects/${id}`);
      localStorage.setItem('inkflow.project', id);
    }
    S.rightCollapsed = localStorage.getItem('inkflow.rightCollapsed') === '1';
    S.drawerOpen = localStorage.getItem('inkflow.drawerOpen') === '1';
    S.tab = localStorage.getItem('inkflow.tab') || 'flow';
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'err');
  }
  render();
}

/* =============================== 渲染入口 =============================== */

function scheduleRender() {
  if (S.renderQueued) return;
  S.renderQueued = true;
  requestAnimationFrame(() => {
    S.renderQueued = false;
    const scrolls = [...document.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop]);
    const drawer = $('.drawer-body');
    const drawerScroll = drawer ? drawer.scrollTop : 0;
    render();
    for (const [key, top] of scrolls) {
      const el = document.querySelector(`[data-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
    const d2 = $('.drawer-body');
    if (d2) d2.scrollTop = drawerOpenAtBottom ? d2.scrollHeight : drawerScroll;
  });
}
let drawerOpenAtBottom = true;

function render() {
  const ws = $('#workspace');
  if (ws) {
    ws.className = 'workspace'
      + (S.rightCollapsed ? ' right-collapsed' : '')
      + (S.leftCollapsed ? ' left-collapsed' : '');
  }
  renderTopbar();
  renderLeft();
  renderRight();
  renderDrawer();
  renderModal();
}

/* =============================== 顶栏 =============================== */

function renderTopbar() {
  const p = S.project;
  const provider = S.meta?.provider;
  $('#topbar').innerHTML = `
    <div class="brand">
      <span class="mark">墨</span>
      <div>
        <h1>墨脉 <span style="font-family:var(--sans);font-size:11px;color:#a09788;letter-spacing:.16em;margin-left:4px">INKFLOW</span></h1>
        <div class="sub">长篇小说创作工作流</div>
      </div>
    </div>
    <div class="project-picker">
      <select id="project-select" title="切换项目">
        ${S.projects.length
          ? S.projects.map((x) => `<option value="${esc(x.id)}" ${p && x.id === p.id ? 'selected' : ''}>${esc(x.name)} · ${x.done ?? x.chapters ?? 0}章</option>`).join('')
          : '<option value="">（暂无项目）</option>'}
      </select>
    </div>
    <button class="btn sm dark" data-act="new-project">＋ 新建</button>
    <div class="spacer"></div>
    <span id="run-status" class="tiny" style="color:#a09788;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      ${S.running ? '运行中…' : provider ? `${provider.mode} · ${esc(provider.model)}` : ''}
    </span>
    <button class="btn sm primary" data-act="run-auto" ${!p || S.running ? 'disabled' : ''}>▶ 自动连跑</button>
    <button class="btn sm" data-act="run-step" ${!p || S.running ? 'disabled' : ''}>下一步</button>
    <button class="btn sm" data-act="stop" ${!S.running ? 'disabled' : ''}>■ 暂停</button>
    <button class="btn sm dark" data-act="settings">⚙ 设置</button>
  `;
  $('#project-select').onchange = (e) => openProject(e.target.value);
}

async function openProject(id) {
  if (!id) return;
  try {
    S.project = await api(`/api/projects/${id}`);
    localStorage.setItem('inkflow.project', id);
    S.stageId = null;
    S.focusChapter = null;
    render();
  } catch (err) { toast(err.message, 'err'); }
}

/* =============================== 左侧 =============================== */

function renderLeft() {
  const left = $('#left');
  left.innerHTML = `${projectHead()}${tabs()}${paneBody()}`;
}

function projectHead() {
  const p = S.project;
  const target = Number(p?.brief?.targetChapters || 12);
  const done = (p?.chapters || []).filter((c) => c.status === 'done').length;
  const drafted = (p?.chapters || []).filter((c) => c.current && c.status !== 'done').length;
  const stats = p?.stats || {};
  if (!p) {
    return `<div class="proj-head">
      <div class="proj-title">还没有项目</div>
      <div class="proj-meta">点击「＋ 新建」从立项开始，或运行 <span class="kbd">npm run seed</span> 生成演示项目</div>
      <div class="run-bar"><button class="btn primary" data-act="new-project">＋ 新建创作项目</button></div>
    </div>`;
  }
  return `<div class="proj-head">
    <div class="row">
      <div class="grow">
        <div class="proj-title">${esc(p.name)}</div>
        <div class="proj-meta">
          <span>${esc(p.brief?.genre || '')} · ${esc(p.brief?.subgenre || '')}</span>
          <span>${target} 章 × ${fmt(p.brief?.wordsPerChapter)} 字</span>
          <span>${esc(p.brief?.pov || '')}</span>
        </div>
      </div>
      <button class="btn sm ghost" data-act="toggle-left" title="收起左侧">‹</button>
    </div>
    <div class="progress">
      <div class="bar">
        <i style="width:${clamp((done / target) * 100)}%"></i>
        <i class="draft" style="width:${clamp((drafted / target) * 100)}%"></i>
      </div>
      <div class="labels">
        <span>定稿 ${done}/${target} 章 · ${fmt(stats.words)} 字</span>
        <span>${stats.avgScore ? `三审均分 ${stats.avgScore}` : ''}${stats.avgAi !== null && stats.avgAi !== undefined ? ` · AI味 ${stats.avgAi}` : ''}</span>
      </div>
    </div>
    <div class="run-bar">
      <button class="btn sm primary" data-act="run-step" ${S.running ? 'disabled' : ''}>▶ 运行下一步</button>
      <button class="btn sm" data-act="run-auto" ${S.running ? 'disabled' : ''}>自动连跑</button>
      <button class="btn sm" data-act="toggle-right">${S.rightCollapsed ? '展开正文' : '收起正文'}</button>
      <a class="btn sm" href="/api/projects/${p.id}/export?format=md" download>导出 MD</a>
    </div>
  </div>`;
}

const TABS = [
  ['flow', '流程'],
  ['world', '世界观'],
  ['characters', '人物'],
  ['outline', '大纲'],
  ['quality', '质量'],
  ['skill', '说明'],
];

function tabs() {
  return `<div class="tabs">
    ${TABS.map(([id, label]) => `<button class="tab ${S.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}">${label}</button>`).join('')}
  </div>`;
}

function paneBody() {
  if (!S.project) return `<div class="pane-body"><div class="empty">尚无数据</div></div>`;
  const map = { flow: flowTab, world: worldTab, characters: charactersTab, outline: outlineTab, quality: qualityTab, skill: skillTab };
  return `<div class="pane-body" data-scroll="left">${(map[S.tab] || flowTab)()}</div>`;
}

/* ------------------------------ 流程 tab ------------------------------ */

function flowTab() {
  const p = S.project;
  const overview = p.overview || [];
  return `
    <div class="section-title">创作流水线 <span class="tiny muted">共 ${overview.length} 环节 · 当前第 ${(overview.find((s) => s.status === 'active')?.no) || '—'} </span></div>
    <div class="stepper">
      ${overview.map(stageItem).join('')}
    </div>
    ${S.stageId ? stageDetail() : ''}
    <div class="card tight">
      <h3>产物速览 <span class="hint">左侧可直接查看完整内容</span></h3>
      <div class="row wrap">
        <button class="btn sm" data-act="tab" data-tab="world">世界观 ${p.world ? '✓' : '·'}</button>
        <button class="btn sm" data-act="tab" data-tab="characters">人物 ${p.characters?.length || 0}</button>
        <button class="btn sm" data-act="tab" data-tab="outline">大纲 ${(p.outline?.volumes || []).reduce((n, v) => n + (v.arcs || []).reduce((m, a) => m + (a.chapters || []).length, 0), 0)} 章</button>
        <button class="btn sm" data-act="tab" data-tab="quality">质量看板</button>
      </div>
    </div>
    ${marketCard()}
    ${topicCards()}
    ${dedupCard()}
  `;
}

function stageSummary(s) {
  const p = S.project;
  switch (s.id) {
    case 'brief': return `${p.brief?.targetChapters} 章 × ${fmt(p.brief?.wordsPerChapter)} 字 · ${p.brief?.genre}`;
    case 'market': return p.market ? `${p.market.items?.length || 0} 个细分 · 更新 ${time(p.market.updatedAt)}` : '待运行';
    case 'topic': {
      const t = (p.topics || []).find((x) => x.id === p.selectedTopicId) || p.topics?.[0];
      return t ? `《${t.title}》 ${t.total} 分 · 共 ${p.topics.length} 个候选` : '待运行';
    }
    case 'dedup': return p.dedup ? `${p.dedup.verdict} · 安全分 ${p.dedup.score}` : '待运行';
    case 'world': return p.world ? `${p.world.hardRules?.length || 0} 条硬规则 · ${p.world.glossary?.length || 0} 个术语` : '待运行';
    case 'characters': return p.characters?.length ? `${p.characters.length} 人 · ${p.relationEdges?.length || 0} 条关系` : '待运行';
    case 'outline': return p.outline ? `${p.outline.volumes?.length || 0} 卷 · ${(p.outline.volumes || []).reduce((n, v) => n + (v.arcs || []).reduce((m, a) => m + (a.chapters || []).length, 0), 0)} 章` : '待运行';
    case 'pacing': return p.pacing ? `平均密度 ${p.pacing.avg} · ${p.pacing.alarms?.length || 0} 个报警` : '待运行';
    case 'foreshadow': return p.foreshadow ? `${p.foreshadow.ledger?.length || 0} 条伏笔 · ${p.foreshadow.hooks?.length || 0} 个钩子` : '待运行';
    case 'draft': return `当前第 ${p.chapterCursor || 1} 章`;
    case 'review': {
      const ch = (p.chapters || []).find((c) => c.no === (p.chapterCursor || 1));
      return ch?.review ? `三审 ${ch.review.score} 分 · ${ch.review.verdict}` : '每章写完即审';
    }
    case 'revise': {
      const ch = (p.chapters || []).find((c) => c.no === (p.chapterCursor || 1));
      return ch ? `已修订 ${ch.rounds || 0} 轮` : '按审稿意见自动修订';
    }
    case 'deai': {
      const ch = (p.chapters || []).find((c) => c.no === (p.chapterCursor || 1));
      return ch?.deai ? `AI味 ${ch.deai.before.aiScore} → ${ch.deai.after.aiScore}` : '规则层 + 模型改写';
    }
    case 'summary': {
      const done = (p.chapters || []).filter((c) => c.status === 'done').length;
      return `${done} 章摘要已入库`;
    }
    case 'compress': return p.summaries?.rolling ? `覆盖 1-${p.summaries.coveredUpTo} 章 · ${p.summaries.rolling.length} 字` : `每 ${p.settings?.compressEvery || 30} 章触发`;
    case 'export': return p.export ? `${p.export.chapters} 章 · ${fmt(p.export.chars)} 字` : '待导出';
    default: return '';
  }
}

function stageItem(s) {
  const cls = s.status === 'active' ? 'active' : s.status === 'done' ? 'done' : s.status === 'warn' ? 'warn' : '';
  const tagCls = s.status === 'active' ? 'active' : s.status === 'done' ? 'done' : s.status === 'warn' ? 'warn' : '';
  const tagText = { active: '进行中', done: '已完成', warn: '待处理', pending: '未开始' }[s.status] || '';
  return `<div class="stage ${cls}" data-act="stage" data-stage="${s.id}">
    <div class="idx">${s.no}</div>
    <div class="body">
      <div class="name">${esc(s.title)} ${s.perChapter ? '<span class="tag">章循环</span>' : ''}</div>
      <div class="desc">${esc(stageSummary(s))}</div>
    </div>
    <div class="side"><span class="tag ${tagCls}">${tagText}</span></div>
  </div>`;
}

function stageDetail() {
  const p = S.project;
  const s = (S.meta?.stages || []).find((x) => x.id === S.stageId);
  if (!s) return '';
  const extra = [];
  if (s.id === 'market') extra.push(`<button class="btn sm" data-act="refresh-market">↻ 刷新市场数据</button><button class="btn sm" data-act="add-market">＋ 导入素材</button>`);
  if (s.id === 'pacing') {
    extra.push(`<button class="btn sm" data-act="pacing-fix">一键调律</button><button class="btn sm" data-act="rerun-pacing">↻ 重算曲线</button>`);
    if (p.pacing?.alarms?.length) extra.push(`<span class="pill bad">${p.pacing.alarms.length} 个报警</span>`);
  }
  if (s.id === 'dedup') {
    extra.push(`<span class="pill ${p.dedup?.verdict === 'safe' ? 'ok' : p.dedup?.verdict === 'duplicate' ? 'bad' : 'warn'}">${esc(p.dedup?.verdict || '')}</span>`);
    if (p.dedup?.verdict === 'duplicate' && !p.forceDedup) extra.push(`<button class="btn sm danger" data-act="force-dedup">接受风险继续</button>`);
  }
  if (s.id === 'topic') extra.push(`<button class="btn sm" data-act="tab" data-tab="flow">↓ 查看候选</button>`);
  if (['world', 'characters', 'outline'].includes(s.id)) extra.push(`<button class="btn sm" data-act="tab" data-tab="${s.id}">查看完整产物</button>`);
  if (s.id === 'compress') extra.push(`<button class="btn sm" data-act="compress">立即压缩</button>`);
  if (s.id === 'export') extra.push(`<a class="btn sm" href="/api/projects/${p.id}/export?format=md" download>下载 Markdown</a><a class="btn sm" href="/api/projects/${p.id}/export?format=txt" download>下载 TXT</a>`);
  return `<div class="stage-detail">
    <h4>${s.no}. ${esc(s.title)} <button class="btn sm ghost" data-act="stage" data-stage="${s.id}">收起</button></h4>
    <dl class="kv">
      <dt>输入</dt><dd>${esc(s.input)}</dd>
      <dt>输出</dt><dd>${esc(s.output)}</dd>
      <dt>衔接</dt><dd>${esc(s.handoff)}</dd>
      <dt>状态</dt><dd>${esc(stageSummary(s))}</dd>
    </dl>
    ${extra.length ? `<div class="row wrap" style="margin-top:10px">${extra.join('')}</div>` : ''}
    ${stageDetailExtra(s.id)}
  </div>`;
}

function stageDetailExtra(id) {
  const p = S.project;
  if (id === 'brief') {
    const b = p.brief || {};
    return `<div class="tiny muted" style="margin-top:8px;line-height:1.7">
      文风：${esc((b.styleTags || []).join('、'))}｜基调：${esc(b.tone)}<br>
      禁忌：${esc((b.taboos || []).join('；'))}<br>
      种子想法：${esc(b.seedIdea)}
    </div>`;
  }
  if (id === 'market' && p.market) {
    return `<div class="tiny" style="margin-top:8px;line-height:1.7;color:var(--ink-2)">${esc(p.market.insight)}</div>`;
  }
  if (id === 'pacing' && p.pacing?.alarms?.length) {
    return `<ul class="alarm-list">${p.pacing.alarms.slice(0, 4).map((a) => `<li class="${a.severity}"><b>${esc(a.type)}</b> · 第 ${(a.chapters || []).join('/')} 章<br><span class="muted">${esc(a.fix || a.why)}</span></li>`).join('')}</ul>`;
  }
  return '';
}

/* ------------------------------ 市场 / 选题 / 查重 ------------------------------ */

function marketCard() {
  const p = S.project;
  if (!p.market) return '';
  const m = p.market;
  return `<div class="card">
    <h3>市场热度雷达 <span class="hint">${esc(m.mode)} · ${time(m.updatedAt)}</span></h3>
    <div class="small" style="color:var(--ink-2);line-height:1.7;margin-bottom:8px">${esc(m.insight)}</div>
    <table class="mini">
      <thead><tr><th>细分</th><th class="num">热度</th><th>趋势</th><th>饱和度</th></tr></thead>
      <tbody>
        ${(m.items || []).map((i) => `<tr>
          <td>${esc(i.genre)}<div class="tiny muted">${esc(i.note)}</div></td>
          <td class="num"><span class="heat ${i.heat >= 78 ? 'h' : i.heat >= 65 ? 'm' : 'l'}">${i.heat}</span></td>
          <td class="tiny">${i.trend === 'rising' ? '↗ 上升' : i.trend === 'cooling' ? '↘ 降温' : '→ 平稳'}</td>
          <td class="tiny">${i.saturation === 'high' ? '高' : i.saturation === 'medium' ? '中' : '低'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${m.avoid?.length ? `<div class="tiny muted" style="margin-top:8px">避坑：${esc(m.avoid.join('；'))}</div>` : ''}
  </div>`;
}

function topicCards() {
  const p = S.project;
  if (!p.topics?.length) return '';
  return `<div class="card">
    <h3>候选选题 <span class="hint">点击「选它」可切换主线（会重置下游环节）</span></h3>
    ${p.topics.map((t) => `
      <div class="topic-card ${t.id === p.selectedTopicId ? 'selected' : ''}">
        <div class="spread">
          <h4>《${esc(t.title)}》 ${t.id === p.selectedTopicId ? '<span class="pill accent">当前主线</span>' : ''}</h4>
          <div class="row">
            <span class="score-ring">${t.total}</span>
            ${t.id === p.selectedTopicId ? '' : `<button class="btn sm" data-act="select-topic" data-topic="${esc(t.id)}">选它</button>`}
          </div>
        </div>
        <div class="logline">${esc(t.logline)}</div>
        <div class="score-bar" style="margin-top:7px"><span>热度</span><span class="track"><i style="width:${t.heat}%"></i></span><span>${t.heat}</span></div>
        <div class="score-bar"><span>创新</span><span class="track"><i style="width:${t.novelty}%"></i></span><span>${t.novelty}</span></div>
        <div class="score-bar"><span>风险</span><span class="track"><i style="width:${t.risk}%;background:var(--warn)"></i></span><span>${t.risk}</span></div>
        <div class="facts">
          <span class="pill">差异化：${esc(t.differentiation)}</span>
          <span class="pill">承诺：${esc(t.promise)}</span>
        </div>
        <details style="margin-top:7px"><summary class="tiny muted" style="cursor:pointer">执行风险与受众</summary>
          <div class="tiny" style="margin-top:5px;line-height:1.7">${esc(t.riskNote)}<br>受众：${esc(t.audience)}<br>核心冲突：${esc(t.coreConflict)}</div>
        </details>
      </div>`).join('')}
    ${p.topicRecommendation ? `<div class="tiny muted" style="margin-top:6px;line-height:1.7">推荐理由：${esc(p.topicRecommendation)}</div>` : ''}
  </div>`;
}

function dedupCard() {
  const p = S.project;
  if (!p.dedup) return '';
  const d = p.dedup;
  return `<div class="card">
    <h3>查重报告
      <span class="hint"><span class="pill ${d.verdict === 'safe' ? 'ok' : d.verdict === 'duplicate' ? 'bad' : 'warn'}">${esc(d.verdict)} · ${d.score} 分</span></span>
    </h3>
    ${(d.matches || []).length ? `<table class="mini">
      <thead><tr><th>参考作品 / 原型</th><th class="num">相似</th><th>重合维度</th></tr></thead>
      <tbody>${d.matches.map((m) => `<tr>
        <td>${esc(m.title)}<div class="tiny muted">${esc(m.detail)}</div></td>
        <td class="num">${Math.round((m.similarity || 0) * 100)}%</td>
        <td class="tiny">${esc((m.overlapFacets || []).join('、'))}<div class="tiny muted" style="margin-top:2px">${esc(m.suggestion)}</div></td>
      </tr>`).join('')}</tbody>
    </table>` : '<div class="empty">参考库为空：可把竞品简介放进 corpus/ 或 data/corpus/</div>'}
    ${d.mustChange?.length ? `<div class="tiny" style="margin-top:8px;color:var(--bad)">必须修改：${esc(d.mustChange.join('；'))}</div>` : ''}
    <div class="tiny muted" style="margin-top:5px">${esc(d.advice)}</div>
  </div>`;
}

/* ------------------------------ 世界观 tab ------------------------------ */

function worldTab() {
  const p = S.project;
  const w = p.world;
  if (!w) return `<div class="empty">世界观尚未生成。先运行到「世界观构建」环节。</div>`;
  return `
    <div class="section-title">世界观总览</div>
    <div class="card">
      <div class="small" style="line-height:1.8;color:var(--ink-2)"><b>一句话世界</b>：${esc(w.premise)}</div>
      <div class="tiny muted" style="margin-top:6px;line-height:1.7">${esc(w.era)}</div>
      ${w.society ? `<div class="tiny" style="margin-top:8px;line-height:1.8">${esc(w.society)}</div>` : ''}
    </div>

    <div class="card">
      <h3>可审核的硬规则 <span class="hint">逻辑审的对照基准</span></h3>
      <ol class="rule-list">${(w.hardRules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
    </div>

    ${(w.powerSystem || []).map((ps) => `<div class="card">
      <h3>力量体系 · ${esc(ps.name)} <span class="hint">单位：${esc(ps.unit)}</span></h3>
      <div class="power">
        <div class="tiers">${(ps.tiers || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <dl class="kv" style="grid-template-columns:46px 1fr">
          <dt>代价</dt><dd>${esc(ps.cost)}</dd>
          <dt>上限</dt><dd>${esc(ps.bounds)}</dd>
          <dt>例外</dt><dd>${esc(ps.exception)}</dd>
        </dl>
        <ul class="rule-list" style="margin-top:6px">${(ps.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>
    </div>`).join('')}

    ${(w.factions || []).length ? `<div class="card">
      <h3>阵营</h3>
      <table class="mini"><thead><tr><th>阵营</th><th>目标</th><th>软肋</th></tr></thead><tbody>
        ${w.factions.map((f) => `<tr><td><b>${esc(f.name)}</b><div class="tiny muted">${esc(f.relation || '')}</div></td><td class="tiny">${esc(f.goal)}<div class="tiny muted">资源：${esc(f.resource || '')}</div></td><td class="tiny">${esc(f.weakness)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}

    ${(w.geography || []).length ? `<div class="card">
      <h3>地理与场景</h3>
      ${w.geography.map((g) => `<div style="margin-bottom:7px"><b class="small">${esc(g.name)}</b> <span class="tiny muted">${esc(g.feature)}</span><div class="tiny" style="color:var(--bad)">危险：${esc(g.danger)}</div></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h3>术语表 <span class="hint">正文不得偏离定义</span></h3>
      <div>${(w.glossary || []).map((g) => `<span class="chip" title="${esc(g.def)}"><b>${esc(g.term)}</b> ${esc((g.def || '').slice(0, 16))}${(g.def || '').length > 16 ? '…' : ''}</span>`).join('')}</div>
    </div>

    <div class="grid-2">
      <div class="card tight"><h3>避讳</h3><div class="tiny" style="line-height:1.8">${(w.taboo || []).map(esc).join('<br>') || '—'}</div></div>
      <div class="card tight"><h3>留白问题</h3><div class="tiny" style="line-height:1.8">${(w.openQuestions || []).map(esc).join('<br>') || '—'}</div></div>
    </div>
  `;
}

/* ------------------------------ 人物 tab ------------------------------ */

function charactersTab() {
  const p = S.project;
  const chars = p.characters || [];
  if (!chars.length) return `<div class="empty">人物尚未生成。</div>`;
  return `
    <div class="section-title">人物档案 <span class="tiny muted">${chars.length} 人 · ${p.relationEdges?.length || 0} 条关系</span></div>
    ${p.characterNotes?.network ? `<div class="card tight small" style="line-height:1.75">${esc(p.characterNotes.network)}${p.characterNotes.pov ? `<div class="tiny muted" style="margin-top:4px">视角：${esc(p.characterNotes.pov)}</div>` : ''}</div>` : ''}
    ${chars.map((c) => `<div class="char-card">
      <div class="top"><span class="nm">${esc(c.name)}</span><span class="role">${esc(c.role)}</span><span class="tiny muted">${esc(c.age)} · ${esc(c.rank)}</span></div>
      <div class="one">${esc(c.oneLine)}</div>
      <dl>
        <dt>欲望</dt><dd>${esc(c.motivation)}</dd>
        <dt>障碍</dt><dd>${esc(c.obstacle)}</dd>
        <dt>错误信念</dt><dd>${esc(c.misbelief)}</dd>
        <dt>秘密</dt><dd>${esc(c.secret)}</dd>
        <dt>转折</dt><dd>${esc(c.turn)}</dd>
        <dt>弧光</dt><dd>${esc(c.arcStart)} → ${esc(c.arcEnd)}</dd>
        <dt>语感</dt><dd>${esc(c.voice)}</dd>
      </dl>
      ${(c.relations || []).length ? `<div style="margin-top:6px">${c.relations.map((r) => `<span class="chip"><b>${esc(r.target)}</b> · ${esc(r.type)}：${esc(r.tension)}</span>`).join('')}</div>` : ''}
    </div>`).join('')}
    ${relationSvg()}
    ${(p.characterNotes?.conflictMatrix || []).length ? `<div class="card tight"><h3>冲突矩阵</h3><table class="mini"><tbody>
      ${p.characterNotes.conflictMatrix.map((m) => `<tr><td class="tiny"><b>${esc(m.a)}</b> × <b>${esc(m.b)}</b></td><td class="tiny">${esc(m.stake)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  `;
}

function relationSvg() {
  const p = S.project;
  const chars = p.characters || [];
  const edges = (p.relationEdges || []).filter((e) => chars.some((c) => c.name === e.source) && chars.some((c) => c.name === e.target));
  if (chars.length < 2) return '';
  const W = 380, H = 300, cx = W / 2, cy = H / 2, R = 108;
  const pos = new Map();
  chars.forEach((c, i) => {
    const a = (i / chars.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(c.name, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.92 });
  });
  return `<div class="card">
    <h3>关系网络 <span class="hint">连线=关系 · 颜色=类型</span></h3>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      ${edges.map((e) => {
        const a = pos.get(e.source), b = pos.get(e.target);
        if (!a || !b) return '';
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${e.type?.includes('仇') || e.type?.includes('利用') ? '#c07a63' : '#c4b9a5'}" stroke-width="1" stroke-dasharray="${e.type?.includes('交易') ? '3 3' : ''}"><title>${esc(e.source)} → ${esc(e.target)}（${esc(e.type)}）：${esc(e.tension)}</title></line>`;
      }).join('')}
      ${chars.map((c) => {
        const pt = pos.get(c.name);
        const lead = c.role === '主角';
        return `<g><circle cx="${pt.x}" cy="${pt.y}" r="${lead ? 17 : 13}" fill="${lead ? '#a9432c' : '#fffdf8'}" stroke="${lead ? '#a9432c' : '#d3c9b7'}" stroke-width="1.2"/>
        <text x="${pt.x}" y="${pt.y + 3.5}" text-anchor="middle" font-size="${lead ? 9 : 8}" fill="${lead ? '#fff6ee' : '#423e37'}" font-family="var(--sans)">${esc(c.name.slice(0, 2))}</text>
        <text x="${pt.x}" y="${pt.y + (lead ? 27 : 23)}" text-anchor="middle" font-size="7.5" fill="#857c6f">${esc(c.name)}</text></g>`;
      }).join('')}
    </svg>
  </div>`;
}

/* ------------------------------ 大纲 tab ------------------------------ */

function outlineTab() {
  const p = S.project;
  const o = p.outline;
  if (!o) return `<div class="empty">大纲尚未生成。</div>`;
  const total = (o.volumes || []).reduce((n, v) => n + (v.arcs || []).reduce((m, a) => m + (a.chapters || []).length, 0), 0);
  const current = p.chapterCursor || 1;
  return `
    <div class="section-title">分层大纲 <span class="tiny muted">${o.volumes?.length || 0} 卷 · ${total} 章</span></div>
    <div class="card tight">
      <div class="small" style="line-height:1.75"><b>Logline</b>：${esc(o.logline)}</div>
      <div class="small" style="line-height:1.75;margin-top:4px"><b>主题</b>：${esc(o.theme)}</div>
      ${(o.causalityCheck || []).length ? `<details style="margin-top:6px"><summary class="tiny muted">因果链自检（${o.causalityCheck.length} 条）</summary><div class="tiny" style="line-height:1.8;margin-top:4px">${o.causalityCheck.map((s) => `· ${esc(s)}`).join('<br>')}</div></details>` : ''}
    </div>
    ${(o.volumes || []).map((v) => `<div class="vol">
      <div class="vol-head"><span class="vn">第${v.no}卷 · ${esc(v.title)}</span></div>
      <div class="tiny muted" style="margin:-2px 0 8px;line-height:1.7">目标：${esc(v.goal)}${v.endState ? `<br>卷末变化：${esc(v.endState)}` : ''}</div>
      ${(v.arcs || []).map((a) => `<div class="arc">
        <div class="arc-title">弧 ${a.no} · ${esc(a.title)}</div>
        ${(a.chapters || []).map((c) => chCard(c, current)).join('')}
      </div>`).join('')}
    </div>`).join('')}
  `;
}

function chCard(c, current) {
  const done = (S.project.chapters || []).find((x) => x.no === c.no)?.status === 'done';
  return `<div class="ch-card ${c.no === current ? 'hl' : ''}" id="ch-card-${c.no}">
    <div class="ch-top">
      <span class="ch-no">${String(c.no).padStart(2, '0')}</span>
      <span class="ch-name">${esc(c.title)}</span>
      <span style="flex:1"></span>
      <span class="dens" title="冲突密度 ${c.density}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= c.density ? (c.density === 5 ? 'on5' : 'on') : '' }"></i>`).join('')}</span>
      ${done ? '<span class="dot ok" title="已定稿"></span>' : ''}
    </div>
    <dl class="ch-body">
      <dt>目标</dt><dd>${esc(c.goal)}</dd>
      <dt>阻碍</dt><dd>${esc(c.obstacle)}</dd>
      <dt>转折</dt><dd>${esc(c.turn)}</dd>
      <dt>结果</dt><dd>${esc(c.result)}</dd>
      <dt>钩子</dt><dd>${esc(c.hook)} <span class="pill">${esc(c.hookType)}</span></dd>
      ${(c.foreshadow?.setup || []).length ? `<dt>布置</dt><dd class="tiny">${c.foreshadow.setup.map((s) => `<span class="pill">${esc(s)}</span>`).join(' ')}</dd>` : ''}
      ${(c.foreshadow?.payoff || []).length ? `<dt>回收</dt><dd class="tiny">${c.foreshadow.payoff.map((s) => `<span class="pill ok">${esc(s)}</span>`).join(' ')}</dd>` : ''}
      ${(c.scenes || []).length ? `<dt>场景</dt><dd class="tiny muted">${esc(c.scenes.join(' / '))}</dd>` : ''}
    </dl>
  </div>`;
}

/* ------------------------------ 质量 tab ------------------------------ */

function qualityTab() {
  const p = S.project;
  const stats = p.stats || {};
  const chapters = p.chapters || [];
  const selected = S.focusChapter || null;
  return `
    <div class="section-title">质量看板</div>
    <div class="grid-2">
      <div class="card tight"><div class="tiny muted">总字数</div><div style="font-size:20px;font-family:var(--serif)">${fmt(stats.words)}</div><div class="tiny muted">定稿 ${stats.done || 0} 章 · 均 ${fmt(stats.avgWordsPerChapter)} 字/章</div></div>
      <div class="card tight"><div class="tiny muted">三审均分 / AI味</div><div style="font-size:20px;font-family:var(--serif)">${stats.avgScore ?? '—'} <span class="tiny muted">/ ${stats.avgAi ?? '—'}</span></div><div class="tiny muted">上下文估算 ${fmt(stats.contextTokens)} tokens</div></div>
    </div>

    ${pacingChart()}
    ${pacingAlarms()}
    ${gateTable(chapters)}
    ${p.foreshadow ? foreshadowCard() : ''}
    ${selected ? deaiCard(selected) : ''}
    ${chapters.length ? chapterPicker(chapters, selected) : ''}
    ${p.summaries?.rolling ? `<div class="card tight"><h3>滚动前情摘要 <span class="hint">覆盖 1-${p.summaries.coveredUpTo} 章 · ${p.summaries.rolling.length} 字</span></h3><div class="tiny" style="line-height:1.8;white-space:pre-wrap">${esc(p.summaries.rolling)}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="compress">立即压缩</button></div></div>` : ''}
  `;
}

function pacingChart() {
  const p = S.project;
  const pts = p.pacing?.points || [];
  if (!pts.length) return '';
  const alarms = p.pacing?.alarms || [];
  const n = pts.length;
  const W = Math.max(380, n * 24 + 34), H = 150;
  const pad = { l: 22, r: 8, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const step = plotW / n;
  const x = (i) => pad.l + i * step + step / 2;
  const y = (v) => pad.t + ((5 - v) / 4) * plotH;
  const bars = pts.map((pt, i) => {
    const h = Math.max(2, (pt.density / 5) * plotH);
    const cls = pt.density === 5 ? 'bar d5' : pt.density <= 2 ? `bar d${pt.density}` : 'bar';
    return `<rect class="${cls}" x="${x(i) - Math.min(7, step * 0.3)}" y="${pad.t + plotH - h}" width="${Math.min(14, step * 0.6)}" height="${h}" rx="1.5"><title>第${pt.no}章《${esc(pt.title)}》 密度 ${pt.density}</title></rect>`;
  }).join('');
  const ma = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - 1), e = Math.min(n - 1, i + 1);
    const avg = (pts.slice(s, e + 1).reduce((m, q) => m + q.density, 0)) / (e - s + 1);
    ma.push(`${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(avg).toFixed(1)}`);
  }
  const alarmRects = alarms.filter((a) => a.type === 'low-plateau' || a.type === 'flat-ending').flatMap((a) => {
    const nums = a.chapters || [];
    const idxs = nums.map((no) => pts.findIndex((q) => q.no === no)).filter((i) => i >= 0);
    if (!idxs.length) return [];
    const i0 = Math.min(...idxs), i1 = Math.max(...idxs);
    return [`<rect class="alarm" x="${pad.l + i0 * step + 1}" y="${pad.t}" width="${(i1 - i0 + 1) * step - 2}" height="${plotH}" rx="2"><title>${esc(a.type)}：第${nums.join('/')}章</title></rect>`];
  }).join('');
  const labels = pts.map((pt, i) => (n <= 30 || i % 2 === 0) ? `<text class="ch-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${pt.no}</text>` : '').join('');
  return `<div class="card tight">
    <h3>节奏曲线 <span class="hint">冲突密度 1-5 · 虚线框=报警区 · 绿线=3章移动平均</span></h3>
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${[1, 2, 3, 4, 5].map((v) => `<line class="gridline" x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}"/><text class="axis-label" x="${pad.l - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
        ${alarmRects}
        ${bars}
        <path class="ma" d="${ma.join(' ')}"/>
        ${labels}
      </svg>
    </div>
    <div class="tiny muted">平均密度 ${p.pacing.avg}｜${esc(p.pacing.advice || '')}</div>
  </div>`;
}

function pacingAlarms() {
  const alarms = S.project.pacing?.alarms || [];
  if (!alarms.length) return '';
  return `<div class="card tight">
    <h3>节奏报警 <span class="hint">${alarms.length} 个</span>
      <button class="btn sm" data-act="pacing-fix">一键调律</button>
    </h3>
    <ul class="alarm-list">
      ${alarms.map((a) => `<li class="${a.severity}"><b>${labelAlarm(a.type)}</b> · 第 ${(a.chapters || []).join('/')} 章 <span class="pill ${a.severity === 'high' ? 'bad' : 'warn'}">${a.severity}</span>
        <div class="tiny muted">${esc(a.why)}</div><div class="tiny">改法：${esc(a.fix || '—')}</div></li>`).join('')}
    </ul>
  </div>`;
}

function labelAlarm(type) {
  return ({
    'low-plateau': '连续低密度平台',
    'gap-between-peaks': '高潮间隔过长',
    'front-loaded': '开局过载',
    'flat-ending': '结尾失速',
    'arc-sag': '弧线中段塌陷',
  })[type] || type;
}

function gateTable(chapters) {
  if (!chapters.length) return '';
  return `<div class="card tight">
    <h3>逐章闸门 <span class="hint">字数 / AI味 / 钩子 / 伏笔 / 三审</span></h3>
    <table class="mini">
      <thead><tr><th>章</th><th class="num">字数</th><th class="num">AI味</th><th class="num">钩子</th><th>伏笔</th><th class="num">三审</th><th>状态</th></tr></thead>
      <tbody>
        ${chapters.map((c) => {
          const r = c.review || c.lastReview;
          const words = c.metrics?.words || (c.current ? wordCount(c.current) : 0);
          const ok = (b) => `<span class="dot ${b ? 'ok' : 'bad'}"></span>`;
          return `<tr>
            <td class="nowrap"><b>${c.no}</b> <span class="tiny muted">${esc((c.title || '').slice(0, 6))}</span></td>
            <td class="num">${ok(words >= 2000)}${fmt(words)}</td>
            <td class="num">${c.metrics?.ai ? ok(c.metrics.ai.score <= (S.project.settings?.maxAiScore ?? 4.5)) + c.metrics.ai.score : '—'}</td>
            <td class="num">${r?.gates?.hook ? ok(r.gates.hook.ok) + r.gates.hook.value : '—'}</td>
            <td class="tiny">${r?.gates?.foreshadow ? ok(r.gates.foreshadow.ok) : '—'}</td>
            <td class="num">${r ? r.score : '—'}</td>
            <td class="tiny"><span class="pill ${c.needsAttention ? 'bad' : c.status === 'done' ? 'ok' : c.status === 'empty' ? '' : 'warn'}">${c.needsAttention ? '待人工' : statusLabel(c.status)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function statusLabel(s) {
  return ({ empty: '未写', drafted: '初稿', reviewed: '已审', revised: '已修订', deai: '已去AI味', verified: '已复核', done: '定稿', flagged: '待人工' })[s] || s || '—';
}

function foreshadowCard() {
  const f = S.project.foreshadow;
  return `<div class="card tight">
    <h3>伏笔台账 <span class="hint">${f.ledger?.length || 0} 条</span></h3>
    <table class="mini">
      <thead><tr><th>伏笔</th><th>类型</th><th class="num">布置</th><th class="num">回收</th><th>状态</th></tr></thead>
      <tbody>${(f.ledger || []).map((x) => `<tr>
        <td>${esc(x.name)}<div class="tiny muted">${esc((x.content || '').slice(0, 26))}…</div></td>
        <td class="tiny">${esc(x.type)}</td>
        <td class="num">${x.setupChapter}</td>
        <td class="num">${x.payoffChapter}</td>
        <td class="tiny"><span class="pill ${x.status === 'paid' ? 'ok' : 'warn'}">${x.status === 'paid' ? '已回收' : x.status === 'planted' ? '已布置' : '计划中'}</span></td>
      </tr>`).join('')}</tbody>
    </table>
    ${f.balance ? `<div class="tiny muted" style="margin-top:6px;line-height:1.7">${esc(f.balance)}</div>` : ''}
  </div>`;
}

function chapterPicker(chapters, selected) {
  return `<div class="card tight">
    <h3>章节质量详情</h3>
    <div class="row wrap">
      ${chapters.map((c) => `<button class="btn sm ${selected === c.no ? 'primary' : ''}" data-act="focus-chapter" data-ch="${c.no}">第${c.no}章</button>`).join('')}
    </div>
  </div>`;
}

function deaiCard(no) {
  const ch = (S.project.chapters || []).find((c) => c.no === Number(no));
  if (!ch) return '';
  const r = ch.review || ch.lastReview;
  return `<div class="card tight">
    <h3>第 ${ch.no} 章《${esc(ch.title)}》 <span class="hint">${statusLabel(ch.status)} · ${fmt(ch.metrics?.words || 0)} 字</span></h3>
    ${ch.deai ? `<div class="grid-2" style="margin-bottom:8px">
      <div class="tiny">AI 味：<b>${ch.deai.before.aiScore}</b> → <b style="color:var(--ok)">${ch.deai.after.aiScore}</b><div class="muted">句长标准差 ${ch.deai.before.sentenceLenStd} → ${ch.deai.after.sentenceLenStd}</div></div>
      <div class="tiny">字数：${fmt(ch.deai.before.words)} → ${fmt(ch.deai.after.words)}<div class="muted">去AI味前后对比（脚本实测）</div></div>
    </div>` : ''}
    ${r ? `<div class="row wrap" style="gap:5px;margin-bottom:6px">
      <span class="pill">逻辑 ${r.logicScore}</span><span class="pill">读者 ${r.readerScore}</span><span class="pill">编辑 ${r.editorScore}</span>
      <span class="pill ${r.gates?.wordCount?.ok ? 'ok' : 'bad'}">字数 ${r.gates?.wordCount?.value ?? '—'}</span>
      <span class="pill ${r.gates?.aiFlavor?.ok ? 'ok' : 'bad'}">AI味 ${r.gates?.aiFlavor?.value ?? '—'}</span>
      <span class="pill ${r.gates?.hook?.ok ? 'ok' : 'bad'}">钩子 ${r.gates?.hook?.value ?? '—'}</span>
      <span class="pill ${r.gates?.foreshadow?.ok ? 'ok' : 'bad'}">伏笔 ${esc(r.gates?.foreshadow?.value || '—')}</span>
    </div>
    ${(r.issues || []).length ? `<div class="tiny" style="line-height:1.7">${r.issues.slice(0, 6).map((i) => `<div>· <span class="pill ${i.severity === 'high' ? 'bad' : 'warn'}">${esc(i.severity)}</span> <b>${esc(i.type)}</b> ${esc((i.why || '').slice(0, 62))}</div>`).join('')}</div>` : '<div class="tiny muted">无遗留问题</div>'}
    <div class="row" style="margin-top:8px">
      <button class="btn sm" data-act="audit" data-ch="${ch.no}">查看三审全文</button>
      <button class="btn sm" data-act="focus-chapter" data-ch="${ch.no}">定位到正文</button>
    </div>` : '<div class="tiny muted">尚未审稿</div>'}
    ${(ch.deai?.replacements || []).length ? `<details style="margin-top:8px"><summary class="tiny muted">替换记录（${ch.deai.replacements.length}）</summary>
      <table class="mini" style="margin-top:5px"><tbody>${ch.deai.replacements.slice(0, 14).map((x) => `<tr><td class="tiny">${esc(x.from)}</td><td class="tiny muted">→ ${esc(x.to)}</td><td class="num tiny">${x.count}</td></tr>`).join('')}</tbody></table></details>` : ''}
  </div>`;
}

/* ------------------------------ 说明 tab ------------------------------ */

function skillTab() {
  const p = S.project;
  const stages = S.meta?.stages || [];
  return `
    <div class="section-title">这套工作流怎么跑</div>
    <div class="card tight small" style="line-height:1.85">
      <b>本地运行</b>：<span class="kbd">npm start</span> → 浏览器打开 <span class="kbd">http://localhost:5173</span>；数据落在 <span class="kbd">data/</span>（JSON），可随时备份。<br>
      <b>模型</b>：默认 <b>离线演示引擎</b>（无需 Key，全流程可跑通）；在「设置」里切到 OpenAI 兼容网关或 Anthropic 即可用真实模型写作。<br>
      <b>每一步都是可重跑的环节</b>：左侧点环节看输入/输出/衔接；「下一步」执行一个环节，「自动连跑」连续执行到成书。
    </div>
    <div class="card tight">
      <h3>环节契约（输入 / 输出 / 衔接）</h3>
      <table class="mini">
        <thead><tr><th>#</th><th>环节</th><th>输入 → 输出</th></tr></thead>
        <tbody>${stages.map((s) => `<tr>
          <td class="num tiny">${s.no}</td>
          <td class="tiny"><b>${esc(s.title)}</b><div class="muted">${esc(s.handoff)}</div></td>
          <td class="tiny">${esc(s.input)}<div class="muted">→ ${esc(s.output)}</div></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="card tight">
      <h3>每章的五道硬闸门</h3>
      <div class="tiny" style="line-height:1.9">
        ① 字数 ≥ ${p?.settings?.minWords || 2000}（脚本实测，模型无权覆盖）<br>
        ② AI 味 ≤ ${p?.settings?.maxAiScore ?? 4.5}（脚本统计套话/排比/命定旁白，改写后复测）<br>
        ③ 章末钩子 ≥ 6（可观测特征：疑问、威胁、信息缺口）<br>
        ④ 本章应布置/回收的伏笔全部执行<br>
        ⑤ 设定不冲突：位阶、术语、硬规则逐条核对（脚本 + 逻辑审）
      </div>
    </div>
    <div class="card tight">
      <h3>提示词资产 <span class="hint">${S.meta?.prompts?.length || 0} 个 · skill/prompts/</span></h3>
      <div class="row wrap" style="gap:4px">${(S.meta?.prompts || []).map((x) => `<span class="chip">${esc(x.title)}<span class="tiny muted">${esc(x.stage)}</span></span>`).join('')}</div>
    </div>
    <div class="card tight">
      <h3>定时任务</h3>
      <div class="tiny" style="line-height:1.9">
        市场热度：<span class="kbd">node scripts/market-refresh.mjs</span>（可挂 cron，默认 ${p?.settings?.autoMarketRefreshHours || 24}h 一次）<br>
        导出：<span class="kbd">curl -s localhost:5173/api/projects/${p?.id || 'ID'}/export?format=md</span><br>
        重置演示：<span class="kbd">node scripts/seed.mjs --reset</span>
      </div>
    </div>
    <details class="card tight"><summary class="small" style="cursor:pointer">查看完整 SKILL.md（可复制到其他 agent 使用）</summary>
      <pre class="tiny" style="white-space:pre-wrap;line-height:1.7;max-height:420px;overflow:auto;margin:8px 0 0">${esc((S.meta?.skill || '').slice(0, 20000))}</pre>
    </details>
  `;
}

/* =============================== 右侧：正文 =============================== */

function renderRight() {
  const right = $('#right');
  const p = S.project;
  const collapsed = S.rightCollapsed;
  if (!p) {
    right.innerHTML = `<div class="empty-novel"><div class="big">正文会出现在这里</div>左侧运行工作流，先产出大纲，再逐章写作。</div>`;
    return;
  }
  const chapters = (p.chapters || []).filter((c) => c.current);
  const target = Number(p.brief?.targetChapters || 12);
  const focus = S.focusChapter ? chapters.find((c) => c.no === S.focusChapter) : null;
  const list = focus ? [focus] : chapters;
  const stats = p.stats || {};

  const head = `<div class="novel-head">
    <div class="grow">
      <div class="title">${esc(p.name)}</div>
      <div class="meta">
        <span>${fmt(stats.words)} 字</span>
        <span>${chapters.length}/${target} 章</span>
        <span>${esc(p.brief?.genre || '')}</span>
        ${stats.avgScore ? `<span>三审 ${stats.avgScore}</span>` : ''}
        ${stats.avgAi != null ? `<span>AI味 ${stats.avgAi}</span>` : ''}
      </div>
    </div>
    <select id="chapter-jump" title="跳转章节">
      <option value="">全书</option>
      ${Array.from({ length: Math.max(target, chapters.length) }, (_, i) => i + 1).map((n) => {
        const c = chapters.find((x) => x.no === n);
        return `<option value="${n}" ${S.focusChapter === n ? 'selected' : ''}>第${n}章 ${c ? esc(c.title) : '（未写）'}</option>`;
      }).join('')}
    </select>
    <button class="btn sm" data-act="toggle-right" title="收起右侧">收起 ›</button>
    <button class="btn sm ghost" data-act="toggle-left" title="专注阅读">专注</button>
  </div>`;

  if (collapsed) {
    right.innerHTML = head + `<div class="empty-novel" style="padding-top:60px">正文已收起<br><span class="tiny">点右上角「展开」或按 ← 收起/展开</span></div>`;
    $('#chapter-jump').onchange = (e) => { S.focusChapter = e.target.value ? Number(e.target.value) : null; render(); };
    return;
  }

  const body = (focus && !focus.current)
    ? `<div class="empty-novel"><div class="big">第 ${focus.no} 章还没写</div>点左侧「运行下一步」，这一章会按 L3 大纲生成并立即进入三审。</div>`
    : list.length
    ? `<div class="novel-scroll" data-scroll="novel">
        <div class="novel-inner">
          ${focus ? '' : `<div class="novel-title"><h2>${esc((p.topics || []).find((t) => t.id === p.selectedTopicId)?.title ? `《${(p.topics || []).find((t) => t.id === p.selectedTopicId).title}》` : p.name)}</h2><div class="byline">${esc(p.brief?.genre || '')} · ${esc(p.brief?.subgenre || '')}</div><div class="rule"></div></div>`}
          ${list.map((c) => chapterBlock(p, c)).join('')}
          ${focus ? '' : pendingBlock(p, chapters.length, target)}
        </div>
      </div>`
    : `<div class="empty-novel"><div class="big">还没有正文</div>左侧点「运行下一步」，从选题一路走到第 1 章。<br><span class="tiny">每章都会经过三审 + 修正 + 去AI味，通过全部闸门后才算定稿。</span></div>`;

  right.innerHTML = head + body;
  $('#chapter-jump').onchange = (e) => {
    const n = e.target.value ? Number(e.target.value) : null;
    if (!n) { S.focusChapter = null; render(); return; }
    S.focusChapter = n;
    render();
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-chapter="${n}"]`);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };
}

function chapterBlock(p, c) {
  const r = c.review || c.lastReview;
  const words = c.metrics?.words || wordCount(c.current);
  const status = c.status === 'done' ? 'ok' : 'warn';
  const paras = c.current.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return `<article class="chapter" data-chapter="${c.no}">
    <h3>第${c.no}章 ${esc(c.title)}</h3>
    <div class="ch-meta">
      <span>${fmt(words)} 字</span>
      ${r ? `<span>三审 ${r.score}</span>` : ''}
      ${c.metrics?.ai ? `<span>AI味 ${c.metrics.ai.score}</span>` : ''}
      ${r?.gates?.hook ? `<span>钩子 ${r.gates.hook.value}</span>` : ''}
      <span class="pill ${status}">${statusLabel(c.status)}</span>
      ${c.needsAttention ? '<span class="pill bad" title="仍有未过闸门或 high 级问题">待人工</span>' : ''}
      <button class="btn sm ghost" data-act="audit" data-ch="${c.no}">审核详情</button>
    </div>
    <div class="prose">${paras.map((x) => `<p>${esc(x)}</p>`).join('')}</div>
  </article>`;
}

function pendingBlock(p, have, target) {
  if (have >= target) return '';
  return `<div class="chapter pending" data-chapter="next">
    <h3>第${have + 1}章 待写</h3>
    <div class="ch-meta"><span>下一章会按 L3 大纲生成，写完立刻进入三审</span></div>
  </div>`;
}

/* =============================== 日志抽屉 =============================== */

function renderDrawer() {
  const d = $('#drawer');
  const last = S.logs[S.logs.length - 1];
  d.className = `drawer ${S.drawerOpen ? 'open' : ''}`;
  d.innerHTML = `
    <div class="drawer-head" data-act="toggle-drawer">
      <span class="status"><span class="live ${S.running ? 'on' : ''}"></span>${S.running ? '运行中' : '已就绪'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${last ? esc(last.message) : '日志会显示在这里：每一步的产物、闸门结果、报警与报错。'}</span>
      <span class="tiny">${S.logs.length} 条</span>
      <span class="btn sm ghost">${S.drawerOpen ? '收起 ⌄' : '展开 ⌃'}</span>
    </div>
    <div class="drawer-body" data-scroll="log">
      ${S.logs.map((l) => `<div class="log-line ${l.level || ''}"><span class="t">${time(l.at)}</span><span class="m">${esc(l.message)}</span></div>`).join('')}
    </div>`;
}

/* =============================== 模态框 =============================== */

function renderModal() {
  const root = $('#modal-root');
  if (!S.modal) {
    root.hidden = true; root.innerHTML = ''; S.modalKey = null;
    return;
  }
  const key = `${S.modal.type}:${S.modal.chapter || ''}`;
  if (S.modalKey === key && root.innerHTML) { root.hidden = false; return; }
  S.modalKey = key;
  root.hidden = false;
  const map = { settings: settingsModal, newProject: newProjectModal, audit: auditModal, market: marketModal };
  root.innerHTML = (map[S.modal.type] || (() => ''))();
  root.onclick = (e) => { if (e.target === root) closeModal(); };
}

function openModal(modal) { S.modal = modal; S.modalKey = null; renderModal(); }
function closeModal() { S.modal = null; S.modalKey = null; renderModal(); }

function modalShell(title, body, foot = '', wide = false) {
  return `<div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn sm ghost" data-act="close-modal">✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
  </div>`;
}

function settingsModal() {
  const s = S.meta?.settings || {};
  return modalShell('设置', `
    <div class="field">
      <label>模型来源</label>
      <select id="set-provider">
        <option value="mock" ${s.provider === 'mock' ? 'selected' : ''}>离线演示引擎（无需 Key，可跑通全流程）</option>
        <option value="openai" ${s.provider === 'openai' ? 'selected' : ''}>OpenAI 兼容接口（OpenAI / DeepSeek / Moonshot / Ollama / vLLM…）</option>
        <option value="anthropic" ${s.provider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
      </select>
      <div class="help">本地部署的模型通常把 baseUrl 写成 <span class="kbd">http://localhost:11434/v1</span>（Ollama）或 <span class="kbd">http://localhost:8000/v1</span>（vLLM）。Key 只保存在本机 data/settings.json。</div>
    </div>
    <div class="field-row">
      <div class="field"><label>Base URL</label><input id="set-baseUrl" value="${esc(s.baseUrl || '')}" placeholder="https://api.openai.com/v1"></div>
      <div class="field"><label>模型名</label><input id="set-model" value="${esc(s.model || '')}" placeholder="gpt-4o-mini / claude-sonnet-4-5"></div>
    </div>
    <div class="field"><label>API Key（留空表示不修改）</label><input id="set-apiKey" type="password" placeholder="${s.hasKey ? '已配置：' + esc(s.apiKey) : '未配置'}"></div>
    <div class="field-row-3">
      <div class="field"><label>temperature</label><input id="set-temp" type="number" step="0.05" min="0" max="1.5" value="${s.temperature ?? 0.85}"></div>
      <div class="field"><label>审稿轮次上限</label><input id="set-rounds" type="number" min="0" max="5" value="${s.reviewRounds ?? 2}"></div>
      <div class="field"><label>单章字数闸门</label><input id="set-minwords" type="number" min="800" step="100" value="${s.minWords ?? 2000}"></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>AI 味上限（≤）</label><input id="set-maxai" type="number" step="0.1" min="1" max="10" value="${s.maxAiScore ?? 4.5}"></div>
      <div class="field"><label>每 N 章压缩摘要</label><input id="set-compress" type="number" min="5" max="100" value="${s.compressEvery ?? 30}"></div>
      <div class="field"><label>市场热度刷新（小时）</label><input id="set-market" type="number" min="1" max="720" value="${s.autoMarketRefreshHours ?? 24}"></div>
    </div>
    <div class="help" style="line-height:1.8">切换模型不会丢失已有内容；建议先用「离线演示引擎」把流程跑通，再换真实模型重跑某一章。</div>
  `, `<button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="save-settings">保存设置</button>`);
}

function newProjectModal() {
  const b = {
    name: '', genre: '东方玄幻', subgenre: '官署怪谈 / 规则流',
    audience: '男频 25-35，喜欢规则流与道德困境',
    targetChapters: 12, wordsPerChapter: 2400, pov: '第三人称限知',
    styleTags: '冷峻、市井质感、少形容词', tone: '压抑中带一点暖',
    taboos: '不写无代价的金手指\n不写降智反派', seedIdea: '',
  };
  return modalShell('新建创作项目', `
    <div class="field-row">
      <div class="field"><label>项目名</label><input id="np-name" placeholder="可留空自动生成" value="${esc(b.name)}"></div>
      <div class="field"><label>一句话种子想法</label><input id="np-seed" placeholder="例：长明灯与影子，灯照见的影子里藏着死期" value="${esc(b.seedIdea)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>题材</label><input id="np-genre" value="${esc(b.genre)}"></div>
      <div class="field"><label>细分方向</label><input id="np-subgenre" value="${esc(b.subgenre)}"></div>
    </div>
    <div class="field"><label>目标读者</label><input id="np-audience" value="${esc(b.audience)}"></div>
    <div class="field-row-3">
      <div class="field"><label>目标章数</label><input id="np-chapters" type="number" min="3" max="200" value="${b.targetChapters}"></div>
      <div class="field"><label>单章字数</label><input id="np-words" type="number" min="1200" step="100" value="${b.wordsPerChapter}"></div>
      <div class="field"><label>叙述视角</label><input id="np-pov" value="${esc(b.pov)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>文风标签（顿号分隔）</label><input id="np-style" value="${esc(b.styleTags)}"></div>
      <div class="field"><label>基调</label><input id="np-tone" value="${esc(b.tone)}"></div>
    </div>
    <div class="field"><label>禁忌（每行一条）</label><textarea id="np-taboos" rows="3">${esc(b.taboos)}</textarea></div>
    <div class="help">创建后点「运行下一步」：市场热度 → 选题 → 查重 → 世界观 → 人物 → 大纲 → 节奏 → 伏笔 → 第 1 章…</div>
  `, `<button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="create-project">创建并开始</button>`);
}

function marketModal() {
  return modalShell('导入市场素材', `
    <div class="field"><label>标题 / 来源</label><input id="mi-title" placeholder="例：番茄「规则怪谈」标签近 30 天新增作品观察"></div>
    <div class="field"><label>链接（可选）</label><input id="mi-url" placeholder="https://..."></div>
    <div class="field"><label>摘要 / 关键数据</label><textarea id="mi-note" rows="5" placeholder="把 WebSearch 抓到的榜单、标签数量、读者评论摘要贴进来。下一轮「市场热度」会把这段素材当作证据。"></textarea></div>
    <div class="help">在 Arena 中可以让 agent 用 WebSearch 检索后通过 <span class="kbd">POST /api/projects/:id/market/input</span> 写入；本机也可以直接贴。</div>
  `, `<button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="save-market">保存素材并重跑市场环节</button>`);
}

function auditModal() {
  const no = S.modal.chapter;
  const ch = (S.project.chapters || []).find((c) => c.no === no);
  if (!ch) return modalShell('审核详情', '<div class="empty">本章还没有内容</div>');
  const r = ch.review || ch.lastReview;
  const gates = r?.gates || {};
  const gateRow = (label, g, unit = '') => g ? `<tr><td>${label}</td><td class="num">${g.value}${unit}</td><td class="tiny">${g.require}</td><td>${g.ok ? '<span class="pill ok">通过</span>' : '<span class="pill bad">未过</span>'}</td></tr>` : '';
  return modalShell(`第 ${ch.no} 章 · 审核详情`, `
    <div class="row wrap" style="margin-bottom:10px">
      <span class="pill ${ch.status === 'done' ? 'ok' : 'warn'}">${statusLabel(ch.status)}</span>
      <span class="pill">${fmt(ch.metrics?.words || 0)} 字</span>
      <span class="pill">AI 味 ${ch.metrics?.ai?.score ?? '—'}</span>
      <span class="pill">修订 ${ch.rounds || 0} 轮</span>
      ${r ? `<span class="pill accent">三审 ${r.score}</span>` : ''}
    </div>
    ${r ? `<table class="mini" style="margin-bottom:10px">
      <thead><tr><th>闸门</th><th class="num">实测</th><th>要求</th><th>结果</th></tr></thead>
      <tbody>
        ${gateRow('字数', gates.wordCount)}
        ${gateRow('AI 味', gates.aiFlavor)}
        ${gateRow('章末钩子', gates.hook)}
        ${gateRow('伏笔执行', gates.foreshadow)}
        ${gateRow('文风一致', gates.styleConsistency)}
      </tbody></table>` : ''}
    ${(r?.passes || []).map((pass) => `<div class="card tight">
      <h3>${esc(pass.name || '')} <span class="hint">${pass.score ?? '—'} 分 · ${esc(pass.verdict || '')}</span></h3>
      ${(pass.issues || []).length ? (pass.issues || []).map((i) => `<div style="margin-bottom:7px;font-size:12px;line-height:1.7">
        <span class="pill ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : ''}">${esc(i.severity || '')}</span>
        <b>${esc(i.type || '')}</b> ${esc(i.why || '')}
        ${i.quote ? `<div class="tiny muted" style="border-left:2px solid var(--line-2);padding-left:7px;margin-top:3px">「${esc(i.quote)}」</div>` : ''}
        ${i.fix ? `<div class="tiny" style="color:var(--accent)">改法：${esc(i.fix)}</div>` : ''}
      </div>`).join('') : '<div class="tiny muted">无问题</div>'}
      ${pass.dropPoints?.length ? `<div class="tiny muted" style="margin-top:4px">弃书点：${pass.dropPoints.map((d) => `第${d.paragraph}段「${esc(d.quote)}」`).join('；')}</div>` : ''}
      ${pass.hookComment ? `<div class="tiny muted">钩子：${esc(pass.hookComment)}</div>` : ''}
    </div>`).join('')}
    ${ch.deai ? `<div class="card tight"><h3>去 AI 味前后</h3>
      <table class="mini"><tbody>
        <tr><td class="tiny">AI 味评分</td><td class="num">${ch.deai.before.aiScore} → <b style="color:var(--ok)">${ch.deai.after.aiScore}</b></td></tr>
        <tr><td class="tiny">句长标准差</td><td class="num">${ch.deai.before.sentenceLenStd} → ${ch.deai.after.sentenceLenStd}</td></tr>
        <tr><td class="tiny">平均句长</td><td class="num">${ch.deai.before.avgSentenceLen} → ${ch.deai.after.avgSentenceLen}</td></tr>
        <tr><td class="tiny">字数</td><td class="num">${fmt(ch.deai.before.words)} → ${fmt(ch.deai.after.words)}</td></tr>
      </tbody></table>
      ${(ch.deai.replacements || []).length ? `<div class="tiny muted" style="margin-top:6px">主要替换：${ch.deai.replacements.slice(0, 8).map((x) => `${esc(x.from)}→${esc(x.to)}`).join('；')}</div>` : ''}
    </div>` : ''}
    ${(ch.revisions || []).length ? `<div class="card tight"><h3>修订记录</h3>${ch.revisions.map((x) => `<div class="tiny" style="margin-bottom:5px"><b>第 ${x.round} 轮</b> · ${time(x.at)}<div class="muted" style="line-height:1.7">${(x.applied || []).map(esc).join('<br>')}</div></div>`).join('')}</div>` : ''}
    <div class="card tight"><h3>版本 <span class="hint">${(ch.versions || []).length} 个</span></h3>
      <table class="mini"><tbody>${(ch.versions || []).map((v) => `<tr>
        <td class="tiny">v${v.v} · ${esc(v.source)}</td><td class="num tiny">${fmt(v.words)} 字</td><td class="tiny muted">${time(v.at)}</td>
        <td><button class="btn sm ghost" data-act="rollback" data-ch="${ch.no}" data-v="${v.v}">回滚到此版</button></td>
      </tr>`).join('')}</tbody></table>
    </div>
    ${ch.summary ? `<div class="card tight"><h3>章节摘要</h3><div class="tiny" style="line-height:1.8">${esc(ch.summary)}</div></div>` : ''}
  `, `<button class="btn" data-act="close-modal">关闭</button>`, true);
}

/* =============================== 动作 =============================== */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const p = S.project;

  try {
    switch (act) {
      case 'tab':
        S.tab = el.dataset.tab;
        localStorage.setItem('inkflow.tab', S.tab);
        S.stageId = null;
        render();
        break;
      case 'stage':
        S.stageId = S.stageId === el.dataset.stage ? null : el.dataset.stage;
        render();
        break;
      case 'toggle-right':
        S.rightCollapsed = !S.rightCollapsed;
        localStorage.setItem('inkflow.rightCollapsed', S.rightCollapsed ? '1' : '0');
        render();
        break;
      case 'toggle-left':
        S.leftCollapsed = !S.leftCollapsed;
        render();
        break;
      case 'toggle-drawer':
        S.drawerOpen = !S.drawerOpen;
        drawerOpenAtBottom = true;
        localStorage.setItem('inkflow.drawerOpen', S.drawerOpen ? '1' : '0');
        render();
        break;
      case 'run-step':
        runStream('step');
        break;
      case 'run-auto':
        runStream('auto');
        break;
      case 'stop':
        await api(`/api/projects/${p.id}/stop`, { method: 'POST' });
        toast('已请求暂停，当前环节结束后停止');
        break;
      case 'new-project':
        openModal({ type: 'newProject' });
        break;
      case 'settings':
        openModal({ type: 'settings' });
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'select-topic': {
        if (!confirm('切换主线会重置已生成的世界观、人物、大纲与章节，确定吗？')) break;
        const proj = await api(`/api/projects/${p.id}/select-topic`, { method: 'POST', body: { topicId: el.dataset.topic } });
        S.project = proj;
        S.tab = 'flow';
        render();
        toast('已切换主线，后续环节需要重新运行', 'ok');
        break;
      }
      case 'refresh-market': {
        el.disabled = true; el.textContent = '刷新中…';
        S.project = await api(`/api/projects/${p.id}/market/refresh`, { method: 'POST' });
        S.meta.projects = await api('/api/projects');
        render();
        toast('市场数据已刷新', 'ok');
        break;
      }
      case 'add-market':
        openModal({ type: 'market' });
        break;
      case 'save-market': {
        const title = $('#mi-title').value.trim();
        const url = $('#mi-url').value.trim();
        const note = $('#mi-note').value.trim();
        if (!note) { toast('请填写摘要', 'err'); break; }
        S.project = await api(`/api/projects/${p.id}/market/input`, { method: 'POST', body: { title: title || '手工素材', url, note } });
        S.project = await api(`/api/projects/${p.id}/market/refresh`, { method: 'POST' });
        closeModal();
        render();
        toast('素材已导入并重跑市场环节', 'ok');
        break;
      }
      case 'pacing-fix': {
        const res = await api(`/api/projects/${p.id}/pacing/fix`, { method: 'POST' });
        S.project = res.project;
        render();
        toast(`已调律第 ${res.touched.join('、')} 章，剩余 ${res.pacing.alarms.length} 个报警`, 'ok');
        break;
      }
      case 'rerun-pacing':
        S.project = await api(`/api/projects/${p.id}/pacing/rerun`, { method: 'POST' });
        render();
        toast('节奏曲线已重算', 'ok');
        break;
      case 'force-dedup':
        if (!confirm('确认接受查重风险并继续？建议先按报告修改选题。')) break;
        S.project = await api(`/api/projects/${p.id}/force-dedup`, { method: 'POST', body: { force: true } });
        render();
        toast('已标记为接受风险', 'ok');
        break;
      case 'compress':
        S.project = await api(`/api/projects/${p.id}/compress`, { method: 'POST' });
        render();
        toast('前情摘要已压缩', 'ok');
        break;
      case 'focus-chapter': {
        const n = Number(el.dataset.ch);
        S.focusChapter = n;
        S.rightCollapsed = false;
        render();
        requestAnimationFrame(() => {
          const target = document.querySelector(`[data-chapter="${n}"]`);
          if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        break;
      }
      case 'audit':
        openModal({ type: 'audit', chapter: Number(el.dataset.ch) });
        break;
      case 'rollback': {
        if (!confirm('回滚后本章需要重新审稿，确定吗？')) break;
        S.project = await api(`/api/projects/${p.id}/rollback`, { method: 'POST', body: { chapter: Number(el.dataset.ch), version: Number(el.dataset.v) } });
        S.modalKey = null;
        render();
        toast('已回滚，可重新运行审稿', 'ok');
        break;
      }
      case 'save-settings': {
        const body = {
          provider: $('#set-provider').value,
          baseUrl: $('#set-baseUrl').value.trim(),
          model: $('#set-model').value.trim(),
          temperature: Number($('#set-temp').value),
          reviewRounds: Number($('#set-rounds').value),
          minWords: Number($('#set-minwords').value),
          maxAiScore: Number($('#set-maxai').value),
          compressEvery: Number($('#set-compress').value),
          autoMarketRefreshHours: Number($('#set-market').value),
        };
        const key = $('#set-apiKey').value.trim();
        if (key) body.apiKey = key;
        await api('/api/settings', { method: 'POST', body });
        S.meta = await api('/api/meta');
        if (S.project) S.project = await api(`/api/projects/${S.project.id}`);
        closeModal();
        render();
        toast('设置已保存', 'ok');
        break;
      }
      case 'create-project': {
        const styleTags = $('#np-style').value.split(/[、,，\s]+/).filter(Boolean);
        const taboos = $('#np-taboos').value.split('\n').map((s) => s.trim()).filter(Boolean);
        const body = {
          name: $('#np-name').value.trim() || undefined,
          seedIdea: $('#np-seed').value.trim() || '一个普通人被卷进一件不该他管的事',
          genre: $('#np-genre').value.trim(),
          subgenre: $('#np-subgenre').value.trim(),
          audience: $('#np-audience').value.trim(),
          targetChapters: Number($('#np-chapters').value) || 12,
          wordsPerChapter: Number($('#np-words').value) || 2400,
          pov: $('#np-pov').value.trim(),
          styleTags, taboos,
          tone: $('#np-tone').value.trim(),
        };
        const res = await api('/api/projects', { method: 'POST', body });
        S.project = res.project;
        localStorage.setItem('inkflow.project', S.project.id);
        S.meta.projects = await api('/api/projects');
        S.tab = 'flow';
        S.stageId = null;
        closeModal();
        render();
        toast('项目已创建，开始跑第一步吧', 'ok');
        break;
      }
      default:
        break;
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* =============================== SSE 运行 =============================== */

async function runStream(mode) {
  if (!S.project || S.running) return;
  S.running = true;
  S.drawerOpen = true;
  drawerOpenAtBottom = true;
  render();
  addLocalLog(`开始${mode === 'auto' ? '自动连跑' : '执行下一步'}…`, 'stage');

  try {
    const res = await fetch(`/api/projects/${S.project.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        handleEvent(ev);
      }
    }
  } catch (err) {
    toast(`运行失败：${err.message}`, 'err');
    addLocalLog(`错误：${err.message}`, 'error');
  } finally {
    S.running = false;
    setStatus(S.meta?.provider ? `${S.meta.provider.mode} · ${S.meta.provider.model}` : '');
    try {
      S.meta = await api('/api/meta');
      S.projects = S.meta.projects;
      if (S.project) S.project = await api(`/api/projects/${S.project.id}`);
    } catch { /* ignore */ }
    render();
  }
}

function handleEvent(ev) {
  if (ev.type === 'log') {
    S.logs.push({ at: ev.at, message: ev.message, level: ev.level });
    if (S.logs.length > 400) S.logs.splice(0, S.logs.length - 400);
    drawerOpenAtBottom = true;
    renderDrawer();
    const head = $('.drawer-head span[style*="flex:1"]');
    if (head) head.textContent = ev.message;
    return;
  }
  if (ev.type === 'step') {
    addLocalLog(`→ ${stageName(ev.stage)}${ev.chapter ? `（第 ${ev.chapter} 章）` : ''}`, 'stage');
    setStatus(`${stageName(ev.stage)}${ev.chapter ? ` · 第${ev.chapter}章` : ''}…`);
    return;
  }
  if (ev.type === 'step-done') {
    setStatus(`${stageName(ev.stage)} 完成：${ev.summary || ''}`);
    return;
  }
  if (ev.type === 'project') {
    S.project = ev.project;
    S.projects = S.projects.map((x) => (x.id === ev.project.id ? { ...x, name: ev.project.name, done: ev.project.stats?.done } : x));
    scheduleRender();
    return;
  }
  if (ev.type === 'error') {
    toast(ev.message, 'err');
    addLocalLog(`错误：${ev.message}`, 'error');
    S.running = false;
    render();
    return;
  }
  if (ev.type === 'finished') {
    addLocalLog(`自动连跑结束（${ev.steps} 步）`, 'stage');
    return;
  }
  if (ev.type === 'stopped') {
    addLocalLog('已暂停', 'warn');
    return;
  }
}

function addLocalLog(message, level = '') {
  S.logs.push({ at: new Date().toISOString(), message, level });
  drawerOpenAtBottom = true;
  renderDrawer();
}

function stageName(id) {
  return (S.meta?.stages || []).find((s) => s.id === id)?.title || id;
}

/* =============================== 快捷键 =============================== */

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape' && S.modal) closeModal();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runStream('step'); }
  if (e.key === 'ArrowLeft' && e.altKey) { S.rightCollapsed = !S.rightCollapsed; render(); }
});

init();
