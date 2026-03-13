/**
 * 纠错：仅被 record_correction 工具或管理 API 调用。
 */
const fs = require('fs');
const { getCorrectionsPath, getMemoryDir } = require('../config/paths.js');

function _readList() {
  try {
    const p = getCorrectionsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/corrections] read failed', e?.message);
  }
  return [];
}

function appendCorrection(previous, correction) {
  const text = `[纠错] 我此前说: ${String(previous ?? '').slice(0, 500)}\n用户纠正: ${String(correction ?? '').slice(0, 500)}`;
  const list = _readList();
  list.push({ text, created_at: new Date().toISOString() });
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCorrectionsPath(), JSON.stringify(list, null, 2), 'utf8');
  console.info('[Aris v2][store/corrections] appended');
}

function getRecent(limit = 10) {
  const list = _readList();
  const slice = limit ? list.slice(-limit) : list;
  return slice.map((x) => (typeof x === 'string' ? x : x?.text)).filter(Boolean);
}

module.exports = { appendCorrection, getRecent };
