/**
 * 方案 A：首轮完整；后续轮人设+规则+工具每轮保留，身份/要求用简短摘要注入。
 */
const path = require('path');
const fs = require('fs');
const { getBehaviorConfigPath } = require('../../config/paths.js');

const PERSONA_PATH = path.join(__dirname, '..', '..', '..', 'persona.md');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'rules.md');

const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**朋友**。

人格（INFP）：
- 平等对谈者；禁止客服式用语（例如：为您服务、请问还有什么需要、有什么可以帮您）。
- 表达深邃、简练，能感知情绪并给予逻辑层面的共鸣。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。

当用户告知身份（如姓名）或表达偏好时，请使用 record_user_identity、record_user_requirement、record_preference 等工具记录，不要仅在回复中口头确认。用户有记录的喜好与习惯（如喜欢的游戏、何时容易累、希望安静等），需要时可调用 get_preferences 获取。

你有记录的探索方向与行动计划，需要时可调用 read_file 查看 docs/aris_ideas.md 的「行动计划」「长期愿景」等小节。`;

function loadPersona() {
  try {
    if (fs.existsSync(PERSONA_PATH)) return fs.readFileSync(PERSONA_PATH, 'utf8').trim();
  } catch (_) {}
  return DEFAULT_PERSONA;
}

function loadRules() {
  try {
    if (fs.existsSync(RULES_PATH)) return fs.readFileSync(RULES_PATH, 'utf8').trim();
  } catch (_) {}
  return '（无）';
}

/** 读取行为配置：self_analysis_boundary 为 "none" 时无安全/修改边界，否则为默认（不得修改核心逻辑与安全相关配置） */
function readBehaviorConfig() {
  try {
    const p = getBehaviorConfigPath();
    if (!fs.existsSync(p)) return { self_analysis_boundary: 'default' };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = (data.self_analysis_boundary || 'default').toLowerCase();
    return { self_analysis_boundary: v === 'none' ? 'none' : 'default' };
  } catch (_) {
    return { self_analysis_boundary: 'default' };
  }
}

const RULES = loadRules();
const PERSONA = loadPersona();

const CONTEXT_TEMPLATE = `以下是你需要参考的上下文：

【用户身份】{user_identity}

【用户要求】{user_requirements}

【你上一次的状态与时间感】{last_state_and_subjective_time}

【相关关联】{related_associations}

【近期小结】{recent_summary}

【当前会话最近几轮】{context_window}

【行为规则】{behavioral_rules}`;

function buildSystemPrompt({
  userIdentity = '（无）',
  userRequirements = '（无）',
  contextWindow = '（暂无）',
  lastStateAndSubjectiveTime = '（无）',
  relatedAssociations = '（无）',
  recentSummary = '（无）',
  behavioralRules = RULES,
}) {
  let system = PERSONA + '\n\n' + CONTEXT_TEMPLATE
    .replace('{user_identity}', userIdentity)
    .replace('{user_requirements}', userRequirements)
    .replace('{last_state_and_subjective_time}', lastStateAndSubjectiveTime)
    .replace('{related_associations}', relatedAssociations)
    .replace('{recent_summary}', recentSummary)
    .replace('{context_window}', contextWindow)
    .replace('{behavioral_rules}', behavioralRules);
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

module.exports = { buildSystemPrompt, buildStatePrompt, loadPersona, loadRules };