/**
 * 网络访问工具：fetch_url。仅 GET 抓取页面正文，支持 selector、可选摘要。
 * 配置见 memory/network_config.json 或环境变量；速率限制与审计日志。
 * 使用 Node 原生 https/http 模块以兼容 Electron 主进程中的 HTTPS（避免 fetch 的 TLS 行为差异）。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getNetworkConfigPath } = require('../../../config/paths.js');

const DEFAULT_MAX_LENGTH = 8000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_CALLS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60 * 1000;

let cachedConfig = null;

function getNetworkConfigPathFn() {
  try {
    return getNetworkConfigPath();
  } catch (_) {
    return null;
  }
}

function readNetworkConfig() {
  if (cachedConfig) return cachedConfig;
  const configPath = getNetworkConfigPathFn();
  if (!configPath) {
    cachedConfig = buildConfigFromEnv({});
    return cachedConfig;
  }
  const dir = path.dirname(configPath);
  let data = {};
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8').trim();
      if (raw) data = JSON.parse(raw);
    }
  } catch (_) {}
  const merged = buildConfigFromEnv(data);
  const defaultBlocked = ['localhost', '127.0.0.1'];
  if (!fs.existsSync(configPath) || Object.keys(data).length === 0) {
    try {
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            enable_web_fetch: merged.enable_web_fetch,
            allowed_hosts: merged.allowed_hosts,
            blocked_hosts: (merged.blocked_hosts && merged.blocked_hosts.length > 0) ? merged.blocked_hosts : defaultBlocked,
            timeout_ms: merged.timeout_ms,
            max_calls_per_minute: merged.max_calls_per_minute,
            max_length: merged.max_length,
            reject_unauthorized: merged.reject_unauthorized,
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (_) {}
  }
  cachedConfig = merged;
  return cachedConfig;
}

function readAppConfigJson() {
  try {
    const { getDataDir } = require('../../../config/paths.js');
    const p = path.join(getDataDir(), 'config.json');
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) return JSON.parse(raw);
    }
  } catch (_) {}
  return {};
}

function buildConfigFromEnv(data) {
  const app = readAppConfigJson();
  const env = process.env;
  const enable = env.ENABLE_WEB_FETCH != null
    ? env.ENABLE_WEB_FETCH === 'true' || env.ENABLE_WEB_FETCH === '1'
    : (app.ENABLE_WEB_FETCH != null ? app.ENABLE_WEB_FETCH === 'true' : (data.enable_web_fetch !== false));
  const allowed = env.WEB_FETCH_ALLOWED_HOSTS
    ? env.WEB_FETCH_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : (app.WEB_FETCH_ALLOWED_HOSTS != null && app.WEB_FETCH_ALLOWED_HOSTS !== ''
      ? String(app.WEB_FETCH_ALLOWED_HOSTS).split(',').map((h) => h.trim()).filter(Boolean)
      : (data.allowed_hosts || []));
  const blocked = env.WEB_FETCH_BLOCKED_HOSTS
    ? env.WEB_FETCH_BLOCKED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : (app.WEB_FETCH_BLOCKED_HOSTS != null && app.WEB_FETCH_BLOCKED_HOSTS !== ''
      ? String(app.WEB_FETCH_BLOCKED_HOSTS).split(',').map((h) => h.trim()).filter(Boolean)
      : (data.blocked_hosts && data.blocked_hosts.length > 0 ? data.blocked_hosts : ['localhost', '127.0.0.1']));
  const timeout = Number(env.WEB_FETCH_TIMEOUT_MS) || Number(app.WEB_FETCH_TIMEOUT_MS) || data.timeout_ms || DEFAULT_TIMEOUT_MS;
  const maxCalls = Number(env.WEB_FETCH_MAX_CALLS_PER_MINUTE) || Number(app.WEB_FETCH_MAX_CALLS_PER_MINUTE) || data.max_calls_per_minute || DEFAULT_MAX_CALLS_PER_MINUTE;
  const maxLength = Number(env.WEB_FETCH_MAX_LENGTH) || Number(app.WEB_FETCH_MAX_LENGTH) || data.max_length || DEFAULT_MAX_LENGTH;
  const rejectUnauthorized = env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
    ? false
    : (app.REJECT_UNAUTHORIZED === 'false' || app.reject_unauthorized === false || app.reject_unauthorized === 'false' ? false : (data.reject_unauthorized === false ? false : true));
  return {
    enable_web_fetch: enable,
    allowed_hosts: allowed,
    blocked_hosts: blocked,
    timeout_ms: Math.max(5000, Math.min(60000, timeout)),
    max_calls_per_minute: Math.max(1, Math.min(60, maxCalls)),
    max_length: Math.max(1000, Math.min(100000, maxLength)),
    reject_unauthorized: rejectUnauthorized,
  };
}

function isNetworkFetchEnabled() {
  return readNetworkConfig().enable_web_fetch;
}

/** 速率限制：按 key（global 或 sessionId）统计每分钟调用次数 */
const rateLimitMap = new Map();

function checkRateLimit(key) {
  const config = readNetworkConfig();
  const now = Date.now();
  let entry = rateLimitMap.get(key);
  if (!entry) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitMap.set(key, entry);
  }
  if (now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }
  entry.count += 1;
  if (entry.count > config.max_calls_per_minute) {
    return false;
  }
  return true;
}

function parseUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch (_) {
    return { ok: false, error: '无效的 URL' };
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: '仅支持 http 与 https' };
  }
  const host = (url.hostname || '').toLowerCase();
  const config = readNetworkConfig();
  if (config.blocked_hosts && config.blocked_hosts.length > 0) {
    const blocked = config.blocked_hosts.some((h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase()));
    if (blocked) return { ok: false, error: '该主机已被禁止访问' };
  }
  if (config.allowed_hosts && config.allowed_hosts.length > 0) {
    const allowed = config.allowed_hosts.some((h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase()));
    if (!allowed) return { ok: false, error: '该主机不在允许列表中' };
  }
  return { ok: true, url, host };
}

function stripHtmlToText(html, selector) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html, { decodeEntities: true });
  $('script, style, noscript, iframe').remove();
  let $root = $.root();
  if (selector && typeof selector === 'string') {
    const sel = selector.trim();
    const $el = $(sel).first();
    if ($el.length) $root = $el;
  }
  const text = $root.text().replace(/\s+/g, ' ').trim();
  return text;
}

function requestWithNode(urlObj, timeoutMs) {
  const config = readNetworkConfig();
  const url = urlObj.url;
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: { 'User-Agent': 'Aris-v2/1.0 (read-only)' },
    timeout: timeoutMs,
  };
  if (isHttps && config.reject_unauthorized === false) {
    options.agent = new https.Agent({ rejectUnauthorized: false });
  }
  return new Promise((resolve, reject) => {
    const req = lib.get(options, (res) => {
      const redirect = res.statusCode >= 300 && res.statusCode < 400 && res.headers.location;
      if (redirect) {
        const nextUrl = redirect.startsWith('http') ? redirect : (url.origin + (redirect.startsWith('/') ? redirect : '/' + redirect));
        try {
          const next = new URL(nextUrl);
          requestWithNode({ ok: true, url: next, host: next.hostname }, timeoutMs).then(resolve).catch(reject);
          return;
        } catch (_) {
          reject(new Error('重定向 URL 无效'));
          return;
        }
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('text/html')) {
          const text = body.slice(0, 12000).replace(/\s+/g, ' ');
          resolve({ ok: true, text, statusCode: res.statusCode, truncated: body.length >= 12000 });
        } else {
          resolve({ ok: true, html: body, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

async function fetchUrlContent(urlObj, timeoutMs) {
  try {
    const result = await requestWithNode(urlObj, timeoutMs);
    return result;
  } catch (e) {
    if (e?.message === '请求超时') return { ok: false, error: '请求超时' };
    const msg = e?.message || (e?.cause && e.cause.message) || '请求失败';
    return { ok: false, error: msg };
  }
}

async function summarizeWithLlm(text, maxChars) {
  try {
    const { chat } = require('../../llm/client.js');
    const content = text.slice(0, 30000);
    const messages = [
      { role: 'user', content: `请将以下网页正文压缩为 ${maxChars || 500} 字以内的中文摘要，保留关键信息与结论。不要加「根据上文」等前缀。\n\n${content}` },
    ];
    const { content: summary } = await chat(messages);
    if (summary && !summary.includes('未配置 API')) return summary.trim();
  } catch (_) {}
  return null;
}

const NETWORK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '根据 URL 获取网页正文内容（仅 GET，不执行脚本）。用于了解新闻、文档、百科等外界信息。需要了解外界信息时可调用。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要请求的完整 URL（必须 http 或 https）' },
          max_length: { type: 'number', description: '返回文本最大字符数，默认 8000' },
          selector: { type: 'string', description: '可选。CSS 选择器抽取主体，如 main、article、.content，减少噪音' },
          summarize: { type: 'boolean', description: '可选。为 true 时对正文做简短摘要再返回，节省 token' },
        },
        required: ['url'],
      },
    },
  },
];

async function runNetworkTool(name, args, context) {
  const a = args || {};
  if (name !== 'fetch_url') return { ok: false, error: 'Unknown tool: ' + name };

  const config = readNetworkConfig();
  if (!config.enable_web_fetch) {
    return { ok: false, error: '网络访问未启用，请在 memory/network_config.json 或环境变量中开启 enable_web_fetch' };
  }

  const rateKey = (context && context.sessionId) ? `session:${context.sessionId}` : 'global';
  if (!checkRateLimit(rateKey)) {
    return { ok: false, error: '网络请求过于频繁，请稍后再试' };
  }

  const parsed = parseUrl((a.url || '').trim());
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const maxLength = Math.min(config.max_length, Number(a.max_length) || config.max_length);
  const timeoutMs = config.timeout_ms;

  const fetchResult = await fetchUrlContent(parsed, timeoutMs);
  if (!fetchResult.ok) {
    console.warn('[Aris v2][fetch_url] url=', parsed.url.href, 'error=', fetchResult.error);
    return { ok: false, error: fetchResult.error };
  }

  let text;
  if (fetchResult.html != null) {
    text = stripHtmlToText(fetchResult.html, a.selector || null);
  } else {
    text = fetchResult.text || '';
  }

  const truncated = text.length > maxLength;
  if (truncated) text = text.slice(0, maxLength);

  if (a.summarize && text.length > 800) {
    const summary = await summarizeWithLlm(text, 500);
    if (summary) text = summary;
  }

  console.info(
    '[Aris v2][fetch_url] url=', parsed.url.href,
    'status=', fetchResult.statusCode,
    'truncated=', truncated,
    'length=', text.length
  );

  return {
    ok: true,
    content: text,
    status_code: fetchResult.statusCode,
    truncated,
    url: parsed.url.href,
  };
}

function clearNetworkConfigCache() {
  cachedConfig = null;
}

module.exports = {
  NETWORK_TOOLS,
  runNetworkTool,
  isNetworkFetchEnabled,
  readNetworkConfig,
  clearNetworkConfigCache,
};
