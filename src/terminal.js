const { spawn } = require('child_process');
const path = require('path');
const { getAgentBasePath } = require('./agentFiles.js');

const TERMINAL_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const ALLOWED_COMMANDS = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'node', 'npm', 'npx']);
const NPM_NPX_ALLOWED_SUBCOMMANDS = new Set(['run', 'install', 'exec', 'ci', 'test', 'start']);

function truncate(str, maxBytes) {
  if (typeof str !== 'string') return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  return buf.slice(0, maxBytes).toString('utf8').replace(/\uFFFD/g, '') + '\n[... 已截断]';
}

function isSafeArg(arg) {
  if (typeof arg !== 'string') return false;
  if (arg.includes('..')) return false;
  const p = path.resolve(arg);
  if (path.isAbsolute(p)) return false;
  return true;
}

function runTerminalCommand({ command, args }) {
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!ALLOWED_COMMANDS.has(cmd)) {
    return { ok: false, error: '命令不在白名单内，仅允许: ls, pwd, cat, head, tail, node, npm, npx' };
  }
  const arr = Array.isArray(args) ? args : [];
  for (let i = 0; i < arr.length; i++) {
    const a = typeof arr[i] === 'string' ? arr[i] : String(arr[i]);
    if (!isSafeArg(a)) {
      return { ok: false, error: '参数不允许包含 .. 或绝对路径' };
    }
  }
  if ((cmd === 'npm' || cmd === 'npx') && arr.length > 0) {
    const sub = arr[0];
    if (typeof sub === 'string' && !NPM_NPX_ALLOWED_SUBCOMMANDS.has(sub)) {
      return { ok: false, error: 'npm/npx 仅允许子命令: run, install, exec, ci, test, start' };
    }
  }

  const cwd = getAgentBasePath();
  return new Promise((resolve) => {
    const child = spawn(cmd, arr, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    const to = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (_) {}
      resolve({
        ok: false,
        error: '执行超时',
        stdout: truncate(stdout, MAX_OUTPUT_BYTES),
        stderr: truncate(stderr, MAX_OUTPUT_BYTES),
      });
    }, TERMINAL_TIMEOUT_MS);

    child.stdout?.on('data', (d) => { stdout += (d && d.toString) ? d.toString() : String(d); });
    child.stderr?.on('data', (d) => { stderr += (d && d.toString) ? d.toString() : String(d); });
    child.on('error', (err) => {
      clearTimeout(to);
      resolve({ ok: false, error: err.message || '执行失败', stdout: '', stderr: '' });
    });
    child.on('close', (code) => {
      clearTimeout(to);
      resolve({
        ok: true,
        stdout: truncate(stdout, MAX_OUTPUT_BYTES),
        stderr: truncate(stderr, MAX_OUTPUT_BYTES),
        exitCode: code,
      });
    });
  });
}

module.exports = { runTerminalCommand };
