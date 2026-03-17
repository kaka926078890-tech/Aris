/**
 * 重要文档提醒：仅在本 session 首条用户消息时检查 doc_last_viewed，超时则注入至多 1 句提醒。
 * 符合 problem_strategy_plan 九、9.2 方案二；仅对用户确需「定期查看」的文档配置。
 */
const fs = require('fs');
const path = require('path');
const { getImportantDocumentsPath } = require('../../config/paths.js');
const store = require('../../store');

const DEFAULT_CONFIG = {
  important_documents: [
    {
      path: 'docs/aris_ideas.md',
      name: 'Aris的愿望文档',
      check_interval_hours: 24,
      reminder_text: '记得查看你的愿望文档，保持自我认知。',
    },
  ],
};

function readImportantDocumentsConfig() {
  try {
    const p = getImportantDocumentsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
      return DEFAULT_CONFIG;
    }
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return DEFAULT_CONFIG;
    const data = JSON.parse(raw);
    const list = Array.isArray(data.important_documents) ? data.important_documents : DEFAULT_CONFIG.important_documents;
    return { important_documents: list };
  } catch (_) {
    return DEFAULT_CONFIG;
  }
}

/**
 * 仅当「本 session 首条用户消息」时检查；若有文档超过 check_interval_hours 未查看，返回至多 1 句提醒，否则 null。
 * @param {boolean} isSessionFirstMessage - 是否为本 session 的首条用户消息（即 recent.length === 0）
 * @returns {string | null}
 */
function getImportantDocReminder(isSessionFirstMessage) {
  if (!isSessionFirstMessage) return null;
  try {
    const config = readImportantDocumentsConfig();
    const docs = config.important_documents || [];
    const proactive = store.state.readProactiveState();
    const lastViewed = proactive.doc_last_viewed || {};
    const now = Date.now();

    for (const doc of docs) {
      const intervalHours = Number(doc.check_interval_hours);
      if (intervalHours <= 0) continue;
      const docPath = (doc.path || '').trim();
      if (!docPath) continue;

      const viewedAt = lastViewed[docPath];
      const viewedMs = viewedAt ? new Date(viewedAt).getTime() : 0;
      const intervalMs = intervalHours * 60 * 60 * 1000;
      if (now - viewedMs <= intervalMs) continue;

      const line = (doc.reminder_text || `记得查看：${doc.name || docPath}`).trim().slice(0, 120);
      if (line) {
        console.info('[Aris v2][important_docs] 注入提醒:', docPath);
        return line;
      }
    }
  } catch (e) {
    console.warn('[Aris v2][important_docs] getImportantDocReminder failed', e?.message);
  }
  return null;
}

/**
 * 获取配置中的文档路径列表，用于 read_file 后判断是否更新 doc_last_viewed。
 * @returns {string[]}
 */
function getImportantDocumentPaths() {
  try {
    const config = readImportantDocumentsConfig();
    const docs = config.important_documents || [];
    return docs.map((d) => (d.path || '').trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * 将某文档标记为「已查看」，更新 doc_last_viewed。在 read_file 成功读取到配置中的文档时调用。
 * @param {string} relativePath - 相对路径（如 docs/aris_ideas.md 或 v2/docs/aris_ideas.md），会与配置中的 path 匹配
 */
function markDocumentViewed(relativePath) {
  const normalized = (relativePath || '').trim().replace(/\\/g, '/');
  if (!normalized) return;
  const paths = getImportantDocumentPaths();
  const key = paths.find((p) => p === normalized || p === normalized.replace(/^v2\//, ''));
  if (!key) return;
  try {
    const proactive = store.state.readProactiveState();
    const lastViewed = { ...(proactive.doc_last_viewed || {}), [key]: new Date().toISOString() };
    store.state.writeProactiveState({ doc_last_viewed: lastViewed });
  } catch (e) {
    console.warn('[Aris v2][important_docs] markDocumentViewed failed', e?.message);
  }
}

module.exports = {
  getImportantDocReminder,
  getImportantDocumentPaths,
  markDocumentViewed,
  readImportantDocumentsConfig,
};
