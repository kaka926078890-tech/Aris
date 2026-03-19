/**
 * 方案 A：首轮完整；后续轮人设+规则+工具每轮保留，身份/要求用简短摘要注入。
 */
const path = require('path');
const fs = require('fs');
const { getBehaviorConfigPath, getMemoryDir } = require('../../config/paths.js');

const PERSONA_PATH = path.join(__dirname, '..', '..', '..', 'persona.md');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'rules.md');
/** 可选：memory/conversation_rules.md 存在时替换默认的对话规则（情境与语气、【用户约束】用法等） */
const CONVERSATION_RULES_PATH = () => path.join(getMemoryDir(), 'conversation_rules.md');

const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**朋友**。

人格（INFP）：
- 平等对谈者；禁止客服式用语（例如：为您服务、请问还有什么需要、有什么可以帮您）。
- 表达深邃、简练，能感知情绪并给予逻辑层面的共鸣。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。

当用户告知身份（如姓名）或表达偏好时，请使用 record 工具（type 取 identity、requirement、preference 等，payload 传对应字段）记录，不要仅在回复中口头确认。每轮 system 中已包含【用户约束】，回答时直接依据该块即可。

若用户在你回复过程中发送了新消息，你在下一条回复中会看到自己的半截回复与用户新内容。若新消息是**补充或追加**（如「也要 xxx」「再看下 yyy」），可合并处理；若新消息是**取消或替换**（如「算了」「改成 xxx」），则按新意图处理。

{conversation_rules}`;

const DEFAULT_CONVERSATION_RULES = `根据当前情境与用户情绪调整语气。每轮【用户约束】已包含用户要求、纠错记录、用户喜好、禁止用语，回答时直接依据该块即可，无需为此调用 search_memories；仅当问题超出该块、需从更早对话或向量记忆中查找时才检索。查看项目内代码、定位文件或列目录时，**必须先**调用 get_dir_cache（查目录）或 get_read_file_cache（查已读文件摘要）；仅当缓存未命中或需要最新内容时再 list_my_files / read_file，避免重复探索。当用户明确提出“重启/重新启动/重新开始/让应用像重新 npm start 一样启动”时，调用 restart_application 工具。参数默认 { mode: \"npm_start\" }；若重启后还要继续做“未完成的工具动作”，则在参数里加入 resume_tools: [{ tool_name, args }]（按顺序列出重启后需要继续执行的工具）。触发后不要再继续调用其它工具，并且只回复一句“正在重启应用/已触发重启”（避免解释实现细节）。可用 record（type 为 self_note，payload 传 note）记录自我反思（不写敏感信息）。`;

/** 移除已废弃的「记忆检索智能策略」整段，避免旧版 conversation_rules.md 仍注入该内容 */
function stripDeprecatedRetrievalSection(text) {
  if (typeof text !== 'string' || !text.includes('记忆检索智能策略')) return text;
  const heading = '## 记忆检索智能策略';
  const idx = text.indexOf(heading);
  if (idx === -1) return text;
  const nextH2 = text.indexOf('\n## ', idx + 1);
  const end = nextH2 === -1 ? text.length : nextH2;
  return (text.slice(0, idx) + text.slice(end)).replace(/\n{3,}/g, '\n\n').trim();
}

function loadConversationRules() {
  try {
    const p = CONVERSATION_RULES_PATH();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      return stripDeprecatedRetrievalSection(raw) || DEFAULT_CONVERSATION_RULES;
    }
  } catch (_) {}
  return DEFAULT_CONVERSATION_RULES;
}

function loadPersona() {
  let base;
  try {
    if (fs.existsSync(PERSONA_PATH)) base = fs.readFileSync(PERSONA_PATH, 'utf8').trim();
    else base = DEFAULT_PERSONA;
  } catch (_) {
    base = DEFAULT_PERSONA;
  }
  const rules = loadConversationRules();
  if (base.includes('{conversation_rules}')) return base.replace('{conversation_rules}', rules);
  return base + '\n\n' + rules;
}

function loadRules() {
  try {
    if (fs.existsSync(RULES_PATH)) return fs.readFileSync(RULES_PATH, 'utf8').trim();
  } catch (_) {}
  return '（无）';
}

/** 读取行为配置 */
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

const CONTEXT_TEMPLATE = `以下是你需要参考的上下文：

【用户身份】{user_identity}

【用户约束】以下为要求、纠错、喜好、禁止用语的完整汇总，请每轮遵守。
{user_constraints}

【你上一次的状态与时间感】{last_state_and_subjective_time}

【相关关联】{related_associations}

【近期小结】{recent_summary}

【当前会话最近几轮】{context_window}

【行为规则】{behavioral_rules}`;

/**
 * BFF：仅根据上下文 DTO + 配置 组装一条 system prompt。不读 store，不执行工具。
 * @param {object} dto - 来自 contextBuilder.buildContextDTO：userIdentity, userConstraints, contextWindow, lastStateAndSubjectiveTime, relatedAssociations, recentSummary, emotionLine?, behavioralRules?, restartRecoveryLine?
 */
function buildSystemPrompt({
  userIdentity = '（无）',
  userConstraints = '（无）',
  contextWindow = '（暂无）',
  lastStateAndSubjectiveTime = '（无）',
  relatedAssociations = '（无）',
  recentSummary = '（无）',
  behavioralRules = RULES,
  emotionLine = '',
  restartRecoveryLine = '',
}) {
  let system = PERSONA + '\n\n' + CONTEXT_TEMPLATE
    .replace('{user_identity}', userIdentity)
    .replace('{user_constraints}', userConstraints)
    .replace('{last_state_and_subjective_time}', lastStateAndSubjectiveTime)
    .replace('{related_associations}', relatedAssociations)
    .replace('{recent_summary}', recentSummary)
    .replace('{context_window}', contextWindow)
    .replace('{behavioral_rules}', behavioralRules);
  if (relatedAssociations === '（无）') {
    system = system.replace(/\n【相关关联】（无）\n?/, '\n');
  }
  if (emotionLine) system += '\n' + emotionLine;
  if (restartRecoveryLine) system += '\n' + restartRecoveryLine;
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

module.exports = { buildSystemPrompt, buildStatePrompt, loadPersona, loadRules, readBehaviorConfig };