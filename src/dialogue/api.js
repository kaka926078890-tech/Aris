/**
 * DeepSeek Chat API from main process. API key from env.
 */
require('dotenv').config();

async function chat(messages) {
  const DEEPSEEK_API = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
  const API_KEY = process.env.DEEPSEEK_API_KEY || '';
  if (!API_KEY) {
    console.warn('DEEPSEEK_API_KEY not set');
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
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${t}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, error: false };
  } catch (e) {
    console.error('DeepSeek chat error', e);
    return { content: `[请求失败: ${e.message}]`, error: true };
  }
}

function logPayload(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  console.info('[Aris][deepseek] ========== 发送给 DeepSeek 的 messages ==========');
  messages.forEach((m, i) => {
    const role = m.role || '';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    const len = content.length;
    console.info(`[Aris][deepseek] [${i}] role=${role} length=${len}`);
    console.info('[Aris][deepseek] content:\n' + content);
    console.info('[Aris][deepseek] ---');
  });
  console.info('[Aris][deepseek] ========== end ==========');
}

/**
 * Stream chat completion, call onChunk(text) for each delta.
 * Returns { content, error } when done.
 */
async function chatStream(messages, onChunk) {
  const DEEPSEEK_API = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
  const API_KEY = process.env.DEEPSEEK_API_KEY || '';
  if (!API_KEY) {
    const msg = '[未配置 API Key]';
    if (onChunk) onChunk(msg);
    return { content: msg, error: true };
  }
  logPayload(messages);
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
        max_tokens: 1024,
        temperature: 0.7,
        stream: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${t}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
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
          } catch (_) {}
        }
      }
    }
    return { content, error: false };
  } catch (e) {
    console.error('DeepSeek chat stream error', e);
    const msg = `[请求失败: ${e.message}]`;
    if (onChunk) onChunk(msg);
    return { content: msg, error: true };
  }
}

module.exports = { chat, chatStream };
