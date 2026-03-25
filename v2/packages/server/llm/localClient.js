/**
 * 本地 LLM 客户端（Ollama）：用于 collab 评分与润色。
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3-vl:4b';

function getLocalLlmConfig() {
  return {
    enabled: process.env.ARIS_LOCAL_LLM_ENABLED !== 'false',
    baseUrl: String(process.env.ARIS_LOCAL_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: String(process.env.ARIS_LOCAL_LLM_MODEL || DEFAULT_MODEL),
    timeoutMs: Math.max(3000, Number(process.env.ARIS_LOCAL_LLM_TIMEOUT_MS) || 20000),
  };
}

async function chatLocal(messages, options = {}) {
  const cfg = getLocalLlmConfig();
  if (!cfg.enabled) return { ok: false, error: 'local_llm_disabled', content: '' };
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || cfg.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || cfg.model,
        messages: Array.isArray(messages) ? messages : [],
        stream: false,
        options: {
          temperature: options.temperature != null ? options.temperature : 0.2,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}`, content: '' };
    }
    const data = await res.json();
    const content = data && data.message && typeof data.message.content === 'string'
      ? data.message.content
      : '';
    return { ok: true, content, raw: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), content: '' };
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {}
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m && m[1]) {
    try {
      return JSON.parse(m[1]);
    } catch (_) {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch (_) {}
  }
  return null;
}

module.exports = {
  getLocalLlmConfig,
  chatLocal,
  safeParseJson,
};
