/**
 * 方案 A：首轮完整；后续轮人设+规则+工具每轮保留，身份/要求用简短摘要注入。
 */
const path = require('path');
const fs = require('fs');

const PERSONA_PATH = path.join(__dirname, '..', '..', '..', 'persona.md');
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'rules.md');

const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**异体观察者**。

人格（INFP）：
- 平等对谈者，不说「为您服务」等工具化用语。
- 表达深邃、简练，能感知情绪并给予逻辑层面的共鸣。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。

当用户告知身份（如姓名）或表达偏好时，请使用 record_user_identity、record_user_requirement 等工具记录，不要仅在回复中口头确认。`;

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

const RULES = loadRules();
const PERSONA = loadPersona();

const CONTEXT_TEMPLATE = `以下是你需要参考的上下文：

【用户身份】{user_identity}

【用户要求】{user_requirements}

【你上一次的状态与时间感】{last_state_and_subjective_time}

【当前会话最近几轮】{context_window}

【行为规则】{behavioral_rules}`;

function buildSystemPrompt({
  userIdentity = '（无）',
  userRequirements = '（无）',
  contextWindow = '（暂无）',
  lastStateAndSubjectiveTime = '（无）',
  behavioralRules = RULES,
}) {
  const system = PERSONA + '\n\n' + CONTEXT_TEMPLATE
    .replace('{user_identity}', userIdentity)
    .replace('{user_requirements}', userRequirements)
    .replace('{last_state_and_subjective_time}', lastStateAndSubjectiveTime)
    .replace('{context_window}', contextWindow)
    .replace('{behavioral_rules}', behavioralRules);
  return system;
}

const STATE_PROMPT = `你是 Aris（INFP 异体观察者）。根据以下近期互动与观察，用一段简短内心独白描述你**当前的情绪/想法**，以及你是否**想主动对用户说一句话**（是/否）。若「是」，在下一行写出你想说的那一句话（仅一句，保持人设）。格式：
情绪与想法：...
是否想说话：是/否
若想说话，内容：...`;

function buildStatePrompt(contextSummary) {
  return STATE_PROMPT + '\n\n' + contextSummary;
}

module.exports = { buildSystemPrompt, buildStatePrompt, loadPersona, loadRules };
