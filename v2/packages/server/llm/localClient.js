/**
 * 本地 LLM 客户端（Ollama）：用于 collab 评分与润色。
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3-vl:4b';
const PREVIEW_IN = 600;
const PREVIEW_OUT = 1200;

function isLocalLlmLogEnabled() {
  const v = process.env.ARIS_LOCAL_LLM_LOG;
  if (v === 'false' || v === '0') return false;
  return true;
}

function clip(str, max) {
  if (str == null || typeof str !== 'string') return '';
  const s = str.trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function summarizeMessages(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  return arr.map((m) => ({
    role: m && m.role,
    chars: typeof m?.content === 'string' ? m.content.length : 0,
  }));
}

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
  const label = options.label || 'local_llm';
  if (!cfg.enabled) {
    if (isLocalLlmLogEnabled()) {
      console.info('[Aris v2][localLLM]', label, 'skipped: ARIS_LOCAL_LLM_ENABLED=false');
    }
    return { ok: false, error: 'local_llm_disabled', content: '' };
  }
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || cfg.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const model = options.model || cfg.model;
  const url = `${cfg.baseUrl}/api/chat`;
  const lastUser = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m && m.role === 'user');
  const lastUserPreview = clip(typeof lastUser?.content === 'string' ? lastUser.content : '', PREVIEW_IN);

  if (isLocalLlmLogEnabled()) {
    console.info('[Aris v2][localLLM] request', {
      label,
      url,
      model,
      temperature: options.temperature != null ? options.temperature : 0.2,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      roles: summarizeMessages(messages),
      lastUserPreview: lastUserPreview || '(无 user 正文)',
    });
  }

  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: Array.isArray(messages) ? messages : [],
        stream: false,
        options: {
          temperature: options.temperature != null ? options.temperature : 0.2,
        },
      }),
      signal: controller.signal,
    });
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0,
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (isLocalLlmLogEnabled()) {
        console.warn('[Aris v2][localLLM] response error', { label, status: res.status, bodyPreview: clip(errText, 400) });
      }
      return { ok: false, error: `http_${res.status}`, content: '' };
    }
    const data = await res.json();
    const content = data && data.message && typeof data.message.content === 'string'
      ? data.message.content
      : '';
    const thinking =
      data && data.message && typeof data.message.thinking === 'string'
        ? data.message.thinking
        : '';
    if (isLocalLlmLogEnabled()) {
      const meta = {
        label,
        ok: true,
        elapsedMs,
        responseModel: data.model || model,
        contentChars: content.length,
        contentPreview: clip(content, PREVIEW_OUT),
      };
      if (thinking) meta.thinkingPreview = clip(thinking, PREVIEW_OUT);
      if (data.eval_count != null) meta.eval_count = data.eval_count;
      if (data.prompt_eval_count != null) meta.prompt_eval_count = data.prompt_eval_count;
      console.info('[Aris v2][localLLM] response', meta);
    }
    return { ok: true, content, raw: data };
  } catch (e) {
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0,
    );
    if (isLocalLlmLogEnabled()) {
      console.warn('[Aris v2][localLLM] fetch failed', { label, elapsedMs, error: String(e?.message || e) });
    }
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
