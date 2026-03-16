/**
 * 表达欲望：仅被 record_expression_desire 工具或管理 API 调用。
 * created_at 为 UTC（toISOString）。展示给用户或模型时请标明 UTC 或转为本地时间（如 08:27 UTC = 北京 16:27），避免误读。
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

function appendDesire({ text, intensity, session_id }) {
  const line = String(text ?? '').trim();
  if (!line) return;
  const list = _readList();
  const item = {
    text: line,
    intensity: intensity ?? 3,
    created_at: new Date().toISOString(),
  };
  list.push(item);
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getExpressionDesiresPath(), JSON.stringify(list, null, 2), 'utf8');
  const timeline = require('./timeline.js');
  const payload = session_id != null ? { ...item, session_id } : item;
  timeline.appendEntry({ type: 'expression_desire', payload, actor: 'system' });
  console.info('[Aris v2][store/expressionDesires] appended');
}

function getRecent(limit = 10) {
  const list = _readList();
  return limit ? list.slice(-limit) : list;
}

module.exports = { appendDesire, getRecent };
