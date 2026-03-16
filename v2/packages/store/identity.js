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
  
  const existing = readIdentity();
  let data = { ...existing };
  
  // 如果提供了名字（无论是否为空），则重置整个身份记录
  if (name !== undefined) {
    // 名字更新时，重置整个记录
    data.name = String(name ?? '').trim();
    
    // 如果同时提供了备注，则使用新备注
    if (notes !== undefined) {
      data.notes = String(notes ?? '').trim();
    } else {
      // 如果没有提供备注，则清空备注（因为名字更新意味着新用户或重置）
      data.notes = '';
    }
  } else if (notes !== undefined) {
    // 只更新备注时，追加到现有备注后面
    const newNotes = String(notes ?? '').trim();
    if (newNotes) {
      if (data.notes) {
        // 追加，用换行分隔
        data.notes = data.notes + '\n' + newNotes;
      } else {
        data.notes = newNotes;
      }
    }
  }
  
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.info('[Aris v2][store/identity] written', { name: data.name, notesLength: data.notes.length });
}

module.exports = { readIdentity, writeIdentity };