/**
 * Ollama 检测与启动：检测是否已安装、是否在运行，若未运行则尝试启动。
 * 仅主进程使用，不依赖 BrowserWindow。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OLLAMA_BASE_URL = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace('localhost', '127.0.0.1');
const PING_TIMEOUT_MS = 3000;
const START_WAIT_MS = 3500;

/**
 * @returns {Promise<boolean>} 当前 Ollama 服务是否在运行
 */
async function isOllamaRunning() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch (_) {
    return false;
  }
}

/**
 * @returns {Promise<{ installed: boolean, path?: string }>}
 * 是否检测到 Ollama 可执行文件（PATH 或 Windows 常见路径）
 */
function isOllamaInstalled() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
    const child = spawn(cmd, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let done = false;
    const timeoutId = setTimeout(() => finish(false), 5000);
    const finish = (installed, exePath) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      try { child.kill(); } catch (_) {}
      resolve({ installed: !!installed, path: exePath });
    };
    child.on('error', (err) => {
      if (err && err.code === 'ENOENT' && process.platform === 'win32') {
        const localApp = process.env.LOCALAPPDATA;
        const winPath = localApp
          ? path.join(localApp, 'Programs', 'Ollama', 'ollama.exe')
          : null;
        if (winPath && fs.existsSync(winPath)) {
          finish(true, winPath);
          return;
        }
      }
      finish(false);
    });
    child.on('exit', (code) => finish(code === 0, undefined));
  });
}

/**
 * 尝试启动 Ollama 服务（后台、不阻塞）。不等待完全就绪。
 * @param {string} [exePath] 可选，Ollama 可执行文件路径（Windows 未加入 PATH 时使用）
 */
function startOllama(exePath) {
  const cmd = exePath || (process.platform === 'win32' ? 'ollama.exe' : 'ollama');
  const child = spawn(cmd, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

/**
 * 若已安装且未在运行，则尝试启动并等待一段时间后再检测。
 * @returns {Promise<{ running: boolean, started?: boolean, installed?: boolean, error?: string }>}
 */
async function ensureOllamaStarted() {
  const running = await isOllamaRunning();
  if (running) return { running: true };

  const { installed, path: exePath } = await isOllamaInstalled();
  if (!installed) return { running: false, installed: false, error: 'not_installed' };

  startOllama(exePath);
  await new Promise((r) => setTimeout(r, START_WAIT_MS));
  const nowRunning = await isOllamaRunning();
  return {
    running: nowRunning,
    started: nowRunning,
    installed: true,
    error: nowRunning ? undefined : 'start_failed',
  };
}

/**
 * 仅查询状态，不启动。
 * @returns {Promise<{ running: boolean, installed: boolean }>}
 */
async function getOllamaStatus() {
  const [running, { installed }] = await Promise.all([isOllamaRunning(), isOllamaInstalled()]);
  return { running, installed };
}

module.exports = {
  OLLAMA_BASE_URL,
  isOllamaRunning,
  isOllamaInstalled,
  startOllama,
  ensureOllamaStarted,
  getOllamaStatus,
};
