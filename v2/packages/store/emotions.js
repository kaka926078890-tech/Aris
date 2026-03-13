/**
 * 情感：仅被 record_emotion 工具或管理 API 调用。
 */
const fs = require('fs');
const { getEmotionsPath, getMemoryDir } = require('../config/paths.js');

function _readList() {
  try {
    const p = getEmotionsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/emotions] read failed', e?.message);
  }
  return [];
}

function appendEmotion({ text, intensity, tags }) {
  const line = String(text ?? '').trim();
  if (!line) return;
  const list = _readList();
  list.push({
    text: line,
    intensity: intensity ?? 3,
    tags: Array.isArray(tags) ? tags : [],
    created_at: new Date().toISOString(),
  });
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getEmotionsPath(), JSON.stringify(list, null, 2), 'utf8');
  console.info('[Aris v2][store/emotions] appended');
}

function getRecent(limit = 10) {
  const list = _readList();
  const slice = limit ? list.slice(-limit) : list;
  return slice;
}

module.exports = { appendEmotion, getRecent };
