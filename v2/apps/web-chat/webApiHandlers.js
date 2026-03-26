/**
 * 与 Electron main.js 中 IPC 对齐的 Web API 实现，供 web-chat 服务调用。
 */
const fs = require('fs');
const path = require('path');
const store = require('../../packages/store');
const { handleUserMessage, getPromptPreview } = require('../../packages/server');
const { readConfig, writeConfig, getDataDir } = require('../electron/runtimeConfig.js');
const { getOllamaStatus, ensureOllamaStarted } = require('../electron/ollama.js');
const { getAvoidPhrasesPath, getMemoryDir } = require('../../packages/config/paths.js');
const { runSearchMemoriesPipeline } = require('../../packages/server/dialogue/tools/memory.js');

let dialogueBusy = false;
let dialogueAbortController = null;
let resolveCurrentDialogue = null;

function serializeVectorRow(r) {
  return {
    text: r.text != null ? String(r.text) : '',
    type: r.type != null ? String(r.type) : '',
    created_at: r.created_at,
  };
}

/**
 * 将对话结果以 NDJSON 流式写出：chunk / agentActions / done
 * @param {import('http').ServerResponse} res
 * @param {string} userContent
 */
async function runDialogueNdjson(res, userContent) {
  if (dialogueBusy) {
    if (dialogueAbortController) dialogueAbortController.abort();
    await new Promise((resolve) => {
      resolveCurrentDialogue = resolve;
    });
  }

  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'close',
      'X-Accel-Buffering': 'no',
    });
  }

  const write = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
  };

  dialogueBusy = true;
  dialogueAbortController = new AbortController();
  const sendChunk = (c) => write({ type: 'chunk', data: c });
  const sendAgentActions = (actions) => write({ type: 'agentActions', data: actions });

  try {
    const result = await handleUserMessage(
      userContent,
      sendChunk,
      sendAgentActions,
      dialogueAbortController.signal,
    );
    write({ type: 'done', result });
  } catch (e) {
    console.error('[aris-web-chat] dialogue', e?.message || e);
    write({ type: 'done', result: { error: String(e?.message || e), content: '' } });
  } finally {
    dialogueAbortController = null;
    dialogueBusy = false;
    if (resolveCurrentDialogue) {
      resolveCurrentDialogue();
      resolveCurrentDialogue = null;
    }
    try {
      res.end();
    } catch (_) {}
  }
}

function abortDialogue() {
  if (dialogueAbortController) dialogueAbortController.abort();
}

/**
 * @param {string} method
 * @param {unknown[]} args
 */
async function rpc(method, args) {
  const a = args || [];

  switch (method) {
    case 'prompt:getPreview':
      return getPromptPreview(a[0]);
    case 'history:getSessions':
      return store.conversations.getAllSessions();
    case 'history:getCurrentSessionId':
      return store.conversations.getCurrentSessionId();
    case 'history:getConversation':
      return store.conversations.getAllForSession(a[0]);
    case 'history:clearAll':
      await store.conversations.clearAllConversations();
      return { ok: true };
    case 'vector:search': {
      const out = await runSearchMemoriesPipeline(String(a[0] || ''), Number(a[1]) || 10);
      return {
        results: out.rows.map((r) => ({
          ...serializeVectorRow(r),
          _score: Number(r._score) || 0,
          _keyword_boost: typeof r._keyword_boost === 'number' ? r._keyword_boost : 0,
          _vector_layer_score: r._vector_layer_score != null ? Number(r._vector_layer_score) : undefined,
          _memory_type_weight: r._memory_type_weight != null ? Number(r._memory_type_weight) : undefined,
          _time_decay_factor: r._time_decay_factor != null ? Number(r._time_decay_factor) : undefined,
          _score_after_type_time: r._score_after_type_time != null ? Number(r._score_after_type_time) : undefined,
        })),
        smartQuery: out.smartQuery,
        originalQuery: out.originalQuery,
        filterByAssociation: out.filterByAssociation,
        meta: out.meta || null,
      };
    }
    case 'vector:getRecent': {
      if (!store.vector) return [];
      const rows = await store.vector.getRecentByType(String(a[0] || 'dialogue_turn'), Number(a[1]) || 50);
      return rows.map(serializeVectorRow);
    }
    case 'monitor:getTokenUsageRecords':
      return store.monitor && store.monitor.getTokenUsageRecords ? store.monitor.getTokenUsageRecords() : [];
    case 'monitor:getFileModifications':
      return store.monitor && store.monitor.getFileModifications ? store.monitor.getFileModifications() : [];
    case 'content:getIdentity':
      return store.identity ? store.identity.readIdentity() : { name: '', notes: '' };
    case 'content:writeIdentity':
      if (store.identity) store.identity.writeIdentity(a[0]);
      return { ok: true };
    case 'content:getRequirements':
      return store.requirements ? store.requirements.listRecent(a[0] === 0 ? 0 : (Number(a[0]) || 50)) : [];
    case 'content:writeRequirements':
      if (store.requirements && store.requirements.replaceAll) store.requirements.replaceAll(a[0]);
      return { ok: true };
    case 'content:writeRequirementsAsDocument': {
      if (!store.requirements || !store.requirements.replaceAll) return { ok: false };
      const text = typeof a[0] === 'string' ? a[0].trim() : '';
      if (text) store.requirements.replaceAll([{ text }]);
      return { ok: true };
    }
    case 'content:triggerRequirementsRefinement':
      return store.requirements && store.requirements.triggerRefinementAsDocument
        ? await store.requirements.triggerRefinementAsDocument()
        : { success: false, message: '未加载' };
    case 'content:triggerRefinementAsDocument': {
      const RequirementsRefiner = require('../../packages/store/requirements_refiner.js');
      const refiner = new RequirementsRefiner();
      const category = a[0];
      if (category === 'requirements' && store.requirements && store.requirements.triggerRefinementAsDocument) {
        return await store.requirements.triggerRefinementAsDocument();
      }
      if (category === 'corrections' && store.corrections) {
        const list = store.corrections.getRecentWithMeta ? store.corrections.getRecentWithMeta(0) : [];
        const texts = list.map((x) => x.text).filter(Boolean);
        if (!texts.length) return { success: false, message: '暂无纠错内容' };
        const doc = await refiner.refineToDocument(texts, 'corrections');
        if (store.corrections.replaceWithDocument) store.corrections.replaceWithDocument(doc);
        return { success: true, message: '纠错已总结为一份文档' };
      }
      if (category === 'preferences' && store.preferences) {
        const list = store.preferences.listAll ? store.preferences.listAll() : [];
        const schema = { topic_field: 'topic', summary_field: 'summary' };
        const lines = list
          .map((x) => `[${x[schema.topic_field] || x.topic || ''}] ${x[schema.summary_field] || x.summary || ''}`)
          .filter(Boolean);
        if (!lines.length) return { success: false, message: '暂无喜好内容' };
        const doc = await refiner.refineToDocument(lines, 'preferences');
        if (store.preferences.replaceWithDocument) store.preferences.replaceWithDocument(doc);
        return { success: true, message: '喜好已总结为一份文档' };
      }
      return { success: false, message: '不支持的类别' };
    }
    case 'content:getState':
      return store.state ? store.state.readState() : null;
    case 'content:getProactiveState':
      return store.state ? store.state.readProactiveState() : null;
    case 'content:getEmotionsRecent':
      return store.emotions ? store.emotions.getRecent(Number(a[0]) || 20) : [];
    case 'content:getExpressionDesiresRecent': {
      const list = store.expressionDesires ? store.expressionDesires.getRecent(Number(a[0]) || 20) : [];
      const formatUtc =
        store.timeline && typeof store.timeline.formatTimestampForDisplay === 'function'
          ? store.timeline.formatTimestampForDisplay
          : () => '';
      return list.map((e) => ({ ...e, created_at_display_utc: formatUtc(e.created_at) || '' }));
    }
    case 'content:getCorrectionsRecent':
      return store.corrections ? store.corrections.getRecent(Number(a[0]) || 20) : [];
    case 'content:getCorrectionsAll':
      return store.corrections && store.corrections.getRecentWithMeta ? store.corrections.getRecentWithMeta(0) : [];
    case 'content:writeCorrections':
      if (store.corrections && store.corrections.replaceAll) store.corrections.replaceAll(a[0]);
      return { ok: true };
    case 'content:writeCorrectionsAsDocument': {
      if (!store.corrections || !store.corrections.replaceAll) return { ok: false };
      const text = typeof a[0] === 'string' ? a[0].trim() : '';
      if (text) store.corrections.replaceAll([{ text }]);
      return { ok: true };
    }
    case 'content:getPreferences':
      return store.preferences && store.preferences.listAll ? store.preferences.listAll() : [];
    case 'content:writePreferences':
      if (store.preferences && store.preferences.replaceAll) store.preferences.replaceAll(a[0]);
      return { ok: true };
    case 'content:writePreferencesAsDocument':
      if (store.preferences && store.preferences.replaceWithDocument) store.preferences.replaceWithDocument(a[0]);
      return { ok: true };
    case 'content:getAvoidPhrases': {
      try {
        const p = getAvoidPhrasesPath();
        if (!fs.existsSync(p)) return { avoid_phrases: [] };
        const raw = fs.readFileSync(p, 'utf8').trim();
        const data = raw ? JSON.parse(raw) : {};
        return { avoid_phrases: Array.isArray(data.avoid_phrases) ? data.avoid_phrases : [] };
      } catch (e) {
        return { avoid_phrases: [] };
      }
    }
    case 'content:setAvoidPhrases': {
      try {
        const list = Array.isArray(a[0]) ? a[0].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
        const dir = getMemoryDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(getAvoidPhrasesPath(), JSON.stringify({ avoid_phrases: list }, null, 2), 'utf8');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message };
      }
    }
    case 'config:get':
      return { ...readConfig(), dataDir: getDataDir() };
    case 'config:set': {
      writeConfig(a[0] || {});
      return { ok: true };
    }
    case 'ollama:status':
      return getOllamaStatus();
    case 'ollama:ensure':
      return ensureOllamaStarted();
    default:
      throw new Error('unknown_rpc_method: ' + method);
  }
}

module.exports = {
  runDialogueNdjson,
  abortDialogue,
  rpc,
};
