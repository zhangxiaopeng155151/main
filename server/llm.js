import { getSettings } from './store.js';

/**
 * 统一的大模型调用层。三种 provider：
 *  - mock      : 无需 key，本地确定性生成，用于离线演示 / 冒烟测试
 *  - openai    : 任何 OpenAI 兼容网关（OpenAI、DeepSeek、通义、Moonshot、Ollama、vLLM…）
 *  - anthropic : Claude 原生 Messages API
 * 本地运行只需要在「设置」里填 baseUrl / model / apiKey，或设置环境变量。
 */

export function providerInfo() {
  const s = getSettings();
  return {
    provider: s.provider,
    model: s.provider === 'mock' ? 'mock-local' : s.model,
    hasKey: Boolean(s.apiKey) || s.provider === 'mock',
    mode: s.provider === 'mock' ? '离线演示' : '在线大模型',
  };
}

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (/401|403|invalid.*key|unauthor/i.test(msg)) return `鉴权失败：请检查 API Key（原始信息：${msg.slice(0, 160)}）`;
  if (/404/.test(msg)) return `接口不存在：请检查 baseUrl / model 是否正确（原始信息：${msg.slice(0, 160)}）`;
  if (/429|rate/i.test(msg)) return `触发限流：请降低并发或稍后重试（原始信息：${msg.slice(0, 160)}）`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) return `无法连接模型服务：本地模型请确认服务已启动（原始信息：${msg.slice(0, 160)}）`;
  return msg;
}

async function callOpenAI({ system, prompt, maxTokens, temperature, json }) {
  const s = getSettings();
  const body = {
    model: s.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature: temperature ?? s.temperature,
    max_tokens: maxTokens ?? s.maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return { text, tokens: data.usage?.total_tokens ?? 0, model: data.model || s.model };
}

async function callAnthropic({ system, prompt, maxTokens, temperature }) {
  const s = getSettings();
  const res = await fetch(`${(s.baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: s.model,
      max_tokens: maxTokens ?? s.maxTokens,
      temperature: temperature ?? s.temperature,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  return { text, tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0), model: data.model || s.model };
}

export async function complete({ system, prompt, maxTokens, temperature, json }) {
  const s = getSettings();
  if (s.provider === 'mock') throw new Error('MOCK_PROVIDER'); // 由 pipeline 走本地生成分支
  try {
    if (s.provider === 'anthropic') return await callAnthropic({ system, prompt, maxTokens, temperature });
    return await callOpenAI({ system, prompt, maxTokens, temperature, json });
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

/** 从模型回复里抠出 JSON（容忍 ```json 包裹与前后废话） */
export function parseJSON(text = '') {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型未返回 JSON：' + text.slice(0, 300));
  const slice = raw.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (e) {
    try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch { throw new Error('JSON 解析失败：' + e.message); }
  }
}
