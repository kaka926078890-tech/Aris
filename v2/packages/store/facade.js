/**
 * 数据门面：对上层暴露「读上下文」「写对话/状态/向量」等粗粒度接口。
 * 逻辑层与工具层通过门面访问数据，避免直接依赖各 store 子模块。
 * 仅做读写与聚合，不包含「何时检索」「何时写」的策略。
 */
const identity = require('./identity.js');
const requirements = require('./requirements.js');
const state = require('./state.js');
const conversations = require('./conversations.js');
const summaries = require('./summaries.js');
const corrections = require('./corrections.js');
const emotions = require('./emotions.js');

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
  getRecentEmotions,
  appendConversation,
  writeState,
  writeProactiveState,
  addVectorBlock,
  embedForDialogue,
  getStore,
};
