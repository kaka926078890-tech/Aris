/**
 * 用户要求：仅被 record_user_requirement 工具或管理 API 调用。
 */
const fs = require('fs');
const { getRequirementsPath, getMemoryDir } = require('../config/paths.js');

function _readList() {
  try {
    const p = getRequirementsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/requirements] read failed', e?.message);
  }
  return [];
}

function appendRequirement(text) {
  const line = String(text ?? '').trim();
  if (!line) return;
  const list = _readList();
  if (list.includes(line)) return;
  list.push(line);
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRequirementsPath(), JSON.stringify(list, null, 2), 'utf8');
  console.info('[Aris v2][store/requirements] appended');
}

function listRecent(limit = 50) {
  const list = _readList();
  return limit ? list.slice(-limit) : list;
}

function getSummary() {
  const list = listRecent(50);
  return list.length ? list.map((t, i) => `${i + 1}. ${t}`).join('\n') : '';
}

module.exports = { appendRequirement, listRecent, getSummary };
