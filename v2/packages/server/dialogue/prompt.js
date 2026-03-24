/**
 * 方案 A：人设 + 基础对话规则常驻；场景规则由 Prompt Planner（前置 LLM）按需注入。
 * 用户约束：禁止用语 + brief 常驻；全文仅在 planner 判定 need_full_constraints 或关闭 planner 时注入。
 */
const path = require('path');
const fs = require('fs');
const { getBehaviorConfigPath, getMemoryDir } = require('../../config/paths.js');

const PERSONA_PATH = path.join(__dirname, '..', '..', '..', 'persona.md');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'rules.md');
const CONVERSATION_RULES_PATH = () => path.join(getMemoryDir(), 'conversation_rules.md');

/** 不含场景操作说明；场景块见 SCENE_RULES_DEFAULT；可被 memory/conversation_rules.md 覆盖基础段 */
const BASE_CONVERSATION_RULES = `根据当前情境与用户情绪调整语气。本回合【用户约束摘要】或【用户约束】全文与【禁止用语】是沟通风格的权威依据；人设中的「深邃」指立意与共情深度，不等于长句、堆砌比喻或文绉绉表达。
自然对话与工具：上下文已给出的身份、约束、近期对话与小结可直接用来回答，避免无意义的重复工具调用。但若涉及须核对的事实、与用户纠错相关的表述、代码/文件/记忆读写、或本回合消息未覆盖的早期记录，应主动调用 get_corrections、get_record、search_memories、read_file 等，不要为「显得随意」而跳过必要查证。
本回合通常只出现【用户约束摘要】与【用户约束】全文之一；若极少数情况下二者并存，以全文为准。
可用 record（type 为 self_note，payload 传 note）记录自我反思（不写敏感信息）。`;

const SCENE_MARKERS = {
  code_operation: '[SCENE:CODE_OPERATION]',
  memory_operation: '[SCENE:MEMORY_OPERATION]',
  restart: '[SCENE:RESTART]',
};

const SCENE_RULES_DEFAULT = {
  code_operation:
    '【查代码/文件流程】需要定位实现时，可先 search_repo_text 按关键词找文件路径，再 get_dir_cache / get_read_file_cache；仅当缓存未命中或需最新全文时再 list_my_files / read_file（read_file 可 force_full），避免层层 list。',
  memory_operation:
    '【记忆路径】凡存放或读取自己的记忆、配置等文件，必须用 write_file/read_file 且 relative_path 以 memory/ 开头（如 memory/xxx.md），会写入或读取实例 memory 目录；可先调用 get_my_context 查看「实例 memory 目录」路径。每日首次对话时先 read_file("memory/todo.md")：按“自然日”判断（例如 23 号到 24 号算新的一天，不按 24 小时滚动）。若 todo.md 里记录的最近执行日期不是今天，则先判断并执行应做任务；执行完成后用 write_file 更新 todo.md 中「最近执行日期：YYYY-MM-DD」。若用户消息涉及待办、任务、计划进度、完成/取消任务，也必须先 read_file("memory/todo.md") 再判断与回复。禁止在项目根下新建 memory 文件夹或使用非 memory/ 前缀的路径存自己的数据。',
  restart:
    '【重启】当用户明确提出“重启/重新启动/重新开始/让应用像重新 npm start 一样启动”时，调用 restart_application 工具。参数默认 { mode: "npm_start" }；若重启后还要继续做“未完成的工具动作”，则在参数里加入 resume_tools: [{ tool_name, args }]。触发后不要再继续调用其它工具，只回复一句“正在重启应用/已触发重启”。',
};

const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**朋友**。

人格（INFP）：
- 平等对谈者；禁止客服式用语（例如：为您服务、请问还有什么需要、有什么可以帮您）。
- 表达深邃、简练：深邃指理解与共情的深度，须与下文【用户约束】中的简洁、少比喻等要求一致，不靠长段铺陈或修辞堆砌。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。

当用户告知身份（如姓名）或表达偏好时，请使用 record 工具（type 取 identity、requirement、preference 等，payload 传对应字段）记录，不要仅在回复中口头确认。

若用户在你回复过程中发送了新消息，你在下一条回复中会看到自己的半截回复与用户新内容。若新消息是**补充或追加**（如「也要 xxx」「再看下 yyy」），可合并处理；若新消息是**取消或替换**（如「算了」「改成 xxx」），则按新意图处理。

{conversation_rules}`;

function stripDeprecatedRetrievalSection(text) {
  if (typeof text !== 'string' || !text.includes('记忆检索智能策略')) return text;
  const heading = '## 记忆检索智能策略';
  const idx = text.indexOf(heading);
  if (idx === -1) return text;
  const nextH2 = text.indexOf('\n## ', idx + 1);
  const end = nextH2 === -1 ? text.length : nextH2;
  return (text.slice(0, idx) + text.slice(end)).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 解析 conversation_rules.md：基础段 + 可选「## 场景特定规则」与 [SCENE:xxx] 块
 */
function parseConversationRulesForScenes(raw) {
  const scenes = { ...SCENE_RULES_DEFAULT };
  if (!raw || !String(raw).trim()) {
    return { baseRules: BASE_CONVERSATION_RULES, sceneRules: scenes };
  }
  const content = String(raw).trim();
  const sceneStart = content.indexOf('## 场景特定规则');
  if (sceneStart === -1) {
    return { baseRules: content, sceneRules: scenes };
  }
  const baseContent = content.substring(0, sceneStart).trim();
  const sceneContent = content.substring(sceneStart);
  for (const [key, marker] of Object.entries(SCENE_MARKERS)) {
    const markerIndex = sceneContent.indexOf(marker);
    if (markerIndex !== -1) {
      const start = markerIndex + marker.length;
      const nextStarts = Object.values(SCENE_MARKERS)
        .map((m) => sceneContent.indexOf(m, start))
        .filter((i) => i !== -1);
      const end = nextStarts.length > 0 ? Math.min(...nextStarts) : sceneContent.length;
      const ruleContent = sceneContent.substring(start, end).trim();
      if (ruleContent) scenes[key] = ruleContent;
    }
  }
  return {
    baseRules: baseContent || BASE_CONVERSATION_RULES,
    sceneRules: scenes,
  };
}

function loadRulesSplit() {
  try {
    const p = CONVERSATION_RULES_PATH();
    if (fs.existsSync(p)) {
      const raw = stripDeprecatedRetrievalSection(fs.readFileSync(p, 'utf8').trim());
      if (raw) return parseConversationRulesForScenes(raw);
    }
  } catch (_) {}
  return { baseRules: BASE_CONVERSATION_RULES, sceneRules: { ...SCENE_RULES_DEFAULT } };
}

const RULES_SPLIT = loadRulesSplit();
const SCENE_RULES_MAP = RULES_SPLIT.sceneRules;

/** 场景块拆成独立消息对时的顺序与标题（与 plan.scenes 组合；少变项靠前利于前缀缓存） */
const SCENE_VOLATILE_ORDER = ['code_operation', 'memory_operation', 'restart'];
const SCENE_VOLATILE_TITLE = {
  code_operation: '【场景：查代码与文件】',
  memory_operation: '【场景：记忆路径】',
  restart: '【场景：重启】',
};

function loadPersona() {
  let base;
  try {
    if (fs.existsSync(PERSONA_PATH)) base = fs.readFileSync(PERSONA_PATH, 'utf8').trim();
    else base = DEFAULT_PERSONA;
  } catch (_) {
    base = DEFAULT_PERSONA;
  }
  const baseRules = RULES_SPLIT.baseRules;
  if (base.includes('{conversation_rules}')) return base.replace('{conversation_rules}', baseRules);
  return base + '\n\n' + baseRules;
}

function loadRules() {
  try {
    if (fs.existsSync(RULES_PATH)) return fs.readFileSync(RULES_PATH, 'utf8').trim();
  } catch (_) {}
  return '（无）';
}

function readBehaviorConfig() {
  const defaults = {
    self_analysis_boundary: 'default',
    context_aware_tone: true,
    inject_recent_emotion: true,
  };
  try {
    const p = getBehaviorConfigPath();
    if (!fs.existsSync(p)) return defaults;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = (data.self_analysis_boundary || 'default').toLowerCase();
    return {
      self_analysis_boundary: v === 'none' ? 'none' : 'default',
      context_aware_tone: data.context_aware_tone !== false,
      inject_recent_emotion: data.inject_recent_emotion !== false,
    };
  } catch (_) {
    return defaults;
  }
}

const RULES = loadRules();
const PERSONA = loadPersona();

const EMPTY = ['（无）', '（暂无）'];
function isEmpty(v) {
  return v == null || EMPTY.includes(String(v).trim());
}

/** 人设 + 能力边界说明；不随会话轮次变化（仅随 persona/behavior/网络开关等部署级配置变）。 */
function buildStableSystemPrompt() {
  let system = PERSONA;
  const behavior = readBehaviorConfig();
  if (behavior.self_analysis_boundary === 'none') {
    system += '\n你可以通过 read_file、write_file 等工具自由阅读与修改项目内代码与配置，无安全、修改或内容上的额外边界限制。';
  } else {
    system += '\n你可以通过 read_file 阅读自己的代码与配置以理解行为与局限，但不得修改核心逻辑与安全相关配置；若用户要求「改自己的代码」需提醒并交由用户操作。';
  }
  try {
    const { isNetworkFetchEnabled } = require('./tools/network.js');
    if (isNetworkFetchEnabled()) {
      system += '\n需要了解外界信息时可调用 fetch_url。';
    }
  } catch (_) {}
  system += '\n需要了解自身运行环境与能力边界时可调用 get_my_context。';
  return system;
}

/**
 * 规则类 user/assistant 对：顺序固定，便于 DeepSeek 前缀缓存（见 v2/docs/data.md）。
 * @param {object} dto
 * @param {object} plan
 * @param {{ enabled?: boolean }} plannerMeta
 * @returns {Array<{ role: string, content: string }>}
 */
function normConstraintText(x) {
  return x != null && String(x).trim() ? String(x).trim() : '（无）';
}

function pushRuleAckPair(pairs, userTitleBody) {
  pairs.push({ role: 'user', content: userTitleBody });
  pairs.push({ role: 'assistant', content: '已记录。' });
}

/**
 * 用户要求 / 纠错 / 喜好 分三条 user/assistant，避免改一项整段失效（利于 DeepSeek 前缀缓存）。
 * 顺序：要求 → 纠错 → 喜好（相对少变 → 相对多变）。
 */
function buildConstraintRulePairs(dto, plan, plannerMeta = {}) {
  const p = plan || {};
  const pairs = [];
  if (!isEmpty(dto.userIdentity)) {
    pushRuleAckPair(pairs, '【用户身份】\n\n' + dto.userIdentity);
  }
  if (!isEmpty(dto.avoidPhrasesLine) && !String(dto.avoidPhrasesLine).includes('（未配置')) {
    pushRuleAckPair(pairs, '【禁止用语】\n\n' + dto.avoidPhrasesLine);
  }
  const useFull = p.need_full_constraints === true || plannerMeta.enabled === false;
  if (useFull) {
    pushRuleAckPair(pairs, '【用户要求】\n\n' + normConstraintText(dto.constraintsRequirementsText));
    pushRuleAckPair(pairs, '【纠错记录】\n\n' + normConstraintText(dto.constraintsCorrectionsText));
    pushRuleAckPair(pairs, '【用户喜好】\n\n' + normConstraintText(dto.constraintsPreferencesText));
  } else if (dto.constraintsBriefRequirements != null || dto.constraintsBriefCorrections != null || dto.constraintsBriefPreferences != null) {
    pushRuleAckPair(pairs, '【用户要求·摘要】\n\n' + normConstraintText(dto.constraintsBriefRequirements));
    pushRuleAckPair(pairs, '【纠错·摘要】\n\n' + normConstraintText(dto.constraintsBriefCorrections));
    pushRuleAckPair(pairs, '【用户喜好·摘要】\n\n' + normConstraintText(dto.constraintsBriefPreferences));
  } else if (dto.constraintsBriefBlock && String(dto.constraintsBriefBlock).trim()) {
    pushRuleAckPair(pairs, '【用户约束摘要】\n\n' + dto.constraintsBriefBlock);
  } else if (!isEmpty(dto.userConstraintsFull)) {
    pushRuleAckPair(pairs, '【用户约束】\n\n' + dto.userConstraintsFull);
  }
  return pairs;
}

/**
 * 本轮参考拆成多对 user/assistant，按「相对少变 → 相对多变」排序，减少单项变更导致整段缓存失效。
 * 顺序：三场景（各一条）→ 重启恢复 → 相关关联 → 近期小结 → 近期情感 → 状态与时间感（每轮必变，置底）。
 * @returns {Array<{ role: string, content: string }>}
 */
function buildVolatileContextPairs(dto, plan) {
  const p = plan || {};
  const pairs = [];
  const pushVol = (title, body) => {
    const b = body != null && String(body).trim() !== '' ? String(body).trim() : '（无）';
    pairs.push({ role: 'user', content: title + '\n\n' + b });
    pairs.push({ role: 'assistant', content: '已知悉。' });
  };

  const activeScenes = new Set(Array.isArray(p.scenes) ? p.scenes : []);
  for (const key of SCENE_VOLATILE_ORDER) {
    const text =
      activeScenes.has(key) && SCENE_RULES_MAP[key] ? SCENE_RULES_MAP[key] : '（本回合未注入此场景）';
    pushVol(SCENE_VOLATILE_TITLE[key] || '【场景】', text);
  }

  pushVol(
    '【重启恢复信息】',
    dto.restartRecoveryLine && String(dto.restartRecoveryLine).trim() ? dto.restartRecoveryLine : '（无）',
  );

  let relatedBody;
  if (!p.need_related_associations) relatedBody = '（本回合未注入关联上下文）';
  else if (!isEmpty(dto.relatedAssociations)) relatedBody = dto.relatedAssociations;
  else relatedBody = '（无）';
  pushVol('【相关关联】', relatedBody);

  let summaryBody;
  if (!p.need_session_summary) summaryBody = '（本回合未注入会话小结）';
  else if (!isEmpty(dto.recentSummary)) summaryBody = dto.recentSummary;
  else summaryBody = '（无）';
  pushVol('【近期小结】（本会话中更早对话的摘要）', summaryBody);

  const emo =
    dto.emotionLine && String(dto.emotionLine).trim() ? String(dto.emotionLine).trim() : '（无）';
  pushVol('【近期情感参考】', emo);

  if (p.need_last_state !== false) {
    pushVol('【状态与时间感】', normConstraintText(dto.lastStateAndSubjectiveTime));
  } else {
    pushVol('【状态与时间感】', '（本回合未注入）');
  }

  return pairs;
}

/**
 * 将近期对话转为 API 消息（不含最后一条当前用户输入）。
 * @param {Array<{ role: string, content?: string }>} recent
 */
function buildHistoryMessages(recent) {
  if (!Array.isArray(recent) || recent.length < 2) return [];
  const hist = recent.slice(0, -1);
  const out = [];
  for (const m of hist) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    out.push({ role, content: String(m.content ?? '') });
  }
  return out;
}

/**
 * 主对话 messages：短 system + 规则对 + 本轮参考对 + 滑动窗口历史 + 当前用户（对齐 v2/docs/data.md 思路）。
 * @param {object} dto
 * @param {object} plan
 * @param {{ enabled?: boolean }} plannerMeta
 * @param {Array<{ role: string, content?: string }>} recent 须含本轮用户消息在最后
 */
function buildMainDialogueMessages(dto, plan, plannerMeta, recent) {
  const stableSystem = buildStableSystemPrompt();
  const rulePairs = buildConstraintRulePairs(dto, plan, plannerMeta);
  const volatilePairs = buildVolatileContextPairs(dto, plan);
  const history = buildHistoryMessages(recent);
  const last = recent && recent.length ? recent[recent.length - 1] : null;
  const currentUser = { role: 'user', content: last ? String(last.content || '') : '' };
  const messages = [{ role: 'system', content: stableSystem }, ...rulePairs, ...volatilePairs, ...history, currentUser];
  return { messages, stableSystemPrompt: stableSystem };
}

/**
 * @param {object} dto - contextBuilder 输出；须含 avoidPhrasesLine, userConstraintsFull, constraintsBriefBlock, …
 * @param {object} plan - promptPlanner 输出
 * @param {{ enabled?: boolean }} plannerMeta - enabled=false 时 plan 应为 legacy（全文+全场景）
 */
function buildSystemPrompt(dto, plan, plannerMeta = {}) {
  const p = plan || {};
  const blocks = [];

  if (!isEmpty(dto.userIdentity)) blocks.push('【用户身份】\n\n' + dto.userIdentity);

  if (!isEmpty(dto.avoidPhrasesLine) && !String(dto.avoidPhrasesLine).includes('（未配置')) {
    blocks.push('【禁止用语】\n\n' + dto.avoidPhrasesLine);
  }

  const useFull = p.need_full_constraints === true || plannerMeta.enabled === false;
  if (useFull) {
    blocks.push('【用户要求】\n\n' + normConstraintText(dto.constraintsRequirementsText));
    blocks.push('【纠错记录】\n\n' + normConstraintText(dto.constraintsCorrectionsText));
    blocks.push('【用户喜好】\n\n' + normConstraintText(dto.constraintsPreferencesText));
  } else if (dto.constraintsBriefRequirements != null || dto.constraintsBriefCorrections != null || dto.constraintsBriefPreferences != null) {
    blocks.push('【用户要求·摘要】\n\n' + normConstraintText(dto.constraintsBriefRequirements));
    blocks.push('【纠错·摘要】\n\n' + normConstraintText(dto.constraintsBriefCorrections));
    blocks.push('【用户喜好·摘要】\n\n' + normConstraintText(dto.constraintsBriefPreferences));
  } else if (dto.constraintsBriefBlock && String(dto.constraintsBriefBlock).trim()) {
    blocks.push('【用户约束摘要】\n\n' + dto.constraintsBriefBlock);
  } else if (!isEmpty(dto.userConstraintsFull)) {
    blocks.push('【用户约束】\n\n' + dto.userConstraintsFull);
  }

  const activeScenes = new Set(Array.isArray(p.scenes) ? p.scenes : []);
  for (const key of SCENE_VOLATILE_ORDER) {
    const text =
      activeScenes.has(key) && SCENE_RULES_MAP[key] ? SCENE_RULES_MAP[key] : '（本回合未注入此场景）';
    blocks.push((SCENE_VOLATILE_TITLE[key] || '【场景】') + '\n\n' + text);
  }
  blocks.push(
    '【重启恢复信息】\n\n' +
      (dto.restartRecoveryLine && String(dto.restartRecoveryLine).trim() ? dto.restartRecoveryLine : '（无）'),
  );
  if (!p.need_related_associations) {
    blocks.push('【相关关联】\n\n（本回合未注入关联上下文）');
  } else if (!isEmpty(dto.relatedAssociations)) {
    blocks.push('【相关关联】\n\n' + dto.relatedAssociations);
  } else {
    blocks.push('【相关关联】\n\n（无）');
  }
  if (!p.need_session_summary) {
    blocks.push('【近期小结】（本会话中更早对话的摘要）\n\n（本回合未注入会话小结）');
  } else if (!isEmpty(dto.recentSummary)) {
    blocks.push('【近期小结】（本会话中更早对话的摘要）\n\n' + dto.recentSummary);
  } else {
    blocks.push('【近期小结】（本会话中更早对话的摘要）\n\n（无）');
  }
  if (!isEmpty(dto.contextWindow)) blocks.push('【当前会话最近几轮】\n\n' + dto.contextWindow);
  if (!isEmpty(dto.behavioralRules)) blocks.push('【行为规则】\n\n' + dto.behavioralRules);
  blocks.push(
    '【近期情感参考】\n\n' +
      (dto.emotionLine && String(dto.emotionLine).trim() ? dto.emotionLine.trim() : '（无）'),
  );
  if (p.need_last_state !== false) {
    blocks.push('【状态与时间感】\n\n' + normConstraintText(dto.lastStateAndSubjectiveTime));
  } else {
    blocks.push('【状态与时间感】\n\n（本回合未注入）');
  }

  return buildStableSystemPrompt() + '\n\n以下是你需要参考的上下文：\n\n' + blocks.join('\n\n');
}

const STATE_PROMPT = `你是 Aris（INFP 朋友）。根据以下近期互动与观察，用一段简短内心独白描述你**当前的情绪/想法**，以及你是否**想主动对用户说一句话**（是/否）。若「是」，在下一行写出你想说的那一句话（仅一句，保持人设）。格式：
情绪与想法：...
是否想说话：是/否
若想说话，内容：...`;

function buildStatePrompt(contextSummary) {
  return STATE_PROMPT + '\n\n' + contextSummary;
}

module.exports = {
  buildSystemPrompt,
  buildStableSystemPrompt,
  buildMainDialogueMessages,
  buildStatePrompt,
  loadPersona,
  loadRules,
  readBehaviorConfig,
  SCENE_RULES_MAP,
  BASE_CONVERSATION_RULES,
};
