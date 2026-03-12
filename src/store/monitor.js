/**
 * 监控存储：每轮 token 使用记录、文件修改记录，供监控面板读取。
 * 持久化到用户目录（与现有 db 同基路径）的 JSON 文件。
 */
const path = require('path');
const fs = require('fs');
const { getUserDataPath } = require('./db.js');

const MONITOR_DIR = path.join(getUserDataPath(), 'monitor');
const TOKEN_USAGE_FILE = path.join(MONITOR_DIR, 'token_usage.json');
const FILE_MODIFICATIONS_FILE = path.join(MONITOR_DIR, 'file_modifications.json');

function ensureDir() {
  if (!fs.existsSync(MONITOR_DIR)) {
    fs.mkdirSync(MONITOR_DIR, { recursive: true });
  }
}

/**
 * 记录该轮对话的 token 使用。
 * @param {string} sessionId
 * @param {string|number} roundId - 轮次标识（如时间戳或序号）
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {boolean} [isEstimated=false] - 是否为估算值（API 未返回 usage 时用字符/4 估算）
 */
function recordTokenUsage(sessionId, roundId, inputTokens, outputTokens, isEstimated = false) {
  ensureDir();
  let list = [];
  try {
    if (fs.existsSync(TOKEN_USAGE_FILE)) {
      const raw = fs.readFileSync(TOKEN_USAGE_FILE, 'utf8').trim();
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    }
  } catch (_) {}
  list.push({
    session_id: sessionId,
    round_id: String(roundId),
    input_tokens: Number(inputTokens) || 0,
    output_tokens: Number(outputTokens) || 0,
    is_estimated: !!isEstimated,
    created_at: new Date().toISOString(),
  });
  try {
    fs.writeFileSync(TOKEN_USAGE_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris][monitor] recordTokenUsage write failed', e?.message);
  }
}

/**
 * 对给定文件路径累加修改次数并更新最后修改时间。
 * @param {string} relativePath - 相对路径（项目内或 Aris 文件夹内）
 */
function recordFileModification(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return;
  const normalized = relativePath.replace(/\\/g, '/').trim();
  if (!normalized) return;
  ensureDir();
  let map = {};
  try {
    if (fs.existsSync(FILE_MODIFICATIONS_FILE)) {
      const raw = fs.readFileSync(FILE_MODIFICATIONS_FILE, 'utf8').trim();
      if (raw) map = JSON.parse(raw);
      if (typeof map !== 'object' || map === null) map = {};
    }
  } catch (_) {}
  const prev = map[normalized] || { modificationCount: 0, lastModifiedAt: null };
  map[normalized] = {
    path: normalized,
    modificationCount: (prev.modificationCount || 0) + 1,
    lastModifiedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(FILE_MODIFICATIONS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris][monitor] recordFileModification write failed', e?.message);
  }
}

/**
 * 读取 token 使用记录（按时间倒序，便于面板展示）。
 */
function getTokenUsageRecords() {
  try {
    if (fs.existsSync(TOKEN_USAGE_FILE)) {
      const raw = fs.readFileSync(TOKEN_USAGE_FILE, 'utf8').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          return list.slice().reverse();
        }
      }
    }
  } catch (e) {
    console.warn('[Aris][monitor] getTokenUsageRecords failed', e?.message);
  }
  return [];
}

/**
 * 读取文件修改记录，返回数组 [{ path, modificationCount, lastModifiedAt }]，按 lastModifiedAt 倒序。
 */
function getFileModifications() {
  try {
    if (fs.existsSync(FILE_MODIFICATIONS_FILE)) {
      const raw = fs.readFileSync(FILE_MODIFICATIONS_FILE, 'utf8').trim();
      if (raw) {
        const map = JSON.parse(raw);
        if (typeof map === 'object' && map !== null) {
          const arr = Object.values(map).filter((v) => v && v.path);
          return arr.sort((a, b) => (b.lastModifiedAt || '').localeCompare(a.lastModifiedAt || ''));
        }
      }
    }
  } catch (e) {
    console.warn('[Aris][monitor] getFileModifications failed', e?.message);
  }
  return [];
}

module.exports = {
  recordTokenUsage,
  recordFileModification,
  getTokenUsageRecords,
  getFileModifications,
};
