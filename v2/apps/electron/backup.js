/**
 * v2 全量备份/恢复：对话(SQLite)、向量库、用户身份、状态、要求、情感、纠错、表达欲望、监控等，
 * 以及 memory/ 与 data/ 下所有已知配置文件（timeline、associations、quiet_phrases、
 * retrieval_config、session_summaries、preferences、network_config、aris_ideas 等）。
 * v3 起额外包含：data 根目录观测/配置（dialogue_turn_metrics、prompt_planner_metrics、config.json）、
 * async_outbox/ 全量、以及 constraints_brief / exploration_notes / action_cache / work_state / conversation_rules.md。
 * 单文件 .aris，支持一键导出/导入，便于公司↔家里或换机迁移。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKUP_VERSION = 3;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex');
}

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

/** 存在则读 UTF-8，不存在则 null（与空文件区分：空文件返回 ''） */
function readUtf8OrNull(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    console.warn('[Aris v2][backup] readUtf8', filePath, e?.message);
  }
  return null;
}

function isSafeFlatFileName(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') return false;
  return true;
}

/** data 根目录下需随迁移带走的文本文件（观测、应用配置） */
const DATA_ROOT_TEXT_FILES = [
  'dialogue_turn_metrics.jsonl',
  'prompt_planner_metrics.jsonl',
  'config.json',
];

/**
 * 导出 data 目录下除 sqlite/lancedb 外的关键文件，避免换机丢失观测与异步队列。
 * @returns {{ root_files: Record<string, string|null>, async_outbox: Record<string, string|null> }}
 */
function exportDataDirBundle(dataDir) {
  const root_files = {};
  for (const name of DATA_ROOT_TEXT_FILES) {
    if (!isSafeFlatFileName(name)) continue;
    root_files[name] = readUtf8OrNull(path.join(dataDir, name));
  }
  const async_outbox = {};
  const outDir = path.join(dataDir, 'async_outbox');
  try {
    if (fs.existsSync(outDir) && fs.statSync(outDir).isDirectory()) {
      const names = fs.readdirSync(outDir);
      for (const name of names) {
        if (!isSafeFlatFileName(name)) continue;
        const p = path.join(outDir, name);
        if (fs.statSync(p).isFile()) async_outbox[name] = readUtf8OrNull(p);
      }
    }
  } catch (e) {
    console.warn('[Aris v2][backup] export async_outbox', e?.message);
  }
  return { root_files, async_outbox };
}

function writeDataDirBundle(dataDir, bundle) {
  if (!bundle || typeof bundle !== 'object') return;
  const root = bundle.root_files && typeof bundle.root_files === 'object' ? bundle.root_files : {};
  for (const [name, content] of Object.entries(root)) {
    if (!isSafeFlatFileName(name)) continue;
    if (typeof content !== 'string') continue;
    try {
      fs.writeFileSync(path.join(dataDir, name), content, 'utf8');
    } catch (e) {
      console.warn('[Aris v2][backup] write root file', name, e?.message);
    }
  }
  const ao = bundle.async_outbox && typeof bundle.async_outbox === 'object' ? bundle.async_outbox : {};
  const outDir = path.join(dataDir, 'async_outbox');
  if (Object.keys(ao).length) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(ao)) {
      if (!isSafeFlatFileName(name)) continue;
      if (typeof content !== 'string') continue;
      try {
        fs.writeFileSync(path.join(outDir, name), content, 'utf8');
      } catch (e) {
        console.warn('[Aris v2][backup] write async_outbox', name, e?.message);
      }
    }
  }
}

function getMonitorDir() {
  return path.join(getConfig().getDataDir(), 'monitor');
}

/** 导出 data/ 与 memory/ 下所有已知配置与文本文件（供全量迁移） */
function exportExtraPaths(config) {
  const c = config;
  const memoryDir = c.getMemoryDir && c.getMemoryDir();
  const mf = (c.getMemoryFiles && c.getMemoryFiles()) || {};
  const explorationName = mf.exploration_notes || 'exploration_notes.json';
  return {
    timeline: readJsonIfExists(c.getTimelinePath && c.getTimelinePath(), null),
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
    user_profile_summary_md: readTextIfExists(c.getUserProfileSummaryPath && c.getUserProfileSummaryPath(), ''),
    aris_ideas_md: readTextIfExists(c.getArisIdeasPath && c.getArisIdeasPath(), ''),
    constraints_brief: readJsonIfExists(c.getConstraintsBriefPath && c.getConstraintsBriefPath(), null),
    exploration_notes: memoryDir ? readJsonIfExists(path.join(memoryDir, explorationName), null) : null,
    action_cache: readJsonIfExists(c.getActionCachePath && c.getActionCachePath(), null),
    work_state: readJsonIfExists(c.getWorkStatePath && c.getWorkStatePath(), null),
    conversation_rules_md: memoryDir ? readUtf8OrNull(path.join(memoryDir, 'conversation_rules.md')) : null,
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
  if (extra.user_profile_summary_md != null && c.getUserProfileSummaryPath) {
    fs.writeFileSync(c.getUserProfileSummaryPath(), extra.user_profile_summary_md, 'utf8');
  }
  if (extra.aris_ideas_md != null && c.getArisIdeasPath) {
    fs.writeFileSync(c.getArisIdeasPath(), extra.aris_ideas_md, 'utf8');
  }
  w('constraints_brief', c.getConstraintsBriefPath, extra.constraints_brief);
  const mf = (c.getMemoryFiles && c.getMemoryFiles()) || {};
  if (extra.exploration_notes != null && c.getMemoryDir) {
    const p = path.join(c.getMemoryDir(), mf.exploration_notes || 'exploration_notes.json');
    try {
      fs.writeFileSync(p, JSON.stringify(extra.exploration_notes, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Aris v2][backup] writeExtra exploration_notes', e?.message);
    }
  }
  w('action_cache', c.getActionCachePath, extra.action_cache);
  w('work_state', c.getWorkStatePath, extra.work_state);
  if (extra.conversation_rules_md != null && c.getMemoryDir) {
    try {
      fs.writeFileSync(path.join(c.getMemoryDir(), 'conversation_rules.md'), extra.conversation_rules_md, 'utf8');
    } catch (e) {
      console.warn('[Aris v2][backup] writeExtra conversation_rules', e?.message);
    }
  }
}

/** 与写入 .aris 文件相同结构的 JSON 对象（供 Web 导出等复用） */
async function buildExportPayload() {
  const store = getStore();
  const config = getConfig();
  const dataDir = config.getDataDir();

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
  const data_dir_bundle = exportDataDirBundle(dataDir);

  return {
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
    data_dir_bundle,
  };
}

async function exportToFile(filePath) {
  const payload = await buildExportPayload();
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  console.info('[Aris v2][backup] export', filePath, 'memory=', payload.memory.length);
  return {
    memoryCount: payload.memory.length,
    hasConversations: !!payload.sqlite,
    hasIdentity: !!(payload.identity && (payload.identity.name || payload.identity.notes)),
  };
}

/**
 * 从已解析的备份对象恢复（与 importFromFile 逻辑一致，供 Web HTTP 等调用）。
 * @param {object} payload
 * @param {{ label?: string }} [meta]
 */
async function importFromParsedPayload(payload, meta = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份格式无效：根对象缺失');
  }
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
    if (version >= 3 && payload.data_dir_bundle && typeof payload.data_dir_bundle === 'object') {
      writeDataDirBundle(dataDir, payload.data_dir_bundle);
    }
  }

  const label = meta.label != null ? String(meta.label) : 'payload';
  console.info('[Aris v2][backup] import', label, 'version=', version);
}

async function importMergeFromParsedPayload(payload, meta = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份格式无效：根对象缺失');
  }
  const store = getStore();
  const config = getConfig();

  const dataDir = config.getDataDir();
  const memoryDir = config.getMemoryDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

  let insertedConversations = 0;
  let mergedMemory = 0;

  if (payload.sqlite && typeof payload.sqlite === 'string') {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const backupBytes = Buffer.from(payload.sqlite, 'base64');
    const backupDb = new SQL.Database(new Uint8Array(backupBytes));

    const currentDb = await store.db.getDb();

    // 预先把当前库的消息去重键建集合；这样不会触发逐条 SELECT。
    const existingKeys = new Set();
    {
      const stmt = currentDb.prepare('SELECT session_id, role, created_at, content FROM conversations');
      while (stmt.step()) {
        const [session_id, role, created_at, content] = stmt.get();
        const key = `${String(session_id)}|${String(role)}|${Number(created_at) || 0}|${sha256Hex(content)}`;
        existingKeys.add(key);
      }
      stmt.free();
    }

    const selectStmt = backupDb.prepare('SELECT session_id, role, content, created_at FROM conversations');
    while (selectStmt.step()) {
      const [session_id, role, content, created_at] = selectStmt.get();
      const key = `${String(session_id)}|${String(role)}|${Number(created_at) || 0}|${sha256Hex(content)}`;
      if (existingKeys.has(key)) continue;

      const ins = currentDb.prepare('INSERT INTO conversations (session_id, role, content, created_at) VALUES (?, ?, ?, ?)');
      ins.bind([String(session_id), String(role), String(content), Number(created_at) || 0]);
      ins.step();
      ins.free();

      existingKeys.add(key);
      insertedConversations++;
    }
    selectStmt.free();
    try { backupDb.close?.(); } catch (_) {}
    store.db.persist();
  }

  if (payload.memory && Array.isArray(payload.memory) && payload.memory.length > 0 && store.vector) {
    const desiredTypes = new Set(payload.memory.map((r) => String(r?.type ?? '')));
    const existingMemory = await store.vector.exportAll();
    const existingMemoryKeys = new Set();
    for (const r of existingMemory) {
      const type = String(r?.type ?? '');
      if (!desiredTypes.has(type)) continue;
      existingMemoryKeys.add(`${type}|${sha256Hex(r?.text ?? '')}`);
    }

    for (const r of payload.memory) {
      const type = String(r?.type ?? '');
      if (!desiredTypes.has(type)) desiredTypes.add(type);
      if (!r || !Array.isArray(r.vector) || r.vector.length === 0) continue;
      const text = String(r?.text ?? '');
      const key = `${type}|${sha256Hex(text)}`;
      if (existingMemoryKeys.has(key)) continue;

      await store.vector.add({
        text,
        vector: r.vector,
        type,
        metadata: (r.metadata && typeof r.metadata === 'object') ? r.metadata : {},
      });
      existingMemoryKeys.add(key);
      mergedMemory++;
    }
  }

  const label = meta.label != null ? String(meta.label) : 'payload';
  console.info('[Aris v2][backup] import_merge', label, 'insertedConversations=', insertedConversations, 'mergedMemory=', mergedMemory);
  return { insertedConversations, mergedMemory };
}

async function importFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  await importFromParsedPayload(payload, { label: filePath });
}

async function importMergeFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  return importMergeFromParsedPayload(payload, { label: filePath });
}

module.exports = {
  exportToFile,
  importFromFile,
  importMergeFromFile,
  buildExportPayload,
  importFromParsedPayload,
  importMergeFromParsedPayload,
};
