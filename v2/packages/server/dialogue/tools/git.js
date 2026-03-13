/**
 * Git 只读工具：git_status、git_log。工作目录为 v2 或向上查找含 .git 的目录。
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { getV2Root } = require('../../../config/paths.js');

const GIT_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 16 * 1024;

function getGitCwd() {
  let dir = getV2Root();
  while (dir) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return getV2Root();
}

function truncate(str, maxBytes) {
  if (typeof str !== 'string') return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  return buf.slice(0, maxBytes).toString('utf8').replace(/\uFFFD/g, '') + '\n[... 已截断]';
}

function runGit(cwd, gitArgs) {
  const result = spawnSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES * 2,
  });
  const stdout = truncate(result.stdout || '', MAX_OUTPUT_BYTES);
  const stderr = truncate(result.stderr || '', MAX_OUTPUT_BYTES);
  if (result.error) {
    return { ok: false, error: result.error.message || '执行失败', stdout, stderr };
  }
  return { ok: true, stdout, stderr, status: result.status };
}

const GIT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 Git 工作区状态（简短）。在 v2 或项目根目录执行。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史（最近若干条）。',
      parameters: {
        type: 'object',
        properties: {
          max_count: { type: 'number', description: '最多条数', default: 10 },
        },
      },
    },
  },
];

async function runGitTool(name, args) {
  const cwd = getGitCwd();
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库（v2 及上级目录均无 .git）' };
  }
  if (name === 'git_status') {
    return runGit(cwd, ['status', '--short', '--porcelain']);
  }
  if (name === 'git_log') {
    const n = Math.min(Math.max(Number(args?.max_count) || 10, 1), 50);
    return runGit(cwd, ['log', `-${n}`, '--oneline']);
  }
  return { ok: false, error: 'Unknown tool: ' + name };
}

module.exports = { GIT_TOOLS, runGitTool };
