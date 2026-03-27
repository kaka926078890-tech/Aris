/**
 * 每轮对话控制：意图分类 + 任务账本 + 工具门控。
 * 目标：用户新消息优先，工具轨迹仅作为证据，不驱动旧任务惯性延续。
 */

const CANCEL_PATTERNS = [
  /停下|停下来|停止|先停/,
  /别(看|查|搜|读|整|搞)/,
  /算了/,
  /不用了/,
  /不打扰/,
];

const REPLACE_PATTERNS = [
  /改成|改为|换成|换为/,
  /不要.*(而是|改成|改为)/,
  /别.*(了|啦).*(改|换)/,
  /重新(来|开始)/,
];

const SUPPLEMENT_PATTERNS = [
  /再(看|查|补|加|来|试)/,
  /顺便/,
  /另外/,
  /补充/,
  /加上|再加/,
  /还有/,
  /也要/,
];

const CONTINUE_PATTERNS = [
  /继续/,
  /接着/,
  /按刚才/,
  /照刚才/,
  /然后呢?/,
];

function safeText(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function matchAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function isSoftAssistantBoundary(content) {
  const text = safeText(content);
  if (!text) return true;
  if (text.includes('[已停止]')) return true;
  if (text.includes('（上轮为工具调用，未生成自然语言回复')) return true;
  return false;
}

function extractRecentUserBurst(recent, options = {}) {
  const maxMessages = Number(options.maxMessages) > 0 ? Number(options.maxMessages) : 3;
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : 700;
  if (!Array.isArray(recent) || recent.length === 0) {
    return { mergedText: '', segments: [], mergedCount: 0 };
  }
  const segments = [];
  let charCount = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'user') {
      const content = safeText(msg.content);
      if (!content) continue;
      const projected = charCount + content.length;
      if (segments.length >= maxMessages || projected > maxChars) break;
      segments.unshift(content);
      charCount = projected;
      continue;
    }
    if (msg.role === 'assistant') {
      if (isSoftAssistantBoundary(msg.content)) continue;
      break;
    }
  }
  return {
    mergedText: segments.join('\n'),
    segments,
    mergedCount: segments.length,
  };
}

function classifyTurnIntent(userContent, mergedUserText) {
  const text = safeText(userContent);
  const merged = safeText(mergedUserText || text);
  if (!text) return { type: 'chitchat', reason: 'empty_message' };
  const lower = text.toLowerCase();
  const mergedLower = merged.toLowerCase();
  const hasCancel = matchAny(lower, CANCEL_PATTERNS);
  const hasReplace = matchAny(lower, REPLACE_PATTERNS);
  if (hasReplace || (hasCancel && /改成|改为|换成|换为|直接|现在/.test(lower))) {
    return { type: 'replace', reason: 'replace_or_cancel_with_new_goal' };
  }
  if (hasCancel) return { type: 'cancel', reason: 'cancel_pattern' };
  if (matchAny(mergedLower, SUPPLEMENT_PATTERNS)) return { type: 'supplement', reason: 'supplement_pattern_in_burst' };
  if (matchAny(mergedLower, CONTINUE_PATTERNS)) return { type: 'continue', reason: 'continue_pattern_in_burst' };
  return { type: 'chitchat', reason: 'fallback' };
}

function normalizeLedger(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    version: 'v1',
    status: typeof raw.status === 'string' ? raw.status : 'idle',
    goal_current: safeText(raw.goal_current),
    goal_prev: safeText(raw.goal_prev),
    evidence_summary: safeText(raw.evidence_summary),
    last_tool_outcome: safeText(raw.last_tool_outcome),
    side_effects: Array.isArray(raw.side_effects) ? raw.side_effects.slice(0, 12).map((x) => String(x).slice(0, 80)) : [],
    intent_last: typeof raw.intent_last === 'string' ? raw.intent_last : 'chitchat',
    updated_at: raw.updated_at || null,
  };
}

function summarizeLedger(ledger) {
  if (!ledger) return '（无）';
  const parts = [];
  parts.push(`状态：${ledger.status || 'idle'}`);
  if (ledger.goal_current) parts.push(`当前目标：${ledger.goal_current}`);
  if (ledger.goal_prev) parts.push(`上一个目标：${ledger.goal_prev}`);
  if (ledger.evidence_summary) parts.push(`证据摘要：${ledger.evidence_summary}`);
  if (ledger.last_tool_outcome) parts.push(`工具结果：${ledger.last_tool_outcome}`);
  if (Array.isArray(ledger.side_effects) && ledger.side_effects.length) {
    parts.push(`可能副作用：${ledger.side_effects.join('、')}`);
  }
  return parts.join('\n');
}

function buildIntentBlock(intentType, intentReason, userContent, mergedUserText, mergedCount) {
  return [
    `意图分类：${intentType}`,
    `分类原因：${intentReason}`,
    `本轮用户消息：${safeText(userContent) || '（空）'}`,
    `组合用户输入条数：${mergedCount || 1}`,
    `组合用户输入：${safeText(mergedUserText) || safeText(userContent) || '（空）'}`,
  ].join('\n');
}

function deriveGoalFromIntent(intentType, userContent, prevLedger, mergedUserText) {
  const text = safeText(mergedUserText || userContent);
  const prevGoal = prevLedger && prevLedger.goal_current ? prevLedger.goal_current : '';
  if (intentType === 'cancel') return '';
  if (intentType === 'replace') return text || prevGoal;
  if (intentType === 'supplement') return prevGoal ? `${prevGoal}；补充：${text}` : text;
  if (intentType === 'continue') return prevGoal || text;
  return text;
}

function computeToolGate(intentType) {
  if (intentType === 'cancel' || intentType === 'replace') {
    return { allowTools: false, reason: `intent_${intentType}_hard_stop` };
  }
  return { allowTools: true, reason: `intent_${intentType}_allows_tools_if_needed` };
}

function buildTurnControl({ userContent, prevLedger, recent }) {
  const normalizedPrev = normalizeLedger(prevLedger);
  const burst = extractRecentUserBurst(recent);
  const mergedText = burst.mergedText || safeText(userContent);
  const intent = classifyTurnIntent(userContent, mergedText);
  const gate = computeToolGate(intent.type);
  const shouldCarryEvidence = intent.type === 'continue' || intent.type === 'supplement';
  const nextLedger = {
    version: 'v1',
    status: intent.type === 'cancel' ? 'interrupted' : (normalizedPrev?.status || 'idle'),
    goal_current: deriveGoalFromIntent(intent.type, userContent, normalizedPrev, mergedText),
    goal_prev: intent.type === 'replace' || intent.type === 'cancel'
      ? (normalizedPrev?.goal_current || '')
      : (normalizedPrev?.goal_prev || ''),
    evidence_summary: shouldCarryEvidence ? (normalizedPrev?.evidence_summary || '') : '',
    last_tool_outcome: shouldCarryEvidence ? (normalizedPrev?.last_tool_outcome || '') : '',
    side_effects: normalizedPrev?.side_effects || [],
    intent_last: intent.type,
    updated_at: new Date().toISOString(),
  };
  return {
    intentType: intent.type,
    intentReason: intent.reason,
    mergedUserText: mergedText,
    mergedUserCount: burst.mergedCount || 1,
    toolGate: gate,
    ledgerAtTurnStart: nextLedger,
    intentBlock: buildIntentBlock(intent.type, intent.reason, userContent, mergedText, burst.mergedCount || 1),
    taskLedgerSummary: summarizeLedger(nextLedger),
  };
}

function buildToolOutcomeSummary(toolRoundsDetail) {
  if (!Array.isArray(toolRoundsDetail) || toolRoundsDetail.length === 0) return '';
  const last = toolRoundsDetail[toolRoundsDetail.length - 1];
  const names = Array.isArray(last.tools) && last.tools.length ? last.tools.join(', ') : '（无）';
  return `最近一轮工具：${names}`;
}

function collectSideEffects(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const effectNames = [];
  for (const batch of actions) {
    if (!Array.isArray(batch)) continue;
    for (const item of batch) {
      const name = item && item.name ? String(item.name) : '';
      if (!name) continue;
      if (/^write_|^record$|^restart_application$/.test(name)) effectNames.push(name);
    }
  }
  return [...new Set(effectNames)].slice(0, 12);
}

function finalizeLedger({
  startLedger,
  intentType,
  userContent,
  mergedUserText,
  hadToolCalls,
  toolRoundsDetail,
  allAgentActions,
  reply,
  err,
  toolGate,
}) {
  const base = normalizeLedger(startLedger) || {
    version: 'v1',
    status: 'idle',
    goal_current: '',
    goal_prev: '',
    evidence_summary: '',
    last_tool_outcome: '',
    side_effects: [],
    intent_last: intentType || 'chitchat',
    updated_at: new Date().toISOString(),
  };
  const goal = deriveGoalFromIntent(intentType, userContent, base, mergedUserText);
  const toolSummary = buildToolOutcomeSummary(toolRoundsDetail);
  const sideEffects = collectSideEffects(allAgentActions);
  const status =
    err ? 'failed'
      : intentType === 'cancel' ? 'interrupted'
        : intentType === 'replace' && !toolGate.allowTools ? 'interrupted'
          : hadToolCalls ? 'running'
            : (intentType === 'chitchat' ? 'idle' : 'running');
  const keepEvidence = intentType === 'continue' || intentType === 'supplement' || hadToolCalls;
  const nextEvidenceSummary = keepEvidence ? (toolSummary || base.evidence_summary || '') : '';
  return {
    ...base,
    version: 'v1',
    status,
    goal_current: goal,
    goal_prev: intentType === 'replace' || intentType === 'cancel' ? (base.goal_current || base.goal_prev || '') : base.goal_prev,
    evidence_summary: nextEvidenceSummary,
    last_tool_outcome: keepEvidence ? (toolSummary || base.last_tool_outcome || '') : '',
    side_effects: sideEffects.length ? sideEffects : base.side_effects,
    intent_last: intentType || 'chitchat',
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildTurnControl,
  finalizeLedger,
  summarizeLedger,
};
