/**
 * BFF 上下文 DTO 构建：从数据门面 + 关联/提醒/行为配置 组装供 prompt 使用的完整上下文。
 * 不直接写 store，不调 LLM，不执行工具。
 */
const store = require('../../store');
const { getRelatedAssociationsLines } = require('./associationContext.js');
const { getImportantDocReminder } = require('./importantDocsReminder.js');
const { readBehaviorConfig } = require('./prompt.js');

const RECENT_ROUNDS = 3;

function formatMessageTime(created_at) {
  if (created_at == null) return '';
  const date = new Date(typeof created_at === 'number' ? created_at * 1000 : created_at);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getSubjectiveTimeDescription(lastActiveTimeIso) {
  const now = new Date();
  const nowStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!lastActiveTimeIso) return `现在是 ${nowStr}。（暂无记录）`;
  let last;
  try {
    last = new Date(lastActiveTimeIso);
    if (Number.isNaN(last.getTime())) last = null;
  } catch (_) {
    last = null;
  }
  if (!last) return `现在是 ${nowStr}。`;
  const deltaMin = Math.floor((now.getTime() - last.getTime()) / 60000);
  return `现在是 ${nowStr}。距离上次活跃已过去 ${deltaMin} 分钟。`;
}

function getCorrectionsSummaryLine(correctionsList) {
  if (!Array.isArray(correctionsList) || correctionsList.length === 0) return '';
  const parts = correctionsList.slice(-2).map((t) => {
    const m = (t || '').match(/用户纠正[：:]\s*([^\n]+)/);
    return m ? m[1].trim().slice(0, 18) : '';
  });
  const raw = parts.filter(Boolean).join('、');
  const line = raw.slice(0, 50);
  return line ? `用户曾纠正：${line}。` : '';
}

function getRecentEmotionLine(emotionsList) {
  if (!Array.isArray(emotionsList) || emotionsList.length === 0) return '';
  const e = emotionsList[0];
  const text = (e.text || '').trim().slice(0, 25);
  const intensity = e.intensity != null ? e.intensity : 3;
  return text ? `你最近记录的情感（强度${intensity}）：${text}。` : '';
}

/**
 * 构建供 BFF（prompt）使用的完整上下文 DTO。
 * @param {string} sessionId
 * @param {Array} recent - 最近消息 [{ role, content, created_at }, ...]
 * @returns {Promise<object>} DTO: userIdentity, userRequirements, contextWindow, lastStateAndSubjectiveTime, relatedAssociations, recentSummary, reminderLine, correctionsLine, emotionLine, recentMessages
 */
async function buildContextDTO(sessionId, recent) {
  const facade = store.facade;
  const id = facade.getIdentity();
  const userIdentity = id.name ? `用户名字：${id.name}` + (id.notes ? '\n' + id.notes : '') : '（无）';
  const userRequirements = facade.getRequirementsSummary();
  const contextWindow = recent
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');
  const state = facade.getState();
  const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
  const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
  const lastStateAndSubjectiveTime = [timeDesc, lastStateLine].filter(Boolean).join('\n') || '（无）';
  const relatedAssociations = await getRelatedAssociationsLines(sessionId, recent);
  const recentSummary = facade.getSessionSummary(sessionId);
  const isSessionFirstMessage = recent.length === 1 && recent[0].role === 'user';
  const reminderLine = getImportantDocReminder(isSessionFirstMessage);
  const behavior = readBehaviorConfig();
  const correctionsLine = behavior.inject_corrections_summary
    ? getCorrectionsSummaryLine(facade.getRecentCorrections(3))
    : '';
  const emotionLine = behavior.inject_recent_emotion
    ? getRecentEmotionLine(facade.getRecentEmotions(1))
    : '';
  const recentMessages = recent.slice(-(RECENT_ROUNDS * 2));
  return {
    userIdentity,
    userRequirements,
    contextWindow,
    lastStateAndSubjectiveTime,
    relatedAssociations,
    recentSummary,
    reminderLine,
    correctionsLine,
    emotionLine,
    recentMessages,
  };
}

module.exports = { buildContextDTO, formatMessageTime, getSubjectiveTimeDescription };
