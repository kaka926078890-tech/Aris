/**
 * 数据门面：对上层暴露「读上下文」「写对话/状态/向量」等粗粒度接口。
 * 逻辑层与工具层通过门面访问数据，避免直接依赖各 store 子模块。
 * 仅做读写与聚合，不包含「何时检索」「何时写」的策略。
 */
const fs = require('fs');
const identity = require('./identity.js');
const requirements = require('./requirements.js');
const state = require('./state.js');
const conversations = require('./conversations.js');
const summaries = require('./summaries.js');
const corrections = require('./corrections.js');
const emotions = require('./emotions.js');
const preferences = require('./preferences.js');
const { getAvoidPhrasesPath } = require('../config/paths.js');

let vectorModule = null;
try {
  vectorModule = require('./vector.js');
} catch (_) {}

// ---------- 读：供 BFF/contextBuilder 组上下文 ----------

function getIdentity() {
  return identity.readIdentity();
}

function getRequirementsSummary() {
  return requirements.getSummary() || '（无）';
}

function getState() {
  return state.readState();
}

function getProactiveState() {
  return state.readProactiveState();
}

async function getCurrentSessionId() {
  return conversations.getCurrentSessionId();
}

async function getRecentConversation(sessionId, limit = 20) {
  return conversations.getRecent(sessionId, limit);
}

function getSessionSummary(sessionId) {
  const entry = summaries.readSummary(sessionId);
  return (entry && entry.content && entry.content.trim()) || '（无）';
}

function getRecentCorrections(limit = 3) {
  return corrections.getRecent(limit);
}

/** 纠错完整摘要：全部纠错。若为单条文档（无「此前/用户纠正」格式或仅一条长文）则原样返回；否则格式化为「此前→用户纠正」列表 */
function getCorrectionsFullSummary() {
  const withMeta = corrections.getRecentWithMeta ? corrections.getRecentWithMeta(0) : [];
  if (!withMeta.length) return '（无）';
  if (withMeta.length === 1 && withMeta[0].text) {
    const raw = withMeta[0].text;
    if (raw.length > 400 || !/用户纠正[：:]|我此前说[：:]/.test(raw)) return raw;
  }
  const list = withMeta.map((x) => x.text);
  const lines = list.map((raw) => {
    const m = (raw || '').match(/用户纠正[：:]\s*([^\n]+)/);
    const correction = m ? m[1].trim().slice(0, 80) : '';
    const prev = (raw || '').match(/我此前说[：:]\s*([^\n]+)/);
    const prevText = prev ? prev[1].trim().slice(0, 50) : '';
    if (!correction) return null;
    return prevText ? `· 此前：${prevText} → 用户纠正：${correction}` : `· 用户纠正：${correction}`;
  }).filter(Boolean);
  return lines.length ? lines.join('\n') : '（无）';
}

/** 用户喜好摘要：供【用户约束】注入，全部喜好（原先+新内容整块） */
function getPreferencesSummaryForPrompt() {
  return preferences.getSummaryForPrompt({ maxLines: 200 }) || '（无）';
}

/** 禁止用语列表：供【用户约束】注入，一行「禁止使用以下表述：xxx、yyy」 */
function getAvoidPhrasesForPrompt() {
  try {
    const p = getAvoidPhrasesPath();
    if (!fs.existsSync(p)) return '（未配置，可在 memory/avoid_phrases.json 中配置）';
    const raw = fs.readFileSync(p, 'utf8').trim();
    const data = raw ? JSON.parse(raw) : {};
    const list = Array.isArray(data.avoid_phrases) ? data.avoid_phrases : (Array.isArray(data) ? data : []);
    const phrases = list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 30));
    return phrases.length ? `禁止使用以下表述：${phrases.join('、')}` : '（未配置）';
  } catch (_) {
    return '（未配置）';
  }
}

function getRecentEmotions(limit = 1) {
  return emotions.getRecent(limit);
}

// ---------- 写：供逻辑层与工具执行后写回 ----------

async function appendConversation(sessionId, role, content) {
  return conversations.append(sessionId, role, content);
}

function writeState(updates) {
  return state.writeState(updates);
}

function writeProactiveState(updates) {
  return state.writeProactiveState(updates);
}

/**
 * 写入一条向量块（对话轮次）。需传入已 embed 的 vector 与 metadata。
 * @param {object} params - { text, vector, type, metadata }
 */
async function addVectorBlock(params) {
  if (!vectorModule || !vectorModule.add) return null;
  return vectorModule.add(params);
}

/**
 * 生成对话块的 embedding。门面统一封装，便于逻辑层只调一次。
 */
async function embedForDialogue(text, options = {}) {
  if (!vectorModule || !vectorModule.embed) return null;
  return vectorModule.embed(text, options);
}

// ---------- 供工具层通过 context 使用的 store 能力（保持与现有 store 兼容，便于工具逐步迁移） ----------

function getStore() {
  return require('./index.js');
}

module.exports = {
  getIdentity,
  getRequirementsSummary,
  getState,
  getProactiveState,
  getCurrentSessionId,
  getRecentConversation,
  getSessionSummary,
  getRecentCorrections,
  getCorrectionsFullSummary,
  getPreferencesSummaryForPrompt,
  getAvoidPhrasesForPrompt,
  getRecentEmotions,
  appendConversation,
  writeState,
  writeProactiveState,
  addVectorBlock,
  embedForDialogue,
  getStore,
};
