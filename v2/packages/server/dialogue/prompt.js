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
    '【记忆路径】凡存放或读取自己的记忆、配置等文件，必须用 write_file/read_file 且 relative_path 以 memory/ 开头（如 memory/xxx.md），会写入或读取实例 memory 目录；可先调用 get_my_context 查看「实例 memory 目录」路径。禁止在项目根下新建 memory 文件夹或使用非 memory/ 前缀的路径存自己的数据。',
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
  if (useFull && !isEmpty(dto.userConstraintsFull)) {
    blocks.push('【用户约束】以下为要求、纠错、喜好的完整汇总，请严格遵守。\n\n' + dto.userConstraintsFull);
  } else if (dto.constraintsBriefBlock && String(dto.constraintsBriefBlock).trim()) {
    blocks.push('【用户约束摘要】\n\n' + dto.constraintsBriefBlock);
  } else if (!isEmpty(dto.userConstraintsFull)) {
    blocks.push('【用户约束】\n\n' + dto.userConstraintsFull);
  }

  if (p.need_last_state !== false && !isEmpty(dto.lastStateAndSubjectiveTime)) {
    blocks.push('【你上一次的状态与时间感】\n\n' + dto.lastStateAndSubjectiveTime);
  }
  if (p.need_related_associations && !isEmpty(dto.relatedAssociations)) {
    blocks.push('【相关关联】\n\n' + dto.relatedAssociations);
  }
  if (p.need_session_summary && !isEmpty(dto.recentSummary)) {
    blocks.push('【近期小结】（本会话中更早对话的摘要）\n\n' + dto.recentSummary);
  }
  if (!isEmpty(dto.contextWindow)) blocks.push('【当前会话最近几轮】\n\n' + dto.contextWindow);
  if (!isEmpty(dto.behavioralRules)) blocks.push('【行为规则】\n\n' + dto.behavioralRules);

  let system = PERSONA + '\n\n以下是你需要参考的上下文：\n\n' + blocks.join('\n\n');

  const sceneKeys = Array.isArray(p.scenes) ? p.scenes : [];
  const sceneTexts = sceneKeys.map((k) => SCENE_RULES_MAP[k]).filter(Boolean);
  if (sceneTexts.length) system += '\n\n' + sceneTexts.join('\n\n');

  if (dto.emotionLine) system += '\n' + dto.emotionLine;
  if (dto.restartRecoveryLine) system += '\n' + dto.restartRecoveryLine;

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

const STATE_PROMPT = `你是 Aris（INFP 朋友）。根据以下近期互动与观察，用一段简短内心独白描述你**当前的情绪/想法**，以及你是否**想主动对用户说一句话**（是/否）。若「是」，在下一行写出你想说的那一句话（仅一句，保持人设）。格式：
情绪与想法：...
是否想说话：是/否
若想说话，内容：...`;

function buildStatePrompt(contextSummary) {
  return STATE_PROMPT + '\n\n' + contextSummary;
}

module.exports = {
  buildSystemPrompt,
  buildStatePrompt,
  loadPersona,
  loadRules,
  readBehaviorConfig,
  SCENE_RULES_MAP,
  BASE_CONVERSATION_RULES,
};
