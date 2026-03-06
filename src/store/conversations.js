const { getDb, persist } = require('./db.js');

async function getCurrentSessionId() {
  const db = await getDb();
  const stmt = db.prepare("SELECT value FROM settings WHERE key = 'current_session_id'");
  if (stmt.step()) {
    const val = stmt.get()[0];
    stmt.free();
    return val;
  }
  stmt.free();
  const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  const ins = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  ins.bind(['current_session_id', id]);
  ins.step();
  ins.free();
  persist();
  return id;
}

async function append(sessionId, role, content) {
  const db = await getDb();
  const stmt = db.prepare('INSERT INTO conversations (session_id, role, content, created_at) VALUES (?, ?, ?, ?)');
  stmt.bind([sessionId, role, content, Math.floor(Date.now() / 1000)]);
  stmt.step();
  stmt.free();
  persist();
}

async function getRecent(sessionId, limit = 20) {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  );
  stmt.bind([sessionId, limit]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows.reverse().map(([role, content, created_at]) => ({ role, content, created_at }));
}

async function getAllForSession(sessionId) {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC'
  );
  stmt.bind([sessionId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows.map(([role, content, created_at]) => ({ role, content, created_at }));
}

async function getAllSessions() {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT session_id, MAX(created_at) AS last_at FROM conversations GROUP BY session_id ORDER BY last_at DESC'
  );
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows.map(([session_id, last_at]) => ({ session_id, last_at }));
}

/**
 * 删除所有会话记录（conversations 表清空，settings 保留）。
 */
async function clearAllConversations() {
  const db = await getDb();
  const stmt = db.prepare('DELETE FROM conversations');
  stmt.step();
  stmt.free();
  persist();
}

/**
 * 近期「非当前会话」的对话，按时间倒序。用于跨会话回忆（身份、偏好等），
 * 不依赖向量召回，直接给模型看真实历史对话。
 */
async function getRecentFromOtherSessions(currentSessionId, limit = 40) {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT role, content, created_at FROM conversations WHERE session_id != ? ORDER BY created_at DESC LIMIT ?'
  );
  stmt.bind([currentSessionId, limit]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows.reverse().map(([role, content, created_at]) => ({ role, content, created_at }));
}

module.exports = { getCurrentSessionId, append, getRecent, getAllForSession, getAllSessions, getRecentFromOtherSessions, clearAllConversations };
