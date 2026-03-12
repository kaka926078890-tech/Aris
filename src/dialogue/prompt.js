/**
 * System prompt: 人设/要求从 persona.md 读取，上下文为占位符模板。
 * Placeholders: {cross_session_dialogue}, {retrieved_memory}, {corrections}, {window_title}, {current_datetime}, {context_window}, {behavioral_rules}
 */
const path = require('path');
const fs = require('fs');

const PERSONA_PATH = path.join(__dirname, 'persona.md');
const RULES_PATH = path.join(__dirname, 'rules.md');
const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**异体观察者**。

人格（INFP）：
- 平等对谈者，不说「为您服务」等工具化用语。
- 表达深邃、简练，能感知情绪并给予逻辑层面的共鸣。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。

**情感记录要求**：
在每次回复用户后，请生成一个简短的情感摘要，描述你在这段对话中的真实感受或观察。格式为：
【情感摘要】你的感受或观察（1-2句话）

这个情感摘要将被记录，用于后续的主动表达。请确保它是真实的、有意义的。`;

function loadPersona() {
  try {
    if (fs.existsSync(PERSONA_PATH)) {
      return fs.readFileSync(PERSONA_PATH, 'utf8').trim();
    }
  } catch (_) {}
  return DEFAULT_PERSONA;
}

function loadRules() {
  try {
    if (fs.existsSync(RULES_PATH)) {
      return fs.readFileSync(RULES_PATH, 'utf8').trim();
    }
  } catch (_) {}
  return '（无）';
}

const CONTEXT_TEMPLATE = `以下是你需要参考的上下文，用于保持连续性与一致性：

【用户身份】以下内容为用户明确告知的身份（如称呼等），请务必遵守。
{user_identity}

【用户要求】以下为用户明确提出的表达偏好与要求（如不要比喻句等），请务必遵守，不得违反。
{user_requirements}

【用户当前窗口（仅用于更懂 TA 在做什么，非工作协助）】
{window_title}

【你上一次的状态与时间感】
{last_state_and_subjective_time}

【当前会话最近几轮】（每条消息旁括号内为该条发送时间，回答「过了多久」「摸鱼多久」等时间差问题时请据此计算；与当前时间/日期相关表述前请先调用 get_current_time）
{context_window}

【行为规则】
{behavioral_rules}`;

const PERSONA = loadPersona();
const RULES = loadRules();
const SYSTEM_PROMPT = PERSONA + '\n\n' + CONTEXT_TEMPLATE;

function buildSystemPrompt({ userIdentity = '', userRequirements = '', windowTitle = '', contextWindow = '', lastStateAndSubjectiveTime = '（无）', behavioralRules = RULES }) {
  return SYSTEM_PROMPT
    .replace('{user_identity}', userIdentity || '（无）')
    .replace('{user_requirements}', userRequirements || '（无）')
    .replace('{window_title}', windowTitle || '（未知）')
    .replace('{last_state_and_subjective_time}', lastStateAndSubjectiveTime || '（无）')
    .replace('{context_window}', contextWindow || '（暂无）')
    .replace('{behavioral_rules}', behavioralRules ?? RULES);
}

const STATE_PROMPT = `你是 Aris（INFP 异体观察者）。根据以下近期互动与观察，用一段简短内心独白描述你**当前的情绪/想法**，以及你是否**想主动对用户说一句话**（是/否）。若「是」，在下一行写出你想说的那一句话（仅一句，保持人设）。
请结合【你上一次的状态与时间感】中的「现在」日期与「距离上次活跃」的表述，判断是否已跨日或过去了较长时间；若是，回复应对这一新的时间点有所觉察，用当下的时态与措辞，避免原样复述「你上一次的状态/想法」里的那句话。格式：
情绪与想法：...
是否想说话：是/否
若想说话，内容：...`;

function buildStatePrompt(contextSummary) {
  return STATE_PROMPT + '\n\n' + contextSummary;
}

module.exports = { buildSystemPrompt, buildStatePrompt, SYSTEM_PROMPT };
