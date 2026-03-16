/**
 * 用户身份：仅被 record_user_identity 工具或管理 API 调用。
 * 累积式更新 + 历史，结构由 schema 定义，无硬编码字段。
 */
const fs = require('fs');
const { getIdentityPath, getMemoryDir } = require('../config/paths.js');
const { loadSchema } = require('./schemaLoader.js');

function getSchema() {
  const schema = loadSchema('identity');
  if (!schema || !Array.isArray(schema.current_fields)) {
    return { current_fields: ['name', 'notes'], history_key: 'history', history_entry_fields: ['timestamp', 'name', 'notes', 'source'], defaults: { name: '', notes: '' } };
  }
  return schema;
}

function readIdentity(options = {}) {
  const schema = getSchema();
  const defaults = schema.defaults || {};
  const currentFields = schema.current_fields;
  try {
    const p = getIdentityPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        const current = {};
        for (const key of currentFields) {
          current[key] = data[key] !== undefined ? data[key] : (defaults[key] !== undefined ? defaults[key] : '');
        }
        if (options.includeHistory && schema.history_key && Array.isArray(data[schema.history_key])) {
          current[schema.history_key] = data[schema.history_key];
        }
        return current;
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/identity] read failed', e?.message);
  }
  const fallback = {};
  for (const key of currentFields) {
    fallback[key] = defaults[key] !== undefined ? defaults[key] : '';
  }
  return fallback;
}

function writeIdentity(payload) {
  const schema = getSchema();
  const p = getIdentityPath();
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const currentFields = schema.current_fields;
  const historyKey = schema.history_key;
  const historyEntryFields = schema.history_entry_fields || currentFields;
  let data = {};
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) data = JSON.parse(raw);
    }
  } catch (_) {}
  const defaults = schema.defaults || {};
  for (const key of currentFields) {
    if (data[key] === undefined) data[key] = defaults[key] !== undefined ? defaults[key] : '';
  }
  const previous = { ...data };
  let changed = false;
  for (const key of currentFields) {
    if (payload[key] !== undefined) {
      const newVal = typeof payload[key] === 'string' ? payload[key].trim() : (payload[key] ?? '');
      if (data[key] !== newVal) {
        data[key] = newVal;
        changed = true;
      }
    }
  }
  if (changed && historyKey && historyEntryFields.length) {
    const entry = {};
    const now = new Date().toISOString();
    for (const f of historyEntryFields) {
      if (f === 'timestamp') entry[f] = now;
      else if (f === 'source') entry[f] = '用户告知';
      else entry[f] = previous[f] !== undefined ? previous[f] : '';
    }
    if (!Array.isArray(data[historyKey])) data[historyKey] = [];
    data[historyKey].push(entry);
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  const preview = currentFields.map((k) => `${k}:${String(data[k]).length}`).join(', ');
  console.info('[Aris v2][store/identity] written', preview);
}

module.exports = { readIdentity, writeIdentity };
