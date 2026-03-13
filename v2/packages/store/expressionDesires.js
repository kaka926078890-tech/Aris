/**
 * 表达欲望：仅被 record_expression_desire 工具或管理 API 调用。
 */
const fs = require('fs');
const { getExpressionDesiresPath, getMemoryDir } = require('../config/paths.js');

function _readList() {
  try {
    const p = getExpressionDesiresPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/expressionDesires] read failed', e?.message);
  }
  return [];
}

function appendDesire({ text, intensity }) {
  const line = String(text ?? '').trim();
  if (!line) return;
  const list = _readList();
  list.push({
    text: line,
    intensity: intensity ?? 3,
    created_at: new Date().toISOString(),
  });
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getExpressionDesiresPath(), JSON.stringify(list, null, 2), 'utf8');
  console.info('[Aris v2][store/expressionDesires] appended');
}

function getRecent(limit = 10) {
  const list = _readList();
  return limit ? list.slice(-limit) : list;
}

module.exports = { appendDesire, getRecent };
