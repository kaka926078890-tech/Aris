/**
 * Aris 自己文件夹：项目源码根目录（含 src/、docs/ 等），通过 listMyFiles / readFile / writeFile 读写。
 * 路径校验防止越权，大文件截断，仅 UTF-8 文本。
 */
const path = require('path');
const fs = require('fs');

const MAX_READ_BYTES = 512 * 1024; // 512KB
/** 路径段允许：Unicode 字母/数字、空格、下划线、点、横线（支持中文等文件名） */
const SAFE_NAME_REGEX = /^[\p{L}\p{N}\s_.\-]+$/u;

/** 项目根目录：agentFiles.js 在 src/ 下，故上一级为项目根 */
function getAgentBasePath() {
  return path.normalize(path.join(__dirname, '..'));
}

/**
 * 校验相对路径并解析为绝对路径，禁止 .. 与绝对路径，并用 realpath 防链接逃逸。
 * @returns { { ok: boolean, resolved?: string, error?: string } }
 */
function resolveAndValidate(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('..')) {
    return { ok: false, error: '路径不允许' };
  }
  const base = getAgentBasePath();
  const joined = path.join(base, relativePath);
  const resolved = path.normalize(path.resolve(base, relativePath));
  if (!resolved.startsWith(base)) {
    return { ok: false, error: '路径不允许' };
  }
  try {
    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync(resolved);
      const realBase = fs.realpathSync(base);
      const rel = path.relative(realBase, real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, error: '路径不允许' };
      }
    }
  } catch (_) {
    return { ok: false, error: '路径不允许' };
  }
  const segments = relativePath.split(path.sep).filter(Boolean);
  for (const seg of segments) {
    if (!SAFE_NAME_REGEX.test(seg) || seg === '.' || seg === '..') {
      return { ok: false, error: '路径不允许' };
    }
  }
  return { ok: true, resolved };
}

/**
 * 列出 agent 目录下文件与子目录。
 * @param {string} [subpath=''] 相对子路径
 * @returns {{ ok: boolean, entries?: Array<{ name: string, type: 'file'|'dir' }>, error?: string }}
 */
function listMyFiles(subpath = '') {
  const { ok, resolved, error } = resolveAndValidate(subpath || '');
  if (!ok) return { ok: false, error: error || '路径不允许' };
  try {
    if (!fs.existsSync(resolved)) return { ok: true, entries: [] };
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { ok: false, error: '不是目录' };
    const names = fs.readdirSync(resolved);
    const entries = names.map((name) => {
      const full = path.join(resolved, name);
      const s = fs.statSync(full);
      return { name, type: s.isDirectory() ? 'dir' : 'file' };
    });
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: e.message || '列出失败' };
  }
}

/**
 * 读取 agent 下某文件的文本内容，限制 512KB，仅 UTF-8。
 * @param {string} relativePath 相对路径
 * @returns {{ ok: boolean, content?: string, error?: string }}
 */
function readFile(relativePath) {
  const { ok, resolved, error } = resolveAndValidate(relativePath);
  if (!ok) return { ok: false, error: error || '路径不允许' };
  try {
    if (!fs.existsSync(resolved)) return { ok: false, error: '文件不存在' };
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    const size = stat.size;
    if (size > MAX_READ_BYTES) {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const fd = fs.openSync(resolved, 'r');
      fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
      fs.closeSync(fd);
      const content = buf.toString('utf8');
      return { ok: true, content: content + '\n\n[内容已截断，文件超过 512KB]' };
    }
    const raw = fs.readFileSync(resolved);
    if (!Buffer.isBuffer(raw)) return { ok: false, error: '读取失败' };
    const content = raw.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(raw)) {
      return { ok: false, error: '仅支持 UTF-8 文本文件' };
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message || '读取失败' };
  }
}

/**
 * 在 agent 下写入或追加文本文件。
 * @param {string} relativePath 相对路径
 * @param {string} content 文本内容
 * @param {boolean} [append=false] 是否追加
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
function writeFile(relativePath, content, append = false) {
  const { ok, resolved, error } = resolveAndValidate(relativePath);
  if (!ok) return { ok: false, error: error || '路径不允许' };
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const flag = append ? 'a' : 'w';
    fs.writeFileSync(resolved, typeof content === 'string' ? content : String(content), { flag, encoding: 'utf8' });
    const base = getAgentBasePath();
    const rel = path.relative(base, resolved);
    return { ok: true, path: rel };
  } catch (e) {
    return { ok: false, error: e.message || '写入失败' };
  }
}

function deleteFile(relativePath) {
  const { ok, resolved, error } = resolveAndValidate(relativePath);
  if (!ok) return { ok: false, error: error || '路径不允许' };
  try {
    if (!fs.existsSync(resolved)) return { ok: false, error: '文件不存在' };
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: '只能删除文件，不能删除目录' };
    fs.unlinkSync(resolved);
    const base = getAgentBasePath();
    const rel = path.relative(base, resolved);
    return { ok: true, path: rel };
  } catch (e) {
    return { ok: false, error: e.message || '删除失败' };
  }
}

module.exports = { getAgentBasePath, listMyFiles, readFile, writeFile, deleteFile };
