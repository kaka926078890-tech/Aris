/**
 * 在 v2 项目根目录内按文本搜索，减少反复 list/read 探路。
 * 优先调用 ripgrep（rg）；不可用时回退为有限深度的 Node 扫描。
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getV2Root } = require('../../../config/paths.js');

const execFileAsync = promisify(execFile);

const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.cache', 'coverage', 'lancedb',
]);
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.html', '.css', '.scss',
  '.yml', '.yaml', '.toml', '.txt', '.sh', '.env', '.example',
]);

const REPO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_repo_text',
      description:
        '在 v2 项目根目录下按关键词搜索文件路径（优先 ripgrep）。用于快速定位含某字符串的文件，减少层层 list_my_files。pattern 为普通子串（非正则时 rg 仍按字面匹配）。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本（子串）' },
          subpath: { type: 'string', description: '可选，限定在相对子目录下搜索，如 packages/server', default: '' },
          max_results: { type: 'number', description: '最多返回路径条数', default: 40 },
        },
        required: ['pattern'],
      },
    },
  },
];

function normalizeSubpath(sub) {
  let s = path.normalize(String(sub || '')).replace(/\\/g, '/').trim();
  s = s.replace(/^(\.\.(\/|$))+/, '').replace(/^\/+/, '');
  return s.replace(/\/+$/, '');
}

async function tryRipgrep(rootAbs, pattern, subpath, maxResults) {
  const cwd = subpath ? path.join(rootAbs, subpath) : rootAbs;
  if (!fs.existsSync(cwd)) return null;
  const args = [
    '-l',
    '-F',
    '--max-count',
    '1',
    '--glob',
    '!**/node_modules/**',
    '--glob',
    '!.git/**',
    '--glob',
    '!**/dist/**',
    '--glob',
    '!**/lancedb/**',
    pattern,
    '.',
  ];
  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd,
      timeout: 25000,
      maxBuffer: 3 * 1024 * 1024,
      windowsHide: true,
    });
    const lines = String(stdout || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    const out = [];
    for (const line of lines) {
      const full = path.isAbsolute(line) ? line : path.join(cwd, line);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        out.push(path.relative(rootAbs, full).replace(/\\/g, '/'));
      }
      if (out.length >= maxResults) break;
    }
    return { ok: true, engine: 'ripgrep', paths: out.slice(0, maxResults) };
  } catch (_) {
    return null;
  }
}

function walkScan(rootAbs, pattern, subpath, maxResults) {
  const base = subpath ? path.join(rootAbs, subpath) : rootAbs;
  if (!fs.existsSync(base)) return { ok: true, engine: 'node_walk', paths: [], note: '子路径不存在' };
  const needle = String(pattern || '').toLowerCase();
  const results = [];
  let scanned = 0;
  const maxScan = 2500;

  function walk(dir, depth) {
    if (results.length >= maxResults || depth > 14 || scanned >= maxScan) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxResults || scanned >= maxScan) return;
      const name = e.name;
      if (SKIP_DIR.has(name)) continue;
      const full = path.join(dir, name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      scanned += 1;
      const ext = path.extname(name).toLowerCase();
      if (ext && !TEXT_EXT.has(ext)) continue;
      try {
        const st = fs.statSync(full);
        if (st.size > 800_000) continue;
        const raw = fs.readFileSync(full, 'utf8');
        if (raw.toLowerCase().includes(needle)) {
          results.push(path.relative(rootAbs, full).replace(/\\/g, '/'));
        }
      } catch (_) {}
    }
  }

  walk(base, 0);
  return {
    ok: true,
    engine: 'node_walk',
    paths: results.slice(0, maxResults),
    note:
      results.length >= maxResults || scanned >= maxScan
        ? '（已达条数或扫描上限；可缩小 subpath、安装 ripgrep 或更具体的 pattern）'
        : undefined,
  };
}

async function runRepoSearchTool(name, args) {
  const a = args || {};
  if (name !== 'search_repo_text') return { ok: false, error: 'Unknown tool' };
  const pattern = String(a.pattern || '').trim();
  if (!pattern) return { ok: false, error: 'pattern 不能为空' };
  const maxResults = Math.min(Math.max(Number(a.max_results) || 40, 1), 80);
  const subpath = normalizeSubpath(a.subpath);
  const rootAbs = getV2Root();

  const rg = await tryRipgrep(rootAbs, pattern, subpath, maxResults);
  if (rg) {
    const text =
      rg.paths.length === 0
        ? '（未命中；可换关键词或确认路径在 v2 项目内）'
        : rg.paths.join('\n');
    return { ok: true, paths: rg.paths, text, engine: rg.engine };
  }

  const fb = walkScan(rootAbs, pattern, subpath, maxResults);
  const text =
    fb.paths.length === 0
      ? '（未命中；本机若无 rg 则使用慢速扫描，可安装 ripgrep 后重试）'
      : fb.paths.join('\n');
  return {
    ok: true,
    paths: fb.paths,
    text,
    engine: fb.engine,
    note: fb.note,
  };
}

module.exports = { REPO_TOOLS, runRepoSearchTool };
