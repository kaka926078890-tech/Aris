/**
 * v2 全量备份/恢复：对话(SQLite)、向量库、用户身份、状态、要求、情感、纠错、表达欲望、监控等，
 * 以及 memory/ 与 data/ 下所有已知配置文件（timeline、important_documents、associations、
 * quiet_phrases、retrieval_config、session_summaries、preferences、network_config、aris_ideas 等）。
 * 单文件 .aris，支持一键导出/导入，便于公司↔家里或换机迁移。
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

function readTextIfExists(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    console.warn('[Aris v2][backup] readText', filePath, e?.message);
  }
  return defaultValue == null ? '' : defaultValue;
}

function getMonitorDir() {
  return path.join(getConfig().getDataDir(), 'monitor');
}

/** 导出 data/ 与 memory/ 下所有已知配置与文本文件（供全量迁移） */
function exportExtraPaths(config) {
  const c = config;
  return {
    timeline: readJsonIfExists(c.getTimelinePath && c.getTimelinePath(), null),
    important_documents: readJsonIfExists(c.getImportantDocumentsPath && c.getImportantDocumentsPath(), null),
    associations: readJsonIfExists(c.getAssociationsPath && c.getAssociationsPath(), null),
    quiet_phrases: readJsonIfExists(c.getQuietPhrasesPath && c.getQuietPhrasesPath(), null),
    retrieval_config: readJsonIfExists(c.getRetrievalConfigPath && c.getRetrievalConfigPath(), null),
    session_summaries: readJsonIfExists(c.getSessionSummariesPath && c.getSessionSummariesPath(), null),
    preferences: readJsonIfExists(c.getPreferencesPath && c.getPreferencesPath(), null),
    network_config: readJsonIfExists(c.getNetworkConfigPath && c.getNetworkConfigPath(), null),
    proactive_config: readJsonIfExists(c.getProactiveConfigPath && c.getProactiveConfigPath(), null),
    behavior_config: readJsonIfExists(c.getBehaviorConfigPath && c.getBehaviorConfigPath(), null),
    avoid_phrases: readJsonIfExists(c.getAvoidPhrasesPath && c.getAvoidPhrasesPath(), null),
    self_notes: readJsonIfExists(c.getSelfNotesPath && c.getSelfNotesPath(), null),
    exploration_notes: readJsonIfExists(c.getExplorationNotesPath && c.getExplorationNotesPath(), null),
    user_profile_summary_md: readTextIfExists(c.getUserProfileSummaryPath && c.getUserProfileSummaryPath(), ''),
    aris_ideas_md: readTextIfExists(c.getArisIdeasPath && c.getArisIdeasPath(), ''),
  };
}

function writeExtraPaths(config, payload) {
  const c = config;
  const w = (key, getPath, value) => {
    if (value == null || (typeof value === 'string' && value === '')) return;
    if (!getPath || typeof getPath !== 'function') return;
    const p = getPath();
    if (!p) return;
    try {
      if (typeof value === 'string' && (p.endsWith('.md') || !p.endsWith('.json'))) {
        fs.writeFileSync(p, value, 'utf8');
      } else {
        fs.writeFileSync(p, JSON.stringify(value, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn('[Aris v2][backup] writeExtra', key, e?.message);
    }
  };
  const extra = payload.extra_paths || {};
  w('timeline', c.getTimelinePath, extra.timeline);
  w('important_documents', c.getImportantDocumentsPath, extra.important_documents);
  w('associations', c.getAssociationsPath, extra.associations);
  w('quiet_phrases', c.getQuietPhrasesPath, extra.quiet_phrases);
  w('retrieval_config', c.getRetrievalConfigPath, extra.retrieval_config);
  w('session_summaries', c.getSessionSummariesPath, extra.session_summaries);
  w('preferences', c.getPreferencesPath, extra.preferences);
  w('network_config', c.getNetworkConfigPath, extra.network_config);
  w('proactive_config', c.getProactiveConfigPath, extra.proactive_config);
  w('behavior_config', c.getBehaviorConfigPath, extra.behavior_config);
  w('avoid_phrases', c.getAvoidPhrasesPath, extra.avoid_phrases);
  w('self_notes', c.getSelfNotesPath, extra.self_notes);
  w('exploration_notes', c.getExplorationNotesPath, extra.exploration_notes);
  if (extra.user_profile_summary_md != null && c.getUserProfileSummaryPath) {
    fs.writeFileSync(c.getUserProfileSummaryPath(), extra.user_profile_summary_md, 'utf8');
  }
  if (extra.aris_ideas_md != null && c.getArisIdeasPath) {
    fs.writeFileSync(c.getArisIdeasPath(), extra.aris_ideas_md, 'utf8');
  }
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

  const extra_paths = exportExtraPaths(config);

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
    extra_paths,
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
    if (payload.extra_paths && typeof payload.extra_paths === 'object') {
      writeExtraPaths(config, payload);
    }
  }

  console.info('[Aris v2][backup] import', filePath, 'version=', version);
}

module.exports = { exportToFile, importFromFile };
