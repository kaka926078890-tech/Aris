/**
 * 用户要求：仅被 record_user_requirement 工具或管理 API 调用。
 * 结构由 schema 定义；支持对象列表、旧数据迁移、语义去重（向量）与提炼（refiner）。
 */
const fs = require('fs');
const { getRequirementsPath, getMemoryDir } = require('../config/paths.js');
const { loadSchema } = require('./schemaLoader.js');
const RequirementsRefiner = require('./requirements_refiner.js');

const refiner = new RequirementsRefiner();

function getSchema() {
  const schema = loadSchema('requirements');
  if (!schema) {
    return {
      list_key: 'requirements',
      text_field: 'text',
      id_field: 'id',
      created_at_field: 'created_at',
      updated_at_field: 'updated_at',
      frequency_field: 'frequency',
      embedding_field: 'embedding',
      similarity_threshold: 0.85,
    };
  }
  return schema;
}

function genId() {
  return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom <= 0 ? 0 : dot / denom;
}

/** 读原始数据，若为旧版字符串数组则迁移为 schema 定义的对象列表 */
function _readRaw() {
  const schema = getSchema();
  const listKey = schema.list_key;
  const textField = schema.text_field;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  try {
    const p = getRequirementsPath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      const migrated = data.map((item) => {
        const text = typeof item === 'string' ? item : (item && item[textField]) || '';
        return {
          [idField]: typeof item === 'object' && item && item[idField] ? item[idField] : genId(),
          [textField]: text,
          [createdAtField]: typeof item === 'object' && item && item[createdAtField] ? item[createdAtField] : new Date().toISOString(),
        };
      });
      return migrated;
    }
    if (data && Array.isArray(data[listKey])) {
      return data[listKey];
    }
  } catch (e) {
    console.warn('[Aris v2][store/requirements] read failed', e?.message);
  }
  return [];
}

function _writeList(list, lastWrittenItem) {
  const schema = getSchema();
  const listKey = schema.list_key;
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRequirementsPath(), JSON.stringify({ [listKey]: list }, null, 2), 'utf8');
  if (lastWrittenItem != null) {
    const timeline = require('./timeline.js');
    timeline.appendEntry({ type: 'requirement', payload: lastWrittenItem, actor: 'system' });
  }
}

/** 智能添加：语义去重（有向量时）或精确去重，否则追加；结构依 schema */
async function appendRequirement(text) {
  const newText = String(text ?? '').trim();
  if (!newText) return { success: false, message: '内容为空' };

  const schema = getSchema();
  const textField = schema.text_field;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  const updatedAtField = schema.updated_at_field;
  const frequencyField = schema.frequency_field;
  const embeddingField = schema.embedding_field;
  const threshold = Number(schema.similarity_threshold) || 0.85;

  let list = _readRaw();
  const now = new Date().toISOString();
  let newVec = null;

  let vectorModule = null;
  try {
    vectorModule = require('./vector.js');
  } catch (_) {}

  const hasVector = vectorModule && typeof vectorModule.embed === 'function' && embeddingField;

  if (hasVector) {
    try {
      newVec = await vectorModule.embed(newText, { prefix: 'document' });
    } catch (e) {
      console.warn('[Aris v2][store/requirements] embed failed', e?.message);
    }
    if (newVec && newVec.length) {
      let bestIdx = -1;
      let bestSim = 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const vec = item[embeddingField];
        if (Array.isArray(vec) && vec.length === newVec.length) {
          const sim = cosineSimilarity(vec, newVec);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = i;
          }
        } else if (item[textField]) {
          const otherVec = await vectorModule.embed(String(item[textField]), { prefix: 'document' });
          const sim = cosineSimilarity(Array.isArray(otherVec) ? otherVec : [], newVec);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = i;
          }
        }
      }
      if (bestIdx >= 0 && bestSim >= threshold) {
        const item = list[bestIdx];
        item[updatedAtField] = now;
        item[frequencyField] = (Number(item[frequencyField]) || 0) + 1;
        if (embeddingField) item[embeddingField] = newVec;
        _writeList(list, item);
        console.info('[Aris v2][store/requirements] 语义合并', bestSim.toFixed(2));
        return { success: true, merged: true, message: '已与已有要求合并' };
      }
    }
  }

  const exactIdx = list.findIndex((item) => String(item[textField]).trim() === newText);
  if (exactIdx >= 0) {
    const item = list[exactIdx];
    item[updatedAtField] = now;
    item[frequencyField] = (Number(item[frequencyField]) || 0) + 1;
    _writeList(list, item);
    return { success: true, merged: true, message: '已与已有要求合并' };
  }

  const newItem = {
    [idField]: genId(),
    [textField]: newText,
    [createdAtField]: now,
  };
  if (embeddingField && Array.isArray(newVec) && newVec.length) {
    newItem[embeddingField] = newVec;
  }
  list.push(newItem);
  _writeList(list, newItem);
  console.info('[Aris v2][store/requirements] 追加', list.length, '项');
  setImmediate(() => {
    triggerRefinementAsDocument().then((r) => {
      if (r && r.success) console.info('[Aris v2][store/requirements] 已自动总结为文档');
    }).catch((e) => console.warn('[Aris v2][store/requirements] 自动总结失败', e?.message));
  });
  return { success: true, merged: false, count: list.length, message: '已记录' };
}

/** 简单追加（不语义合并，仅精确去重），兼容用 */
function simpleAppendRequirement(text) {
  const line = String(text ?? '').trim();
  if (!line) return;
  const list = _readRaw();
  const schema = getSchema();
  const textField = schema.text_field;
  if (list.some((item) => String(item[textField]).trim() === line)) return;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  const newItem = {
    [idField]: genId(),
    [textField]: line,
    [createdAtField]: new Date().toISOString(),
  };
  list.push(newItem);
  _writeList(list, newItem);
  console.info('[Aris v2][store/requirements] 简单追加', list.length);
  return { success: true, count: list.length };
}

function listRecent(limit = 50) {
  const list = _readRaw();
  return limit ? list.slice(-limit) : list;
}

/** 整体替换用户要求列表（管理页编辑后保存）。list: 与 schema 兼容的项数组，至少含 text */
function replaceAll(list) {
  if (!Array.isArray(list)) return;
  const schema = getSchema();
  const textField = schema.text_field;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  const now = new Date().toISOString();
  const normalized = list.map((item) => {
    const text = String(item[textField] ?? item.text ?? '').trim();
    if (!text) return null;
    return {
      ...item,
      [idField]: item[idField] || item.id || genId(),
      [textField]: text,
      [createdAtField]: item[createdAtField] || item.created_at || now,
    };
  }).filter(Boolean);
  _writeList(normalized, null);
  console.info('[Aris v2][store/requirements] replaceAll', normalized.length);
}

function getSummary() {
  const schema = getSchema();
  const textField = schema.text_field;
  const list = listRecent(0); // 0 = 全部，与「原先+新内容总结提炼」一致
  if (!list.length) return '';
  return list.map((item, i) => `${i + 1}. ${String(item[textField] || '').trim()}`).join('\n');
}

function getDetailedReport() {
  const schema = getSchema();
  const textField = schema.text_field;
  const list = _readRaw();
  const groups = { '沟通风格': 0, '行为规则': 0, '技术要求': 0, '功能需求': 0, '其他': 0 };
  list.forEach((item) => {
    const r = String(item[textField] || '');
    const lower = r.toLowerCase();
    if (lower.includes('沟通') || lower.includes('说话') || lower.includes('语言') || lower.includes('表达')) groups['沟通风格']++;
    else if (lower.includes('行为') || lower.includes('规则') || lower.includes('应该') || lower.includes('不要')) groups['行为规则']++;
    else if (lower.includes('技术') || lower.includes('改进') || lower.includes('优化') || lower.includes('修复')) groups['技术要求']++;
    else if (lower.includes('功能') || lower.includes('需求') || lower.includes('需要') || lower.includes('想要')) groups['功能需求']++;
    else groups['其他']++;
  });
  let report = '用户要求详细报告\n总要求数: ' + list.length + '\n\n分类统计:\n';
  Object.entries(groups).forEach(([cat, count]) => {
    if (count > 0) report += `- ${cat}: ${count}项\n`;
  });
  report += '\n最近5项:\n';
  list.slice(-5).forEach((item, i) => {
    report += `${i + 1}. ${String(item[textField] || '').trim()}\n`;
  });
  return report;
}

async function triggerRefinement() {
  const list = _readRaw();
  if (list.length <= 1) return { success: false, message: '要求太少，无需提炼' };

  const schema = getSchema();
  const textField = schema.text_field;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  const texts = list.map((item) => String(item[textField] || '').trim()).filter(Boolean);
  if (texts.length <= 1) return { success: false, message: '有效要求太少' };

  try {
    const refined = await refiner.refine(texts.slice(0, -1), texts[texts.length - 1]);
    const newList = refined.map((t) => {
      const existing = list.find((item) => String(item[textField]).trim() === t);
      if (existing) return { ...existing, [textField]: t };
      return {
        [idField]: genId(),
        [textField]: t,
        [createdAtField]: new Date().toISOString(),
      };
    });
    _writeList(newList, { action: 'refine', count: newList.length });
    const stats = refiner.getStatistics(texts.length, newList.length);
    return {
      success: true,
      stats,
      message: `提炼完成: ${stats.originalCount} -> ${stats.refinedCount} 项`,
    };
  } catch (e) {
    console.error('[Aris v2][store/requirements] triggerRefinement failed', e?.message);
    return { success: false, error: e?.message };
  }
}

/** 文档式总结：原先 + 新内容 合并为一份完整文档后存为单条，不遗漏任何信息 */
async function triggerRefinementAsDocument() {
  const list = _readRaw();
  const schema = getSchema();
  const textField = schema.text_field;
  const idField = schema.id_field;
  const createdAtField = schema.created_at_field;
  const texts = list.map((item) => String(item[textField] || '').trim()).filter(Boolean);
  if (!texts.length) return { success: false, message: '暂无内容' };

  try {
    const doc = await refiner.refineToDocument(texts, 'requirements');
    const now = new Date().toISOString();
    const singleItem = {
      [idField]: genId(),
      [textField]: doc,
      [createdAtField]: now,
    };
    _writeList([singleItem], null);
    console.info('[Aris v2][store/requirements] 文档式总结已写入 1 条');
    return { success: true, message: '已总结为一份文档，未遗漏任何内容' };
  } catch (e) {
    console.error('[Aris v2][store/requirements] triggerRefinementAsDocument failed', e?.message);
    return { success: false, error: e?.message };
  }
}

module.exports = {
  appendRequirement,
  simpleAppendRequirement,
  listRecent,
  getSummary,
  getDetailedReport,
  triggerRefinement,
  triggerRefinementAsDocument,
  replaceAll,
};
