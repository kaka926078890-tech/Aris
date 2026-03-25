/**
 * 运行时配置：从 userData/config.json 读写，供打包后用户无需 .env 即可在设置页配置。
 * main 进程启动时先 loadAndApplyRuntimeConfig()，再 require server。
 */
const path = require('path');
const fs = require('fs');
const { getBaseDataDir, normalizeAgentProfile } = require('../../packages/config/paths.js');

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
  'ARIS_LOCAL_LLM_ENABLED',
  'ARIS_LOCAL_LLM_BASE_URL',
  'ARIS_LOCAL_LLM_MODEL',
  'ARIS_LOCAL_LLM_TIMEOUT_MS',
  'ARIS_COLLAB_SCORE_THRESHOLD',
  'ARIS_COLLAB_POLISH_THRESHOLD',
  'ARIS_COLLAB_MAX_ITERATIONS',
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
  ARIS_LOCAL_LLM_ENABLED: 'true',
  ARIS_LOCAL_LLM_BASE_URL: 'http://127.0.0.1:11434',
  ARIS_LOCAL_LLM_MODEL: 'qwen3-vl:4b',
  ARIS_LOCAL_LLM_TIMEOUT_MS: '120000',
  ARIS_COLLAB_SCORE_THRESHOLD: '65',
  ARIS_COLLAB_POLISH_THRESHOLD: '80',
  ARIS_COLLAB_MAX_ITERATIONS: '2',
};

const GLOBAL_CONFIG_DEFAULTS = {
  ARIS_AGENT_PROFILE: 'legacy',
};

function getBaseDir() {
  try {
    return getBaseDataDir();
  } catch (_) {
    return path.join(__dirname, '..', '..', 'data');
  }
}

function getGlobalConfigPath() {
  return path.join(getBaseDir(), 'runtime_config.global.json');
}

function getConfigPath(profile) {
  try {
    const p = normalizeAgentProfile(profile || process.env.ARIS_AGENT_PROFILE);
    return path.join(getBaseDir(), 'profiles', p, 'config.json');
  } catch (_) {
    const p = normalizeAgentProfile(profile || process.env.ARIS_AGENT_PROFILE);
    return path.join(__dirname, '..', '..', 'data', 'profiles', p, 'config.json');
  }
}

function getDataDir() {
  try {
    const p = normalizeAgentProfile(process.env.ARIS_AGENT_PROFILE);
    return path.join(getBaseDir(), 'profiles', p);
  } catch (_) {
    const p = normalizeAgentProfile(process.env.ARIS_AGENT_PROFILE);
    return path.join(__dirname, '..', '..', 'data', 'profiles', p);
  }
}

function readGlobalConfig() {
  const p = getGlobalConfigPath();
  const out = { ...GLOBAL_CONFIG_DEFAULTS };
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        out.ARIS_AGENT_PROFILE = normalizeAgentProfile(data.ARIS_AGENT_PROFILE);
      }
    }
  } catch (e) {
    console.warn('[Aris v2] runtimeConfig global read failed', e?.message);
  }
  return out;
}

function writeGlobalConfig(obj) {
  const p = getGlobalConfigPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = {
    ARIS_AGENT_PROFILE: normalizeAgentProfile(obj && obj.ARIS_AGENT_PROFILE),
  };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function readConfig(profile) {
  const selectedProfile = normalizeAgentProfile(profile || process.env.ARIS_AGENT_PROFILE || readGlobalConfig().ARIS_AGENT_PROFILE);
  const p = getConfigPath(selectedProfile);
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
  out.ARIS_AGENT_PROFILE = selectedProfile;
  return out;
}

function writeConfig(obj) {
  const targetProfile = normalizeAgentProfile(
    obj && Object.prototype.hasOwnProperty.call(obj, 'ARIS_AGENT_PROFILE')
      ? obj.ARIS_AGENT_PROFILE
      : (process.env.ARIS_AGENT_PROFILE || readGlobalConfig().ARIS_AGENT_PROFILE),
  );
  writeGlobalConfig({ ARIS_AGENT_PROFILE: targetProfile });
  process.env.ARIS_AGENT_PROFILE = targetProfile;
  const p = getConfigPath(targetProfile);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = readConfig(targetProfile);
  const data = {};
  CONFIG_KEYS.forEach((k) => {
    const v = obj[k];
    data[k] = v !== undefined && v !== null ? String(v) : (current[k] !== undefined ? current[k] : DEFAULTS[k]);
  });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  applyToProcessEnv(data); // 保存时应用全部键，供 network 等后续使用
  process.env.ARIS_AGENT_PROFILE = targetProfile;
}

/** 仅这 2 个键在启动时写入 process.env，避免启动阶段改动过多导致 SIGBUS */
const ENV_APPLY_AT_STARTUP = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_URL', 'ARIS_LOCAL_LLM_BASE_URL', 'ARIS_LOCAL_LLM_MODEL'];

function applyToProcessEnv(config, keys) {
  if (!config) return;
  const list = keys || CONFIG_KEYS;
  list.forEach((k) => {
    if (config[k] !== undefined && config[k] !== null) process.env[k] = String(config[k]);
  });
}

function loadAndApplyRuntimeConfig() {
  const globalConfig = readGlobalConfig();
  // 若 .env 已显式设置 ARIS_AGENT_PROFILE，优先使用（避免被 runtime_config.global.json 默认 legacy 覆盖）
  const envRaw = process.env.ARIS_AGENT_PROFILE;
  if (envRaw != null && String(envRaw).trim() !== '') {
    process.env.ARIS_AGENT_PROFILE = normalizeAgentProfile(envRaw);
  } else {
    process.env.ARIS_AGENT_PROFILE = normalizeAgentProfile(globalConfig.ARIS_AGENT_PROFILE);
  }
  const config = readConfig(process.env.ARIS_AGENT_PROFILE);
  applyToProcessEnv(config, ENV_APPLY_AT_STARTUP);
  console.info('[Aris v2] runtime profile:', process.env.ARIS_AGENT_PROFILE, 'dataDir=', getDataDir());
}

module.exports = {
  readConfig,
  writeConfig,
  applyToProcessEnv,
  loadAndApplyRuntimeConfig,
  getDataDir,
  readGlobalConfig,
};
