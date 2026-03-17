/**
 * 文件类工具：v2 根目录下的文件读写。
 */
const path = require('path');
const fs = require('fs');
const { getV2Root, getDataDir, getMemoryFiles, getArisIdeasPath } = require('../../../config/paths.js');
const { markDocumentViewed } = require('../importantDocsReminder.js');

const MEMORY_ARIS_IDEAS_KEY = 'memory/aris_ideas.md';

function resolvePath(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
  if (normalized === MEMORY_ARIS_IDEAS_KEY || normalized === 'aris_ideas.md') {
    return getArisIdeasPath();
  }
  const root = getV2Root();
  return path.join(root, normalized);
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
      description: '列出 v2 项目下的文件和子目录。可传 subpath 表示子目录。',
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
      name: 'read_file',
      description: '读取 v2 项目下某个文件的文本内容（UTF-8）。相对路径 memory/aris_ideas.md 表示当前实例的愿望/探索文档（存于 data/memory/），与代码库隔离。',
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
      description: '在 v2 项目下写入或覆盖文件。可设 append: true 追加。相对路径 memory/aris_ideas.md 表示写入当前实例的愿望/探索文档（存于 data/memory/）。',
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
      description: '删除 v2 项目下的某个文件。',
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

async function runFileTool(name, args) {
  const a = args || {};
  try {
    if (name === 'list_my_files') {
      const base = path.join(getV2Root(), (a.subpath || '').trim());
      if (!fs.existsSync(base)) return { ok: true, list: [] };
      const entries = fs.readdirSync(base, { withFileTypes: true });
      const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { ok: true, list };
    }
    if (name === 'read_file') {
      const rel = (a.relative_path || '').trim();
      const normalizedRel = path.normalize(rel).replace(/\\/g, '/');
      if (normalizedRel === MEMORY_ARIS_IDEAS_KEY || normalizedRel === 'aris_ideas.md') {
        ensureArisIdeasInMemory();
      }
      const p = resolvePath(rel);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, error: '文件不存在' };
      const content = fs.readFileSync(p, 'utf8');
      markDocumentViewed(normalizedRel);
      return { ok: true, content };
    }
    if (name === 'write_file') {
      const p = resolvePath(a.relative_path || '');
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = typeof a.content === 'string' ? a.content : String(a.content ?? '');
      fs.writeFileSync(p, content, { flag: a.append ? 'a' : 'w', encoding: 'utf8' });
      return { ok: true };
    }
    if (name === 'delete_file') {
      const p = resolvePath(a.relative_path || '');
      if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.unlinkSync(p);
      return { ok: true };
    }
    if (name === 'get_my_context') {
      const { getTools } = require('./index.js');
      const tools = getTools();
      const toolNames = tools.map((t) => t.function.name).join(', ');
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
      const text = `Aris v2 版本 ${version}。数据目录：${dataDir}。可用工具：${toolNames}。主要 memory 文件（位于 memory/）：${memoryList}。配置与行为细节可通过 read_file 查看 packages/server、packages/store 及 docs/aris_runtime_context.md。`;
      return { ok: true, summary: text };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { FILE_TOOLS, runFileTool };
