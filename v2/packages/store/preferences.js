/**
 * 用户喜好与习惯：按 topic 存条目，供 get_preferences 按需拉取，不预注入 prompt。
 */
const fs = require('fs');
const { getPreferencesPath, getMemoryDir } = require('../config/paths.js');
const schemaLoader = require('./schemaLoader.js');

const LIST_KEY = 'preferences';

function _getSchema() {
  const schema = schemaLoader.loadSchema('preferences');
  if (schema) return schema;
  return {
    list_key: LIST_KEY,
    id_field: 'id',
    topic_field: 'topic',
    summary_field: 'summary',
    source_field: 'source',
    created_at_field: 'created_at',
    updated_at_field: 'updated_at',
    tags_field: 'tags',
  };
}

function _readRaw() {
  try {
    const p = getPreferencesPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        const key = _getSchema().list_key;
        if (data && Array.isArray(data[key])) return data[key];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/preferences] read failed', e?.message);
  }
  return [];
}

function _write(list) {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = _getSchema().list_key;
  fs.writeFileSync(getPreferencesPath(), JSON.stringify({ [key]: list }, null, 2), 'utf8');
}

/**
 * @param {string} topic - 如 game / rest / quiet / food
 * @param {number} [limit=20]
 * @returns {Array<{ id, topic, summary, source?, created_at, updated_at, tags? }>}
 */
function listByTopic(topic, limit = 20) {
  const list = _readRaw();
  const schema = _getSchema();
  const tf = schema.topic_field || 'topic';
  const uf = schema.updated_at_field || 'updated_at';
  const filtered = topic ? list.filter((x) => String(x[tf] || '').toLowerCase() === String(topic).toLowerCase()) : list;
  filtered.sort((a, b) => (b[uf] || '').localeCompare(a[uf] || ''));
  return filtered.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

/**
 * @param {{ topic: string, summary: string, source?: string, tags?: string[] }} payload
 * @returns {{ success: boolean, id?: string, message?: string }}
 */
function add(payload) {
  if (!payload || typeof payload.topic !== 'string' || typeof payload.summary !== 'string') {
    return { success: false, message: '缺少 topic 或 summary' };
  }
  const schema = _getSchema();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const item = {
    [schema.id_field]: id,
    [schema.topic_field]: payload.topic.trim(),
    [schema.summary_field]: (payload.summary || '').trim() || '（无）',
    [schema.created_at_field]: now,
    [schema.updated_at_field]: now,
  };
  if (payload.source != null) item[schema.source_field] = payload.source;
  if (Array.isArray(payload.tags)) item[schema.tags_field] = payload.tags;
  const list = _readRaw();
  list.push(item);
  _write(list);
  const timeline = require('./timeline.js');
  timeline.appendEntry({ type: 'preference', payload: { id, topic: item[schema.topic_field], summary: item[schema.summary_field] }, actor: 'system' });
  setImmediate(() => {
    const Refiner = require('./requirements_refiner.js');
    const refiner = new Refiner();
    const all = _readRaw();
    const tf = schema.topic_field || 'topic';
    const sf = schema.summary_field || 'summary';
    const lines = all.map((x) => (x[tf] === '_doc' ? String(x[sf] || '').trim() : `[${x[tf]}] ${x[sf]}`)).filter(Boolean);
    if (lines.length) {
      refiner.refineToDocument(lines, 'preferences').then((doc) => {
        if (doc) replaceWithDocument(doc);
        console.info('[Aris v2][store/preferences] 已自动总结为文档');
      }).catch((e) => console.warn('[Aris v2][store/preferences] 自动总结失败', e?.message));
    }
  });
  return { success: true, id };
}

/**
 * 供 prompt 用：返回多行摘要（每行一条），不灌入整表。
 * @param {{ topic?: string, maxLines?: number }} [options]
 * @returns {string}
 */
function getSummaryForPrompt(options = {}) {
  const { topic, maxLines = 15 } = options || {};
  const schema = _getSchema();
  const sf = schema.summary_field || 'summary';
  const tf = schema.topic_field || 'topic';
  const items = listByTopic(topic, maxLines);
  if (!items.length) return '';
  const docItem = items.find((x) => x[tf] === '_doc' || x.topic === '_doc');
  const others = items.filter((x) => x[tf] !== '_doc' && x.topic !== '_doc');
  const docPart = docItem ? String(docItem[sf] || docItem.summary || '').trim() : '';
  const othersPart = others.map((x) => (topic ? x[sf] : `[${x[tf]}] ${x[sf]}`).trim()).filter(Boolean).join('\n');
  if (docPart && othersPart) return docPart + '\n\n' + othersPart;
  if (docPart) return docPart;
  return othersPart;
}

/** 返回全部喜好条目，供管理页展示与编辑 */
function listAll() {
  return _readRaw();
}

/** 整体替换喜好列表（管理页编辑后保存）。list: 与 schema 兼容的项数组 */
function replaceAll(list) {
  if (!Array.isArray(list)) return;
  const schema = _getSchema();
  const normalized = list.map((item) => ({
    ...item,
    [schema.id_field]: item[schema.id_field] || item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    [schema.topic_field]: String(item[schema.topic_field] ?? item.topic ?? '').trim() || '其他',
    [schema.summary_field]: String(item[schema.summary_field] ?? item.summary ?? '').trim() || '（无）',
    [schema.created_at_field]: item[schema.created_at_field] || item.created_at || new Date().toISOString(),
    [schema.updated_at_field]: new Date().toISOString(),
  })).filter((x) => (x[schema.summary_field] || '').trim() !== '');
  _write(normalized);
  console.info('[Aris v2][store/preferences] replaceAll', normalized.length);
}

/** 文档式：将一份完整文档存为单条（topic=_doc，summary=文档内容） */
function replaceWithDocument(docString) {
  const text = String(docString ?? '').trim();
  if (!text) return;
  const schema = _getSchema();
  const now = new Date().toISOString();
  const single = {
    [schema.id_field]: `${Date.now()}-doc`,
    [schema.topic_field]: '_doc',
    [schema.summary_field]: text,
    [schema.created_at_field]: now,
    [schema.updated_at_field]: now,
  };
  _write([single]);
  console.info('[Aris v2][store/preferences] replaceWithDocument 已写入 1 条');
}

module.exports = { listByTopic, add, getSummaryForPrompt, listAll, replaceAll, replaceWithDocument };
