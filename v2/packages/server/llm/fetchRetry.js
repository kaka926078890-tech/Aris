/**
 * DeepSeek 等外网 API 偶发 ECONNRESET / undici terminated，对瞬时网络错误做有限次重试。
 *
 * 说明：同一轮里常出现「Planner 的 chat 成功、紧接着 chatWithTools 失败」——后者请求体明显更大（tools 列表等），
 * 部分网络/代理/对端会对复用的 keep-alive 连接在第二次大包时直接 RST。默认对 LLM 请求加 Connection: close，
 * 尽量不复用同一 TCP，减轻此类与「并发对话」无关的现象。
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function maxRetries() {
  const n = Number(process.env.ARIS_LLM_MAX_RETRIES);
  if (Number.isFinite(n) && n >= 1) return Math.min(12, Math.floor(n));
  return 5;
}

/** 单次重试基础间隔（ms），指数退避：base * 2^attempt */
function retryBaseMs() {
  const n = Number(process.env.ARIS_LLM_RETRY_BASE_MS);
  if (Number.isFinite(n) && n >= 100) return Math.min(10000, Math.floor(n));
  return 400;
}

/**
 * 是否适合重试。用户中止时不要重试。
 * undici 在 TLS 被 RST 时常抛 TypeError，message 为 "terminated"，cause 为 ECONNRESET。
 */
function isTransientNetError(e, signal) {
  if (!e || e.name === 'AbortError') return false;
  if (signal && signal.aborted) return false;
  const c = e.cause || e;
  const code = c.code || e.code;
  const msg = String(e.message || '');
  if (code === 'EEMPTYBODY' || msg.includes('empty body')) {
    return true;
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ENETUNREACH' || code === 'EAI_AGAIN') {
    return true;
  }
  if (msg.includes('ECONNRESET') || msg.includes('fetch failed') || msg.includes('socket')) {
    return true;
  }
  if (msg === 'terminated' || msg.includes('terminated')) {
    return true;
  }
  return false;
}

/** 是否为用户主动中断（与网络失败区分，便于上层返回 aborted） */
function isLikelyUserAbort(e, signal) {
  if (!e) return false;
  if (e.name === 'AbortError') return true;
  if (signal && signal.aborted) return true;
  return false;
}

function buildLlmFetchInit(init) {
  const out = { ...init };
  if (process.env.ARIS_LLM_HTTP_CLOSE !== 'false') {
    const headers = { ...(init.headers || {}) };
    if (!headers.Connection && !headers.connection) headers.Connection = 'close';
    out.headers = headers;
  }
  return out;
}

/**
 * POST JSON，解析 JSON 响应；对 fetch 层瞬时错误与 429 做重试。
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} logLabel
 */
async function postJsonWithRetry(url, init, logLabel = 'llm') {
  const cap = maxRetries();
  const base = retryBaseMs();
  const mergedInit = buildLlmFetchInit(init);
  let lastErr;
  for (let attempt = 0; attempt < cap; attempt++) {
    try {
      const res = await fetch(url, mergedInit);
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 429 && attempt < cap - 1) {
          const wait = 1500 * (attempt + 1);
          console.warn(`[Aris v2] ${logLabel} HTTP 429, retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new Error(`DeepSeek ${res.status}: ${text}`);
      }
      if (!String(text || '').trim()) {
        const err = new Error(`DeepSeek ${res.status}: empty body`);
        err.code = 'EEMPTYBODY';
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(`DeepSeek ${res.status}: ${text}`);
      }
    } catch (e) {
      lastErr = e;
      if (mergedInit.signal?.aborted || e.name === 'AbortError') {
        throw e;
      }
      if (attempt < cap - 1 && isTransientNetError(e, mergedInit.signal)) {
        const wait = base * Math.pow(2, attempt);
        console.warn(
          `[Aris v2] ${logLabel} transient network error, attempt ${attempt + 1}/${cap}, next in ${wait}ms`,
          e?.message || e,
        );
        await sleep(wait);
        if (mergedInit.signal?.aborted) throw e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { postJsonWithRetry, isTransientNetError, isLikelyUserAbort, maxRetries, buildLlmFetchInit };
