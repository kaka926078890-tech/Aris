/**
 * 流式回复，用于最终一轮展示。
 */
require('dotenv').config();

const MAX_TOKENS_STREAM = Math.min(Number(process.env.ARIS_STREAM_MAX_TOKENS) || 8192, 32768);
const DEEPSEEK_API = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';

async function chatStream(messages, onChunk, signal) {
  if (!API_KEY) {
    const msg = '[未配置 API Key]';
    if (onChunk) onChunk(msg);
    return { content: msg, error: true };
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
        max_tokens: MAX_TOKENS_STREAM,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = null;
    while (true) {
      if (signal && signal.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta && typeof delta === 'string') {
              content += delta;
              if (onChunk) onChunk(delta);
            }
            if (obj.usage) usage = obj.usage;
          } catch (_) {}
        }
      }
    }
    return { content, error: false, usage, aborted: !!(signal && signal.aborted) };
  } catch (e) {
    if (e && e.name === 'AbortError') return { content: '', error: false, aborted: true };
    console.error('[Aris v2] chatStream error', e);
    const msg = `[请求失败: ${e.message}]`;
    if (onChunk) onChunk(msg);
    return { content: msg, error: true };
  }
}

module.exports = { chatStream };
