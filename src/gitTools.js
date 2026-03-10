const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getAgentBasePath } = require('./agentFiles.js');

const GIT_TIMEOUT_MS = 60000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const DANGEROUS_PATTERNS = ['--force', '-f', 'push -f', 'push --force'];
// 移除了 'reset' 和 '--hard'，允许安全的reset操作

function truncate(str, maxBytes) {
  if (typeof str !== 'string') return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  return buf.slice(0, maxBytes).toString('utf8').replace(/\\uFFFD/g, '') + '\n[... 已截断]';
}

function resolveRepoPath(repoPath) {
  const base = getAgentBasePath();
  const rel = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (rel.includes('..')) return { ok: false, error: '路径不允许' };
  const joined = path.join(base, rel);
  const resolved = path.normalize(path.resolve(base, rel));
  const normalizedBase = path.normalize(base);
  if (!resolved.startsWith(normalizedBase)) {
    return { ok: false, error: '路径不允许' };
  }
  return { ok: true, cwd: resolved };
}

function rejectDangerousArgs(args) {
  const flat = Array.isArray(args) ? args : [args];
  const str = flat.map((a) => String(a)).join(' ');
  const lower = str.toLowerCase();
  for (const p of DANGEROUS_PATTERNS) {
    if (lower.includes(p.toLowerCase())) return true;
  }
  return false;
}

function runGit(cwd, gitArgs) {
  if (rejectDangerousArgs(gitArgs)) {
    return { ok: false, error: '不允许的参数（禁止 --force、push -f 等）' };
  }
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

function gitStatus(repoPath = '') {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  return runGit(cwd, ['status', '--short', '--porcelain']);
}

function gitDiff(repoPath = '', staged = false) {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const args = ['diff'];
  if (staged) args.push('--staged');
  return runGit(cwd, args);
}

function gitLog(repoPath = '', maxCount = 10) {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const n = Math.min(Math.max(Number(maxCount) || 10, 1), 50);
  return runGit(cwd, ['log', `-${n}`, '--oneline']);
}

function gitAdd(repoPath = '', paths = []) {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const pathList = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && !p.includes('..')) : [];
  if (pathList.length === 0) return runGit(cwd, ['add', '.']);
  return runGit(cwd, ['add', ...pathList]);
}

function gitCommit(repoPath = '', message = '') {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) return { ok: false, error: 'commit message 不能为空' };
  return runGit(cwd, ['commit', '-m', msg]);
}

function gitPull(repoPath = '', remote = '', branch = '') {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const args = ['pull'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  return runGit(cwd, args);
}

function gitPush(repoPath = '', remote = '', branch = '') {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  const args = ['push'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  return runGit(cwd, args);
}

// 新增：安全的git reset函数
function gitReset(repoPath = '', mode = '--soft', commit = 'HEAD~1') {
  const { ok, cwd, error } = resolveRepoPath(repoPath);
  if (!ok) return { ok: false, error };
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { ok: false, error: '当前路径不是 Git 仓库' };
  }
  
  // 只允许安全的reset模式
  const allowedModes = ['--soft', '--mixed'];
  if (!allowedModes.includes(mode)) {
    return { ok: false, error: '只允许 --soft 或 --mixed 模式' };
  }
  
  return runGit(cwd, ['reset', mode, commit]);
}

module.exports = {
  gitStatus,
  gitDiff,
  gitLog,
  gitAdd,
  gitCommit,
  gitPull,
  gitPush,
  gitReset,
};