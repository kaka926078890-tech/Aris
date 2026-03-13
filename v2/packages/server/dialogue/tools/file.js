/**
 * 文件类工具：v2 根目录下的文件读写。
 */
const path = require('path');
const fs = require('fs');
const { getV2Root } = require('../../../config/paths.js');

function resolvePath(relativePath) {
  const root = getV2Root();
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(root, normalized);
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
      description: '读取 v2 项目下某个文件的文本内容（UTF-8）。',
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
      name: 'write_file',
      description: '在 v2 项目下写入或覆盖文件。可设 append: true 追加。',
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
      const p = resolvePath(a.relative_path || '');
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, error: '文件不存在' };
      const content = fs.readFileSync(p, 'utf8');
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
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { FILE_TOOLS, runFileTool };
