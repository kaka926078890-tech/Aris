/**
 * 文件类工具：v2 根目录下的文件读写。
 */
const path = require('path');
const fs = require('fs');
const { getV2Root, getDataDir, getMemoryDir, getMemoryFiles, getArisIdeasPath, getArisIdeasRelativeKey } = require('../../../config/paths.js');
const { getReadFileMaxChars } = require('../../../config/constants.js');
const store = require('../../../store');

/** 禁止作为文本读取的扩展名（二进制/数据库），避免整库进 context 导致超长 */
const BINARY_EXT_BLOCKLIST = new Set(['.db', '.sqlite', '.sqlite3', '.aris', '.lance', '.bin', '.so', '.dylib', '.node', '.exe', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz']);

function readFileMaxBytesBeforeReject() {
  const maxChars = getReadFileMaxChars();
  return Math.min(80 * 1024 * 1024, Math.max(maxChars * 8, 4 * 1024 * 1024));
}

function resolvePath(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/').trim();
  // 所有 memory/ 开头的路径统一解析到实例 memory 目录（与 get_my_context 返回的「实例 memory 目录」一致）
  if (normalized === 'memory' || normalized.startsWith('memory/')) {
    const sub = normalized === 'memory' ? '' : normalized.slice(7);
    return sub ? path.join(getMemoryDir(), sub) : getMemoryDir();
  }
  // 兼容旧文档/旧提示：仅写「文件名」时仍指向实例 memory 下的 ideas 文件（文件名由 memory_files.json 的 aris_ideas 决定，非每个实例必有内容，首次读会尝试从仓库模板复制）
  const ideasBasename = getMemoryFiles().aris_ideas || 'aris_ideas.md';
  if (normalized === ideasBasename) {
    return getArisIdeasPath();
  }
  const root = getV2Root();
  return path.join(root, normalized);
}

function normalizeRelForCache(relativePath) {
  const normalized = path
    .normalize(String(relativePath ?? ''))
    .replace(/^(\.\.(\/|\\|$))+/, '')
    .replace(/\\/g, '/')
    .trim();
  const ideasBasename = getMemoryFiles().aris_ideas || 'aris_ideas.md';
  if (normalized === ideasBasename) return getArisIdeasRelativeKey();
  return normalized;
}

function summarizeText(text, maxChars = 2500) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const head = s.slice(0, maxChars);
  return head + (s.length > maxChars ? '\n\n[摘要截断]' : '');
}

/** 若实例 memory 下 ideas 文件不存在，尝试从仓库内旧路径复制一份（一次性迁移）；实际文件名见 memory_files.json 的 aris_ideas */
function ensureArisIdeasInMemory() {
  const memPath = getArisIdeasPath();
  if (fs.existsSync(memPath) && fs.statSync(memPath).isFile()) return;
  const root = getV2Root();
  const candidates = [
    path.join(root, 'aris_ideas.md'),
    path.join(root, 'docs', 'aris_ideas.md'),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      const dir = path.dirname(memPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, memPath);
      return;
    }
  }
}

const FILE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_my_files',
      description: '列出 v2 项目下的文件和子目录。可传 subpath 表示子目录。内部会优先使用目录缓存（返回中带 from_cache）；也可先 get_dir_cache(subpath) 查看。',
      parameters: {
        type: 'object',
        properties: {
          subpath: { type: 'string', description: '相对子路径', default: '' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dir_cache',
      description: '获取目录缓存（list_my_files 的缓存）。仅返回仍有效的目录条目，用于减少重复 list_my_files。',
      parameters: {
        type: 'object',
        properties: {
          subpath: { type: 'string', description: '目录相对子路径，如 packages/server；空表示 v2 根目录', default: '' },
          limit: { type: 'number', description: '最多返回条数（可选）', default: 50 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_read_file_cache',
      description: '获取已读过的文件摘要缓存（仅返回仍有效、文件存在且未修改的条目）。用于避免重复 read_file。',
      parameters: {
        type: 'object',
        properties: {
          path_prefix: { type: 'string', description: '可选：只返回 path 以此前缀开头的缓存，如 packages/server/dialogue' },
          limit: { type: 'number', description: '最多返回条数', default: 20 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_read_file_cache',
      description: '获取当前会话（sessionId）最近的已读文件摘要缓存。用于在对话中继续阅读时快速定位已读路径，减少 list_my_files 与重复 read_file。',
      parameters: {
        type: 'object',
        properties: {
          path_prefix: { type: 'string', description: '可选：只返回 path 以此前缀开头的缓存，如 packages/server/dialogue' },
          limit: { type: 'number', description: '最多返回条数', default: 20 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取 v2 项目下某个文件的文本内容（UTF-8）。relative_path 以 memory/ 开头的表示实例 memory 目录下的文件（该目录路径可通过 get_my_context 查看），其它为 v2 项目根目录下的相对路径。若文件未修改且存在缓存，可能直接返回摘要（from_cache: true）；需要全文时请传 force_full: true。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径（如 docs/xxx.md 或 memory/xxx.md，memory/ 即实例记忆目录）' },
          force_full: { type: 'boolean', description: '为 true 时跳过读缓存摘要，始终从磁盘读取全文（仍受最大长度限制）', default: false },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在 v2 项目下写入或覆盖文件。relative_path 以 memory/ 开头的会写入实例 memory 目录（可通过 get_my_context 查看该目录路径），其它为 v2 项目根目录下的相对路径。可设 append: true 追加。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '内容' },
          append: { type: 'boolean', description: '是否追加', default: false },
        },
        required: ['relative_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除 v2 项目下的某个文件或文件夹。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径' },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_context',
      description: '获取当前运行环境与自身能力的简短摘要（版本、数据目录、实例 memory 目录、可用工具列表、主要 memory 文件）。写入或读取自己的记忆/配置等文件前，可先调用本工具确认「实例 memory 目录」路径，再使用 write_file/read_file 的 memory/ 前缀写入该目录。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

async function runFileTool(name, args, context) {
  const a = args || {};
  try {
    const sessionId = context?.sessionId;
    const normalizeRelDir = (subpath) => {
      let s = path.normalize(String(subpath ?? '')).replace(/\\/g, '/').trim();
      s = s.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
      // 去掉末尾 /
      s = s.replace(/\/+$/, '');
      return s;
    };
    if (name === 'list_my_files') {
      const subpath = normalizeRelDir(a.subpath || '');
      // memory 或 memory/xxx 统一对应实例 memory 目录，与 resolvePath 一致
      const base = (subpath === 'memory' || subpath.startsWith('memory/'))
        ? (subpath === 'memory' ? getMemoryDir() : path.join(getMemoryDir(), subpath.slice(7)))
        : path.join(getV2Root(), subpath);
      if (!fs.existsSync(base)) return { ok: true, list: [], from_cache: false };

      // 命中目录缓存则直接返回
      const cacheRes = store.actionCache.getDirListCache({ dir_path: subpath, limit: null });
      if (cacheRes?.hit && Array.isArray(cacheRes.list)) return { ok: true, list: cacheRes.list, from_cache: true };

      const entries = fs.readdirSync(base, { withFileTypes: true });
      const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      // 写入目录缓存（用于重复 list_my_files 快速复用）
      try {
        const stat = fs.statSync(base);
        store.actionCache.upsertDirList({
          dir_path: subpath,
          entries: list,
          dir_mtime_at_cache: stat.mtimeMs,
          session_id: sessionId,
        });
      } catch (e) {
        console.warn('[Aris v2][action_cache] 写入目录缓存失败', e?.message);
      }
      return { ok: true, list, from_cache: false };
    }
    if (name === 'get_dir_cache') {
      const subpath = normalizeRelDir(a.subpath || '');
      const limit = a.limit != null ? a.limit : 50;
      const cacheRes = store.actionCache.getDirListCache({ dir_path: subpath, limit });
      return { ok: true, hit: !!cacheRes?.hit, list: cacheRes?.list || [] };
    }
    if (name === 'get_read_file_cache') {
      const res = store.actionCache.getReadFileCache({
        path_prefix: a.path_prefix,
        limit: a.limit,
      });
      return res;
    }
    if (name === 'get_recent_read_file_cache') {
      const res = store.actionCache.getRecentReadFileCache({
        session_id: context?.sessionId,
        path_prefix: a.path_prefix,
        limit: a.limit,
      });
      return res;
    }
    if (name === 'read_file') {
      const rel = (a.relative_path || '').trim();
      const forceFull = a.force_full === true || a.force_full === 'true';
      const normalizedRel = normalizeRelForCache(rel);
      if (normalizedRel === getArisIdeasRelativeKey()) {
        ensureArisIdeasInMemory();
      }
      const p = resolvePath(rel);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, error: '文件不存在' };
      const ext = path.extname(p).toLowerCase();
      if (BINARY_EXT_BLOCKLIST.has(ext)) {
        return { ok: false, error: '该文件为二进制或数据库格式，无法作为文本返回。请指定 .md、.json、.js、.html 等文本文件，或使用 list_my_files 查看结构。' };
      }
      const stat = fs.statSync(p);
      const maxBytes = readFileMaxBytesBeforeReject();
      if (stat.size > maxBytes) {
        return {
          ok: false,
          error: `文件过大（约 ${Math.round(stat.size / 1024)}KB），超过本机可读上限（约 ${Math.round(maxBytes / 1024 / 1024)}MB）。可调小文件或设置 ARIS_READ_FILE_MAX_CHARS / 见 README。`,
        };
      }
      if (!forceFull && typeof store.actionCache.getSingleFileReadIfValid === 'function') {
        const cached = store.actionCache.getSingleFileReadIfValid(normalizedRel);
        if (cached && cached.hit && cached.result_summary) {
          return {
            ok: true,
            content: cached.result_summary,
            from_cache: true,
            note: '来自 action_cache 摘要（与上次 read_file 一致且文件未改）。需全文请对 read_file 传 force_full: true。',
          };
        }
      }
      let content = fs.readFileSync(p, 'utf8');
      const readCap = getReadFileMaxChars();
      if (content.length > readCap) {
        content = content.slice(0, readCap) + '\n\n[内容过长已截断，仅显示前 ' + readCap + ' 字]';
      }
      // read_file 成功后写入 action_cache（仅文件路径维度 + mtime 校验，避免摘要失效）
      try {
        const summary = summarizeText(content, 2500);
        store.actionCache.upsertFileRead({
          file_path: normalizedRel,
          result_summary: summary,
          file_mtime_at_cache: stat.mtimeMs,
          session_id: context?.sessionId,
        });
      } catch (e) {
        // 缓存失败不影响读文件本身
        console.warn('[Aris v2][action_cache] 写入失败', e?.message);
      }
      return { ok: true, content, from_cache: false };
    }
    if (name === 'write_file') {
      const relKey = normalizeRelForCache(a.relative_path || '');
      const p = resolvePath(a.relative_path || '');
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = typeof a.content === 'string' ? a.content : String(a.content ?? '');
      fs.writeFileSync(p, content, { flag: a.append ? 'a' : 'w', encoding: 'utf8' });
      // 写入成功后失效对应缓存条目，避免读缓存摘要与实际文件不一致
      try {
        if (relKey) store.actionCache.invalidateFile({ file_path: relKey });
        // 失效该文件所在目录的目录缓存（仅当该目录处于 v2 根之内时有效；memory/ 下可能不命中）
        if (relKey && !relKey.startsWith('memory/')) {
          const dirPath = path.posix.dirname(relKey);
          const dirKey = (dirPath === '.' ? '' : dirPath);
          store.actionCache.invalidateDir({ dir_path: dirKey });
        }
      } catch (e) {
        console.warn('[Aris v2][action_cache] 失效失败', e?.message);
      }
      return { ok: true };
    }
    if (name === 'delete_file') {
      const relKey = normalizeRelForCache(a.relative_path || '');
      const p = resolvePath(a.relative_path || '');
      
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          // 是文件夹，使用 fs.rmSync 递归删除（Node.js 14+）
          // recursive: true 表示递归删除，force: true 表示即使文件夹非空也删除
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          // 是文件，直接删除
          fs.unlinkSync(p);
        }
      }
      
      try {
        if (relKey) store.actionCache.invalidateFile({ file_path: relKey });
        if (relKey && !relKey.startsWith('memory/')) {
          const dirPath = path.posix.dirname(relKey);
          const dirKey = (dirPath === '.' ? '' : dirPath);
          store.actionCache.invalidateDir({ dir_path: dirKey });
        }
      } catch (e) {
        console.warn('[Aris v2][action_cache] 失效失败', e?.message);
      }
      return { ok: true };
    }
    if (name === 'get_my_context') {
      const toolNames = (context && Array.isArray(context.toolNames))
        ? context.toolNames.join(', ')
        : require('./index.js').getTools().map((t) => t.function.name).join(', ');
      const memoryFiles = getMemoryFiles();
      const memoryList = Object.keys(memoryFiles).join(', ');
      const memoryDir = getMemoryDir();
      let version = '0.0.0';
      try {
        const pkgPath = path.join(getV2Root(), 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          version = pkg.version || version;
        }
      } catch (_) {}
      const dataDir = getDataDir();
      const text = `Aris v2 版本 ${version}。数据目录：${dataDir}。实例 memory 目录（写入/读取自己的记忆、配置等文件时请使用此目录；write_file/read_file 的 relative_path 以 memory/ 开头即指此目录）：${memoryDir}。可用工具：${toolNames}。主要 memory 文件（位于 memory/）：${memoryList}。配置与行为细节可通过 read_file 查看 packages/server、packages/store 及数据目录下配置。`;
      return { ok: true, summary: text };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { FILE_TOOLS, runFileTool };