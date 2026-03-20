/**
 * QQ 官方事件处理（MVP）：
 * - 解析 webhook payload（op/t/d 或扁平结构）
 * - 生成 sessionId 调 Aris
 * - 用 QQ OpenAPI 回发（users/groups）
 */
const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const QQ_OPENAPI_BASE = process.env.QQ_BOT_OPENAPI_BASE || 'https://api.sgroup.qq.com';
const SESSION_MODE = process.env.ARIS_QQ_SESSION_MODE || 'group_member';

let tokenCache = { token: '', expireAt: 0 };

function trimText(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function pickEvent(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return p.d && typeof p.d === 'object' ? p.d : p;
}

function normalizeInbound(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const d = pickEvent(p);
  const content = trimText(d.content);
  if (!content) return null;
  if (d.author && d.author.bot) return null;

  const groupId = trimText(d.group_openid);
  const userId = trimText(d.user_openid || d.openid);
  const memberId = trimText(d.author && (d.author.member_openid || d.author.id));
  const msgId = trimText(d.id || d.msg_id || p.id);
  const eventId = trimText(p.id || d.event_id || d.id);

  if (groupId) {
    return {
      scope: 'group',
      targetId: groupId,
      senderId: memberId || 'unknown',
      content,
      msgId,
      eventId,
    };
  }
  if (userId) {
    return {
      scope: 'user',
      targetId: userId,
      senderId: userId,
      content,
      msgId,
      eventId,
    };
  }
  return null;
}

function toSessionId(inb) {
  if (inb.scope === 'group') {
    if (SESSION_MODE === 'group_shared') return `qq:group:${inb.targetId}`;
    return `qq:group:${inb.targetId}:${inb.senderId}`;
  }
  return `qq:private:${inb.targetId}`;
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expireAt > now + 30000) return tokenCache.token;
  const appId = process.env.QQ_BOT_APP_ID || '';
  const secret = process.env.QQ_BOT_APP_SECRET || '';
  if (!appId || !secret) throw new Error('QQ_BOT_APP_ID / QQ_BOT_APP_SECRET missing');

  const res = await fetch(QQ_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: secret }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`getAppAccessToken ${res.status}: ${text}`);
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  const token = trimText(data.access_token);
  const expires = Math.max(60, Number(data.expires_in) || 7200);
  if (!token) throw new Error('empty access_token');
  tokenCache = { token, expireAt: now + expires * 1000 };
  return token;
}

function endpointFor(inb) {
  if (inb.scope === 'group') return `${QQ_OPENAPI_BASE}/v2/groups/${encodeURIComponent(inb.targetId)}/messages`;
  return `${QQ_OPENAPI_BASE}/v2/users/${encodeURIComponent(inb.targetId)}/messages`;
}

async function sendReply(inb, text) {
  const appId = process.env.QQ_BOT_APP_ID || '';
  const token = await getAccessToken();
  const body = {
    content: (text || '').slice(0, 1800) || '（空回复）',
  };
  if (inb.msgId) body.msg_id = inb.msgId;
  if (inb.eventId) body.event_id = inb.eventId;

  const res = await fetch(endpointFor(inb), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `QQBot ${token}`,
      'X-Union-Appid': appId,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`send message ${res.status}: ${raw}`);
  return raw;
}

async function handleOfficialWebhook(payload, runArisChat) {
  const inb = normalizeInbound(payload);
  if (!inb) return { ok: true, ignored: true, reason: 'unsupported_or_empty' };
  const sessionId = toSessionId(inb);
  const aris = await runArisChat(inb.content, sessionId);
  const reply = trimText(aris && aris.content) || '（收到）';
  await sendReply(inb, reply);
  return { ok: true, ignored: false, scope: inb.scope, sessionId };
}

module.exports = { handleOfficialWebhook };
