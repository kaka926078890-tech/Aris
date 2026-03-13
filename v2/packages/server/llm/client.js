/**
 * LLM 调用：chat、chatWithTools。DeepSeek 兼容 API。
 */
require('dotenv').config();

const MAX_TOKENS_STREAM = Math.min(Number(process.env.ARIS_STREAM_MAX_TOKENS) || 8192, 32768);
const MAX_TOKENS_TOOLS = Math.min(Number(process.env.ARIS_TOOL_MAX_TOKENS) || 8192, 32768);
const DEEPSEEK_API = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';

async function chat(messages) {
  if (!API_KEY) {
    console.warn('[Aris v2] DEEPSEEK_API_KEY not set');
    return { content: '[未配置 API Key]', error: true };
  }
  try {
    const res = await fetch(`${DEEPSEEK_API}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: MAX_TOKENS_STREAM,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    return { content: msg.content ?? '', tool_calls: msg.tool_calls ?? null, error: false };
  } catch (e) {
    console.error('[Aris v2] chat error', e);
    return { content: `[请求失败: ${e.message}]`, tool_calls: null, error: true };
  }
}

async function chatWithTools(messages, tools, signal) {
  if (!API_KEY) {
    return { content: '[未配置 API Key]', tool_calls: null, error: true };
  }
  try {
    const res = await fetch(`${DEEPSEEK_API}/v1/chat/completions`, {
      signal: signal || undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
        stream: false,
        max_tokens: MAX_TOKENS_TOOLS,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const usage = data.usage ? { prompt_tokens: data.usage.prompt_tokens ?? 0, completion_tokens: data.usage.completion_tokens ?? 0 } : null;
    return {
      content: msg.content ?? '',
      tool_calls: msg.tool_calls ?? null,
      error: false,
      usage,
    };
  } catch (e) {
    if (e && e.name === 'AbortError') return { content: '', tool_calls: null, error: true, aborted: true };
    console.error('[Aris v2] chatWithTools error', e);
    return { content: `[请求失败: ${e.message}]`, tool_calls: null, error: true };
  }
}

module.exports = { chat, chatWithTools };
