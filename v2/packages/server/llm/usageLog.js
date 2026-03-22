/**
 * DeepSeek / OpenAI 兼容：usage 里「缓存命中」等字段的终端日志片段。
 * 不同供应商字段名不一，除显式解析外，对顶层键名含 cache/cached 的也会打印。
 */

/**
 * 单次 API 返回的 usage 中，与「前缀/Prompt 缓存命中」「推理 token」相关的可汇总数值（字段因供应商而异）。
 * @returns {{ prompt_cached_tokens: number, reasoning_tokens: number, prompt_cache_known: boolean, reasoning_known: boolean }}
 */
function extractUsageCacheMetrics(usage) {
  let prompt_cached_tokens = 0;
  let reasoning_tokens = 0;
  let prompt_cache_known = false;
  let reasoning_known = false;
  if (!usage || typeof usage !== 'object') {
    return { prompt_cached_tokens: 0, reasoning_tokens: 0, prompt_cache_known: false, reasoning_known: false };
  }
  const ptd = usage.prompt_tokens_details;
  if (ptd && typeof ptd === 'object' && ptd.cached_tokens != null) {
    const c = Number(ptd.cached_tokens);
    if (!Number.isNaN(c) && c >= 0) {
      prompt_cached_tokens = Math.floor(c);
      prompt_cache_known = true;
    }
  }
  const ctd = usage.completion_tokens_details;
  if (ctd && typeof ctd === 'object' && ctd.reasoning_tokens != null) {
    const r = Number(ctd.reasoning_tokens);
    if (!Number.isNaN(r) && r >= 0) {
      reasoning_tokens = Math.floor(r);
      reasoning_known = true;
    }
  }
  if (!prompt_cache_known) {
    const skipTop = new Set([
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'prompt_tokens_details',
      'completion_tokens_details',
    ]);
    for (const k of Object.keys(usage)) {
      if (skipTop.has(k)) continue;
      if (!/cache|cached/i.test(k)) continue;
      const v = usage[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
      prompt_cached_tokens += Math.floor(v);
      prompt_cache_known = true;
    }
  }
  return { prompt_cached_tokens, reasoning_tokens, prompt_cache_known, reasoning_known };
}

function usageCacheExtraParts(usage) {
  if (!usage || typeof usage !== 'object') return [];
  const parts = [];
  const ptd = usage.prompt_tokens_details;
  if (ptd && typeof ptd === 'object' && ptd.cached_tokens != null) {
    parts.push('prompt_cached_tokens=' + ptd.cached_tokens);
  }
  const ctd = usage.completion_tokens_details;
  if (ctd && typeof ctd === 'object' && ctd.reasoning_tokens != null && Number(ctd.reasoning_tokens) > 0) {
    parts.push('reasoning_tokens=' + ctd.reasoning_tokens);
  }
  const skipTop = new Set(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_tokens_details', 'completion_tokens_details']);
  for (const k of Object.keys(usage)) {
    if (skipTop.has(k)) continue;
    if (!/cache|cached/i.test(k)) continue;
    const v = usage[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    parts.push(k + '=' + v);
  }
  return parts;
}

/**
 * @param {string} label 如 chat、chatWithTools、chatStream
 * @param {Record<string, unknown>} usage
 */
function logDeepSeekUsageResponse(label, usage) {
  if (!usage || typeof usage !== 'object') return;
  const pt = usage.prompt_tokens;
  const ct = usage.completion_tokens;
  const tt = usage.total_tokens;
  let line = '[Aris v2] DeepSeek ' + label + ' response: prompt_tokens= ' + pt + ' completion_tokens= ' + ct;
  if (tt != null) line += ' total_tokens= ' + tt;
  const extra = usageCacheExtraParts(usage);
  if (extra.length) line += ' ' + extra.join(' ');
  console.info(line);
}

module.exports = { usageCacheExtraParts, logDeepSeekUsageResponse, extractUsageCacheMetrics };
