/**
 * UI 冒烟测试（开发用）：用 jsdom 跑一遍前端渲染，捕捉运行时报错。
 *   node scripts/ui-smoke.mjs
 * 需要 jsdom：npm i jsdom --no-save
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from '../server/store.js';

const nodeFetch = globalThis.fetch;
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;
const errors = [];

window.fetch = (input, init) => {
  const url = String(input).startsWith('http') ? String(input) : `http://localhost:5173${input}`;
  return nodeFetch(url, init);
};
window.confirm = () => true;
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.addEventListener('error', (e) => errors.push(e.message));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.requestAnimationFrame = window.requestAnimationFrame;
global.fetch = window.fetch;
global.confirm = window.confirm;

global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.getComputedStyle = window.getComputedStyle;

process.on('unhandledRejection', (e) => errors.push(String(e)));

await import('../web/app.js');
await new Promise((r) => setTimeout(r, 1500));

const bodyText = () => window.document.body.textContent.replace(/\s+/g, ' ');
const click = async (sel, wait = 120) => {
  const el = window.document.querySelector(sel);
  if (!el) { errors.push(`找不到元素 ${sel}`); return false; }
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, wait));
  return true;
};
const clickAll = async (sel) => {
  const nodes = [...window.document.querySelectorAll(sel)];
  if (!nodes.length) { errors.push(`找不到元素集合 ${sel}`); return; }
  nodes[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
};

// 依次点击各标签页与环节，验证渲染不炸
const tabChecks = [
  ['world', '硬规则'],
  ['characters', '人物档案'],
  ['outline', '分层大纲'],
  ['quality', '节奏曲线'],
  ['skill', '五道硬闸门'],
  ['flow', '创作流水线'],
];
for (const [tab, expect] of tabChecks) {
  await click(`[data-act="tab"][data-tab="${tab}"]`);
  if (!bodyText().includes(expect)) errors.push(`标签页 ${tab} 未渲染出「${expect}」`);
}
await click('[data-act="stage"][data-stage="world"]');
if (!bodyText().includes('衔接')) errors.push('环节详情未显示输入/输出/衔接');
await click('[data-act="stage"][data-stage="world"]');

// 设置 / 新建 弹窗
await click('[data-act="settings"]');
if (!window.document.querySelector('#set-provider')) errors.push('设置弹窗未渲染');
await click('[data-act="close-modal"]');
await click('[data-act="new-project"]');
if (!window.document.querySelector('#np-genre')) errors.push('新建项目弹窗未渲染');
await click('[data-act="close-modal"]');

// 收起/展开正文
await click('[data-act="toggle-right"]');
if (!window.document.querySelector('.novel-head')) errors.push('收起正文后顶栏丢失');
await click('[data-act="toggle-right"]');

// 审核详情弹窗
await click('[data-act="audit"]');
if (!bodyText().includes('闸门')) errors.push('审核详情未渲染闸门表');
await click('[data-act="close-modal"]');

// 通过 UI 触发一次运行（走 SSE），验证流式日志与状态刷新
const beforeLogs = window.document.querySelectorAll('.log-line').length;
await click('[data-act="run-step"]', 300);
await new Promise((r) => setTimeout(r, 3000));
const afterLogs = window.document.querySelectorAll('.log-line').length;
if (afterLogs <= beforeLogs) errors.push('运行一步后没有新增日志（SSE 可能未生效）');
if (window.document.querySelector('.toast.err')) errors.push(`运行报错：${window.document.querySelector('.toast.err').textContent}`);
const text = bodyText();
const checks = [
  ['顶部品牌', text.includes('墨脉')],
  ['项目标题', text.includes('照影')],
  ['环节名称', text.includes('世界观构建') && text.includes('三视角审稿团')],
  ['左侧大纲入口', text.includes('大纲')],
  ['右侧正文', text.includes('第1章') || text.includes('第 1 章')],
  ['日志抽屉', text.includes('日志会显示在这里') || text.includes('定稿')],
  ['阶段已渲染', window.document.querySelectorAll('.stage').length >= 10],
];
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) bad++;
}
if (errors.length) {
  console.log('\n运行时错误：');
  for (const e of errors) console.log(' -', e);
  bad++;
}
console.log(`\nDOM 节点：${window.document.querySelectorAll('*').length}；结论：${bad ? '有问题' : '通过'}`);
process.exit(bad ? 1 : 0);
