/**
 * action_cache：缓存「文件读/写操作」的摘要，用于复用 read_file 结果并避免重复读取。
 * 当前实现：仅缓存 read_file 的结果摘要；write_file/delete_file 会失效对应条目。
 * 额外记录 session_id，便于按会话取最近已读文件。
 */
const fs = require('fs');
const path = require('path');
const { getActionCachePath, getV2Root, getArisIdeasPath, getArisIdeasRelativeKey } = require('../config/paths.js');

let actionCache = null;
function loadCache() {
  if (actionCache) return actionCache;
  const p = getActionCachePath();
  try {
    if (!fs.existsSync(p)) return (actionCache = []);
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return (actionCache = []);
    const data = JSON.parse(raw);
    actionCache = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    return actionCache;
  } catch (_) {
    return (actionCache = []);
  }
}

function saveCache() {
  const p = getActionCachePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(actionCache || [], null, 2), 'utf8');
}

function genId() {
  return `ac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getAbsPath(file_path) {
  if (!file_path) return null;
  const normalized = String(file_path).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (normalized === getArisIdeasRelativeKey()) return getArisIdeasPath();
  return path.join(getV2Root(), normalized);
}

function getAbsDirPath(dir_path) {
  const normalized = String(dir_path ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  // '' 表示 v2 根目录
  if (!normalized) return getV2Root();
  return path.join(getV2Root(), normalized);
}

function upsertFileRead({ file_path, result_summary, file_mtime_at_cache, session_id }) {
  const list = loadCache();
  const key = `file:${file_path}`;
  const now = new Date().toISOString();
  const next = {
    id: genId(),
    key,
    action: 'read_file',
    file_path,
    result_summary: String(result_summary ?? '').trim(),
    file_mtime_at_cache,
    session_id: session_id || null,
    cached_at: now,
  };
  // 只对同 key 更新（保留最近一条）
  actionCache = list.filter((x) => x?.key !== key);
  actionCache.push(next);
  saveCache();
  return next;
}

function upsertDirList({ dir_path, entries, dir_mtime_at_cache, session_id }) {
  const list = loadCache();
  const key = `dir:${dir_path ?? ''}`;
  const now = new Date().toISOString();
  const next = {
    id: genId(),
    key,
    action: 'list_my_files',
    dir_path: dir_path ?? '',
    entries: Array.isArray(entries) ? entries : [],
    dir_mtime_at_cache,
    session_id: session_id || null,
    cached_at: now,
  };
  actionCache = list.filter((x) => x?.key !== key);
  actionCache.push(next);
  saveCache();
  return next;
}

function invalidateFile({ file_path }) {
  const list = loadCache();
  const key = `file:${file_path}`;
  actionCache = list.filter((x) => x?.key !== key);
  saveCache();
  return true;
}

function invalidateDir({ dir_path }) {
  const list = loadCache();
  const key = `dir:${dir_path ?? ''}`;
  actionCache = list.filter((x) => x?.key !== key);
  saveCache();
  return true;
}

function statMtimeMsSafe(absPath) {
  try {
    if (!absPath || !fs.existsSync(absPath)) return null;
    const st = fs.statSync(absPath);
    return st?.mtimeMs ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * 获取目录缓存（会校验目录 mtime 与存在性，不通过则返回未命中）
 * @param {{ dir_path?: string, limit?: number }} options
 * @returns {{ ok: boolean, hit: boolean, list: (string[]|null) }}
 */
function getDirListCache(options = {}) {
  const list = loadCache();
  const dir_path = options.dir_path != null ? String(options.dir_path) : '';
  const limit = options.limit != null ? Number(options.limit) : null;
  const absDir = getAbsDirPath(dir_path);
  const currentMtime = statMtimeMsSafe(absDir);

  // 目录不存在则命中失败
  if (currentMtime == null) return { ok: true, hit: false, list: null };

  const key = `dir:${dir_path}`;
  const item = (list || []).slice().reverse().find((x) => x?.key === key && x?.action === 'list_my_files');
  if (!item || item.dir_mtime_at_cache == null) return { ok: true, hit: false, list: null };

  const mtimeDiff = Math.abs((currentMtime ?? 0) - item.dir_mtime_at_cache);
  if (mtimeDiff > 1) return { ok: true, hit: false, list: null };

  const entries = Array.isArray(item.entries) ? item.entries : [];
  const finalEntries = (limit && !Number.isNaN(limit)) ? entries.slice(0, limit) : entries;
  return { ok: true, hit: true, list: finalEntries };
}

/**
 * 获取有效的 read_file 缓存（会在返回前校验 mtime 与文件存在性，不通过则过滤）。
 * @param {{ path_prefix?: string, limit?: number }} options
 * @returns {{ ok: boolean, items: Array<{ path: string, result_summary: string, cached_at: string }> }}
 */
function getReadFileCache(options = {}) {
  const list = loadCache();
  const path_prefix = options.path_prefix != null ? String(options.path_prefix) : '';
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const prefix = path_prefix.replace(/\\/g, '/').replace(/^\/+/, '').trim();

  const candidates = (list || [])
    .filter((x) => x?.action === 'read_file' && typeof x?.file_path === 'string' && x.file_path)
    .filter((x) => (prefix ? x.file_path.startsWith(prefix) : true))
    .sort((a, b) => String(b?.cached_at || '').localeCompare(String(a?.cached_at || '')));

  const valid = [];
  const invalidKeys = [];
  for (const item of candidates) {
    if (valid.length >= limit) break;
    const abs = getAbsPath(item.file_path);
    const currentMtime = statMtimeMsSafe(abs);
    // 文件不存在 / mtime 不一致 => 该缓存失效（过滤掉并可选清理）
    const cachedMtime = item.file_mtime_at_cache;
    const mtimeDiff = (currentMtime == null || cachedMtime == null) ? Infinity : Math.abs(currentMtime - cachedMtime);
    if (currentMtime == null || cachedMtime == null || mtimeDiff > 1) {
      invalidKeys.push(item.key);
      continue;
    }
    valid.push({
      path: item.file_path,
      result_summary: item.result_summary,
      cached_at: item.cached_at,
    });
  }

  if (invalidKeys.length) {
    actionCache = (list || []).filter((x) => !invalidKeys.includes(x?.key));
    saveCache();
  }

  return { ok: true, items: valid };
}

/**
 * 单路径：若存在有效 read_file 缓存（mtime 一致），返回摘要，供 read_file 工具短路读盘。
 * @param {string} file_path 与缓存 key 一致的相对路径（已 normalize，如 packages/foo.js）
 * @returns {{ hit: false } | { hit: true, result_summary: string, cached_at?: string }}
 */
function getSingleFileReadIfValid(file_path) {
  const fp = String(file_path || '').trim();
  if (!fp) return { hit: false };
  const list = loadCache();
  const key = `file:${fp}`;
  const item = (list || []).slice().reverse().find((x) => x?.key === key && x?.action === 'read_file');
  if (!item || typeof item.result_summary !== 'string') return { hit: false };

  const abs = getAbsPath(item.file_path);
  const currentMtime = statMtimeMsSafe(abs);
  const cachedMtime = item.file_mtime_at_cache;
  const mtimeDiff = (currentMtime == null || cachedMtime == null) ? Infinity : Math.abs(currentMtime - cachedMtime);
  if (currentMtime == null || mtimeDiff > 1) {
    try {
      invalidateFile({ file_path: fp });
    } catch (_) {}
    return { hit: false };
  }
  return {
    hit: true,
    result_summary: item.result_summary,
    cached_at: item.cached_at,
  };
}

/**
 * 获取某会话下最近的 read_file 缓存（仍会做 mtime + 存在性校验）。
 * 若 session_id 缺失，则等价于全局最近缓存。
 * @param {{ session_id?: string, path_prefix?: string, limit?: number }} options
 * @returns {{ ok: boolean, items: Array<{ path: string, result_summary: string, cached_at: string }> }}
 */
function getRecentReadFileCache(options = {}) {
  const list = loadCache();
  const session_id = options.session_id != null ? String(options.session_id) : '';
  const path_prefix = options.path_prefix != null ? String(options.path_prefix) : '';
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const prefix = path_prefix.replace(/\\/g, '/').replace(/^\/+/, '').trim();

  const candidates = (list || [])
    .filter((x) => x?.action === 'read_file' && typeof x?.file_path === 'string' && x.file_path)
    .filter((x) => (session_id ? x.session_id === session_id : true))
    .filter((x) => (prefix ? x.file_path.startsWith(prefix) : true))
    .sort((a, b) => String(b?.cached_at || '').localeCompare(String(a?.cached_at || '')));

  const valid = [];
  for (const item of candidates) {
    if (valid.length >= limit) break;
    const abs = getAbsPath(item.file_path);
    const currentMtime = statMtimeMsSafe(abs);
    const cachedMtime = item.file_mtime_at_cache;
    const mtimeDiff = (currentMtime == null || cachedMtime == null) ? Infinity : Math.abs(currentMtime - cachedMtime);
    if (currentMtime == null || cachedMtime == null || mtimeDiff > 1) continue;
    valid.push({
      path: item.file_path,
      result_summary: item.result_summary,
      cached_at: item.cached_at,
    });
  }

  return { ok: true, items: valid };
}

module.exports = {
  upsertFileRead,
  upsertDirList,
  invalidateFile,
  invalidateDir,
  getReadFileCache,
  getRecentReadFileCache,
  getDirListCache,
  getSingleFileReadIfValid,
};

