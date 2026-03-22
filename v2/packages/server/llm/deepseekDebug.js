/**
 * 可选：在终端打印发往 DeepSeek 的 JSON 请求体（不含 Authorization）。
 * 由 ARIS_DEBUG_DEEPSEEK_REQUEST_BODY 控制，默认关闭。
 * chatWithTools 的 tools 列表默认省略（过长）；需全文时设 ARIS_DEBUG_DEEPSEEK_TOOLS=true。
 */

function isDeepSeekRequestBodyDebugEnabled() {
  const v = process.env.ARIS_DEBUG_DEEPSEEK_REQUEST_BODY;
  return v === 'true' || v === '1';
}

function isDeepSeekToolsInBodyDebugEnabled() {
  const v = process.env.ARIS_DEBUG_DEEPSEEK_TOOLS;
  return v === 'true' || v === '1';
}

/** 浅拷贝并替换 tools，避免调试日志被超长 tool 定义刷屏 */
function payloadForDebugLog(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (isDeepSeekToolsInBodyDebugEnabled()) return payload;
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) return payload;
  return {
    ...payload,
    tools: `[已省略 ${payload.tools.length} 个 tool 定义；需要全文请在 .env 设 ARIS_DEBUG_DEEPSEEK_TOOLS=true]`,
  };
}

/** @param {string} label 如 chat、chatWithTools、chatStream */
function logDeepSeekRequestBody(label, payload) {
  if (!isDeepSeekRequestBodyDebugEnabled()) return;
  try {
    const forLog = payloadForDebugLog(payload);
    console.info('[Aris v2][debug] DeepSeek ' + label + ' request body JSON:\n' + JSON.stringify(forLog, null, 2));
  } catch (e) {
    console.warn('[Aris v2][debug] DeepSeek ' + label + ' request body stringify failed:', e?.message || e);
  }
}

module.exports = { isDeepSeekRequestBodyDebugEnabled, logDeepSeekRequestBody };
