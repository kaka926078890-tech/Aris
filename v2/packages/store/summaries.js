/**
 * 会话小结：每 N 轮生成一条小结，供 prompt 注入。按 session 存最新一条。
 */
const fs = require('fs');
const { getSessionSummariesPath, getMemoryDir } = require('../config/paths.js');

const KEY = 'by_session';

function _readRaw() {
  try {
    const p = getSessionSummariesPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data[KEY] === 'object') return data[KEY];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/summaries] read failed', e?.message);
  }
  return {};
}

function _write(bySession) {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSessionSummariesPath(), JSON.stringify({ [KEY]: bySession }, null, 2), 'utf8');
}

/**
 * @param {string} sessionId
 * @returns {{ content: string, updated_at: string, round_index: number } | null}
 */
function readSummary(sessionId) {
  if (!sessionId) return null;
  const bySession = _readRaw();
  const entry = bySession[sessionId];
  if (!entry || typeof entry.content !== 'string') return null;
  return {
    content: entry.content,
    updated_at: entry.updated_at || '',
    round_index: typeof entry.round_index === 'number' ? entry.round_index : 0,
  };
}

/**
 * @param {string} sessionId
 * @param {string} content
 * @param {number} roundIndex - 生成小结时的轮数（user+assistant 为一轮）
 */
function writeSummary(sessionId, content, roundIndex) {
  if (!sessionId) return;
  const bySession = _readRaw();
  bySession[sessionId] = {
    content: String(content).trim() || '（无）',
    updated_at: new Date().toISOString(),
    round_index: Math.max(0, Math.floor(Number(roundIndex) || 0)),
  };
  _write(bySession);
}

module.exports = { readSummary, writeSummary };
