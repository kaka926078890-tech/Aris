/**
 * LLM 调用：chat、chatWithTools。DeepSeek 兼容 API。
 */
require('dotenv').config();

const { getChatTemperature } = require('./temperature.js');

const MAX_TOKENS_STREAM = Math.min(Number(process.env.ARIS_STREAM_MAX_TOKENS) || 8192, 32768);
const MAX_TOKENS_TOOLS = Math.min(Number(process.env.ARIS_TOOL_MAX_TOKENS) || 8192, 32768);
const LOG_PREVIEW_LEN = 280;

function getApiConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
  };
}

function preview(str, maxLen) {
  if (str == null || typeof str !== 'string') return '';
  const s = str.trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

async function chat(messages, options = {}) {
  const { signal, max_tokens: maxTokensOverride, temperature: temperatureOverride } = options || {};
  const { apiKey, apiUrl } = getApiConfig();
  if (!apiKey) {
    console.warn('[Aris v2] DEEPSEEK_API_KEY not set');
    return { content: '[未配置 API Key，请在设置中填写]', error: true };
  }
  try {
    const msgCount = Array.isArray(messages) ? messages.length : 0;
    console.info('[Aris v2] DeepSeek chat request: messages=', msgCount, 'url=', apiUrl);
    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      signal: signal || undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: maxTokensOverride != null ? maxTokensOverride : MAX_TOKENS_STREAM,
        temperature: temperatureOverride != null ? temperatureOverride : getChatTemperature(),
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const usage = data.usage;
    const content = msg.content ?? '';
    if (usage) console.info('[Aris v2] DeepSeek chat response: prompt_tokens=', usage.prompt_tokens, 'completion_tokens=', usage.completion_tokens);
    if (content) console.info('[Aris v2] DeepSeek chat 返回内容:', preview(content, LOG_PREVIEW_LEN));
    return { content, tool_calls: msg.tool_calls ?? null, error: false };
  } catch (e) {
    if (e && e.name === 'AbortError') return { content: '', tool_calls: null, error: true, aborted: true };
    console.error('[Aris v2] chat error', e);
    return { content: `[请求失败: ${e.message}]`, tool_calls: null, error: true };
  }
}

async function chatWithTools(messages, tools, signal) {
  const { apiKey, apiUrl } = getApiConfig();
  if (!apiKey) {
    console.warn('[Aris v2] DEEPSEEK_API_KEY not set');
    return { content: '[未配置 API Key，请在设置中填写]', tool_calls: null, error: true };
  }
  try {
    const toolCount = Array.isArray(tools) ? tools.length : 0;
    console.info('[Aris v2] DeepSeek chatWithTools request: messages=', messages?.length || 0, 'tools=', toolCount);
    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      signal: signal || undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
        stream: false,
        max_tokens: MAX_TOKENS_TOOLS,
        temperature: getChatTemperature(),
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const usage = data.usage ? { prompt_tokens: data.usage.prompt_tokens ?? 0, completion_tokens: data.usage.completion_tokens ?? 0 } : null;
    const content = msg.content ?? '';
    const toolCalls = msg.tool_calls ?? null;
    if (usage) console.info('[Aris v2] DeepSeek chatWithTools response: prompt_tokens=', usage.prompt_tokens, 'completion_tokens=', usage.completion_tokens);
    if (content) console.info('[Aris v2] DeepSeek chatWithTools 返回文本:', preview(content, LOG_PREVIEW_LEN));
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const names = toolCalls.map((tc) => tc.function?.name || '?').join(', ');
      console.info('[Aris v2] DeepSeek chatWithTools 调用工具:', names);
      toolCalls.forEach((tc, i) => {
        const name = tc.function?.name || '?';
        const args = tc.function?.arguments;
        let argsPreview = '';
        try {
          if (typeof args === 'string') argsPreview = preview(args, 120);
          else if (args && typeof args === 'object') argsPreview = preview(JSON.stringify(args), 120);
        } catch (_) {}
        console.info('[Aris v2]   工具[' + (i + 1) + ']', name, argsPreview ? 'args=' + argsPreview : '');
      });
    }
    return {
      content,
      tool_calls: toolCalls,
      error: false,
      usage,
    };
  } catch (e) {
    if (e && e.name === 'AbortError') return { content: '', tool_calls: null, error: true, aborted: true };
    console.error('[Aris v2] chatWithTools error', e);
    return { content: `[请求失败: ${e.message}]`, tool_calls: null, error: true };
  }
}

module.exports = { chat, chatWithTools, getChatTemperature };
