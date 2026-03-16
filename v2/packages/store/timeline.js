/**
 * 时间线：所有 write 路径在写入时追加一条历史记录，支持按时刻回溯（L1/L2）。
 * 结构：entries[]，每条约定 timestamp、type、payload、actor。
 *
 * 重要：timestamp 与各 store 的 created_at 均为 UTC（ISO 8601 带 Z）。
 * 例如 08:27 UTC = 北京 16:27。展示给用户或模型时请用 formatTimestampForDisplay 标明 UTC，或转为本地时间，避免误读为「早上 8:27」。
 */
const fs = require('fs');
const { getTimelinePath, getDataDir } = require('../config/paths.js');

const LIST_KEY = 'entries';
const MAX_ENTRIES = 50000;

function _readRaw() {
  try {
    const p = getTimelinePath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data[LIST_KEY])) return data[LIST_KEY];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/timeline] read failed', e?.message);
  }
  return [];
}

function _write(list) {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const capped = list.length > MAX_ENTRIES ? list.slice(-MAX_ENTRIES) : list;
  fs.writeFileSync(getTimelinePath(), JSON.stringify({ [LIST_KEY]: capped }, null, 2), 'utf8');
}

/**
 * 追加一条时间线记录（所有写路径在写入后调用）。
 * @param {{ type: string, payload: object, actor?: 'user'|'system' }} entry
 */
function appendEntry(entry) {
  if (!entry || typeof entry.type !== 'string') return;
  const list = _readRaw();
  list.push({
    timestamp: new Date().toISOString(),
    type: entry.type,
    payload: entry.payload != null && typeof entry.payload === 'object' ? entry.payload : { value: entry.payload },
    actor: entry.actor === 'user' || entry.actor === 'system' ? entry.actor : 'system',
  });
  _write(list);
}

/**
 * 将 ISO 时间格式化为带时区标注的展示用字符串，避免 UTC 被误读为本地时间。
 * @param {string} isoString - 如 "2026-03-16T08:27:10.926Z"
 * @returns {string} 如 "2026-03-16 08:27 (UTC)"
 */
function formatTimestampForDisplay(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min} (UTC)`;
  } catch (_) {
    return String(isoString);
  }
}

/**
 * 按时间、类型查询时间线（用于某时刻状态回溯或审计）。
 * @param {{ since?: string, until?: string, type?: string, limit?: number }} options - ISO 时间、类型过滤、条数上限
 * @returns {Array<{ timestamp: string, type: string, payload: object, actor: string }>}
 */
function getEntries(options = {}) {
  let list = _readRaw();
  const since = options.since;
  const until = options.until;
  const type = options.type;
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
  if (since) {
    const t = new Date(since).getTime();
    if (!Number.isNaN(t)) list = list.filter((e) => new Date(e.timestamp).getTime() >= t);
  }
  if (until) {
    const t = new Date(until).getTime();
    if (!Number.isNaN(t)) list = list.filter((e) => new Date(e.timestamp).getTime() <= t);
  }
  if (type) list = list.filter((e) => e.type === type);
  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return list.slice(0, limit);
}

module.exports = { appendEntry, getEntries, formatTimestampForDisplay };
