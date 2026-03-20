/**
 * 官方 QQ 机器人桥接（方案二）：本机 HTTP 入口，将消息交给 Aris handleUserMessage（显式 sessionId）。
 * 腾讯侧 Webhook / OpenAPI 对接请在本进程前再加一层网关，或在此文件内扩展（以官方文档为准）。
 *
 * 启动：在 v2 目录下 ARIS_QQ_BRIDGE_PORT=8765 node apps/qq-bridge/index.js
 * 或 npm run qq-bridge
 */
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { handleUserMessage } = require('../../packages/server');

const PORT = parseInt(process.env.ARIS_QQ_BRIDGE_PORT || '8765', 10) || 8765;
const TOKEN = process.env.ARIS_QQ_BRIDGE_TOKEN || '';

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m && m[1] === TOKEN;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'aris-qq-bridge',
      qq_bot_credentials_loaded: !!(process.env.QQ_BOT_APP_ID && process.env.QQ_BOT_APP_SECRET),
    });
  }

  if (req.method !== 'POST' || req.url !== '/chat') {
    return json(res, 404, { error: 'not_found' });
  }

  if (!checkAuth(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    return json(res, 400, { error: 'invalid_json' });
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (!text) {
    return json(res, 400, { error: 'missing_text' });
  }
  if (!sessionId) {
    return json(res, 400, { error: 'missing_sessionId' });
  }

  const chunks = [];
  const sendChunk = (c) => {
    if (typeof c === 'string' && c) chunks.push(c);
  };
  const sendAgentActions = () => {};

  try {
    const result = await handleUserMessage(text, sendChunk, sendAgentActions, undefined, { sessionId });
    const content = result && typeof result.content === 'string' ? result.content : '';
    return json(res, 200, {
      ok: !result.error,
      content,
      sessionId: result.sessionId,
      error: result.error || false,
    });
  } catch (e) {
    console.error('[aris-qq-bridge]', e);
    return json(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.info('[aris-qq-bridge] listening on http://127.0.0.1:' + PORT + ' POST /chat');
  if (!TOKEN) console.warn('[aris-qq-bridge] ARIS_QQ_BRIDGE_TOKEN 未设置，任意客户端可调用本机接口，生产环境请设置');
});
