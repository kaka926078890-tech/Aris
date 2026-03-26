/**
 * 关联驱动检索：根据当前上下文拉取关联并格式化为 1～3 行，供注入 system prompt。
 * 配置来自 memory/retrieval_config.json，无硬编码。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  enable_association_inject: true,
  max_association_lines: 3,
  source_types: ['identity', 'requirement'],
  requirement_id_max: 5,
  enable_summary: true,
  summary_rounds_interval: 10,
  filter_experience_by_association: true,
  max_experience_results: 10,
  /** search_memories 工具侧：是否对每条记忆再乘 24h 行级时间衰减；默认 false（相关性优先） */
  memory_row_time_decay: false,
};

function getRetrievalConfigPath() {
  const { getRetrievalConfigPath: getPath } = require('../../config/paths.js');
  return getPath();
}

function readRetrievalConfig() {
  try {
    const p = getRetrievalConfigPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        return { ...DEFAULT_CONFIG, ...data };
      }
    }
    fs.writeFileSync(p, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  } catch (_) {}
  return DEFAULT_CONFIG;
}

/**
 * 当前上下文相关实体列表，用于向量写入 metadata 与检索过滤（分层记忆）。
 * @returns {{ type: string, id: string }[]}
 */
function getCurrentRelatedEntityIds() {
  const config = readRetrievalConfig();
  const sourceTypes = Array.isArray(config.source_types) ? config.source_types : DEFAULT_CONFIG.source_types;
  const reqIdMax = Math.max(0, Math.min(Number(config.requirement_id_max) || 5, 20));
  const list = [];
  if (sourceTypes.includes('identity')) list.push({ type: 'identity', id: 'name' });
  if (sourceTypes.includes('requirement') && reqIdMax > 0) {
    let store;
    try {
      store = require('../../store');
    } catch (_) {
      return list;
    }
    if (store.requirements && typeof store.requirements.listRecent === 'function') {
      const reqList = store.requirements.listRecent(reqIdMax);
      const idField = (store.requirements.getSchema && store.requirements.getSchema())?.id_field || 'id';
      (reqList || []).forEach((r) => {
        if (r[idField] != null) list.push({ type: 'requirement', id: String(r[idField]) });
      });
    }
  }
  return list;
}

/**
 * @param {string} sessionId - 当前会话 id（未用，预留）
 * @param {Array} recent - 最近消息 [{ role, content }, ...]
 * @param {object} options - 可选覆盖配置
 * @returns {Promise<string>} 多行字符串，无关联或关闭时返回 ''，否则返回「（无）」或 1～max 行
 */
async function getRelatedAssociationsLines(sessionId, recent, options = {}) {
  const config = { ...readRetrievalConfig(), ...options };
  if (!config.enable_association_inject) return '（无）';

  let store;
  try {
    store = require('../../store');
  } catch (_) {
    return '（无）';
  }
  if (!store.associations || typeof store.associations.getAssociationsFor !== 'function') {
    return '（无）';
  }

  const maxLines = Math.max(1, Math.min(Number(config.max_association_lines) || 3, 10));
  const sourceTypes = Array.isArray(config.source_types) ? config.source_types : DEFAULT_CONFIG.source_types;
  const reqIdMax = Math.max(0, Math.min(Number(config.requirement_id_max) || 5, 20));

  const schema = store.associations.getSchema && store.associations.getSchema();
  const srcTypeF = (schema && schema.source_type_field) || 'source_type';
  const srcIdF = (schema && schema.source_id_field) || 'source_id';
  const targetTypeF = (schema && schema.target_type_field) || 'target_type';
  const targetIdF = (schema && schema.target_id_field) || 'target_id';
  const relF = (schema && schema.relationship_field) || 'relationship';

  const allAssociations = [];

  if (sourceTypes.includes('identity')) {
    const list = store.associations.getAssociationsFor('identity', 'name');
    if (list && list.length) allAssociations.push(...list);
  }

  const reqIdToText = {};
  if (store.requirements && typeof store.requirements.listRecent === 'function') {
    const reqList = store.requirements.listRecent(Math.max(reqIdMax, 50));
    const idField = (store.requirements.getSchema && store.requirements.getSchema())?.id_field || 'id';
    const textField = (store.requirements.getSchema && store.requirements.getSchema())?.text_field || 'text';
    (reqList || []).forEach((r) => {
      if (r[idField] != null) reqIdToText[String(r[idField])] = String(r[textField] || '').trim().slice(0, 80);
    });
  }

  if (sourceTypes.includes('requirement') && reqIdMax > 0 && store.requirements && typeof store.requirements.listRecent === 'function') {
    const reqList = store.requirements.listRecent(reqIdMax);
    const idField = (store.requirements.getSchema && store.requirements.getSchema())?.id_field || 'id';
    for (const req of reqList || []) {
      const sid = req[idField];
      if (sid == null) continue;
      const list = store.associations.getAssociationsFor('requirement', sid);
      if (list && list.length) allAssociations.push(...list);
    }
  }

  function formatLine(a) {
    const targetType = a[targetTypeF];
    const targetId = a[targetIdF];
    let targetLabel = targetId;
    if (targetType === 'requirement' && reqIdToText[String(targetId)] !== undefined) {
      targetLabel = `要求「${reqIdToText[String(targetId)] || targetId}」`;
    } else if (targetType === 'identity') {
      targetLabel = '身份';
    }
    const srcType = a[srcTypeF];
    const srcId = a[srcIdF];
    let srcLabel = srcId;
    if (srcType === 'requirement' && reqIdToText[String(srcId)] !== undefined) {
      srcLabel = `要求「${reqIdToText[String(srcId)] || srcId}」`;
    } else if (srcType === 'identity') {
      srcLabel = '身份';
    }
    const rel = a[relF] ? `（${a[relF]}）` : '';
    return `${srcLabel} 与 ${targetLabel} 相关${rel}`.trim();
  }

  const seen = new Set();
  const lines = [];
  for (const a of allAssociations) {
    const line = formatLine(a);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= maxLines) break;
  }

  if (lines.length === 0) return '（无）';
  return lines.join('\n');
}

module.exports = { getRelatedAssociationsLines, readRetrievalConfig, getCurrentRelatedEntityIds };
