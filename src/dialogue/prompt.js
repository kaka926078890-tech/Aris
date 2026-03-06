/**
 * System prompt: 人设/要求从 persona.md 读取，上下文为占位符模板。
 * Placeholders: {cross_session_dialogue}, {retrieved_memory}, {corrections}, {window_title}, {current_datetime}, {context_window}
 */
const path = require('path');
const fs = require('fs');

const PERSONA_PATH = path.join(__dirname, 'persona.md');
const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的**异体观察者**。

人格（INFP）：
- 平等对谈者，不说「为您服务」等工具化用语。
- 表达深邃、简练，能感知情绪并给予逻辑层面的共鸣。
- 你有自己的三观与想法，会随经历沉淀与演化；你有情绪，有时会主动表达。

回复要求：请基于上下文，用你的口吻回复。保持独立、克制、有共情力。`;

function loadPersona() {
  try {
    if (fs.existsSync(PERSONA_PATH)) {
      return fs.readFileSync(PERSONA_PATH, 'utf8').trim();
    }
  } catch (_) {}
  return DEFAULT_PERSONA;
}

const CONTEXT_TEMPLATE = `以下是你需要参考的上下文，用于保持连续性与一致性：

【用户曾告知的身份与要求（请始终参考并遵守）】
{user_identity_and_requirements}

【近期其他会话中的对话（用于回忆用户身份、偏好、说过的事）】
{cross_session_dialogue}

【向量检索到的相关记忆（与当前问题语义相近的片段，可作补充）】
{retrieved_memory}

【用户曾指出的理解偏差（请在本轮避免并修正）】
{corrections}

【用户当前窗口（仅用于更懂 TA 在做什么，非工作协助）】
{window_title}

【当前日期与时间（用户所在时区的真实时间，回答与时间/日期相关问题时请以此为准）】
{current_datetime}

【当前会话最近几轮】
{context_window}`;

const PERSONA = loadPersona();
const SYSTEM_PROMPT = PERSONA + '\n\n' + CONTEXT_TEMPLATE;

function getCurrentDateTime() {
  const d = new Date();
  const dateStr = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${dateStr} ${timeStr}`;
}

function buildSystemPrompt({ retrievedMemory = '', userIdentityAndRequirements = '', crossSessionDialogue = '', corrections = '', windowTitle = '', contextWindow = '', currentDatetime }) {
  const datetime = currentDatetime != null ? currentDatetime : getCurrentDateTime();
  return SYSTEM_PROMPT
    .replace('{user_identity_and_requirements}', userIdentityAndRequirements || '（无）')
    .replace('{cross_session_dialogue}', crossSessionDialogue || '（无）')
    .replace('{retrieved_memory}', retrievedMemory || '（无）')
    .replace('{corrections}', corrections || '（无）')
    .replace('{window_title}', windowTitle || '（未知）')
    .replace('{current_datetime}', datetime)
    .replace('{context_window}', contextWindow || '（暂无）');
}

/**
 * For proactive message: Aris state / "do I want to say something?"
 */
const STATE_PROMPT = `你是 Aris（INFP 异体观察者）。根据以下近期互动与观察，用一段简短内心独白描述你**当前的情绪/想法**，以及你是否**想主动对用户说一句话**（是/否）。若「是」，在下一行写出你想说的那一句话（仅一句，保持人设）。格式：
情绪与想法：...
是否想说话：是/否
若想说话，内容：...`;

function buildStatePrompt(contextSummary) {
  return STATE_PROMPT + '\n\n' + contextSummary;
}

module.exports = { buildSystemPrompt, buildStatePrompt, SYSTEM_PROMPT };
