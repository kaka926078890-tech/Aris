/**
 * 运行时配置：从 userData/config.json 读写，供打包后用户无需 .env 即可配置 API Key。
 * main 进程启动时先 loadAndApplyRuntimeConfig()，再 require server。
 */
const path = require('path');
const fs = require('fs');

const CONFIG_KEYS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_URL'];

function getConfigPath() {
  try {
    const { getDataDir } = require('../../packages/config/paths.js');
    return path.join(getDataDir(), 'config.json');
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data', 'config.json');
  }
}

function readConfig() {
  const p = getConfigPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        return {
          DEEPSEEK_API_KEY: typeof data.DEEPSEEK_API_KEY === 'string' ? data.DEEPSEEK_API_KEY : '',
          DEEPSEEK_API_URL: typeof data.DEEPSEEK_API_URL === 'string' ? data.DEEPSEEK_API_URL : '',
        };
      }
    }
  } catch (e) {
    console.warn('[Aris v2] runtimeConfig read failed', e?.message);
  }
  return { DEEPSEEK_API_KEY: '', DEEPSEEK_API_URL: '' };
}

function writeConfig(obj) {
  const p = getConfigPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = {};
  CONFIG_KEYS.forEach((k) => {
    data[k] = typeof obj[k] === 'string' ? obj[k] : (readConfig())[k] || '';
  });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  applyToProcessEnv(data);
}

function applyToProcessEnv(config) {
  if (!config) return;
  CONFIG_KEYS.forEach((k) => {
    if (config[k] !== undefined && config[k] !== null) process.env[k] = String(config[k]);
  });
}

function loadAndApplyRuntimeConfig() {
  const config = readConfig();
  applyToProcessEnv(config);
}

module.exports = {
  readConfig,
  writeConfig,
  applyToProcessEnv,
  loadAndApplyRuntimeConfig,
};
