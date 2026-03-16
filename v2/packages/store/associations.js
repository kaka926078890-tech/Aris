/**
 * 关联索引：身份、要求、对话等之间的关联，结构由 schema 定义。
 */
const fs = require('fs');
const { getAssociationsPath, getMemoryDir } = require('../config/paths.js');
const { loadSchema } = require('./schemaLoader.js');

function getSchema() {
  const schema = loadSchema('associations');
  if (!schema) {
    return {
      list_key: 'associations',
      source_type_field: 'source_type',
      source_id_field: 'source_id',
      target_type_field: 'target_type',
      target_id_field: 'target_id',
      relationship_field: 'relationship',
      strength_field: 'strength',
    };
  }
  return schema;
}

function _readRaw() {
  const schema = getSchema();
  const listKey = schema.list_key;
  try {
    const p = getAssociationsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data[listKey])) return data[listKey];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/associations] read failed', e?.message);
  }
  return [];
}

function _writeList(list) {
  const schema = getSchema();
  const listKey = schema.list_key;
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getAssociationsPath(), JSON.stringify({ [listKey]: list }, null, 2), 'utf8');
}

function addAssociation(payload) {
  const schema = getSchema();
  const srcTypeF = schema.source_type_field;
  const srcIdF = schema.source_id_field;
  const targetTypeF = schema.target_type_field;
  const targetIdF = schema.target_id_field;
  const relF = schema.relationship_field;
  const strengthF = schema.strength_field;
  const srcType = payload[srcTypeF] != null ? String(payload[srcTypeF]) : '';
  const srcId = payload[srcIdF] != null ? String(payload[srcIdF]) : '';
  const targetType = payload[targetTypeF] != null ? String(payload[targetTypeF]) : '';
  const targetId = payload[targetIdF] != null ? String(payload[targetIdF]) : '';
  if (!srcType || !srcId || !targetType || !targetId) {
    return { ok: false, error: '缺少 source_type / source_id / target_type / target_id' };
  }
  const list = _readRaw();
  const key = (a) => `${a[srcTypeF]}:${a[srcIdF]}:${a[targetTypeF]}:${a[targetIdF]}`;
  const newKey = `${srcType}:${srcId}:${targetType}:${targetId}`;
  const idx = list.findIndex((a) => key(a) === newKey);
  const entry = {
    [srcTypeF]: srcType,
    [srcIdF]: srcId,
    [targetTypeF]: targetType,
    [targetIdF]: targetId,
    [relF]: payload[relF] != null ? String(payload[relF]) : '',
    [strengthF]: typeof payload[strengthF] === 'number' ? payload[strengthF] : 1,
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  _writeList(list);
  const timeline = require('./timeline.js');
  timeline.appendEntry({ type: 'association', payload: entry, actor: 'system' });
  console.info('[Aris v2][store/associations] add', newKey);
  return { ok: true, message: '已记录关联' };
}

function getAssociationsFor(sourceType, sourceId) {
  const schema = getSchema();
  const srcTypeF = schema.source_type_field;
  const srcIdF = schema.source_id_field;
  const list = _readRaw();
  return list.filter(
    (a) => String(a[srcTypeF]) === String(sourceType) && String(a[srcIdF]) === String(sourceId)
  );
}

module.exports = { addAssociation, getAssociationsFor, getSchema };