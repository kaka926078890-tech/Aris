/**
 * Prompt 统一生效层（resolved policy）：
 * - 输入：DTO + plan + 场景规则
 * - 输出：单一可消费结构（constraints / volatile blocks + 冲突追踪）
 */
function isBlank(value) {
  return value == null || ['（无）', '（暂无）'].includes(String(value).trim());
}

function normalizeText(value, fallback = '（无）') {
  const text = value != null ? String(value).trim() : '';
  return text ? text : fallback;
}

function pushBlock(blocks, title, body, source, fallback = '（无）') {
  blocks.push({
    title,
    body: normalizeText(body, fallback),
    source,
  });
}

function buildConstraintBlocks(dto, plan, trace) {
  const blocks = [];
  const useFull = plan && plan.need_full_constraints === true;
  const hasStructuredBrief =
    dto.constraintsBriefRequirements != null ||
    dto.constraintsBriefCorrections != null ||
    dto.constraintsBriefPreferences != null;
  const hasLegacyBrief = dto.constraintsBriefBlock && String(dto.constraintsBriefBlock).trim();
  const hasFull = !isBlank(dto.userConstraintsFull);

  if (!isBlank(dto.userIdentity)) {
    pushBlock(blocks, '【用户身份】', dto.userIdentity, 'identity');
  }
  if (!isBlank(dto.avoidPhrasesLine) && !String(dto.avoidPhrasesLine).includes('（未配置')) {
    pushBlock(blocks, '【禁止用语】', dto.avoidPhrasesLine, 'avoid_phrases');
  }

  if (useFull) {
    pushBlock(blocks, '【用户要求】', dto.constraintsRequirementsText, 'requirements_full');
    pushBlock(blocks, '【纠错记录】', dto.constraintsCorrectionsText, 'corrections_full');
    pushBlock(blocks, '【用户喜好】', dto.constraintsPreferencesText, 'preferences_full');
    if (hasStructuredBrief || hasLegacyBrief) {
      trace.conflicts.push({
        key: 'constraints_mode',
        winner: 'full',
        overridden: 'brief',
        reason: 'plan.need_full_constraints = true',
      });
    }
    return blocks;
  }

  if (hasStructuredBrief) {
    pushBlock(blocks, '【用户要求·摘要】', dto.constraintsBriefRequirements, 'requirements_brief');
    pushBlock(blocks, '【纠错·摘要】', dto.constraintsBriefCorrections, 'corrections_brief');
    pushBlock(blocks, '【用户喜好·摘要】', dto.constraintsBriefPreferences, 'preferences_brief');
    if (hasFull) {
      trace.conflicts.push({
        key: 'constraints_mode',
        winner: 'brief_structured',
        overridden: 'full',
        reason: 'plan.need_full_constraints = false',
      });
    }
    return blocks;
  }

  if (hasLegacyBrief) {
    pushBlock(blocks, '【用户约束摘要】', dto.constraintsBriefBlock, 'constraints_brief_legacy');
    if (hasFull) {
      trace.conflicts.push({
        key: 'constraints_mode',
        winner: 'brief_legacy',
        overridden: 'full',
        reason: 'structured brief unavailable',
      });
    }
    return blocks;
  }

  if (hasFull) {
    pushBlock(blocks, '【用户约束】', dto.userConstraintsFull, 'constraints_full_fallback');
    trace.decisions.push('constraints_full_used_as_fallback');
  } else {
    pushBlock(blocks, '【用户约束】', '（无）', 'constraints_empty');
    trace.decisions.push('constraints_empty');
  }
  return blocks;
}

function buildVolatileBlocks(dto, plan, sceneRulesMap, sceneOrder, sceneTitleMap, trace) {
  const blocks = [];
  const activeScenes = new Set(Array.isArray(plan && plan.scenes) ? plan.scenes : []);

  pushBlock(
    blocks,
    '【本轮用户意图】',
    dto.currentTurnIntentBlock && String(dto.currentTurnIntentBlock).trim() ? dto.currentTurnIntentBlock : '（无）',
    'turn_intent'
  );
  pushBlock(
    blocks,
    '【任务账本摘要】',
    dto.taskLedgerSummary && String(dto.taskLedgerSummary).trim() ? dto.taskLedgerSummary : '（无）',
    'task_ledger'
  );
  pushBlock(
    blocks,
    '【工具门控】',
    dto.toolGateLine && String(dto.toolGateLine).trim() ? dto.toolGateLine : 'allow_tools=true; reason=default',
    'tool_gate'
  );

  for (const key of sceneOrder) {
    const sceneText = sceneRulesMap[key];
    if (activeScenes.has(key) && sceneText) {
      pushBlock(blocks, sceneTitleMap[key] || '【场景】', sceneText, `scene:${key}`);
      continue;
    }
    if (activeScenes.has(key) && !sceneText) {
      trace.conflicts.push({
        key: `scene:${key}`,
        winner: 'disabled',
        overridden: 'active',
        reason: 'scene rule text missing',
      });
    }
    pushBlock(blocks, sceneTitleMap[key] || '【场景】', '（本回合未注入此场景）', `scene:${key}:disabled`);
  }

  pushBlock(
    blocks,
    '【重启恢复信息】',
    dto.restartRecoveryLine && String(dto.restartRecoveryLine).trim() ? dto.restartRecoveryLine : '（无）',
    'restart_recovery'
  );

  if (plan && plan.need_related_associations === false) {
    pushBlock(blocks, '【相关关联】', '（本回合未注入关联上下文）', 'associations_disabled');
  } else {
    pushBlock(
      blocks,
      '【相关关联】',
      !isBlank(dto.relatedAssociations) ? dto.relatedAssociations : '（无）',
      'associations'
    );
  }

  if (plan && plan.need_session_summary === false) {
    pushBlock(blocks, '【近期小结】（本会话中更早对话的摘要）', '（本回合未注入会话小结）', 'summary_disabled');
  } else {
    pushBlock(
      blocks,
      '【近期小结】（本会话中更早对话的摘要）',
      !isBlank(dto.recentSummary) ? dto.recentSummary : '（无）',
      'session_summary'
    );
  }

  pushBlock(
    blocks,
    '【近期情感参考】',
    dto.emotionLine && String(dto.emotionLine).trim() ? String(dto.emotionLine).trim() : '（无）',
    'recent_emotion'
  );

  if (plan && plan.need_last_state === false) {
    pushBlock(blocks, '【状态与时间感】', '（本回合未注入）', 'last_state_disabled');
  } else {
    pushBlock(blocks, '【状态与时间感】', dto.lastStateAndSubjectiveTime, 'last_state');
  }

  return blocks;
}

function resolvePromptPolicy(dto, plan, options = {}) {
  const trace = { decisions: [], conflicts: [] };
  const sceneRulesMap = options.sceneRulesMap || {};
  const sceneOrder = Array.isArray(options.sceneOrder) ? options.sceneOrder : [];
  const sceneTitleMap = options.sceneTitleMap || {};

  const constraintBlocks = buildConstraintBlocks(dto, plan, trace);
  const volatileBlocks = buildVolatileBlocks(dto, plan, sceneRulesMap, sceneOrder, sceneTitleMap, trace);

  return {
    version: 'v1',
    precedence: [
      'user_explicit_message',
      'user_constraints',
      'scene_rules',
      'behavior_defaults',
    ],
    constraintBlocks,
    volatileBlocks,
    trace,
  };
}

module.exports = {
  resolvePromptPolicy,
};
