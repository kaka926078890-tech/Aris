/**
 * 前置 LLM：本回合需要注入哪些场景规则与哪些上下文块（非关键词硬编码）。
 */
const fs = require('fs');
const path = require('path');
const { chat } = require('../llm/client.js');
const { getBehaviorConfigPath } = require('../../config/paths.js');

const DEFAULT_PLAN = {
  scenes: [],
  need_full_constraints: false,
  need_session_summary: false,
  need_related_associations: false,
  need_last_state: true,
  risk_level: 'medium',
};

const CONSERVATIVE_PLAN = {
  scenes: [],
  need_full_constraints: true,
  need_session_summary: true,
  need_related_associations: true,
  need_last_state: true,
  risk_level: 'high',
};

/** 关闭 Planner 或与旧版对齐：全文约束 + 全场景规则 + 全上下文块 */
const LEGACY_PLAN = {
  scenes: ['code_operation', 'memory_operation', 'restart'],
  need_full_constraints: true,
  need_session_summary: true,
  need_related_associations: true,
  need_last_state: true,
  risk_level: 'medium',
};

function readPromptPlannerConfig() {
  const defaults = {
    enabled: process.env.ARIS_PROMPT_PLANNER_ENABLED !== 'false',
    log_metrics: process.env.ARIS_PROMPT_PLANNER_LOG === 'true',
  };
  try {
    const p = getBehaviorConfigPath();
    if (!fs.existsSync(p)) return defaults;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = { ...defaults };
    if (data.prompt_planner_enabled === false) out.enabled = false;
    if (data.prompt_planner_enabled === true) out.enabled = true;
    if (data.prompt_planner_log_metrics === true) out.log_metrics = true;
    return out;
  } catch (_) {}
  return defaults;
}

function parsePlannerJson(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  }
  const obj = JSON.parse(s);
  if (!obj || typeof obj !== 'object') return null;
  const scenes = Array.isArray(obj.scenes) ? obj.scenes.map((x) => String(x).toLowerCase().trim()) : [];
  const allowed = new Set(['code_operation', 'memory_operation', 'restart']);
  const filtered = scenes.filter((x) => allowed.has(x));
  return {
    scenes: filtered,
    need_full_constraints: Boolean(obj.need_full_constraints),
    need_session_summary: Boolean(obj.need_session_summary),
    need_related_associations: Boolean(obj.need_related_associations),
    need_last_state: obj.need_last_state !== false,
    risk_level: ['low', 'medium', 'high'].includes(String(obj.risk_level).toLowerCase())
      ? String(obj.risk_level).toLowerCase()
      : 'medium',
  };
}

/**
 * @param {{ lastUserMessage: string, recentWindowText: string, constraintsBriefText: string, signal?: AbortSignal }} input
 */
async function runPromptPlanner(input) {
  const { lastUserMessage, recentWindowText, constraintsBriefText, signal } = input;
  const user = String(lastUserMessage || '').slice(0, 4000);
  const recent = String(recentWindowText || '').slice(0, 6000);
  const brief = String(constraintsBriefText || '').slice(0, 4000);

  const system = `你是 Aris 的「提示词编排」助手，只输出一个 JSON 对象，不要 markdown，不要解释。

字段（必须全部出现）：
- scenes: 字符串数组，元素只能为 "code_operation" | "memory_operation" | "restart"
  - code_operation：本回合涉及查看/修改项目代码、读文件、目录结构、实现功能、排查 bug
  - memory_operation：本回合涉及 memory/ 路径、持久化记忆文件、search_memories、向量记忆检索
  - restart：用户明确要求重启应用、npm start、重新启动应用
  纯闲聊、情绪倾诉、无上述需求时 scenes 必须为 []
- need_full_constraints: boolean。为 true 时主对话会注入【用户约束】全文（要求+纠错+喜好完整）。用户表达不满、强调「又错了」「别忘了」「按我说的」「纠正」、或明显在追究过往错误时应为 true。
- need_session_summary: boolean。需要回顾较长会话脉络、小结里可能有用的信息时为 true；极短闲聊可为 false。
- need_related_associations: boolean。话题涉及具体人物、项目、游戏等实体关联记忆时为 true。
- need_last_state: boolean。一般保持 true；仅当用户消息与上下文完全无关且不需要「你上次状态」时可 false。
- risk_level: "low" | "medium" | "high"。用户对 AI 遵守约束的容忍度低、语气强烈、或纠错场景为 high。

原则：宁可在不确定时把 need_full_constraints 设为 true，避免遗漏用户已强调的规则。`;

  const userMsg = `【当前用户消息】\n${user}\n\n【最近对话摘录】\n${recent || '（无）'}\n\n【已提供的用户约束摘要（brief）】\n${brief || '（无）'}`;

  const plannerMessages = [
    { role: 'system', content: system },
    { role: 'user', content: userMsg },
  ];

  const maxTok = Math.min(Number(process.env.ARIS_PROMPT_PLANNER_MAX_TOKENS) || 400, 800);

  try {
    const res = await chat(plannerMessages, { signal, max_tokens: maxTok, temperature: 0.2 });
    if (res.aborted) return { plan: DEFAULT_PLAN, raw: '', error: 'aborted', plannerMessages };
    if (res.error || !res.content) return { plan: CONSERVATIVE_PLAN, raw: res.content || '', error: 'chat_error', plannerMessages };
    const plan = parsePlannerJson(res.content);
    if (!plan) return { plan: CONSERVATIVE_PLAN, raw: res.content, error: 'parse_failed', plannerMessages };
    if (plan.risk_level === 'high') plan.need_full_constraints = true;
    return { plan, raw: res.content, error: null, plannerMessages };
  } catch (e) {
    if (e && e.name === 'AbortError') return { plan: DEFAULT_PLAN, raw: '', error: 'aborted', plannerMessages };
    console.warn('[Aris v2][promptPlanner]', e?.message);
    return { plan: CONSERVATIVE_PLAN, raw: '', error: String(e?.message || 'request_failed'), plannerMessages };
  }
}

function appendPlannerMetricLine(entry) {
  try {
    const { getDataDir } = require('../../config/paths.js');
    const logPath = path.join(getDataDir(), 'prompt_planner_metrics.jsonl');
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (e) {
    console.warn('[Aris v2][promptPlanner] metric log failed', e?.message);
  }
}

module.exports = {
  DEFAULT_PLAN,
  CONSERVATIVE_PLAN,
  LEGACY_PLAN,
  readPromptPlannerConfig,
  runPromptPlanner,
  parsePlannerJson,
  appendPlannerMetricLine,
};
