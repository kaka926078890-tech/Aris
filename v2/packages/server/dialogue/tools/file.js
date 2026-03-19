/**
 * 文件类工具：v2 根目录下的文件读写。
 */
const path = require('path');
const fs = require('fs');
const { getV2Root, getDataDir, getMemoryFiles, getArisIdeasPath } = require('../../../config/paths.js');
const store = require('../../../store');

const MEMORY_ARIS_IDEAS_KEY = 'memory/aris_ideas.md';

/** 禁止作为文本读取的扩展名（二进制/数据库），避免整库进 context 导致超长 */
const BINARY_EXT_BLOCKLIST = new Set(['.db', '.sqlite', '.sqlite3', '.aris', '.lance', '.bin', '.so', '.dylib', '.node', '.exe', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz']);
/** read_file 最大返回字符数，避免单次工具结果撑爆 context（约 3 万 token 量级） */
const READ_FILE_MAX_CHARS = 120000;

function resolvePath(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
  if (normalized === MEMORY_ARIS_IDEAS_KEY || normalized === 'aris_ideas.md') {
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
  if (normalized === 'aris_ideas.md') return MEMORY_ARIS_IDEAS_KEY;
  return normalized;
}

function summarizeText(text, maxChars = 2500) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const head = s.slice(0, maxChars);
  return head + (s.length > maxChars ? '\n\n[摘要截断]' : '');
}

/** 若 memory 下 aris_ideas.md 不存在，尝试从 repo 内旧位置复制一份（一次性迁移） */
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
      description: '列出 v2 项目下的文件和子目录。可传 subpath 表示子目录。调用前请先 get_dir_cache(subpath) 看是否有可复用目录缓存，未命中再调用本工具。',
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
      description: '读取 v2 项目下某个文件的文本内容（UTF-8）。相对路径 memory/aris_ideas.md 表示当前实例的 memory 文件（存于 data/memory/），与代码库隔离。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径（如 docs/xxx.md 或 memory/aris_ideas.md）' },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在 v2 项目下写入或覆盖文件。可设 append: true 追加。相对路径 memory/aris_ideas.md 表示写入当前实例的 memory 文件（存于 data/memory/）。',
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
      description: '获取当前运行环境与自身能力的简短摘要（版本、数据目录、可用工具列表、主要 memory 文件），用于反思能力边界时按需调用。',
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
      const base = path.join(getV2Root(), subpath);
      if (!fs.existsSync(base)) return { ok: true, list: [] };

      // 命中目录缓存则直接返回
      const cacheRes = store.actionCache.getDirListCache({ dir_path: subpath, limit: null });
      if (cacheRes?.hit && Array.isArray(cacheRes.list)) return { ok: true, list: cacheRes.list };

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
      return { ok: true, list };
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
      const normalizedRel = normalizeRelForCache(rel);
      if (normalizedRel === MEMORY_ARIS_IDEAS_KEY) {
        ensureArisIdeasInMemory();
      }
      const p = resolvePath(rel);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, error: '文件不存在' };
      const ext = path.extname(p).toLowerCase();
      if (BINARY_EXT_BLOCKLIST.has(ext)) {
        return { ok: false, error: '该文件为二进制或数据库格式，无法作为文本返回。请指定 .md、.json、.js、.html 等文本文件，或使用 list_my_files 查看结构。' };
      }
      const stat = fs.statSync(p);
      if (stat.size > READ_FILE_MAX_CHARS * 2) {
        return { ok: false, error: `文件过大（约 ${Math.round(stat.size / 1024)}KB），为避免上下文超长无法完整返回。请指定较小文件或查看文档了解结构。` };
      }
      let content = fs.readFileSync(p, 'utf8');
      if (content.length > READ_FILE_MAX_CHARS) {
        content = content.slice(0, READ_FILE_MAX_CHARS) + '\n\n[内容过长已截断，仅显示前 ' + READ_FILE_MAX_CHARS + ' 字]';
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
      return { ok: true, content };
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
      let version = '0.0.0';
      try {
        const pkgPath = path.join(getV2Root(), 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          version = pkg.version || version;
        }
      } catch (_) {}
      const dataDir = getDataDir();
      const text = `Aris v2 版本 ${version}。数据目录：${dataDir}。可用工具：${toolNames}。主要 memory 文件（位于 memory/）：${memoryList}。配置与行为细节可通过 read_file 查看 packages/server、packages/store 及数据目录下配置。`;
      return { ok: true, summary: text };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { FILE_TOOLS, runFileTool };