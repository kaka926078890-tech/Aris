/**
 * DeepSeek / OpenAI 兼容：usage 里「缓存命中」等字段的终端日志片段。
 * 不同供应商字段名不一，除显式解析外，对顶层键名含 cache/cached 的也会打印。
 */

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

module.exports = { usageCacheExtraParts, logDeepSeekUsageResponse };
