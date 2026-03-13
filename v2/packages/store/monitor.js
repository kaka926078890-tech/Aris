/**
 * 监控存储：每轮 token 使用记录、文件修改记录，供监控面板读取。
 * 与 v1 一致，持久化到 v2 数据目录下的 monitor/ JSON 文件。
 */
const path = require('path');
const fs = require('fs');

function getMonitorDir() {
  try {
    const { getDataDir } = require('../config/paths.js');
    return path.join(getDataDir(), 'monitor');
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data', 'monitor');
  }
}

const TOKEN_USAGE_FILE = () => path.join(getMonitorDir(), 'token_usage.json');
const FILE_MODIFICATIONS_FILE = () => path.join(getMonitorDir(), 'file_modifications.json');

function ensureDir() {
  const dir = getMonitorDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function recordTokenUsage(sessionId, roundId, inputTokens, outputTokens, isEstimated = false) {
  ensureDir();
  let list = [];
  try {
    const fp = TOKEN_USAGE_FILE();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    }
    list.push({
      session_id: sessionId,
      round_id: String(roundId),
      input_tokens: Number(inputTokens) || 0,
      output_tokens: Number(outputTokens) || 0,
      is_estimated: !!isEstimated,
      created_at: new Date().toISOString(),
    });
    fs.writeFileSync(fp, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris v2][monitor] recordTokenUsage write failed', e?.message);
  }
}

function recordFileModification(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return;
  const normalized = relativePath.replace(/\\/g, '/').trim();
  if (!normalized) return;
  ensureDir();
  let map = {};
  try {
    const fp = FILE_MODIFICATIONS_FILE();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      if (raw) map = JSON.parse(raw);
      if (typeof map !== 'object' || map === null) map = {};
    }
    const prev = map[normalized] || { modificationCount: 0, lastModifiedAt: null };
    map[normalized] = {
      path: normalized,
      modificationCount: (prev.modificationCount || 0) + 1,
      lastModifiedAt: new Date().toISOString(),
    };
    fs.writeFileSync(fp, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris v2][monitor] recordFileModification write failed', e?.message);
  }
}

function getTokenUsageRecords() {
  try {
    const fp = TOKEN_USAGE_FILE();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list.slice().reverse();
      }
    }
  } catch (e) {
    console.warn('[Aris v2][monitor] getTokenUsageRecords failed', e?.message);
  }
  return [];
}

function getFileModifications() {
  try {
    const fp = FILE_MODIFICATIONS_FILE();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      if (raw) {
        const map = JSON.parse(raw);
        if (typeof map === 'object' && map !== null) {
          const arr = Object.values(map).filter((v) => v && v.path);
          return arr.sort((a, b) => (b.lastModifiedAt || '').localeCompare(a.lastModifiedAt || ''));
        }
      }
    }
  } catch (e) {
    console.warn('[Aris v2][monitor] getFileModifications failed', e?.message);
  }
  return [];
}

module.exports = {
  recordTokenUsage,
  recordFileModification,
  getTokenUsageRecords,
  getFileModifications,
};
