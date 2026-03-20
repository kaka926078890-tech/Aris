/**
 * DeepSeek 等外网 API 偶发 ECONNRESET / undici terminated，对瞬时网络错误做有限次重试。
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function maxRetries() {
  const n = Number(process.env.ARIS_LLM_MAX_RETRIES);
  if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
  return 3;
}

/** 是否适合重试（非业务 4xx） */
function isTransientNetError(e) {
  if (!e || e.name === 'AbortError') return false;
  const c = e.cause || e;
  const code = c.code || e.code;
  const msg = String(e.message || '');
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ENETUNREACH' || code === 'EAI_AGAIN') {
    return true;
  }
  if (msg.includes('ECONNRESET') || msg.includes('terminated') || msg.includes('fetch failed') || msg.includes('socket')) {
    return true;
  }
  return false;
}

/**
 * POST JSON，解析 JSON 响应；对 fetch 层瞬时错误与 429 做重试。
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} logLabel
 */
async function postJsonWithRetry(url, init, logLabel = 'llm') {
  const cap = maxRetries();
  let lastErr;
  for (let attempt = 0; attempt < cap; attempt++) {
    try {
      const res = await fetch(url, init);
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
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(`DeepSeek ${res.status}: ${text}`);
      }
    } catch (e) {
      lastErr = e;
      if (attempt < cap - 1 && isTransientNetError(e)) {
        const wait = 400 * Math.pow(2, attempt);
        console.warn(`[Aris v2] ${logLabel} transient network error, retry ${attempt + 1}/${cap - 1} in ${wait}ms`, e?.message || e);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { postJsonWithRetry, isTransientNetError, maxRetries };
