/**
 * BFF 上下文 DTO 构建：从数据门面 + 关联/提醒/行为配置 组装供 prompt 使用的完整上下文。
 * 不直接写 store，不调 LLM，不执行工具。
 */
const store = require('../../store');
const constraintsBrief = require('../../store/constraints_brief.js');
const { getRelatedAssociationsLines } = require('./associationContext.js');
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

function getRecentEmotionLine(emotionsList) {
  if (!Array.isArray(emotionsList) || emotionsList.length === 0) return '';
  const e = emotionsList[0];
  const text = (e.text || '').trim().slice(0, 25);
  const intensity = e.intensity != null ? e.intensity : 3;
  if (!text) return '';
  return `你最近记录的情感（强度${intensity}）：${text}。强度表示该条情感的重要或强烈程度（数字越大越强），回复时可参考，不必在回复中复述数字。`;
}

function formatRestartRecoveryInfo(recoveryInfo) {
  if (!recoveryInfo || !recoveryInfo.has_recovery_info) return '';

  const lines = [];
  lines.push('【重启恢复信息】');

  if (recoveryInfo.recent_context) {
    lines.push(`重启前正在处理：${recoveryInfo.recent_context}`);
  }

  if (recoveryInfo.last_conversation && recoveryInfo.last_conversation.length > 0) {
    lines.push('重启前最后几轮对话：');
    recoveryInfo.last_conversation.forEach((msg, i) => {
      const who = msg.role === 'user' ? '用户' : 'Aris';
      const time = msg.created_at ? formatMessageTime(msg.created_at) : '';
      lines.push(`  ${who}${time ? ` (${time})` : ''}: ${msg.content || ''}`);
    });
  }

  if (recoveryInfo.pending_tasks && recoveryInfo.pending_tasks.length > 0) {
    lines.push('未完成的任务：');
    recoveryInfo.pending_tasks.forEach((task, i) => {
      if (!task.completed) {
        const taskText = typeof task.task === 'string' ? task.task : JSON.stringify(task.task);
        lines.push(`  ${i + 1}. ${taskText}`);
      }
    });
  }

  if (recoveryInfo.thinking_questions && recoveryInfo.thinking_questions.length > 0) {
    lines.push('正在思考的问题：');
    recoveryInfo.thinking_questions.forEach((q, i) => {
      lines.push(`  ${i + 1}. ${q}`);
    });
  }

  return lines.join('\n');
}

/**
 * 供 Prompt Planner 的极短窗口：主对话在 API messages 中含滑动历史，
 * 此处仅保留末尾若干条、单条截断，避免与 Planner 输入重复堆叠。
 */
function formatRecentWindowForPlanner(recent) {
  if (!Array.isArray(recent) || !recent.length) return '';
  const PLANNER_RECENT_MAX = 4;
  const PLANNER_MSG_CHARS = 480;
  return recent
    .slice(-PLANNER_RECENT_MAX)
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'Aris';
      return `${role}: ${String(m.content || '').slice(0, PLANNER_MSG_CHARS)}`;
    })
    .join('\n');
}

/**
 * 构建供 BFF（prompt）使用的完整上下文 DTO。
 * @param {string} sessionId
 * @param {Array} recent - 最近消息 [{ role, content, created_at }, ...]
 */
async function buildContextDTO(sessionId, recent) {
  const facade = store.facade;

  const restartRecoveryInfo = facade.checkAndGetRestartRecovery();
  const restartRecoveryLine = restartRecoveryInfo ? formatRestartRecoveryInfo(restartRecoveryInfo) : '';

  const id = facade.getIdentity();
  const userIdentity = id.name ? `用户名字：${id.name}` + (id.notes ? '\n' + id.notes : '') : '（无）';
  const avoidPhrasesLine = facade.getAvoidPhrasesForPrompt();

  const constraintsRequirementsText = facade.getRequirementsSummary() || '（无）';
  const constraintsCorrectionsText = facade.getCorrectionsFullSummary();
  const constraintsPreferencesText = facade.getPreferencesSummaryForPrompt() || '（无）';
  const userConstraintsPartsNoAvoid = [
    '【用户要求】',
    constraintsRequirementsText,
    '【纠错记录】',
    constraintsCorrectionsText,
    '【用户喜好】',
    constraintsPreferencesText,
  ];
  const userConstraintsFull = userConstraintsPartsNoAvoid.join('\n');

  let userConstraintsLegacy = userConstraintsFull;
  if (avoidPhrasesLine && !String(avoidPhrasesLine).includes('（未配置')) {
    userConstraintsLegacy = `${userConstraintsFull}\n【禁止用语】\n${avoidPhrasesLine}`;
  }

  await constraintsBrief.ensureBriefIfNeeded();
  const briefRecord = constraintsBrief.readBrief();
  const br = briefRecord || constraintsBrief._fallbackBrief();
  const constraintsBriefBlock = constraintsBrief.formatBriefForPrompt(br);
  const constraintsBriefRequirements = String(br.requirements_brief || '').trim() || '（无）';
  const constraintsBriefCorrections = String(br.corrections_brief || '').trim() || '（无）';
  const constraintsBriefPreferences = String(br.preferences_brief || '').trim() || '（无）';
  const recentWindowForPlanner = formatRecentWindowForPlanner(recent);

  const contextWindow =
    recent
      .map((r) => {
        const who = r.role === 'user' ? '用户' : 'Aris';
        const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
        return `${who}${timeLabel}: ${r.content}`;
      })
      .join('\n') || '（暂无）';
  const state = facade.getState();
  const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
  const rawState = state?.last_mental_state || '';
  const lastStateLine = rawState ? `你上一次的状态/想法是：${rawState}` : '';
  const lastStateAndSubjectiveTime = [timeDesc, lastStateLine].filter(Boolean).join('\n') || '（无）';
  const relatedAssociations = await getRelatedAssociationsLines(sessionId, recent);
  const recentSummary = facade.getSessionSummary(sessionId) || '（无）';
  const behavior = readBehaviorConfig();
  const emotionLine = behavior.inject_recent_emotion ? getRecentEmotionLine(facade.getRecentEmotions(1)) : '';
  const recentMessages = recent.slice(-(RECENT_ROUNDS * 2));
  return {
    userIdentity,
    /** @deprecated 使用 userConstraintsFull + avoidPhrasesLine；保留兼容旧日志 */
    userConstraints: userConstraintsLegacy,
    userConstraintsFull,
    constraintsRequirementsText,
    constraintsCorrectionsText,
    constraintsPreferencesText,
    avoidPhrasesLine,
    constraintsBriefBlock,
    constraintsBriefRequirements,
    constraintsBriefCorrections,
    constraintsBriefPreferences,
    recentWindowForPlanner,
    contextWindow,
    lastStateAndSubjectiveTime,
    relatedAssociations,
    recentSummary,
    emotionLine,
    recentMessages,
    restartRecoveryLine,
  };
}

module.exports = { buildContextDTO, formatMessageTime, getSubjectiveTimeDescription };
