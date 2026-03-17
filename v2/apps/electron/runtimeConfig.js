/**
 * 运行时配置：从 userData/config.json 读写，供打包后用户无需 .env 即可在设置页配置。
 * main 进程启动时先 loadAndApplyRuntimeConfig()，再 require server。
 */
const path = require('path');
const fs = require('fs');

const CONFIG_KEYS = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_API_URL',
  'ENABLE_WEB_FETCH',
  'WEB_FETCH_TIMEOUT_MS',
  'WEB_FETCH_MAX_CALLS_PER_MINUTE',
  'WEB_FETCH_MAX_LENGTH',
  'WEB_FETCH_ALLOWED_HOSTS',
  'WEB_FETCH_BLOCKED_HOSTS',
  'REJECT_UNAUTHORIZED',
  'SHOW_THINKING',
];

const DEFAULTS = {
  DEEPSEEK_API_KEY: '',
  DEEPSEEK_API_URL: 'https://api.deepseek.com',
  ENABLE_WEB_FETCH: 'true',
  WEB_FETCH_TIMEOUT_MS: '15000',
  WEB_FETCH_MAX_CALLS_PER_MINUTE: '10',
  WEB_FETCH_MAX_LENGTH: '8000',
  WEB_FETCH_ALLOWED_HOSTS: '',
  WEB_FETCH_BLOCKED_HOSTS: 'localhost,127.0.0.1',
  REJECT_UNAUTHORIZED: 'true',
  SHOW_THINKING: 'false',
};

function getConfigPath() {
  try {
    const { getDataDir } = require('../../packages/config/paths.js');
    return path.join(getDataDir(), 'config.json');
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data', 'config.json');
  }
}

function getDataDir() {
  try {
    const { getDataDir: g } = require('../../packages/config/paths.js');
    return g();
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data');
  }
}

function readConfig() {
  const p = getConfigPath();
  const out = { ...DEFAULTS };
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        CONFIG_KEYS.forEach((k) => {
          if (data[k] !== undefined && data[k] !== null) out[k] = String(data[k]);
        });
      }
    }
  } catch (e) {
    console.warn('[Aris v2] runtimeConfig read failed', e?.message);
  }
  return out;
}

function writeConfig(obj) {
  const p = getConfigPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = readConfig();
  const data = {};
  CONFIG_KEYS.forEach((k) => {
    const v = obj[k];
    data[k] = v !== undefined && v !== null ? String(v) : (current[k] !== undefined ? current[k] : DEFAULTS[k]);
  });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  applyToProcessEnv(data); // 保存时应用全部键，供 network 等后续使用
}

/** 仅这 2 个键在启动时写入 process.env，避免启动阶段改动过多导致 SIGBUS */
const ENV_APPLY_AT_STARTUP = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_URL'];

function applyToProcessEnv(config, keys) {
  if (!config) return;
  const list = keys || CONFIG_KEYS;
  list.forEach((k) => {
    if (config[k] !== undefined && config[k] !== null) process.env[k] = String(config[k]);
  });
}

function loadAndApplyRuntimeConfig() {
  const config = readConfig();
  applyToProcessEnv(config, ENV_APPLY_AT_STARTUP);
}

module.exports = {
  readConfig,
  writeConfig,
  applyToProcessEnv,
  loadAndApplyRuntimeConfig,
  getDataDir,
};
