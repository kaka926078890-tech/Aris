/**
 * Web 版 Aris：托管与 Electron 相同的 apps/renderer/index.html，并用 HTTP 模拟 preload API。
 * 启动：在 v2 目录 npm run web-chat
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { loadAndApplyRuntimeConfig } = require('../electron/runtimeConfig.js');
loadAndApplyRuntimeConfig();

const { runDialogueNdjson, abortDialogue, rpc } = require('./webApiHandlers.js');
const { importFromParsedPayload, buildExportPayload } = require('../electron/backup.js');

const PORT = parseInt(process.env.ARIS_WEB_CHAT_PORT || '8780', 10) || 8780;
const TOKEN = process.env.ARIS_WEB_CHAT_TOKEN || '';
const RENDERER_INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const BRIDGE_JS = path.join(__dirname, 'public', 'aris-web-bridge.js');

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
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

/** 合并重复斜杠、去掉末尾 /，避免与路由匹配失败 */
function normalizePathname(req) {
  try {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    let p = u.pathname.replace(/\/+/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  } catch (_) {
    return '/';
  }
}

function getIndexHtml() {
  let html = fs.readFileSync(RENDERER_INDEX, 'utf8');
  if (!html.includes('aris-web-bridge.js')) {
    html = html.replace(
      /<script>\s*\r?\n\s*const messagesEl/,
      '<script src="/aris-web-bridge.js"></script>\n  <script>\n    const messagesEl',
    );
  }
  if (!html.includes('aris-web-hide-minimize')) {
    html = html.replace('</head>', '<style id="aris-web-hide-minimize">#btn-minimize{display:none!important}</style></head>');
  }
  return html;
}

const server = http.createServer(async (req, res) => {
  const pathname = normalizePathname(req);

  if (req.method === 'GET' && pathname === '/aris-web-bridge.js') {
    if (!fs.existsSync(BRIDGE_JS)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing aris-web-bridge.js');
      return;
    }
    const js = fs.readFileSync(BRIDGE_JS, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(js);
    return;
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (!fs.existsSync(RENDERER_INDEX)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('missing apps/renderer/index.html');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getIndexHtml());
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, service: 'aris-web-chat', ui: 'renderer' });
  }

  if (!checkAuth(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'POST' && pathname === '/api/dialogue/send') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return json(res, 400, { error: 'invalid_json' });
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!text) {
      return json(res, 400, { error: 'missing_text' });
    }
    await runDialogueNdjson(res, text);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/dialogue/abort') {
    abortDialogue();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/backup/export') {
    abortDialogue();
    try {
      const payload = await buildExportPayload();
      const body = JSON.stringify(payload);
      const name = `aris-v2-backup-${new Date().toISOString().slice(0, 10)}.aris`;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      console.error('[aris-web-chat] backup export', e);
      return json(res, 500, { error: e && e.message ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/backup/import') {
    abortDialogue();
    let raw;
    try {
      raw = await readBody(req);
      if (!raw || !String(raw).trim()) {
        return json(res, 400, { error: 'empty_body' });
      }
      const payload = JSON.parse(raw);
      await importFromParsedPayload(payload, { label: 'web-upload' });
      return json(res, 200, { ok: true, version: payload.version || 1 });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (e instanceof SyntaxError) {
        return json(res, 400, { error: 'invalid_backup_json', detail: msg });
      }
      console.error('[aris-web-chat] backup import', e);
      return json(res, 500, { error: msg });
    }
  }

  if (req.method === 'POST' && pathname === '/api/rpc') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return json(res, 400, { error: 'invalid_json' });
    }
    const method = typeof payload.method === 'string' ? payload.method : '';
    const args = Array.isArray(payload.args) ? payload.args : [];
    if (!method) {
      return json(res, 400, { error: 'missing_method' });
    }
    try {
      const result = await rpc(method, args);
      return json(res, 200, { ok: true, result });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (msg.startsWith('unknown_rpc_method')) {
        return json(res, 400, { error: msg });
      }
      console.error('[aris-web-chat] rpc', method, e);
      return json(res, 500, { error: msg });
    }
  }

  /* 兼容旧版简单客户端 */
  if (req.method === 'POST' && pathname === '/api/chat') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return json(res, 400, { error: 'invalid_json' });
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    let sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!sessionId) sessionId = 'web:default';
    if (!text) {
      return json(res, 400, { error: 'missing_text' });
    }
    const { handleUserMessage } = require('../../packages/server');
    try {
      const chunks = [];
      const sendChunk = (c) => {
        if (typeof c === 'string' && c) chunks.push(c);
      };
      const result = await handleUserMessage(text, sendChunk, () => {}, undefined, { sessionId });
      const content = result && typeof result.content === 'string' ? result.content : '';
      return json(res, 200, {
        ok: !result.error,
        content,
        sessionId: result.sessionId,
        error: result.error || false,
      });
    } catch (e) {
      return json(res, 500, { error: String(e && e.message ? e.message : e) });
    }
  }

  return json(res, 404, {
    error: 'not_found',
    method: req.method,
    path: pathname,
    hint:
      '若访问的是备份导入：请确认 URL 为 POST /api/backup/import；更新代码后需在运行 web-chat 的终端按 Ctrl+C 停止并重新执行 npm run web-chat。',
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      '[aris-web-chat] 端口 ' + PORT + ' 已被占用（EADDRINUSE）。请：① 关掉已运行的 web-chat / 其它占用进程；② 或在 v2/.env 设置 ARIS_WEB_CHAT_PORT=8781 后重试。',
    );
    process.exit(1);
  }
  console.error('[aris-web-chat] listen error', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.info('[aris-web-chat] 完整 UI（与 Electron 同源页面）: http://127.0.0.1:' + PORT);
  console.info(
    '[aris-web-chat] API: NDJSON POST /api/dialogue/send | POST /api/rpc | GET /api/backup/export | POST /api/backup/import | POST /api/chat（旧）',
  );
  console.info('[aris-web-chat] 备份：GET /api/backup/export · POST /api/backup/import（与桌面 .aris 同格式）');
  if (!TOKEN) {
    console.warn('[aris-web-chat] ARIS_WEB_CHAT_TOKEN 未设置，仅本机可访问时通常可接受；暴露到局域网前请设置 Token');
  }
});
