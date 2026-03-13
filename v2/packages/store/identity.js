/**
 * 用户身份：仅被 record_user_identity 工具或管理 API 调用，不做任何从对话文本的解析。
 */
const fs = require('fs');
const {
  getIdentityPath,
  getMemoryDir,
} = require('../config/paths.js');

const DEFAULT = { name: '', notes: '' };

function readIdentity() {
  try {
    const p = getIdentityPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        return { ...DEFAULT, ...data };
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/identity] read failed', e?.message);
  }
  return { ...DEFAULT };
}

function writeIdentity({ name, notes }) {
  const p = getIdentityPath();
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = { ...readIdentity() };
  if (name !== undefined) data.name = String(name ?? '').trim();
  if (notes !== undefined) data.notes = String(notes ?? '').trim();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.info('[Aris v2][store/identity] written');
}

module.exports = { readIdentity, writeIdentity };
