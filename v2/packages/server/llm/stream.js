/**
 * 流式回复，用于最终一轮展示。
 */
require('dotenv').config();

const { getChatTemperature } = require('./temperature.js');
const { buildLlmFetchInit } = require('./fetchRetry.js');

const MAX_TOKENS_STREAM = Math.min(Number(process.env.ARIS_STREAM_MAX_TOKENS) || 8192, 32768);

async function chatStream(messages, onChunk, signal) {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
  if (!apiKey) {
    const msg = '[未配置 API Key，请在设置中填写]';
    if (onChunk) onChunk(msg);
    return { content: msg, error: true };
  }
  try {
    console.info('[Aris v2] DeepSeek chatStream request: messages=', messages?.length || 0);
    const res = await fetch(
      `${apiUrl}/v1/chat/completions`,
      buildLlmFetchInit({
        signal: signal || undefined,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          max_tokens: MAX_TOKENS_STREAM,
          temperature: getChatTemperature(),
          stream: true,
          stream_options: { include_usage: true },
        }),
      }),
    );
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
    if (usage) console.info('[Aris v2] DeepSeek chatStream done: prompt_tokens=', usage.prompt_tokens, 'completion_tokens=', usage.completion_tokens);
    const previewLen = 280;
    if (content && content.length > 0) {
      const p = content.length <= previewLen ? content : content.slice(0, previewLen) + '…';
      console.info('[Aris v2] DeepSeek chatStream 返回内容:', p);
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
