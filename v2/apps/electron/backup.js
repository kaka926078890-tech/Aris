/**
 * v2 全量备份/恢复：对话(SQLite)、向量库、用户身份、状态、要求、情感、纠错、表达欲望、监控等。
 * 单文件 .aris，支持一键导出/导入，便于公司↔家里同步。
 */
const fs = require('fs');
const path = require('path');

const BACKUP_VERSION = 2;

function getStore() {
  return require('../../packages/store');
}

function getConfig() {
  return require('../../packages/config');
}

function readJsonIfExists(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[Aris v2][backup] readJson', filePath, e?.message);
  }
  return defaultValue;
}

function getMonitorDir() {
  return path.join(getConfig().getDataDir(), 'monitor');
}

async function exportToFile(filePath) {
  const store = getStore();
  const config = getConfig();
  const dataDir = config.getDataDir();
  const memoryDir = config.getMemoryDir();

  let sqliteBase64 = '';
  const sqlitePath = config.getSqlitePath();
  if (fs.existsSync(sqlitePath)) {
    sqliteBase64 = fs.readFileSync(sqlitePath).toString('base64');
  }

  let memory = [];
  if (store.vector) {
    try {
      memory = await store.vector.exportAll();
    } catch (e) {
      console.warn('[Aris v2][backup] vector exportAll failed', e?.message);
    }
  }

  const identity = store.identity.readIdentity();
  const state = store.state.readState();
  const proactive_state = store.state.readProactiveState();
  const requirements = store.requirements.listRecent(99999);

  const emotionsPath = config.getEmotionsPath();
  const expressionDesiresPath = config.getExpressionDesiresPath();
  const correctionsPath = config.getCorrectionsPath();
  const emotions = readJsonIfExists(emotionsPath, []);
  const expression_desires = readJsonIfExists(expressionDesiresPath, []);
  const corrections = readJsonIfExists(correctionsPath, []);

  const monitorDir = getMonitorDir();
  const tokenUsagePath = path.join(monitorDir, 'token_usage.json');
  const fileModsPath = path.join(monitorDir, 'file_modifications.json');
  const token_usage = readJsonIfExists(tokenUsagePath, []);
  const file_modifications = readJsonIfExists(fileModsPath, {});

  const payload = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    sqlite: sqliteBase64,
    memory,
    identity,
    state,
    proactive_state,
    requirements: Array.isArray(requirements) ? requirements : [],
    emotions: Array.isArray(emotions) ? emotions : [],
    expression_desires: Array.isArray(expression_desires) ? expression_desires : [],
    corrections: Array.isArray(corrections) ? corrections : [],
    monitor: { token_usage, file_modifications },
  };

  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  console.info('[Aris v2][backup] export', filePath, 'memory=', memory.length);
  return {
    memoryCount: memory.length,
    hasConversations: !!sqliteBase64,
    hasIdentity: !!(identity && (identity.name || identity.notes)),
  };
}

async function importFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  const store = getStore();
  const config = getConfig();
  const dataDir = config.getDataDir();
  const memoryDir = config.getMemoryDir();

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

  const version = payload.version || 1;

  if (payload.sqlite) {
    store.db.closeWithoutPersist();
    fs.writeFileSync(config.getSqlitePath(), Buffer.from(payload.sqlite, 'base64'));
  }

  if (payload.memory && Array.isArray(payload.memory) && payload.memory.length > 0 && store.vector) {
    try {
      await store.vector.resetAndImport(payload.memory);
    } catch (e) {
      console.warn('[Aris v2][backup] vector import failed', e?.message);
    }
  }

  if (version >= 2) {
    if (payload.identity && typeof payload.identity === 'object') {
      store.identity.writeIdentity({
        name: payload.identity.name,
        notes: payload.identity.notes,
      });
    }
    if (payload.state && typeof payload.state === 'object') {
      store.state.writeState({
        last_active_time: payload.state.last_active_time,
        last_mental_state: payload.state.last_mental_state,
      });
    }
    if (payload.proactive_state && typeof payload.proactive_state === 'object') {
      store.state.writeProactiveState(payload.proactive_state);
    }
    if (Array.isArray(payload.requirements)) {
      fs.writeFileSync(config.getRequirementsPath(), JSON.stringify(payload.requirements, null, 2), 'utf8');
    }
    if (Array.isArray(payload.emotions)) {
      fs.writeFileSync(config.getEmotionsPath(), JSON.stringify(payload.emotions, null, 2), 'utf8');
    }
    if (Array.isArray(payload.expression_desires)) {
      fs.writeFileSync(config.getExpressionDesiresPath(), JSON.stringify(payload.expression_desires, null, 2), 'utf8');
    }
    if (Array.isArray(payload.corrections)) {
      fs.writeFileSync(config.getCorrectionsPath(), JSON.stringify(payload.corrections, null, 2), 'utf8');
    }
    if (payload.monitor && typeof payload.monitor === 'object') {
      const monitorDir = getMonitorDir();
      if (!fs.existsSync(monitorDir)) fs.mkdirSync(monitorDir, { recursive: true });
      if (Array.isArray(payload.monitor.token_usage)) {
        fs.writeFileSync(path.join(monitorDir, 'token_usage.json'), JSON.stringify(payload.monitor.token_usage, null, 2), 'utf8');
      }
      if (payload.monitor.file_modifications && typeof payload.monitor.file_modifications === 'object') {
        fs.writeFileSync(path.join(monitorDir, 'file_modifications.json'), JSON.stringify(payload.monitor.file_modifications, null, 2), 'utf8');
      }
    }
  }

  console.info('[Aris v2][backup] import', filePath, 'version=', version);
}

module.exports = { exportToFile, importFromFile };
