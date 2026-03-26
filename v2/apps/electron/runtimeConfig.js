/**
 * 运行时配置：从 userData/config.json 读写，供打包后用户无需 .env 即可在设置页配置。
 * main 进程启动时先 loadAndApplyRuntimeConfig()，再 require server。
 */
const path = require('path');
const fs = require('fs');
const { getBaseDataDir } = require('../../packages/config/paths.js');

const CONFIG_KEYS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_URL', 'SHOW_THINKING'];

const DEFAULTS = {
  DEEPSEEK_API_KEY: '',
  DEEPSEEK_API_URL: 'https://api.deepseek.com',
  SHOW_THINKING: 'false',
};

function getBaseDir() {
  try {
    return getBaseDataDir();
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data');
  }
}

function getConfigPath() {
  return path.join(getBaseDir(), 'config.json');
}

function getDataDir() {
  const { getDataDir: gd } = require('../../packages/config/paths.js');
  return gd();
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
  applyToProcessEnv(data);
}

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
  console.info('[Aris v2] dataDir=', getDataDir());
}

module.exports = {
  readConfig,
  writeConfig,
  applyToProcessEnv,
  loadAndApplyRuntimeConfig,
  getDataDir,
};
