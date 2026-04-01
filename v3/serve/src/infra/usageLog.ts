/**
 * DeepSeek / OpenAI 兼容：从 usage 中解析「Prompt 缓存命中」「推理 token」等（与 v2 packages/server/llm/usageLog.js 对齐）。
 */

export type UsageCacheMetrics = {
  prompt_cached_tokens: number;
  prompt_uncached_tokens: number;
  reasoning_tokens: number;
  prompt_cache_known: boolean;
  reasoning_known: boolean;
};

export function extractUsageCacheMetrics(
  usage: Record<string, unknown> | null | undefined,
): UsageCacheMetrics {
  let prompt_cached_tokens = 0;
  let reasoning_tokens = 0;
  let prompt_cache_known = false;
  let reasoning_known = false;
  if (!usage || typeof usage !== 'object') {
    return {
      prompt_cached_tokens: 0,
      prompt_uncached_tokens: 0,
      reasoning_tokens: 0,
      prompt_cache_known: false,
      reasoning_known: false,
    };
  }
  const ptd = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  if (ptd && typeof ptd === 'object' && ptd.cached_tokens != null) {
    const c = Number(ptd.cached_tokens);
    if (!Number.isNaN(c) && c >= 0) {
      prompt_cached_tokens = Math.floor(c);
      prompt_cache_known = true;
    }
  }
  const ctd = usage.completion_tokens_details as Record<string, unknown> | undefined;
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
  const pt = Number(usage.prompt_tokens);
  const prompt_uncached_tokens =
    prompt_cache_known && !Number.isNaN(pt) && pt >= 0
      ? Math.max(0, Math.floor(pt) - prompt_cached_tokens)
      : 0;
  return {
    prompt_cached_tokens,
    prompt_uncached_tokens,
    reasoning_tokens,
    prompt_cache_known,
    reasoning_known,
  };
}

/** 与 v2 logDeepSeekUsageResponse 同款的单行可读摘要（便于扫终端） */
export function formatLlmUsageLine(
  label: string,
  usage: Record<string, unknown> | null | undefined,
): string {
  if (!usage || typeof usage !== 'object') return '';
  const pt = usage.prompt_tokens;
  const ct = usage.completion_tokens;
  const tt = usage.total_tokens;
  let line = `[Aris v3] DeepSeek ${label} response: prompt_tokens=${pt} completion_tokens=${ct}`;
  if (tt != null) line += ` total_tokens=${tt}`;
  const ptd = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  if (ptd && typeof ptd === 'object' && ptd.cached_tokens != null) {
    line += ` prompt_cached_tokens=${ptd.cached_tokens}`;
  }
  const ctd = usage.completion_tokens_details as Record<string, unknown> | undefined;
  if (ctd && typeof ctd === 'object' && ctd.reasoning_tokens != null && Number(ctd.reasoning_tokens) > 0) {
    line += ` reasoning_tokens=${ctd.reasoning_tokens}`;
  }
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
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    line += ` ${k}=${v}`;
  }
  return line;
}

/** 结构化日志字段 + 与 v2 一致的可读一行 */
export function logLlmUsage(
  log: { info: (obj: Record<string, unknown>, msg?: string) => void },
  label: string,
  usage: Record<string, unknown> | null | undefined,
  extras?: { elapsed_ms?: number },
): void {
  if (!usage || typeof usage !== 'object') return;
  const pt = Number(usage.prompt_tokens) || 0;
  const ct = Number(usage.completion_tokens) || 0;
  const ex = extractUsageCacheMetrics(usage);
  const line = formatLlmUsageLine(label, usage);
  log.info(
    {
      label,
      ...(extras?.elapsed_ms != null ? { elapsed_ms: extras.elapsed_ms } : {}),
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: usage.total_tokens,
      ...(ex.prompt_cache_known
        ? {
            prompt_cached_tokens: ex.prompt_cached_tokens,
            prompt_uncached_tokens: ex.prompt_uncached_tokens,
          }
        : {}),
      ...(ex.reasoning_known ? { reasoning_tokens: ex.reasoning_tokens } : {}),
    },
    line || `[Aris v3] DeepSeek ${label} usage`,
  );
}
